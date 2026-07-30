import asyncio
import dataclasses
import json
from collections.abc import Awaitable, Callable
from typing import Any

from pydantic import SecretStr
from pydantic_ai import (
    Agent,
    AgentRunResultEvent,
    FunctionToolCallEvent,
    FunctionToolResultEvent,
    PartDeltaEvent,
    PartStartEvent,
    TextPart,
    TextPartDelta,
    ThinkingPart,
    ThinkingPartDelta,
)
from pydantic_ai.messages import ModelMessage, ModelRequest, ModelResponse
from pydantic_ai.settings import ModelSettings
from pydantic_ai.usage import UsageLimits

from flowent_agent.agents.model_factory import create_model
from flowent_agent.agents.models import (
    AgentExecutionResult,
    AgentMessage,
    AgentRunRequest,
    ModelConfiguration,
)
from flowent_agent.approval import ApprovalCoordinator, ApprovalScope
from flowent_agent.persistence.runs import AgentRunStore
from flowent_agent.persistence.settings import CredentialStore, SettingsStore
from flowent_agent.tools.registry import AgentDependencies, ToolRegistry
from flowent_agent.tools.workspace import Workspace, WorkspaceManager

EmitEvent = Callable[[str, dict[str, Any]], Awaitable[None]]


class AgentRunner:
    def __init__(
        self,
        runs: AgentRunStore,
        approvals: ApprovalCoordinator | None = None,
        workspace_manager: WorkspaceManager | None = None,
        credentials: CredentialStore | None = None,
        settings: SettingsStore | None = None,
        model_factory: Callable[..., Any] = create_model,
    ) -> None:
        self.runs = runs
        self.approvals = approvals
        self.workspace_manager = workspace_manager
        self.credentials = credentials
        self.settings = settings
        self.model_factory = model_factory
        self.tools = ToolRegistry()

    async def run(
        self,
        request: AgentRunRequest,
        emit: EmitEvent,
        workspace: Workspace | None = None,
    ) -> AgentExecutionResult:
        configuration = request.agent
        run_started = False
        try:
            model_configuration = await self.resolve_model_configuration(
                configuration.model
            )
            await self.runs.start(
                request.run_id,
                request.conversation_id,
                model_configuration.provider,
                model_configuration.model,
                request.workflow_run_id,
                request.work_item_id,
                None,
                request.node_id,
            )
            run_started = True
            for message in request.messages:
                await self.runs.add_message(
                    request.run_id,
                    message.role,
                    message.content,
                )
            await emit(
                "agent.started",
                {
                    "agent": configuration.name,
                    "provider": model_configuration.provider,
                    "model": model_configuration.model,
                },
            )
            if workspace is None and request.workspace is not None:
                if self.workspace_manager is None:
                    raise RuntimeError("Workspace manager is not configured")
                workspace = await self.workspace_manager.prepare(
                    request.run_id,
                    request.workspace,
                )
            async with asyncio.timeout(configuration.limits.timeout_seconds):
                result = await self.run_loop(
                    request,
                    emit,
                    workspace,
                    model_configuration,
                )
            await self.runs.add_message(request.run_id, "assistant", result["output"])
            await self.runs.finish(request.run_id, "completed", result["usage"])
            await emit("agent.completed", result)
            return AgentExecutionResult(
                run_id=request.run_id,
                status="completed",
                output=result["output"],
                usage=result["usage"],
            )
        except asyncio.CancelledError:
            if run_started:
                await self.runs.finish(request.run_id, "cancelled")
            await emit("agent.cancelled", {})
            raise
        except TimeoutError:
            message = "Agent run timed out"
            if run_started:
                await self.runs.finish(request.run_id, "failed", error=message)
            await emit("agent.failed", {"message": message})
            return AgentExecutionResult(
                run_id=request.run_id,
                status="failed",
                error=message,
            )
        except Exception as error:
            message = str(error) or type(error).__name__
            if run_started:
                await self.runs.finish(request.run_id, "failed", error=message)
            await emit("agent.failed", {"message": message})
            return AgentExecutionResult(
                run_id=request.run_id,
                status="failed",
                error=message,
            )

    async def run_loop(
        self,
        request: AgentRunRequest,
        emit: EmitEvent,
        workspace: Workspace | None,
        model_configuration: ModelConfiguration,
    ) -> dict[str, Any]:
        configuration = request.agent
        model = self.model_factory(model_configuration)
        toolset = self.tools.build(configuration.tools)
        if toolset is not None and workspace is None:
            raise ValueError("Workspace tools require an active workspace")
        dependencies = AgentDependencies(
            workspace=workspace,
            approvals=self.approvals,
            approval_scope=ApprovalScope(
                run_id=request.workflow_run_id or request.run_id,
                workflow_run_id=request.workflow_run_id,
                agent_run_id=request.run_id,
            ),
            emit=emit,
        )
        agent = Agent(
            model,
            name=configuration.name,
            instructions=configuration.instructions,
            deps_type=AgentDependencies,
            retries=configuration.retries,
            model_settings=self.model_settings(request),
            toolsets=[toolset] if toolset is not None else None,
        )
        history, prompt = self.message_history(request.messages)
        limits = configuration.limits
        usage_limits = UsageLimits(
            request_limit=limits.request_limit,
            tool_calls_limit=limits.tool_calls_limit,
            input_tokens_limit=limits.input_tokens_limit,
            output_tokens_limit=limits.output_tokens_limit,
            total_tokens_limit=limits.total_tokens_limit,
        )
        result: dict[str, Any] | None = None
        async with agent.run_stream_events(
            prompt,
            message_history=history,
            conversation_id=request.conversation_id or request.run_id,
            run_id=request.run_id,
            usage_limits=usage_limits,
            deps=dependencies,
        ) as events:
            async for event in events:
                await self.handle_event(event, emit)
                if isinstance(event, AgentRunResultEvent):
                    result = {
                        "output": str(event.result.output),
                        "usage": dataclasses.asdict(event.result.usage),
                    }
        if result is None:
            raise RuntimeError("Agent run ended without a result")
        return result

    async def resolve_model_configuration(
        self,
        model_configuration: ModelConfiguration,
    ) -> ModelConfiguration:
        if model_configuration.provider == "default":
            stored_model = (
                await self.settings.get("model.default")
                if self.settings is not None
                else None
            )
            model_configuration = ModelConfiguration.model_validate(stored_model or {})
        if (
            model_configuration.api_key is None
            and model_configuration.credential_id is not None
            and self.credentials is not None
            and model_configuration.provider != "demo"
        ):
            secret = await self.credentials.get(
                model_configuration.provider,
                model_configuration.credential_id,
            )
            if secret is not None:
                model_configuration = model_configuration.model_copy(
                    update={"api_key": SecretStr(secret)}
                )
        return model_configuration

    @staticmethod
    def model_settings(request: AgentRunRequest) -> ModelSettings:
        settings: ModelSettings = {}
        if request.agent.temperature is not None:
            settings["temperature"] = request.agent.temperature
        if request.agent.limits.max_output_tokens is not None:
            settings["max_tokens"] = request.agent.limits.max_output_tokens
        return settings

    @staticmethod
    def message_history(
        messages: list[AgentMessage],
    ) -> tuple[list[ModelMessage], str]:
        history: list[ModelMessage] = []
        for message in messages[:-1]:
            if message.role == "user":
                history.append(ModelRequest.user_text_prompt(message.content))
            else:
                history.append(ModelResponse(parts=[TextPart(message.content)]))
        return history, messages[-1].content

    async def handle_event(self, event: Any, emit: EmitEvent) -> None:
        if isinstance(event, PartStartEvent):
            if isinstance(event.part, TextPart) and event.part.content:
                await emit("agent.text_delta", {"delta": event.part.content})
            elif isinstance(event.part, ThinkingPart) and event.part.content:
                await emit("agent.thinking_delta", {"delta": event.part.content})
        elif isinstance(event, PartDeltaEvent):
            if isinstance(event.delta, TextPartDelta):
                await emit("agent.text_delta", {"delta": event.delta.content_delta})
            elif (
                isinstance(event.delta, ThinkingPartDelta) and event.delta.content_delta
            ):
                await emit("agent.thinking_delta", {"delta": event.delta.content_delta})
        elif isinstance(event, FunctionToolCallEvent):
            await emit(
                "agent.tool_started",
                {
                    "call_id": event.tool_call_id,
                    "name": event.part.tool_name,
                    "arguments": self.safe_value(event.part.args_as_dict()),
                },
            )
        elif isinstance(event, FunctionToolResultEvent):
            await emit(
                "agent.tool_completed",
                {
                    "call_id": event.tool_call_id,
                    "name": event.part.tool_name,
                    "result": self.safe_value(event.part.content),
                },
            )

    @staticmethod
    def safe_value(value: Any) -> Any:
        serialized = json.dumps(value, ensure_ascii=False, default=str)
        if len(serialized) > 16384:
            return f"{serialized[:16384]}…"
        return json.loads(serialized)
