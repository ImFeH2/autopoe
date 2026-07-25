from __future__ import annotations

import json
import math
import re
import tempfile
from collections import defaultdict, deque
from collections.abc import Mapping, Sequence
from datetime import UTC, datetime
from pathlib import Path
from typing import Literal, Protocol
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field

from flowent.context import runtime_context_messages
from flowent.llm import ChatMessage, ProviderConnection
from flowent.runtime_commands import python_runner_command
from flowent.sandbox import SandboxRunner
from flowent.storage import (
    StateStore,
    StoredWorkflowConnection,
    StoredWorkflowNode,
    StoredWorkflowPresentation,
    StoredWorkflowSpec,
    WorkflowDraft,
    WorkflowRepository,
)
from flowent.workflow_schedule_rules import next_cron_run_at


class WorkflowAgentResult(Protocol):
    @property
    def content(self) -> str: ...

    @property
    def history(self) -> Sequence[Mapping[str, object]]: ...


class WorkflowAgentRuntime(Protocol):
    cwd: Path
    store: StateStore
    workflow_repository: WorkflowRepository

    async def complete(
        self,
        *,
        connection: ProviderConnection,
        history_start_index: int = 0,
        messages: Sequence[ChatMessage | Mapping[str, object]],
        user_request: str,
        workflow_depth: int = 0,
    ) -> WorkflowAgentResult: ...


class WorkflowNodeRunError(BaseModel):
    model_config = ConfigDict(extra="forbid")

    code: str
    message: str


class WorkflowNodeRunResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    error: WorkflowNodeRunError | None = None
    id: str
    inputs: list[str] = Field(default_factory=list)
    output: str = ""
    status: Literal["failed", "pending", "running", "success"]


class WorkflowRunResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    node_results: list[WorkflowNodeRunResult] = Field(default_factory=list)
    outputs: dict[str, str] = Field(default_factory=dict)
    run_id: str
    status: Literal["failed", "success"]
    trigger: Literal["manual", "schedule"]
    workflow_id: str
    workflow_revision: int


class WorkflowRunRequestValues(BaseModel):
    model_config = ConfigDict(extra="forbid")

    default_input: str = ""
    input_values: dict[str, str] = Field(default_factory=dict)


PLACEHOLDER_PATTERN = re.compile(r"\{\{\s*([A-Za-z0-9_.-]+)\.output\s*\}\}")


def validate_workflow_draft(workflow: WorkflowDraft) -> WorkflowDraft:
    validate_workflow_draft_spec(workflow.spec, workflow.presentation)
    return workflow


def validate_workflow_draft_spec(
    spec: StoredWorkflowSpec,
    presentation: StoredWorkflowPresentation | None = None,
) -> None:
    node_ids = [node.id for node in spec.nodes]
    if any(not node_id.strip() for node_id in node_ids):
        raise ValueError("Workflow node ids must not be empty.")
    if len(set(node_ids)) != len(node_ids):
        raise ValueError("Workflow node ids must be unique.")

    connection_ids = [connection.id for connection in spec.connections]
    if any(not connection_id.strip() for connection_id in connection_ids):
        raise ValueError("Workflow connection ids must not be empty.")
    if len(set(connection_ids)) != len(connection_ids):
        raise ValueError("Workflow connection ids must be unique.")

    if presentation is not None:
        if set(presentation.nodes) != set(node_ids):
            raise ValueError("Workflow node presentation must match workflow nodes.")
        if set(presentation.connections) != set(connection_ids):
            raise ValueError(
                "Workflow connection presentation must match workflow connections."
            )

    nodes = {node.id: node for node in spec.nodes}
    pairs: set[tuple[str, str]] = set()
    for connection in spec.connections:
        source_id = connection.from_.node_id
        target_id = connection.to.node_id
        if source_id not in nodes or target_id not in nodes:
            raise ValueError(f"Connection {connection.id} must connect existing nodes.")
        if connection.from_.port != "output":
            raise ValueError(
                f"Connection {connection.id} must use output on node {source_id}."
            )
        if connection.to.port != "input":
            raise ValueError(
                f"Connection {connection.id} must use input on node {target_id}."
            )
        if nodes[source_id].kind == "output":
            raise ValueError(f"Output node {source_id} cannot start a connection.")
        if nodes[target_id].kind in {"input", "timer"}:
            raise ValueError(
                f"{nodes[target_id].kind.title()} node {target_id} cannot receive a connection."
            )
        if source_id == target_id:
            raise ValueError(
                f"Connection {connection.id} cannot connect a node to itself."
            )
        pair = (source_id, target_id)
        if pair in pairs:
            raise ValueError(
                f"Nodes {source_id} and {target_id} cannot have duplicate connections."
            )
        pairs.add(pair)


def compile_workflow_spec(spec: StoredWorkflowSpec) -> list[str]:
    validate_workflow_draft_spec(spec)
    if not spec.nodes:
        raise ValueError("Workflow needs at least one node.")

    sources = {node.id for node in spec.nodes if node.kind in {"input", "timer"}}
    outputs = {node.id for node in spec.nodes if node.kind == "output"}
    if not sources:
        raise ValueError("Workflow needs an Input or Timer node.")
    if not outputs:
        raise ValueError("Workflow needs an Output node.")

    ordered = topological_node_ids(spec)
    outgoing: dict[str, set[str]] = defaultdict(set)
    incoming: dict[str, set[str]] = defaultdict(set)
    for connection in spec.connections:
        outgoing[connection.from_.node_id].add(connection.to.node_id)
        incoming[connection.to.node_id].add(connection.from_.node_id)

    for node in spec.nodes:
        if node.id not in sources and not incoming[node.id]:
            raise ValueError(f"Node {node.id} needs an incoming connection.")
        if node.id not in outputs and not outgoing[node.id]:
            raise ValueError(f"Node {node.id} needs an outgoing connection.")

    reachable = reachable_nodes(sources, outgoing)
    unreachable = [node.id for node in spec.nodes if node.id not in reachable]
    if unreachable:
        raise ValueError(
            f"Node {unreachable[0]} is not reachable from an Input or Timer node."
        )

    reaches_output = reachable_nodes(outputs, incoming)
    stranded = [node.id for node in spec.nodes if node.id not in reaches_output]
    if stranded:
        raise ValueError(f"Node {stranded[0]} does not lead to an Output node.")

    output_keys = [
        node.config.output_key.strip() for node in spec.nodes if node.kind == "output"
    ]
    if any(not output_key for output_key in output_keys):
        raise ValueError("Output keys must not be empty.")
    if len(output_keys) != len(set(output_keys)):
        raise ValueError("Output keys must be unique.")

    validate_timer_configs(spec)
    validate_prompt_references(spec, incoming)
    return ordered


def validate_timer_configs(spec: StoredWorkflowSpec) -> None:
    for node in spec.nodes:
        if node.kind != "timer":
            continue
        if node.config.mode == "interval":
            if (
                not math.isfinite(node.config.interval_seconds)
                or node.config.interval_seconds < 1
            ):
                raise ValueError("Timer interval must be at least 1 second.")
            continue
        next_cron_run_at(node.config.cron, datetime.now(UTC))


def validate_prompt_references(
    spec: StoredWorkflowSpec, incoming: Mapping[str, set[str]]
) -> None:
    node_ids = {node.id for node in spec.nodes}
    for node in spec.nodes:
        if node.kind != "agent":
            continue
        ancestors = reachable_nodes({node.id}, incoming) - {node.id}
        for reference in PLACEHOLDER_PATTERN.findall(node.config.prompt):
            if reference not in node_ids:
                raise ValueError(
                    f"Agent node {node.id} references unknown node {reference}."
                )
            if reference not in ancestors:
                raise ValueError(
                    f"Agent node {node.id} can only reference an upstream node."
                )


def reachable_nodes(start_ids: set[str], adjacency: Mapping[str, set[str]]) -> set[str]:
    reached = set(start_ids)
    queue = deque(start_ids)
    while queue:
        node_id = queue.popleft()
        for next_id in adjacency.get(node_id, set()):
            if next_id not in reached:
                reached.add(next_id)
                queue.append(next_id)
    return reached


def workflow_requires_connection(spec: StoredWorkflowSpec) -> bool:
    return any(node.kind == "agent" for node in spec.nodes)


def timer_run_node_ids(spec: StoredWorkflowSpec, timer_node_id: str) -> set[str]:
    nodes = {node.id: node for node in spec.nodes}
    timer_node = nodes.get(timer_node_id)
    if timer_node is None or timer_node.kind != "timer":
        raise ValueError("Timer node not found.")

    outgoing: dict[str, list[str]] = defaultdict(list)
    incoming: dict[str, list[str]] = defaultdict(list)
    for connection in spec.connections:
        outgoing[connection.from_.node_id].append(connection.to.node_id)
        incoming[connection.to.node_id].append(connection.from_.node_id)

    active = {timer_node_id}
    queue = deque([timer_node_id])
    while queue:
        node_id = queue.popleft()
        for target in outgoing[node_id]:
            if target not in active:
                active.add(target)
                queue.append(target)

    queue = deque(active)
    while queue:
        node_id = queue.popleft()
        for source in incoming[node_id]:
            source_node = nodes[source]
            if source_node.kind == "timer" and source != timer_node_id:
                continue
            if source not in active:
                active.add(source)
                queue.append(source)
    return active


def topological_node_ids(spec: StoredWorkflowSpec) -> list[str]:
    node_ids = [node.id for node in spec.nodes]
    outgoing: dict[str, list[str]] = defaultdict(list)
    indegree = {node_id: 0 for node_id in node_ids}
    for connection in spec.connections:
        outgoing[connection.from_.node_id].append(connection.to.node_id)
        indegree[connection.to.node_id] += 1

    node_order = {node_id: index for index, node_id in enumerate(node_ids)}
    ready = deque(
        sorted(
            [node_id for node_id, degree in indegree.items() if degree == 0],
            key=lambda node_id: node_order[node_id],
        )
    )
    ordered: list[str] = []
    while ready:
        node_id = ready.popleft()
        ordered.append(node_id)
        for target in sorted(outgoing[node_id], key=lambda item: node_order[item]):
            indegree[target] -= 1
            if indegree[target] == 0:
                ready.append(target)

    if len(ordered) != len(node_ids):
        raise ValueError("Workflow cannot contain cycles.")
    return ordered


async def run_workflow_spec(
    *,
    connection: ProviderConnection | None,
    default_input: str = "",
    input_values: Mapping[str, str] | None = None,
    runtime: WorkflowAgentRuntime | None = None,
    run_id: str | None = None,
    spec: StoredWorkflowSpec,
    timer_node_id: str = "",
    trigger: Literal["manual", "schedule"] = "manual",
    workflow_depth: int = 0,
    workflow_id: str,
    workflow_revision: int,
) -> WorkflowRunResponse:
    ordered_ids = compile_workflow_spec(spec)
    if workflow_requires_connection(spec) and connection is None:
        raise ValueError("Choose a provider and model before running.")
    return await run_workflow_once(
        connection=connection,
        input_values=WorkflowRunRequestValues(
            default_input=default_input,
            input_values=dict(input_values or {}),
        ),
        ordered_ids=ordered_ids,
        run_id=run_id,
        runtime=runtime,
        spec=spec,
        timer_node_id=timer_node_id,
        trigger=trigger,
        workflow_depth=workflow_depth,
        workflow_id=workflow_id,
        workflow_revision=workflow_revision,
    )


async def run_workflow_once(
    *,
    connection: ProviderConnection | None,
    input_values: WorkflowRunRequestValues,
    ordered_ids: list[str],
    run_id: str | None,
    runtime: WorkflowAgentRuntime | None,
    spec: StoredWorkflowSpec,
    timer_node_id: str,
    trigger: Literal["manual", "schedule"],
    workflow_depth: int,
    workflow_id: str,
    workflow_revision: int,
) -> WorkflowRunResponse:
    nodes = {node.id: node for node in spec.nodes}
    incoming_connections = connections_by_target(spec.connections)
    active_node_ids = timer_run_node_ids(spec, timer_node_id) if timer_node_id else None
    results = {
        node.id: WorkflowNodeRunResult(id=node.id, status="pending")
        for node in spec.nodes
    }
    outputs: dict[str, str] = {}
    named_outputs: dict[str, str] = {}
    remaining_default_input = input_values.default_input
    run_id = run_id or str(uuid4())

    for node_id in ordered_ids:
        node = nodes[node_id]
        if active_node_ids is not None and node.id not in active_node_ids:
            continue
        node_inputs = upstream_outputs(incoming_connections[node.id], outputs)
        results[node.id] = WorkflowNodeRunResult(
            id=node.id, inputs=node_inputs, status="running"
        )
        try:
            output = await run_node(
                connection=connection,
                default_input=remaining_default_input,
                input_values=input_values.input_values,
                node=node,
                node_inputs=node_inputs,
                outputs=outputs,
                runtime=runtime,
                workflow_depth=workflow_depth,
                workflow_id=workflow_id,
            )
            if node.kind == "input" and remaining_default_input:
                remaining_default_input = ""
        except Exception as error:
            results[node.id] = WorkflowNodeRunResult(
                error=WorkflowNodeRunError(
                    code="node_execution_failed",
                    message=str(error) or "Node could not be completed.",
                ),
                id=node.id,
                inputs=node_inputs,
                status="failed",
            )
            return WorkflowRunResponse(
                node_results=list(results.values()),
                outputs=named_outputs,
                run_id=run_id,
                status="failed",
                trigger=trigger,
                workflow_id=workflow_id,
                workflow_revision=workflow_revision,
            )
        outputs[node.id] = output
        if node.kind == "output":
            named_outputs[node_output_key(node)] = output
        results[node.id] = WorkflowNodeRunResult(
            id=node.id,
            inputs=node_inputs,
            output=output,
            status="success",
        )

    return WorkflowRunResponse(
        node_results=list(results.values()),
        outputs=named_outputs,
        run_id=run_id,
        status="success",
        trigger=trigger,
        workflow_id=workflow_id,
        workflow_revision=workflow_revision,
    )


async def run_node(
    *,
    connection: ProviderConnection | None,
    default_input: str,
    input_values: Mapping[str, str],
    node: StoredWorkflowNode,
    node_inputs: list[str],
    outputs: Mapping[str, str],
    runtime: WorkflowAgentRuntime | None,
    workflow_depth: int,
    workflow_id: str,
) -> str:
    if node.kind == "input":
        if node.id in input_values:
            return input_values[node.id]
        if default_input:
            return default_input
        return node.config.default_value
    if node.kind == "agent":
        if connection is None:
            raise ValueError("Choose a provider and model before running.")
        if runtime is None:
            raise ValueError("Agent runtime is not available.")
        prompt = render_template(
            node.config.prompt or joined_text(node_inputs), outputs
        )
        context_messages = runtime_context_messages(
            runtime.cwd, runtime.store.read_state().settings.agent_prompt
        )
        history = runtime.workflow_repository.read_workflow_agent_history(
            workflow_id, node.id
        )
        current_message: Mapping[str, object] = {"role": "user", "content": prompt}
        pending_history: list[Mapping[str, object]] = [*history, current_message]
        runtime.workflow_repository.save_workflow_agent_history(
            workflow_id, node.id, pending_history
        )
        result = await runtime.complete(
            connection=connection,
            messages=[*context_messages, *pending_history],
            history_start_index=1 + len(context_messages),
            user_request=prompt,
            workflow_depth=workflow_depth,
        )
        runtime.workflow_repository.save_workflow_agent_history(
            workflow_id, node.id, list(result.history)
        )
        return result.content
    if node.kind == "merge":
        if node.config.merge_strategy == "json":
            return merge_json_outputs(node_inputs)
        return joined_text(node_inputs)
    if node.kind == "code":
        return await run_code_node(node, node_inputs)
    if node.kind == "timer":
        return node.config.payload or "Timer fired."
    if node.kind == "output":
        return joined_text(node_inputs)
    raise ValueError("Node kind is not supported.")


async def run_code_node(node: StoredWorkflowNode, upstream: list[str]) -> str:
    if node.kind != "code":
        raise ValueError("Code node is required.")
    code = node.config.code
    if not code.strip():
        return joined_text(upstream)
    with tempfile.TemporaryDirectory(prefix="flowent-workflow-code-") as code_dir:
        result = await SandboxRunner(timeout_seconds=10, cwd=Path(code_dir)).run_async(
            python_runner_command(),
            input_text=json.dumps(
                {"code": code, "input": joined_text(upstream), "inputs": upstream},
                ensure_ascii=False,
            ),
            timeout_seconds=10,
        )
    if result.exit_code != 0:
        raise ValueError((result.stderr or result.stdout).strip() or "Code failed.")
    return result.stdout


def connections_by_target(
    connections: list[StoredWorkflowConnection],
) -> dict[str, list[StoredWorkflowConnection]]:
    grouped: dict[str, list[StoredWorkflowConnection]] = defaultdict(list)
    for connection in connections:
        grouped[connection.to.node_id].append(connection)
    return grouped


def node_output_key(node: StoredWorkflowNode) -> str:
    return node.config.output_key if node.kind == "output" else node.id


def upstream_outputs(
    incoming_connections: list[StoredWorkflowConnection],
    outputs: Mapping[str, str],
) -> list[str]:
    return [
        outputs[connection.from_.node_id]
        for connection in incoming_connections
        if connection.from_.node_id in outputs
    ]


def joined_text(values: list[str]) -> str:
    return "\n".join(value for value in values if value)


def render_template(template: str, outputs: Mapping[str, str]) -> str:
    return PLACEHOLDER_PATTERN.sub(
        lambda match: outputs.get(match.group(1), ""), template
    )


def merge_json_outputs(upstream: list[str]) -> str:
    merged: dict[str, object] = {}
    for output in upstream:
        try:
            parsed = json.loads(output)
        except json.JSONDecodeError:
            continue
        if isinstance(parsed, dict):
            merged.update(parsed)
    return json.dumps(merged, ensure_ascii=False)
