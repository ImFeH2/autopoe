import json
import sys
from pathlib import Path
from typing import Any

import pytest
from openai import APITimeoutError
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export.in_memory_span_exporter import (
    InMemorySpanExporter,
)
from pydantic_ai import InstrumentationSettings
from pydantic_ai.exceptions import ModelHTTPError
from pydantic_ai.messages import (
    ModelMessage,
    ModelRequest,
    ModelResponse,
    TextPart,
    ToolCallPart,
    ToolReturnPart,
    UserPromptPart,
)
from pydantic_ai.models.anthropic import AnthropicModel
from pydantic_ai.models.function import AgentInfo, DeltaToolCall, FunctionModel
from pydantic_ai.models.google import GoogleModel
from pydantic_ai.models.openai import OpenAIChatModel, OpenAIResponsesModel
from pydantic_ai.models.test import TestModel

from flowent.domain import OrganizationState, Reminder, ReminderMention
from flowent.host_tools import HostTools
from flowent.memory import AgentMemory
from flowent.model_runner import (
    ApiType,
    ModelConfig,
    ModelRuntime,
    PydanticAgentRunner,
    clean_runtime_context,
    create_runner,
)
from flowent.observability import (
    ObservabilityConfig,
    PydanticAIObservability,
    create_pydantic_ai_observability,
)
from flowent.persistence import SQLiteStore
from flowent.runtime import AgentRunContext, AgentRunFailure
from flowent.todos import TODO_STATUS_START, AgentTodos


def activation_context(tmp_path: Path) -> tuple[Reminder, AgentRunContext]:
    state = OrganizationState()
    state.create_agent("Ada")
    state.create_discussion("Work", 1, [2])
    state.send_message(1, 1, "Please inspect this", [2])
    activation, _ = state.claim_next_reminder()
    assert activation is not None
    return activation, AgentRunContext(
        agent_id=2,
        state=state,
        host_tools=HostTools(tmp_path),
    )


def test_model_config_repr_does_not_reveal_api_key() -> None:
    secret = "not-for-repr"

    config = ModelConfig(
        api_type="openai-chat",
        base_url="https://example.invalid/v1",
        api_key=secret,
        model="test-model",
    )

    assert secret not in repr(config)


def test_shared_model_settings_never_return_the_api_key() -> None:
    secret = "shared-secret"
    runtime = ModelRuntime()

    settings = runtime.configure(
        api_type="anthropic",
        base_url="https://example.invalid",
        api_key=secret,
        model="test-model",
    )

    assert settings == {
        "api_type": "anthropic",
        "base_url": "https://example.invalid",
        "model": "test-model",
        "has_api_key": True,
    }
    assert secret not in repr(runtime.settings())
    assert (
        runtime.configure(
            api_type="google",
            base_url="https://google.invalid",
            api_key="",
            model="gemini-test",
        )["has_api_key"]
        is True
    )


@pytest.mark.parametrize(
    ("api_type", "model_type"),
    [
        ("openai-chat", OpenAIChatModel),
        ("openai-responses", OpenAIResponsesModel),
        ("anthropic", AnthropicModel),
        ("google", GoogleModel),
    ],
)
def test_pydantic_runner_uses_the_selected_api_type(
    api_type: ApiType,
    model_type: type[Any],
) -> None:
    runner = PydanticAgentRunner(
        ModelConfig(
            api_type=api_type,
            base_url="https://example.invalid",
            api_key="test-key",
            model="test-model",
        )
    )

    assert isinstance(runner._agent.model, model_type)


@pytest.mark.parametrize("api_type", ["openai-chat", "openai-responses"])
def test_openai_runner_bounds_silent_requests(api_type: ApiType) -> None:
    runner = PydanticAgentRunner(
        ModelConfig(
            api_type=api_type,
            base_url="https://example.invalid",
            api_key="test-key",
            model="test-model",
        )
    )

    client = runner._agent.model.provider.client
    assert client.timeout.connect == 5
    assert client.timeout.read == 120
    assert client.timeout.write == 30
    assert client.timeout.pool == 30
    assert client.max_retries == 0


@pytest.mark.parametrize(
    ("api_type", "expected_settings"),
    [
        ("openai-chat", {"openai_prompt_cache_key": "flowent-agent-2"}),
        ("openai-responses", {"openai_prompt_cache_key": "flowent-agent-2"}),
        ("anthropic", None),
        ("google", None),
    ],
)
def test_runner_uses_stable_agent_prompt_cache_settings(
    tmp_path: Path,
    api_type: ApiType,
    expected_settings: dict[str, str] | None,
) -> None:
    settings: list[dict[str, str] | None] = []

    class SuccessfulResult:
        def __init__(self) -> None:
            self.usage: dict[str, Any] = {}

        def new_messages(self) -> tuple[ModelMessage, ...]:
            return ()

    class RecordingAgent:
        def run_sync(self, *_args: Any, **kwargs: Any) -> SuccessfulResult:
            settings.append(kwargs.get("model_settings"))
            return SuccessfulResult()

    runner = object.__new__(PydanticAgentRunner)
    runner._observability = None  # type: ignore[attr-defined]
    runner._api_type = api_type  # type: ignore[attr-defined]
    runner._model_name = "test-model"  # type: ignore[attr-defined]
    runner._agent = RecordingAgent()  # type: ignore[attr-defined]
    reminder, context = activation_context(tmp_path)

    runner.run(reminder, context)
    runner.run(
        reminder,
        AgentRunContext(
            context.agent_id,
            context.state,
            context.host_tools,
            run_id="another-turn",
        ),
    )
    runner.run(
        Reminder(7, reminder.mentions),
        AgentRunContext(7, context.state, context.host_tools, run_id="other-agent"),
    )

    other_agent_settings = (
        {"openai_prompt_cache_key": "flowent-agent-7"}
        if expected_settings is not None
        else None
    )
    assert settings == [expected_settings, expected_settings, other_agent_settings]


def test_pydantic_runner_exposes_only_current_tool_names() -> None:
    runner = PydanticAgentRunner(
        ModelConfig(
            api_type="openai-chat",
            base_url="https://example.invalid",
            api_key="test-key",
            model="test-model",
        )
    )

    assert set(runner._agent._function_toolset.tools) == {
        "discussion",
        "edit",
        "memory",
        "organization",
        "run",
        "todo",
    }


def test_pydantic_runner_executes_edit_and_run_tools_anywhere_on_host(
    tmp_path: Path,
) -> None:
    outside = tmp_path.parent / f"{tmp_path.name}-outside-tools"
    outside.mkdir()
    target = outside / ".env"
    target.write_text("before\n")
    calls = 0
    instructions: list[str] = []

    async def respond(_messages: list[ModelMessage], info: AgentInfo):
        nonlocal calls
        calls += 1
        instructions.append(info.instructions or "")
        if calls == 1:
            yield {
                0: DeltaToolCall(
                    name="edit",
                    json_args=json.dumps(
                        {
                            "path": str(target),
                            "old_text": "before",
                            "new_text": "after",
                        }
                    ),
                    tool_call_id="edit-1",
                )
            }
        elif calls == 2:
            yield {
                0: DeltaToolCall(
                    name="run",
                    json_args=json.dumps(
                        {
                            "argv": [
                                sys.executable,
                                "-c",
                                'from pathlib import Path; print(Path(".env").read_text())',
                            ],
                            "cwd": str(outside),
                        }
                    ),
                    tool_call_id="run-1",
                )
            }
        else:
            yield "Tools completed"

    events: list[tuple[str, dict[str, Any]]] = []
    runner = PydanticAgentRunner(
        ModelConfig(
            api_type="openai-chat",
            base_url="https://example.invalid",
            api_key="test-key",
            model="test-model",
        )
    )
    reminder, context = activation_context(tmp_path)

    with runner._agent.override(model=FunctionModel(stream_function=respond)):
        outcome = runner.run(
            reminder,
            AgentRunContext(
                context.agent_id,
                context.state,
                context.host_tools,
                history_event_sink=lambda event_type, **data: events.append(
                    (event_type, data)
                ),
            ),
        )

    assert target.read_text() == "after\n"
    assert calls == 3
    assert "may access any path available to the host user" in instructions[0]
    assert "Access them when the task requires it" in instructions[0]
    assert "Never read or expose" not in instructions[0]
    assert any(
        event_type == "tool_result"
        and data["tool_name"] == "run"
        and "after" in str(data["content"])
        for event_type, data in events
    )
    assert "Tools completed" in str(outcome.messages)


def test_pydantic_runner_executes_memory_tools(tmp_path: Path) -> None:
    calls = 0
    seen_messages: list[list[ModelMessage]] = []

    async def respond(messages: list[ModelMessage], _info: AgentInfo):
        nonlocal calls
        calls += 1
        seen_messages.append(list(messages))
        if calls == 1:
            yield {
                0: DeltaToolCall(
                    name="memory",
                    json_args=json.dumps(
                        {
                            "action": "write",
                            "path": "MEMORY.md",
                            "content": "# Index\n- Read patterns.md\n",
                        }
                    ),
                    tool_call_id="memory-write-1",
                )
            }
        elif calls == 2:
            yield {
                0: DeltaToolCall(
                    name="memory",
                    json_args=json.dumps(
                        {
                            "action": "write",
                            "path": "patterns.md",
                            "content": "Persistent insight",
                        }
                    ),
                    tool_call_id="memory-write-2",
                )
            }
        elif calls == 3:
            yield {
                0: DeltaToolCall(
                    name="memory",
                    json_args=json.dumps({"action": "read", "path": "patterns.md"}),
                    tool_call_id="memory-read-1",
                )
            }
        else:
            yield "Memory recorded"

    memories = AgentMemory(tmp_path / "data")
    runner = PydanticAgentRunner(
        ModelConfig(
            api_type="openai-chat",
            base_url="https://example.invalid",
            api_key="test-key",
            model="test-model",
        )
    )
    reminder, context = activation_context(tmp_path)
    events: list[tuple[str, dict[str, Any]]] = []

    with runner._agent.override(model=FunctionModel(stream_function=respond)):
        outcome = runner.run(
            reminder,
            AgentRunContext(
                context.agent_id,
                context.state,
                context.host_tools,
                history_event_sink=lambda event_type, **data: events.append(
                    (event_type, data)
                ),
                memories=memories,
            ),
        )

    assert calls == 4
    assert memories.read(2, "MEMORY.md")["content"] == ("# Index\n- Read patterns.md\n")
    assert memories.read(2, "patterns.md")["content"] == "Persistent insight"
    assert "Persistent insight" in str(seen_messages[-1])
    assert "Memory recorded" in str(outcome.messages)
    assert [
        data["tool_name"] for event_type, data in events if event_type == "tool_result"
    ] == ["memory", "memory", "memory"]


def test_memory_index_is_fresh_runtime_only_context(tmp_path: Path) -> None:
    seen_messages: list[list[ModelMessage]] = []

    async def respond(messages: list[ModelMessage], _info: AgentInfo):
        seen_messages.append(list(messages))
        yield "Used current Memory"

    memories = AgentMemory(tmp_path / "data")
    memories.write(2, "MEMORY.md", "Fresh private insight")
    runner = PydanticAgentRunner(
        ModelConfig(
            api_type="openai-chat",
            base_url="https://example.invalid",
            api_key="test-key",
            model="test-model",
        )
    )
    reminder, context = activation_context(tmp_path)

    with runner._agent.override(model=FunctionModel(stream_function=respond)):
        outcome = runner.run(
            reminder,
            AgentRunContext(
                context.agent_id,
                context.state,
                context.host_tools,
                memories=memories,
            ),
        )

    assert "<memory>" in str(seen_messages[0])
    assert "Fresh private insight" in str(seen_messages[0])
    assert "<memory>" not in str(outcome.messages)
    assert "Fresh private insight" not in str(outcome.messages)


def test_all_agents_use_the_latest_shared_runner(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    calls: list[tuple[str, int]] = []

    class RecordingRunner:
        def __init__(self, model: str) -> None:
            self.model = model

        def run(self, activation: Reminder, context: AgentRunContext) -> None:
            del context
            calls.append((self.model, activation.agent_id))

    def create_recording_runner(
        _runtime: ModelRuntime,
        config: ModelConfig | None,
        _observability: object,
    ) -> RecordingRunner:
        return RecordingRunner(config.model if config else "unavailable")

    monkeypatch.setattr(ModelRuntime, "_create_runner", create_recording_runner)
    runtime = ModelRuntime()
    runtime.configure(
        api_type="openai-chat",
        base_url="https://example.invalid",
        api_key="test-key",
        model="shared-model",
    )
    state = OrganizationState(tmp_path)
    host_tools = HostTools(tmp_path)

    for agent_id in (2, 3):
        runtime.run(
            Reminder(
                agent_id=agent_id,
                mentions=(ReminderMention(1, 1, 1, "Request", False),),
            ),
            AgentRunContext(agent_id, state, host_tools),
        )

    assert calls == [("shared-model", 2), ("shared-model", 3)]


def test_observability_settings_never_return_the_secret_key() -> None:
    secret = "langfuse-secret"
    runtime = ModelRuntime(observability_session_factory=lambda _config: None)

    settings = runtime.configure_observability(
        enabled=True,
        base_url="https://langfuse.invalid",
        public_key="langfuse-public",
        secret_key=secret,
        environment="development",
        capture_content=True,
    )

    assert settings == {
        "enabled": True,
        "base_url": "https://langfuse.invalid",
        "public_key": "langfuse-public",
        "environment": "development",
        "capture_content": True,
        "has_secret_key": True,
    }
    assert secret not in repr(settings)
    assert (
        runtime.configure_observability(
            enabled=False,
            base_url="",
            public_key="",
            secret_key="",
            environment="",
            capture_content=False,
        )["has_secret_key"]
        is True
    )


def test_observability_reconfiguration_shuts_down_idle_exporters() -> None:
    shutdown_calls: list[int] = []
    providers: list[object] = []

    class RecordingProvider:
        def shutdown(self) -> None:
            shutdown_calls.append(id(self))

    def create_session(_config: ObservabilityConfig) -> PydanticAIObservability:
        provider = RecordingProvider()
        providers.append(provider)
        instrumentation = InstrumentationSettings(
            tracer_provider=TracerProvider(),
            include_content=False,
        )
        return PydanticAIObservability(provider, instrumentation)

    runtime = ModelRuntime(observability_session_factory=create_session)
    for public_key in ("first-public", "second-public"):
        runtime.configure_observability(
            enabled=True,
            base_url="https://langfuse.invalid",
            public_key=public_key,
            secret_key="test-secret",
            environment="test",
            capture_content=False,
        )

    assert shutdown_calls == [id(providers[0])]
    runtime.shutdown()
    assert shutdown_calls == [id(providers[0]), id(providers[1])]


def test_pydantic_runner_exports_only_pydantic_ai_spans(tmp_path: Path) -> None:
    def exported_spans(capture_content: bool) -> list[Any]:
        exporter = InMemorySpanExporter()
        observability = create_pydantic_ai_observability(
            ObservabilityConfig(
                enabled=True,
                base_url="https://langfuse.invalid",
                public_key="test-public",
                secret_key="test-secret",
                environment="test",
                capture_content=capture_content,
            ),
            span_exporter=exporter,
        )
        runner = PydanticAgentRunner(
            ModelConfig(
                api_type="openai-chat",
                base_url="https://example.invalid/v1",
                api_key="test-key",
                model="test-model",
            ),
            observability,
        )
        activation, context = activation_context(tmp_path)
        with runner._agent.override(
            model=TestModel(call_tools=[], custom_output_text="TRACE_RESPONSE")
        ):
            runner.run(activation, context)
        observability.shutdown()
        return list(exporter.get_finished_spans())

    hidden_spans = exported_spans(False)
    visible_spans = exported_spans(True)
    hidden_attributes = [dict(span.attributes or {}) for span in hidden_spans]
    visible_attributes = [dict(span.attributes or {}) for span in visible_spans]

    assert hidden_spans
    assert all(
        span.instrumentation_scope.name == "pydantic-ai" for span in visible_spans
    )
    assert all(span.name != "Flowent activation" for span in visible_spans)
    assert len({span.context.trace_id for span in visible_spans}) == 1
    assert all("Here is your Reminder" not in str(item) for item in hidden_attributes)
    assert any("Here is your Reminder" in str(item) for item in visible_attributes)
    assert any("TRACE_RESPONSE" in str(item) for item in visible_attributes)
    assert all(
        item.get("langfuse.trace.metadata.agent_id") == 2
        and item.get("langfuse.session.id") == "flowent-agent-2"
        for item in visible_attributes
    )
    assert any("gen_ai.usage.output_tokens" in item for item in visible_attributes)


def test_pydantic_runner_continues_the_same_agent_message_history(
    tmp_path: Path,
) -> None:
    seen_messages: list[list[ModelMessage]] = []

    async def respond(
        messages: list[ModelMessage],
        _info: AgentInfo,
    ):
        seen_messages.append(list(messages))
        yield f"Reply {len(seen_messages)}"

    runner = PydanticAgentRunner(
        ModelConfig(
            api_type="openai-chat",
            base_url="https://example.invalid/v1",
            api_key="test-key",
            model="test-model",
        )
    )
    activation, first_context = activation_context(tmp_path)
    first_events: list[tuple[str, dict[str, Any]]] = []
    first_context = AgentRunContext(
        first_context.agent_id,
        first_context.state,
        first_context.host_tools,
        run_id="first-run",
        history_event_sink=lambda event_type, **data: first_events.append(
            (event_type, data)
        ),
    )
    with runner._agent.override(model=FunctionModel(stream_function=respond)):
        first = runner.run(activation, first_context)
        second = runner.run(
            activation,
            AgentRunContext(
                first_context.agent_id,
                first_context.state,
                first_context.host_tools,
                run_id="second-run",
                message_history=first.messages,
            ),
        )

    assert len(seen_messages) == 2
    assert len(seen_messages[0]) == 1
    assert "Please inspect this" in str(seen_messages[0])
    assert len(seen_messages[1]) == 3
    assert seen_messages[1][0:2] == list(first.messages)
    assert len(first.messages) == 2
    assert len(second.messages) == 2
    assert first.messages[0].conversation_id == second.messages[0].conversation_id
    assert first.messages[0].run_id == "first-run"
    assert second.messages[0].run_id == "second-run"
    assert any(event_type == "text_delta" for event_type, _data in first_events)


def test_runner_accepts_legacy_exec_and_patch_message_history(
    tmp_path: Path,
) -> None:
    seen_messages: list[list[ModelMessage]] = []

    async def respond(messages: list[ModelMessage], _info: AgentInfo):
        seen_messages.append(list(messages))
        yield "Continue with current tools"

    legacy_messages: tuple[ModelMessage, ...] = (
        ModelRequest(parts=[UserPromptPart(content="Legacy Turn")]),
        ModelResponse(
            parts=[
                ToolCallPart("exec", {"argv": ["pwd"]}, "legacy-exec"),
                ToolCallPart("patch", {"diff": "legacy diff"}, "legacy-patch"),
            ],
            model_name="legacy-model",
        ),
        ModelRequest(
            parts=[
                ToolReturnPart("exec", {"exit_code": 0}, "legacy-exec"),
                ToolReturnPart("patch", {"applied": True}, "legacy-patch"),
            ]
        ),
        ModelResponse(parts=[TextPart("Legacy complete")], model_name="legacy-model"),
    )
    runner = PydanticAgentRunner(
        ModelConfig(
            api_type="openai-chat",
            base_url="https://example.invalid",
            api_key="test-key",
            model="test-model",
        )
    )
    reminder, context = activation_context(tmp_path)

    with runner._agent.override(model=FunctionModel(stream_function=respond)):
        outcome = runner.run(
            reminder,
            AgentRunContext(
                context.agent_id,
                context.state,
                context.host_tools,
                message_history=legacy_messages,
            ),
        )

    assert seen_messages[0][:4] == list(legacy_messages)
    assert "exec" in str(seen_messages[0])
    assert "patch" in str(seen_messages[0])
    assert len(outcome.messages) == 2


def test_todo_status_is_visible_after_tools_but_removed_from_history(
    tmp_path: Path,
) -> None:
    seen_messages: list[list[ModelMessage]] = []

    async def respond(messages: list[ModelMessage], _info: AgentInfo):
        seen_messages.append(list(messages))
        if len(seen_messages) == 1:
            yield {
                0: DeltaToolCall(
                    name="todo",
                    json_args='{"action":"create","subject":"Inspect failure"}',
                    tool_call_id="todo-1",
                )
            }
        else:
            yield "Todo recorded"

    store = SQLiteStore(tmp_path / "data")
    state = OrganizationState(
        tmp_path,
        persisted=store.load_organization(),
        on_persist=store.save_organization,
    )
    state.create_agent("Ada")
    state.create_discussion("Work", 1, [2])
    state.send_message(1, 1, "Please inspect this", [2])
    reminder, _ = state.claim_next_reminder()
    assert reminder is not None
    events: list[tuple[str, dict[str, Any]]] = []
    context = AgentRunContext(
        2,
        state,
        HostTools(tmp_path),
        run_id="todo-run",
        history_event_sink=lambda event_type, **data: events.append((event_type, data)),
        todos=AgentTodos(store),
    )
    runner = PydanticAgentRunner(
        ModelConfig(
            api_type="openai-chat",
            base_url="https://example.invalid/v1",
            api_key="test-key",
            model="test-model",
        )
    )

    with runner._agent.override(model=FunctionModel(stream_function=respond)):
        outcome = runner.run(reminder, context)

    assert len(seen_messages) == 2
    assert TODO_STATUS_START not in str(seen_messages[0])
    assert TODO_STATUS_START in str(seen_messages[1])
    assert "Current: none" in str(seen_messages[1])
    assert "#1 Inspect failure" in str(seen_messages[1])
    assert TODO_STATUS_START not in str(outcome.messages)
    tool_results = [data for event_type, data in events if event_type == "tool_result"]
    assert len(tool_results) == 1
    assert "todo_status" not in str(tool_results[0]["content"])


def test_turn_start_todo_status_is_runtime_only(tmp_path: Path) -> None:
    seen_messages: list[list[ModelMessage]] = []

    async def respond(messages: list[ModelMessage], _info: AgentInfo):
        seen_messages.append(list(messages))
        yield "Continue current work"

    store = SQLiteStore(tmp_path / "data")
    state = OrganizationState(
        tmp_path,
        persisted=store.load_organization(),
        on_persist=store.save_organization,
    )
    state.create_agent("Ada")
    state.create_discussion("Work", 1, [2])
    state.send_message(1, 1, "Continue", [2])
    reminder, _ = state.claim_next_reminder()
    assert reminder is not None
    todos = AgentTodos(store)
    todos.create(2, "Persistent task")
    todos.start(2, 1)
    runner = PydanticAgentRunner(
        ModelConfig(
            api_type="openai-chat",
            base_url="https://example.invalid/v1",
            api_key="test-key",
            model="test-model",
        )
    )

    with runner._agent.override(model=FunctionModel(stream_function=respond)):
        outcome = runner.run(
            reminder,
            AgentRunContext(
                2,
                state,
                HostTools(tmp_path),
                todos=todos,
            ),
        )

    assert TODO_STATUS_START in str(seen_messages[0])
    assert "Current: #1 Persistent task" in str(seen_messages[0])
    assert TODO_STATUS_START not in str(outcome.messages)
    assert "Persistent task" not in str(outcome.messages)


def test_todo_cleanup_preserves_matching_tags_from_user_content() -> None:
    persisted_prompt = "Reminder body\n\n<todo_status>\nUser-authored text"
    runtime_prompt = (
        f"{persisted_prompt}\n\n<todo_status>\nCurrent: #1 Work\n</todo_status>"
    )
    messages = (ModelRequest(parts=[UserPromptPart(content=runtime_prompt)]),)

    cleaned = clean_runtime_context(
        messages,
        runtime_prompt=runtime_prompt,
        persisted_prompt=persisted_prompt,
    )

    assert cleaned[0].parts[0].content == persisted_prompt


def test_missing_model_config_returns_runner_that_fails_on_activation(
    tmp_path: Path,
) -> None:
    runner = create_runner()
    activation, context = activation_context(tmp_path)

    with pytest.raises(AgentRunFailure, match="configuration is incomplete"):
        runner.run(activation, context)


def test_openai_timeout_is_mapped_to_safe_model_failure(tmp_path: Path) -> None:
    class TimeoutAgent:
        def run_sync(
            self,
            prompt: str,
            deps: AgentRunContext,
            metadata: dict[str, Any],
            **_kwargs: Any,
        ) -> Any:
            del prompt, deps, metadata
            raise APITimeoutError(request=object())

    runner = object.__new__(PydanticAgentRunner)
    runner._observability = None  # type: ignore[attr-defined]
    runner._agent = TimeoutAgent()  # type: ignore[attr-defined]
    activation, context = activation_context(tmp_path)

    with pytest.raises(AgentRunFailure, match="^Model request failed$"):
        runner.run(activation, context)


def test_pydantic_model_errors_are_mapped_to_safe_message(tmp_path: Path) -> None:
    class FailingAgent:
        def run_sync(
            self,
            prompt: str,
            deps: AgentRunContext,
            metadata: dict[str, Any],
            **_kwargs: Any,
        ) -> Any:
            del prompt, deps, metadata
            raise ModelHTTPError(401, "secret upstream detail", "test-model")

    runner = object.__new__(PydanticAgentRunner)
    runner._observability = None  # type: ignore[attr-defined]
    runner._agent = FailingAgent()  # type: ignore[attr-defined]
    activation, context = activation_context(tmp_path)

    with pytest.raises(AgentRunFailure, match="^Model request failed$"):
        runner.run(activation, context)
