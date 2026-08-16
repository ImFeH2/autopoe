from __future__ import annotations

import time
from collections.abc import Callable, Sequence
from contextlib import nullcontext
from dataclasses import dataclass, field, replace
from threading import Lock
from typing import Any, Literal, cast

from openai import Timeout
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
from pydantic_ai.messages import (
    ModelMessage,
    ModelRequest,
    TextPart,
    ThinkingPart,
    ToolReturnPart,
    UserPromptPart,
)
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

from flowent.diagnostics import log_event, log_exception, register_secret
from flowent.domain import DomainError, Reminder
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
from flowent.todos import unwrap_tool_result

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

    def run(self, reminder: Reminder, context: AgentRunContext) -> None:
        del reminder, context
        raise AgentRunFailure(self._message)


def _openai_provider(config: ModelConfig) -> OpenAIProvider:
    provider = OpenAIProvider(
        base_url=config.base_url,
        api_key=config.api_key,
    )
    provider.client.timeout = Timeout(120, connect=5, write=30, pool=30)
    provider.client.max_retries = 0
    return provider


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
                provider=_openai_provider(config),
            )
        else:
            model = OpenAIChatModel(
                cast(OpenAIModelName, config.model),
                provider=_openai_provider(config),
            )
        capabilities = [observability.capability()] if observability else None
        self._observability = observability
        self._api_type = config.api_type
        self._model_name = config.model
        self._agent = Agent(
            model,
            deps_type=AgentRunContext,
            name="flowent_agent",
            instructions=(
                "You are an Agent in Flowent. All Agents are equal and use the same tools. "
                "Each Turn starts with a Reminder containing your current Pending Mentions. "
                "Decide how to handle them and use discussion action=read when you need surrounding context. "
                "Communicate only with discussion action=send. Use organization and discussion tools "
                "to discover Members, create Agents, or open a new Discussion when useful. "
                "Use todo to maintain unfinished multi-step work, keep at most one Todo in progress, "
                "and complete work promptly. Todo state never replaces discussion.ack and does not "
                "schedule another Turn. Current Todo status may follow tool results as a reminder. "
                "Use run with an argv list to inspect the launch directory and run commands. "
                "Use edit for exact text replacement in existing UTF-8 files. Read enough context first, "
                "provide an old_text value that matches exactly once, and use replace_all only when every "
                "exact match should change. "
                "Never read or expose .env files, environment variables, credentials, tokens, or secrets. "
                "The triggering Message is already delivered; do not wait for an acknowledgement "
                "before completing your Turn."
            ),
            retries=2,
            capabilities=capabilities,
        )
        self._register_tools()

    def _register_tools(self) -> None:
        def model_result(ctx: RunContext[AgentRunContext], result: Any) -> Any:
            return ctx.deps.model_tool_result(result)

        @self._agent.tool(sequential=True)
        def run(
            ctx: RunContext[AgentRunContext],
            argv: list[str],
            cwd: str | None = None,
            timeout_seconds: int = 60,
        ) -> Any:
            """Run argv without a shell inside the launch directory and return captured output."""
            try:
                return model_result(
                    ctx,
                    ctx.deps.run(argv, cwd, timeout_seconds),
                )
            except HostToolError as error:
                raise ModelRetry(str(error)) from error

        @self._agent.tool(sequential=True)
        def edit(
            ctx: RunContext[AgentRunContext],
            path: str,
            old_text: str,
            new_text: str,
            replace_all: bool = False,
        ) -> Any:
            """Atomically replace exact text in an existing UTF-8 file."""
            try:
                return model_result(
                    ctx,
                    ctx.deps.edit(path, old_text, new_text, replace_all),
                )
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
                    result = ctx.deps.organization(action, name=name)
                else:
                    result = ctx.deps.organization(action)
                return model_result(ctx, result)
            except DomainError as error:
                raise ModelRetry(error.message) from error

        @self._agent.tool(sequential=True)
        def todo(
            ctx: RunContext[AgentRunContext],
            action: Literal[
                "create",
                "list",
                "read",
                "start",
                "update",
                "complete",
                "delete",
            ],
            todo_id: int | None = None,
            subject: str | None = None,
            description: str | None = None,
            status: Literal["pending", "in_progress", "completed"] | None = None,
        ) -> Any:
            """Create, inspect, start, update, complete, or delete persistent Agent Todos."""
            try:
                if action == "create":
                    if subject is None:
                        raise ModelRetry("subject is required for create")
                    result = ctx.deps.todo(
                        action,
                        subject=subject,
                        description=description or "",
                    )
                elif action == "list":
                    result = ctx.deps.todo(action, status=status)
                else:
                    if todo_id is None:
                        raise ModelRetry(f"todo_id is required for {action}")
                    if action == "update":
                        result = ctx.deps.todo(
                            action,
                            todo_id=todo_id,
                            subject=subject,
                            description=description,
                        )
                    else:
                        result = ctx.deps.todo(action, todo_id=todo_id)
                return model_result(ctx, result)
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
                    result = ctx.deps.discussion(
                        action,
                        topic=topic,
                        member_ids=member_ids,
                    )
                elif action == "send":
                    if discussion_id is None or not body:
                        raise ModelRetry("discussion_id and body are required for send")
                    result = ctx.deps.discussion(
                        action,
                        discussion_id=discussion_id,
                        body=body,
                        mention_ids=mention_ids or [],
                    )
                elif action == "list":
                    result = ctx.deps.discussion(action)
                elif action == "info":
                    if discussion_id is None:
                        raise ModelRetry("discussion_id is required for info")
                    result = ctx.deps.discussion(
                        action,
                        discussion_id=discussion_id,
                    )
                elif action == "read":
                    if discussion_id is None:
                        raise ModelRetry("discussion_id is required for read")
                    result = ctx.deps.discussion(
                        action,
                        discussion_id=discussion_id,
                        start_message_id=start_message_id,
                        end_message_id=end_message_id,
                        limit=100 if limit is None else limit,
                    )
                elif action == "ack":
                    if discussion_id is None or not message_ids:
                        raise ModelRetry(
                            "discussion_id and message_ids are required for ack"
                        )
                    result = ctx.deps.discussion(
                        action,
                        discussion_id=discussion_id,
                        message_ids=message_ids,
                    )
                else:
                    if not query:
                        raise ModelRetry("query is required for search")
                    result = ctx.deps.discussion(
                        action,
                        query=query,
                        discussion_id=discussion_id,
                        sender_id=sender_id,
                    )
                return model_result(ctx, result)
            except DomainError as error:
                raise ModelRetry(error.message) from error

    def run(
        self,
        reminder: Reminder,
        context: AgentRunContext,
    ) -> AgentRunOutcome:
        mention_lines = [
            (
                f"- [{'previously reminded' if mention.previously_reminded else 'new'}] "
                f"Discussion {mention.discussion_id}, Message {mention.message_id}, "
                f"from Member {mention.sender_id}: {mention.body}"
            )
            for mention in reminder.mentions
        ]
        prompt = (
            f"You are Member {reminder.agent_id}. Here is your Reminder with current Pending Mentions:\n\n"
            + "\n".join(mention_lines)
            + "\n\nDecide how to handle these messages using available tools and communicate through Discussions."
        )
        if any(mention.previously_reminded for mention in reminder.mentions):
            prompt += (
                " Some Mentions were previously reminded but remain pending. Only discussion.ack "
                "marks a Mention as handled."
            )
        persisted_prompt = prompt
        if todo_status := context.todo_status_reminder():
            prompt += f"\n\n{todo_status}"
        run_observability = (
            self._observability.bind(reminder) if self._observability else None
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
                        content=to_jsonable_python(
                            unwrap_tool_result(event.part.content)
                        ),
                    )

        message_history = list(context.message_history)
        api_type = getattr(self, "_api_type", "unknown")
        model_name = getattr(self, "_model_name", "unknown")
        started = time.monotonic()
        log_event(
            "model.request.started",
            agent_id=reminder.agent_id,
            turn_id=context.run_id,
            api_type=api_type,
            model=model_name,
            reminder_count=len(reminder.mentions),
            previous_message_count=len(message_history),
        )
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
            except Exception as error:
                log_exception(
                    "model.request.failed",
                    error,
                    agent_id=reminder.agent_id,
                    turn_id=context.run_id,
                    api_type=api_type,
                    model=model_name,
                    request_count=request_index,
                    duration_ms=round((time.monotonic() - started) * 1000),
                )
                raise AgentRunFailure(
                    "Model request failed",
                    clean_todo_context(
                        captured_messages[len(message_history) :],
                        runtime_prompt=prompt,
                        persisted_prompt=persisted_prompt,
                    ),
                ) from error
        messages = clean_todo_context(
            result.new_messages(),
            runtime_prompt=prompt,
            persisted_prompt=persisted_prompt,
        )
        usage = cast(dict[str, Any], to_jsonable_python(result.usage))
        log_event(
            "model.request.completed",
            agent_id=reminder.agent_id,
            turn_id=context.run_id,
            api_type=api_type,
            model=model_name,
            request_count=request_index,
            message_count=len(messages),
            duration_ms=round((time.monotonic() - started) * 1000),
        )
        return AgentRunOutcome(messages, usage)


def clean_todo_context(
    messages: Sequence[ModelMessage],
    *,
    runtime_prompt: str | None = None,
    persisted_prompt: str | None = None,
) -> tuple[ModelMessage, ...]:
    cleaned: list[ModelMessage] = []
    for message in messages:
        if not isinstance(message, ModelRequest):
            cleaned.append(message)
            continue
        parts = []
        for part in message.parts:
            if (
                isinstance(part, UserPromptPart)
                and runtime_prompt is not None
                and persisted_prompt is not None
                and part.content == runtime_prompt
            ):
                parts.append(replace(part, content=persisted_prompt))
            elif isinstance(part, ToolReturnPart):
                parts.append(replace(part, content=unwrap_tool_result(part.content)))
            else:
                parts.append(part)
        cleaned.append(replace(message, parts=parts))
    return tuple(cleaned)


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
        if config is not None:
            register_secret(config.api_key)
        if observability_config is not None:
            register_secret(observability_config.secret_key)
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
        log_event(
            "model.runtime.initialized",
            configured=config is not None,
            api_type=config.api_type if config is not None else None,
            model=config.model if config is not None else None,
            observability_enabled=session is not None,
        )

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
            register_secret(api_key)
            runner = self._runner_factory(
                config,
                self._current_observability_session,
            )
            if self._on_configure is not None:
                self._on_configure(config.persistence_data())
            self._config = config
            self._runner = runner
        log_event(
            "model.config.updated",
            api_type=config.api_type,
            model=config.model,
        )
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
            register_secret(secret_key)
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
        log_event(
            "observability.config.updated",
            enabled=config.enabled,
            environment=config.environment,
            capture_content=config.capture_content,
            session_active=session is not None,
        )
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
        reminder: Reminder,
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
            return runner.run(reminder, context)
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
        log_event("model.runtime.stopped", observability_session_count=len(sessions))


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
