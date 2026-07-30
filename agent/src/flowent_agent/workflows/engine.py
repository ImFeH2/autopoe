import asyncio
import json
from collections.abc import Awaitable, Callable
from typing import Any, Protocol
from uuid import uuid4

from flowent_agent.agents import AgentExecutionResult, AgentMessage
from flowent_agent.agents.models import AgentRunRequest
from flowent_agent.persistence.workflows import WorkflowStore
from flowent_agent.workflows.models import (
    AgentNode,
    ApprovalDecision,
    ApprovalNode,
    LoopNode,
    WorkflowNode,
    WorkflowRunRequest,
    WorkflowRunResult,
)
from flowent_agent.workflows.template import TemplateRenderer, evaluate_condition

EmitWorkflowEvent = Callable[
    [str, dict[str, Any], str | None],
    Awaitable[None],
]


class WorkflowNodeError(RuntimeError):
    def __init__(self, node_id: str, message: str) -> None:
        super().__init__(message)
        self.node_id = node_id


class AgentExecutor(Protocol):
    async def run(
        self,
        request: AgentRunRequest,
        emit: Callable[[str, dict[str, Any]], Awaitable[None]],
    ) -> AgentExecutionResult: ...


class WorkflowEngine:
    def __init__(self, workflows: WorkflowStore, agents: AgentExecutor) -> None:
        self.workflows = workflows
        self.agents = agents
        self.renderer = TemplateRenderer()
        self.pending_approvals: dict[str, asyncio.Future[ApprovalDecision]] = {}

    async def run(
        self,
        request: WorkflowRunRequest,
        emit: EmitWorkflowEvent,
    ) -> WorkflowRunResult:
        version = await self.workflows.get_version(
            request.workflow_id,
            request.version,
        )
        if version is None:
            message = f"Published workflow not found: {request.workflow_id}"
            await emit("workflow.failed", {"message": message}, None)
            return WorkflowRunResult(
                run_id=request.run_id,
                status="failed",
                error=message,
            )

        await self.workflows.start_run(request.run_id, version.id, request.input)
        await emit(
            "workflow.started",
            {
                "workflow_id": request.workflow_id,
                "workflow_name": version.definition.name,
                "version": version.version,
            },
            None,
        )
        semaphore = asyncio.Semaphore(version.definition.max_parallelism)
        context: dict[str, Any] = {
            "input": request.input,
            "outputs": {},
        }
        try:
            output = await self.run_graph(
                request.run_id,
                version.definition.nodes,
                context,
                semaphore,
                emit,
            )
            await self.workflows.finish_run(request.run_id, "completed", output)
            await emit("workflow.completed", {"output": output}, None)
            return WorkflowRunResult(
                run_id=request.run_id,
                status="completed",
                output=output,
            )
        except asyncio.CancelledError:
            await self.workflows.finish_run(request.run_id, "cancelled")
            await emit("workflow.cancelled", {}, None)
            raise
        except Exception as error:
            message = str(error) or type(error).__name__
            payload: dict[str, Any] = {"message": message}
            if isinstance(error, WorkflowNodeError):
                payload["node_id"] = error.node_id
            await self.workflows.finish_run(
                request.run_id,
                "failed",
                error=message,
            )
            await emit("workflow.failed", payload, None)
            return WorkflowRunResult(
                run_id=request.run_id,
                status="failed",
                error=message,
            )

    async def run_graph(
        self,
        workflow_run_id: str,
        nodes: list[WorkflowNode],
        context: dict[str, Any],
        semaphore: asyncio.Semaphore,
        emit: EmitWorkflowEvent,
    ) -> dict[str, Any]:
        pending = {node.id: node for node in nodes}
        outputs: dict[str, Any] = {}
        while pending:
            ready = [
                node
                for node in pending.values()
                if all(dependency in outputs for dependency in node.depends_on)
            ]
            if not ready:
                raise RuntimeError("Workflow graph cannot make progress")
            graph_context = {
                **context,
                "outputs": {**context.get("outputs", {}), **outputs},
            }
            results = await asyncio.gather(
                *(
                    self.run_node(
                        workflow_run_id,
                        node,
                        graph_context,
                        semaphore,
                        emit,
                    )
                    for node in ready
                ),
                return_exceptions=True,
            )
            for node, result in zip(ready, results, strict=True):
                if isinstance(result, BaseException):
                    raise result
                outputs[node.id] = result
                pending.pop(node.id)
        return outputs

    async def run_node(
        self,
        workflow_run_id: str,
        node: WorkflowNode,
        context: dict[str, Any],
        semaphore: asyncio.Semaphore,
        emit: EmitWorkflowEvent,
    ) -> Any:
        await emit(
            "workflow.node_started",
            {"node_id": node.id, "node_name": node.name, "node_type": node.type},
            None,
        )
        try:
            if isinstance(node, AgentNode):
                output = await self.run_agent_node(
                    workflow_run_id,
                    node,
                    context,
                    semaphore,
                    emit,
                )
            elif isinstance(node, ApprovalNode):
                output = await self.run_approval_node(
                    workflow_run_id,
                    node,
                    context,
                    emit,
                )
            elif isinstance(node, LoopNode):
                output = await self.run_loop_node(
                    workflow_run_id,
                    node,
                    context,
                    semaphore,
                    emit,
                )
            else:
                raise WorkflowNodeError(node.id, f"Unsupported node type: {node.type}")
            await emit(
                "workflow.node_completed",
                {"node_id": node.id, "output": output},
                None,
            )
            return output
        except asyncio.CancelledError:
            raise
        except WorkflowNodeError as error:
            await emit(
                "workflow.node_failed",
                {"node_id": node.id, "message": str(error)},
                None,
            )
            raise
        except Exception as error:
            message = str(error) or type(error).__name__
            await emit(
                "workflow.node_failed",
                {"node_id": node.id, "message": message},
                None,
            )
            raise WorkflowNodeError(node.id, message) from error

    async def run_agent_node(
        self,
        workflow_run_id: str,
        node: AgentNode,
        context: dict[str, Any],
        semaphore: asyncio.Semaphore,
        emit: EmitWorkflowEvent,
    ) -> Any:
        prompt = self.renderer.render(node.prompt, context)
        last_error = "Agent run failed"
        for attempt in range(1, node.max_attempts + 1):
            work_item_id = await self.workflows.start_work_item(
                workflow_run_id,
                node.id,
                {"prompt": prompt},
                attempt,
                node.max_attempts,
            )
            agent_run_id = uuid4().hex

            async def agent_emit(
                name: str,
                payload: dict[str, Any],
                work_item_id: str = work_item_id,
                attempt: int = attempt,
                agent_run_id: str = agent_run_id,
            ) -> None:
                await emit(
                    name,
                    {
                        "node_id": node.id,
                        "work_item_id": work_item_id,
                        "attempt": attempt,
                        **payload,
                    },
                    agent_run_id,
                )

            request = AgentRunRequest(
                run_id=agent_run_id,
                workflow_run_id=workflow_run_id,
                work_item_id=work_item_id,
                node_id=node.id,
                messages=[AgentMessage(role="user", content=prompt)],
                agent=node.agent,
            )
            try:
                async with semaphore:
                    result = await self.agents.run(request, agent_emit)
            except asyncio.CancelledError:
                await self.workflows.finish_work_item(work_item_id, "cancelled")
                raise
            if result.status == "completed" and result.output is not None:
                try:
                    output = self.parse_agent_output(node, result)
                except WorkflowNodeError as error:
                    last_error = str(error)
                    await self.workflows.finish_work_item(work_item_id, "failed")
                    if attempt < node.max_attempts:
                        await emit(
                            "workflow.node_retrying",
                            {
                                "node_id": node.id,
                                "attempt": attempt + 1,
                                "message": last_error,
                            },
                            None,
                        )
                        continue
                    raise
                await self.workflows.finish_work_item(
                    work_item_id,
                    "completed",
                    output,
                )
                return output
            last_error = result.error or last_error
            await self.workflows.finish_work_item(work_item_id, "failed")
            if attempt < node.max_attempts:
                await emit(
                    "workflow.node_retrying",
                    {
                        "node_id": node.id,
                        "attempt": attempt + 1,
                        "message": last_error,
                    },
                    None,
                )
        raise WorkflowNodeError(node.id, last_error)

    async def run_approval_node(
        self,
        workflow_run_id: str,
        node: ApprovalNode,
        context: dict[str, Any],
        emit: EmitWorkflowEvent,
    ) -> dict[str, Any]:
        prompt = self.renderer.render(node.prompt, context)
        work_item_id = await self.workflows.start_work_item(
            workflow_run_id,
            node.id,
            {"prompt": prompt},
            1,
            1,
            "waiting_approval",
        )
        approval_id = await self.workflows.create_approval(
            workflow_run_id,
            prompt,
        )
        future = asyncio.get_running_loop().create_future()
        self.pending_approvals[approval_id] = future
        await emit(
            "workflow.approval_required",
            {
                "approval_id": approval_id,
                "work_item_id": work_item_id,
                "node_id": node.id,
                "prompt": prompt,
            },
            None,
        )
        try:
            if node.timeout_seconds is None:
                decision = await future
            else:
                async with asyncio.timeout(node.timeout_seconds):
                    decision = await future
        except TimeoutError as error:
            await self.workflows.finish_work_item(work_item_id, "failed")
            await self.workflows.close_approval(approval_id, "expired")
            raise WorkflowNodeError(node.id, "Approval timed out") from error
        except asyncio.CancelledError:
            await self.workflows.finish_work_item(work_item_id, "cancelled")
            await self.workflows.close_approval(approval_id, "cancelled")
            raise
        finally:
            self.pending_approvals.pop(approval_id, None)

        output = {"approved": decision.approved, "data": decision.data}
        await emit(
            "workflow.approval_resolved",
            {
                "approval_id": approval_id,
                "node_id": node.id,
                **output,
            },
            None,
        )
        if not decision.approved and node.reject_behavior == "fail":
            await self.workflows.finish_work_item(work_item_id, "failed", output)
            raise WorkflowNodeError(node.id, "Approval was rejected")
        await self.workflows.finish_work_item(work_item_id, "completed", output)
        return output

    async def run_loop_node(
        self,
        workflow_run_id: str,
        node: LoopNode,
        context: dict[str, Any],
        semaphore: asyncio.Semaphore,
        emit: EmitWorkflowEvent,
    ) -> dict[str, Any]:
        work_item_id = await self.workflows.start_work_item(
            workflow_run_id,
            node.id,
            {},
            1,
            1,
        )
        iterations: list[dict[str, Any]] = []
        satisfied = False
        try:
            for iteration in range(1, node.max_iterations + 1):
                await emit(
                    "workflow.loop_iteration_started",
                    {"node_id": node.id, "iteration": iteration},
                    None,
                )
                loop_context = {
                    **context,
                    "iteration": iteration,
                    "previous": iterations[-1] if iterations else None,
                }
                output = await self.run_graph(
                    workflow_run_id,
                    node.nodes,
                    loop_context,
                    semaphore,
                    emit,
                )
                iterations.append(output)
                condition_context = {
                    **loop_context,
                    "outputs": {**context.get("outputs", {}), **output},
                }
                if node.until is not None:
                    satisfied = evaluate_condition(node.until, condition_context)
                else:
                    satisfied = iteration == node.max_iterations
                await emit(
                    "workflow.loop_iteration_completed",
                    {
                        "node_id": node.id,
                        "iteration": iteration,
                        "satisfied": satisfied,
                    },
                    None,
                )
                if satisfied:
                    break
        except asyncio.CancelledError:
            await self.workflows.finish_work_item(work_item_id, "cancelled")
            raise
        except Exception:
            await self.workflows.finish_work_item(work_item_id, "failed")
            raise

        result = {
            "count": len(iterations),
            "satisfied": satisfied,
            "last": iterations[-1],
            "iterations": iterations,
        }
        if not satisfied and node.on_exhausted == "fail":
            await self.workflows.finish_work_item(work_item_id, "failed", result)
            raise WorkflowNodeError(node.id, "Loop exhausted its iteration limit")
        await self.workflows.finish_work_item(work_item_id, "completed", result)
        return result

    async def resolve_approval(self, decision: ApprovalDecision) -> bool:
        future = self.pending_approvals.get(decision.approval_id)
        if future is None or future.done():
            return False
        resolved = await self.workflows.resolve_approval(
            decision.approval_id,
            decision.approved,
            decision.data,
        )
        if not resolved:
            return False
        future.set_result(decision)
        return True

    @staticmethod
    def parse_agent_output(
        node: AgentNode,
        result: AgentExecutionResult,
    ) -> Any:
        if result.output is None:
            raise WorkflowNodeError(node.id, "Agent returned no output")
        if node.output_mode == "text":
            return result.output
        try:
            return json.loads(result.output)
        except json.JSONDecodeError as error:
            raise WorkflowNodeError(node.id, "Agent returned invalid JSON") from error
