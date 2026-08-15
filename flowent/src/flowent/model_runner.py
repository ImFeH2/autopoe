from __future__ import annotations

from collections.abc import Callable
from contextlib import nullcontext
from dataclasses import dataclass, field
from threading import Lock
from typing import Any, Literal, cast

from pydantic_ai import (
    Agent,
    FunctionToolCallEvent,
    FunctionToolResultEvent,
    ModelRetry,
    PartDeltaEvent,
    PartStartEvent,
    RunContext,
    TextPartDelta,
    ThinkingPartDelta,
    capture_run_messages,
)
from pydantic_ai.exceptions import AgentRunError
from pydantic_ai.messages import TextPart, ThinkingPart
from pydantic_ai.models.anthropic import AnthropicModel, AnthropicModelName
from pydantic_ai.models.google import GoogleModel, GoogleModelName
from pydantic_ai.models.openai import (
    OpenAIChatModel,
    OpenAIModelName,
    OpenAIResponsesModel,
)
from pydantic_ai.providers.anthropic import AnthropicProvider
from pydantic_ai.providers.google import GoogleProvider
from pydantic_ai.providers.openai import OpenAIProvider
from pydantic_core import to_jsonable_python

from flowent.domain import Activation, DomainError
from flowent.host_tools import HostToolError
from flowent.observability import (
    ObservabilityConfig,
    PydanticAIObservability,
    create_pydantic_ai_observability,
)
from flowent.runtime import (
    AgentRunContext,
    AgentRunFailure,
    AgentRunner,
    AgentRunOutcome,
)

ApiType = Literal["openai-chat", "openai-responses", "anthropic", "google"]


@dataclass(frozen=True)
class ModelConfig:
    api_type: ApiType
    base_url: str
    api_key: str = field(repr=False)
    model: str

    @classmethod
    def restore(cls, values: dict[str, str]) -> ModelConfig:
        api_type = values["api_type"]
        if api_type not in (
            "openai-chat",
            "openai-responses",
            "anthropic",
            "google",
        ):
            raise RuntimeError("Persisted model API type is invalid")
        config = cls(
            api_type=cast(ApiType, api_type),
            base_url=values["base_url"],
            api_key=values["api_key"],
            model=values["model"],
        )
        if not config.base_url or not config.api_key or not config.model:
            raise RuntimeError("Persisted model configuration is incomplete")
        return config

    def persistence_data(self) -> dict[str, str]:
        return {
            "api_type": self.api_type,
            "base_url": self.base_url,
            "api_key": self.api_key,
            "model": self.model,
        }


class UnavailableRunner:
    def __init__(self, message: str) -> None:
        self._message = message

    def run(self, activation: Activation, context: AgentRunContext) -> None:
        del activation, context
        raise AgentRunFailure(self._message)


class PydanticAgentRunner:
    def __init__(
        self,
        config: ModelConfig,
        observability: PydanticAIObservability | None = None,
    ) -> None:
        if config.api_type == "anthropic":
            model = AnthropicModel(
                cast(AnthropicModelName, config.model),
                provider=AnthropicProvider(
                    base_url=config.base_url,
                    api_key=config.api_key,
                ),
            )
        elif config.api_type == "google":
            model = GoogleModel(
                cast(GoogleModelName, config.model),
                provider=GoogleProvider(
                    base_url=config.base_url,
                    api_key=config.api_key,
                ),
            )
        elif config.api_type == "openai-responses":
            model = OpenAIResponsesModel(
                cast(OpenAIModelName, config.model),
                provider=OpenAIProvider(
                    base_url=config.base_url,
                    api_key=config.api_key,
                ),
            )
        else:
            model = OpenAIChatModel(
                cast(OpenAIModelName, config.model),
                provider=OpenAIProvider(
                    base_url=config.base_url,
                    api_key=config.api_key,
                ),
            )
        capabilities = [observability.capability()] if observability else None
        self._observability = observability
        self._agent = Agent(
            model,
            deps_type=AgentRunContext,
            name="flowent_agent",
            instructions=(
                "You are an Agent in Flowent. All Agents are equal and use the same tools. "
                "You receive an Activation when a Discussion Message mentions you. "
                "It is one user message delivered to you, not a batch or a message range. "
                "Use discussion action=read when you need surrounding context. "
                "Communicate only with discussion action=send. Use organization and discussion tools "
                "to discover Members, create Agents, or open a new Discussion when useful. "
                "Use exec with an argv list to inspect the launch directory and run commands. "
                "Use patch with a unified diff to create, modify, delete, or rename text files. "
                "Never read or expose .env files, environment variables, credentials, tokens, or secrets. "
                "The triggering Message is already delivered; do not wait for an acknowledgement "
                "before completing your Turn."
            ),
            retries=2,
            capabilities=capabilities,
        )
        self._register_tools()

    def _register_tools(self) -> None:
        @self._agent.tool(name="exec", sequential=True)
        def execute_command(
            ctx: RunContext[AgentRunContext],
            argv: list[str],
            cwd: str | None = None,
            timeout_seconds: int = 60,
        ) -> Any:
            """Run argv without a shell inside the launch directory and return captured output."""
            try:
                return ctx.deps.exec(argv, cwd, timeout_seconds)
            except HostToolError as error:
                raise ModelRetry(str(error)) from error

        @self._agent.tool(sequential=True)
        def patch(ctx: RunContext[AgentRunContext], diff: str) -> Any:
            """Atomically apply a unified text diff inside the launch directory."""
            try:
                return ctx.deps.patch(diff)
            except HostToolError as error:
                raise ModelRetry(str(error)) from error

        @self._agent.tool
        def organization(
            ctx: RunContext[AgentRunContext],
            action: Literal["list_members", "create_agent"],
            name: str | None = None,
        ) -> Any:
            """List Organization Members or create an equal Agent by name."""
            try:
                if action == "create_agent":
                    if not name:
                        raise ModelRetry("name is required for create_agent")
                    return ctx.deps.organization(action, name=name)
                return ctx.deps.organization(action)
            except DomainError as error:
                raise ModelRetry(error.message) from error

        @self._agent.tool
        def discussion(
            ctx: RunContext[AgentRunContext],
            action: Literal["create", "send", "list", "info", "read", "ack", "search"],
            discussion_id: int | None = None,
            topic: str | None = None,
            member_ids: list[int] | None = None,
            body: str | None = None,
            mention_ids: list[int] | None = None,
            message_ids: list[int] | None = None,
            start_message_id: int | None = None,
            end_message_id: int | None = None,
            limit: int | None = None,
            query: str | None = None,
            sender_id: int | None = None,
        ) -> Any:
            """Create, send, list, inspect, read, acknowledge, or search Discussions and Messages."""
            try:
                if action == "create":
                    if not topic or not member_ids:
                        raise ModelRetry("topic and member_ids are required for create")
                    return ctx.deps.discussion(
                        action,
                        topic=topic,
                        member_ids=member_ids,
                    )
                if action == "send":
                    if discussion_id is None or not body:
                        raise ModelRetry("discussion_id and body are required for send")
                    return ctx.deps.discussion(
                        action,
                        discussion_id=discussion_id,
                        body=body,
                        mention_ids=mention_ids or [],
                    )
                if action == "list":
                    return ctx.deps.discussion(action)
                if action == "info":
                    if discussion_id is None:
                        raise ModelRetry("discussion_id is required for info")
                    return ctx.deps.discussion(action, discussion_id=discussion_id)
                if action == "read":
                    if discussion_id is None:
                        raise ModelRetry("discussion_id is required for read")
                    return ctx.deps.discussion(
                        action,
                        discussion_id=discussion_id,
                        start_message_id=start_message_id,
                        end_message_id=end_message_id,
                        limit=100 if limit is None else limit,
                    )
                if action == "ack":
                    if discussion_id is None or not message_ids:
                        raise ModelRetry(
                            "discussion_id and message_ids are required for ack"
                        )
                    return ctx.deps.discussion(
                        action,
                        discussion_id=discussion_id,
                        message_ids=message_ids,
                    )
                if not query:
                    raise ModelRetry("query is required for search")
                return ctx.deps.discussion(
                    action,
                    query=query,
                    discussion_id=discussion_id,
                    sender_id=sender_id,
                )
            except DomainError as error:
                raise ModelRetry(error.message) from error

    def run(
        self,
        activation: Activation,
        context: AgentRunContext,
    ) -> AgentRunOutcome:
        prompt = (
            f"You are Member {activation.agent_id}. You received this user message in "
            f"Discussion {activation.discussion_id} from Member {activation.sender_id} "
            f"(Message {activation.message_id}):\n\n{activation.body}\n\n"
            "Handle the request using available tools. Read the Discussion only when you need "
            "surrounding context, communicate through Discussions, then finish with a concise "
            "text response once the work is complete."
        )
        run_observability = (
            self._observability.bind(activation) if self._observability else None
        )
        trace_context = (
            run_observability.activate() if run_observability else nullcontext()
        )
        run_metadata = run_observability.metadata() if run_observability else None
        request_index = 0

        async def handle_events(
            _run_context: RunContext[AgentRunContext],
            events: Any,
        ) -> None:
            nonlocal request_index
            current_request = request_index
            request_index += 1
            async for event in events:
                part_id = None
                if isinstance(event, (PartStartEvent, PartDeltaEvent)):
                    part_id = f"{current_request}-{event.index}"
                if isinstance(event, PartStartEvent):
                    if isinstance(event.part, TextPart):
                        context.emit_history_event(
                            "text_delta",
                            part_id=part_id,
                            content=event.part.content,
                        )
                    elif isinstance(event.part, ThinkingPart):
                        context.emit_history_event("thinking", part_id=part_id)
                elif isinstance(event, PartDeltaEvent):
                    if isinstance(event.delta, TextPartDelta):
                        context.emit_history_event(
                            "text_delta",
                            part_id=part_id,
                            content=event.delta.content_delta,
                        )
                    elif isinstance(event.delta, ThinkingPartDelta):
                        context.emit_history_event("thinking", part_id=part_id)
                elif isinstance(event, FunctionToolCallEvent):
                    context.emit_history_event(
                        "tool_call",
                        tool_name=event.part.tool_name,
                        tool_call_id=event.tool_call_id,
                        content=to_jsonable_python(event.part.args),
                    )
                elif isinstance(event, FunctionToolResultEvent):
                    context.emit_history_event(
                        "retry"
                        if event.part.part_kind == "retry-prompt"
                        else "tool_result",
                        tool_name=event.part.tool_name,
                        tool_call_id=event.tool_call_id,
                        content=to_jsonable_python(event.part.content),
                    )

        message_history = list(context.message_history)
        with capture_run_messages() as captured_messages:
            try:
                with trace_context:
                    result = self._agent.run_sync(
                        prompt,
                        deps=context,
                        metadata=run_metadata,
                        message_history=message_history,
                        run_id=context.run_id,
                        event_stream_handler=handle_events,
                    )
            except AgentRunError as error:
                raise AgentRunFailure(
                    "Model request failed",
                    tuple(captured_messages[len(message_history) :]),
                ) from error
        return AgentRunOutcome(
            tuple(result.new_messages()),
            cast(dict[str, Any], to_jsonable_python(result.usage)),
        )


class ModelRuntime:
    def __init__(
        self,
        config: ModelConfig | None = None,
        observability_config: ObservabilityConfig | None = None,
        on_configure: Callable[[dict[str, str]], None] | None = None,
        on_configure_observability: Callable[[dict[str, Any]], None] | None = None,
        runner_factory: Callable[
            [ModelConfig | None, PydanticAIObservability | None], AgentRunner
        ]
        | None = None,
        observability_session_factory: Callable[
            [ObservabilityConfig], PydanticAIObservability | None
        ] = create_pydantic_ai_observability,
    ) -> None:
        self._lock = Lock()
        self._config = config
        self._observability_config = observability_config
        self._on_configure = on_configure
        self._on_configure_observability = on_configure_observability
        self._runner_factory = runner_factory or self._create_runner
        self._observability_session_factory = observability_session_factory
        self._observability_sessions: list[PydanticAIObservability] = []
        self._active_session_runs: dict[int, int] = {}
        session = self._create_observability_session(observability_config)
        self._current_observability_session = session
        self._runner = self._runner_factory(config, session)

    def _create_observability_session(
        self,
        config: ObservabilityConfig | None,
    ) -> PydanticAIObservability | None:
        if config is None or not config.enabled:
            return None
        session = self._observability_session_factory(config)
        if session is not None:
            self._observability_sessions.append(session)
        return session

    def _create_runner(
        self,
        config: ModelConfig | None,
        observability: PydanticAIObservability | None,
    ) -> AgentRunner:
        if config is None:
            return UnavailableRunner("Model configuration is incomplete")
        return PydanticAgentRunner(config, observability)

    def settings(self) -> dict[str, Any]:
        with self._lock:
            config = self._config
            if config is None:
                return {
                    "api_type": "openai-chat",
                    "base_url": "",
                    "model": "",
                    "has_api_key": False,
                }
            return {
                "api_type": config.api_type,
                "base_url": config.base_url,
                "model": config.model,
                "has_api_key": True,
            }

    def observability_settings(self) -> dict[str, Any]:
        with self._lock:
            config = self._observability_config
            if config is None:
                return {
                    "enabled": False,
                    "base_url": "",
                    "public_key": "",
                    "environment": "development",
                    "capture_content": False,
                    "has_secret_key": False,
                }
            return {
                "enabled": config.enabled,
                "base_url": config.base_url,
                "public_key": config.public_key,
                "environment": config.environment,
                "capture_content": config.capture_content,
                "has_secret_key": bool(config.secret_key),
            }

    def configure(
        self,
        api_type: str,
        base_url: str,
        api_key: str,
        model: str,
    ) -> dict[str, Any]:
        api_type = api_type.strip()
        base_url = base_url.strip()
        api_key = api_key.strip()
        model = model.strip()
        if api_type not in (
            "openai-chat",
            "openai-responses",
            "anthropic",
            "google",
        ):
            raise ValueError(
                "api_type must be openai-chat, openai-responses, anthropic, or google"
            )
        with self._lock:
            if not api_key and self._config is not None:
                api_key = self._config.api_key
            if not base_url:
                raise ValueError("base_url must not be empty")
            if not api_key:
                raise ValueError("api_key must not be empty")
            if not model:
                raise ValueError("model must not be empty")
            config = ModelConfig(
                api_type=cast(ApiType, api_type),
                base_url=base_url,
                api_key=api_key,
                model=model,
            )
            runner = self._runner_factory(
                config,
                self._current_observability_session,
            )
            if self._on_configure is not None:
                self._on_configure(config.persistence_data())
            self._config = config
            self._runner = runner
        return self.settings()

    def configure_observability(
        self,
        enabled: bool,
        base_url: str,
        public_key: str,
        secret_key: str,
        environment: str,
        capture_content: bool,
    ) -> dict[str, Any]:
        base_url = base_url.strip()
        public_key = public_key.strip()
        secret_key = secret_key.strip()
        environment = environment.strip()
        with self._lock:
            if not secret_key and self._observability_config is not None:
                secret_key = self._observability_config.secret_key
            config = ObservabilityConfig(
                enabled=enabled,
                base_url=base_url,
                public_key=public_key,
                secret_key=secret_key,
                environment=environment,
                capture_content=capture_content,
            )
            config.validate()
            session = self._create_observability_session(config)
            try:
                runner = self._runner_factory(self._config, session)
                if self._on_configure_observability is not None:
                    self._on_configure_observability(config.persistence_data())
            except Exception:
                if session is not None:
                    self._observability_sessions.remove(session)
                    session.shutdown()
                raise
            previous_session = self._current_observability_session
            self._observability_config = config
            self._current_observability_session = session
            self._runner = runner
            session_to_shutdown = self._remove_session_if_idle(previous_session)
        if session_to_shutdown is not None:
            session_to_shutdown.shutdown()
        return self.observability_settings()

    def _remove_session_if_idle(
        self,
        session: PydanticAIObservability | None,
    ) -> PydanticAIObservability | None:
        if session is None or self._active_session_runs.get(id(session), 0) > 0:
            return None
        if session not in self._observability_sessions:
            return None
        self._observability_sessions.remove(session)
        return session

    def run(
        self,
        activation: Activation,
        context: AgentRunContext,
    ) -> AgentRunOutcome | None:
        with self._lock:
            runner = self._runner
            session = self._current_observability_session
            if session is not None:
                session_id = id(session)
                self._active_session_runs[session_id] = (
                    self._active_session_runs.get(session_id, 0) + 1
                )
        try:
            return runner.run(activation, context)
        finally:
            session_to_shutdown = None
            if session is not None:
                with self._lock:
                    session_id = id(session)
                    active_runs = self._active_session_runs[session_id] - 1
                    if active_runs:
                        self._active_session_runs[session_id] = active_runs
                    else:
                        del self._active_session_runs[session_id]
                        if session is not self._current_observability_session:
                            session_to_shutdown = self._remove_session_if_idle(session)
            if session_to_shutdown is not None:
                session_to_shutdown.shutdown()

    def shutdown(self) -> None:
        with self._lock:
            sessions = self._observability_sessions
            self._observability_sessions = []
        for session in sessions:
            session.shutdown()


def create_runner(
    stored_config: dict[str, str] | None = None,
    stored_observability_config: dict[str, Any] | None = None,
    on_configure: Callable[[dict[str, str]], None] | None = None,
    on_configure_observability: Callable[[dict[str, Any]], None] | None = None,
) -> ModelRuntime:
    config = ModelConfig.restore(stored_config) if stored_config is not None else None
    observability_config = (
        ObservabilityConfig.restore(stored_observability_config)
        if stored_observability_config is not None
        else None
    )
    return ModelRuntime(
        config,
        observability_config,
        on_configure=on_configure,
        on_configure_observability=on_configure_observability,
    )
