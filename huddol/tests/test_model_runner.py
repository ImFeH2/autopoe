import json
import sqlite3
import sys
from pathlib import Path
from typing import Any

import pytest
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export.in_memory_span_exporter import (
    InMemorySpanExporter,
)
from pydantic_ai import InstrumentationSettings, PartStartEvent
from pydantic_ai.capabilities import WebSearch
from pydantic_ai.exceptions import ModelAPIError, ModelHTTPError
from pydantic_ai.messages import (
    CompactionPart,
    ModelMessage,
    ModelRequest,
    ModelResponse,
    NativeToolCallPart,
    NativeToolReturnPart,
    TextPart,
    ToolCallPart,
    ToolReturnPart,
    UserPromptPart,
)
from pydantic_ai.models.anthropic import AnthropicCompaction, AnthropicModel
from pydantic_ai.models.function import AgentInfo, DeltaToolCall, FunctionModel
from pydantic_ai.models.google import GoogleModel
from pydantic_ai.models.openai import (
    OpenAIChatModel,
    OpenAICompaction,
    OpenAIResponsesModel,
)
from pydantic_ai.models.test import TestModel
from pydantic_ai.native_tools import WebSearchTool

from huddol.domain import OrganizationState, Reminder, ReminderMention
from huddol.history import AgentHistory
from huddol.host_tools import HostTools
from huddol.memory import AgentMemory
from huddol.model_execution import RetryingModel
from huddol.model_runner import (
    ApiType,
    ModelConfig,
    ModelRuntime,
    PydanticAgentRunner,
    active_message_history,
    clean_runtime_context,
    create_runner,
)
from huddol.observability import (
    ObservabilityConfig,
    PydanticAIObservability,
    create_pydantic_ai_observability,
)
from huddol.operations import ActorContext, OrganizationOperations
from huddol.persistence import SQLiteStore
from huddol.runtime import AgentRunContext, AgentRunFailure
from huddol.todos import TODO_STATUS_START, AgentTodos


def activation_context(tmp_path: Path) -> tuple[Reminder, AgentRunContext]:
    state = OrganizationState()
    state.create_agent("Ada")
    state.create_discussion("Work", 1, [2])
    state.send_message(1, 1, "@Ada Please inspect this")
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
        "context_window": None,
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

    assert isinstance(runner._agent.model, RetryingModel)
    assert isinstance(runner._agent.model.wrapped, model_type)


@pytest.mark.parametrize(
    ("api_type", "capability_type"),
    [
        ("openai-chat", None),
        ("openai-responses", OpenAICompaction),
        ("anthropic", AnthropicCompaction),
        ("google", None),
    ],
)
def test_runner_enables_native_compaction_when_supported(
    api_type: ApiType,
    capability_type: type[Any] | None,
) -> None:
    runner = PydanticAgentRunner(
        ModelConfig(
            api_type=api_type,
            base_url="https://example.invalid",
            api_key="test-key",
            model="test-model",
        )
    )
    capabilities: list[Any] = []
    runner._agent.root_capability.apply(capabilities.append)

    native = [
        capability
        for capability in capabilities
        if isinstance(capability, (OpenAICompaction, AnthropicCompaction))
    ]
    if capability_type is None:
        assert native == []
    else:
        assert len(native) == 1
        assert isinstance(native[0], capability_type)


def test_runner_sets_compaction_threshold_to_eighty_five_percent() -> None:
    config = ModelConfig(
        api_type="openai-responses",
        base_url="https://example.invalid",
        api_key="test-key",
        model="test-model",
        context_window=1_050_000,
    )
    runner = PydanticAgentRunner(config)
    capabilities: list[Any] = []
    runner._agent.root_capability.apply(capabilities.append)

    compaction = next(
        capability
        for capability in capabilities
        if isinstance(capability, OpenAICompaction)
    )
    assert config.compaction_threshold == 892_500
    assert compaction.stateless is False
    assert compaction.token_threshold == 892_500


def test_runner_configures_bounded_web_search_with_local_fallback() -> None:
    runner = PydanticAgentRunner(
        ModelConfig(
            api_type="openai-responses",
            base_url="https://example.invalid",
            api_key="test-key",
            model="test-model",
        )
    )
    capabilities: list[Any] = []
    runner._agent.root_capability.apply(capabilities.append)

    web_search = next(
        capability for capability in capabilities if isinstance(capability, WebSearch)
    )
    assert isinstance(web_search.native, WebSearchTool)
    assert web_search.native.max_uses == 8
    assert web_search.local is not None
    assert web_search.local.name == "web_search"
    assert web_search.local.timeout == 30


@pytest.mark.parametrize(
    ("api_type", "model_name"),
    [
        ("openai-chat", "test-model"),
        ("google", "gemini-2.5-pro"),
    ],
)
def test_runner_uses_local_web_search_when_native_is_incompatible(
    api_type: ApiType,
    model_name: str,
) -> None:
    runner = PydanticAgentRunner(
        ModelConfig(
            api_type=api_type,
            base_url="https://example.invalid",
            api_key="test-key",
            model=model_name,
        )
    )
    capabilities: list[Any] = []
    runner._agent.root_capability.apply(capabilities.append)

    web_search = next(
        capability for capability in capabilities if isinstance(capability, WebSearch)
    )
    assert web_search.native is False
    assert web_search.local is not None
    assert web_search.local.name == "web_search"


@pytest.mark.parametrize(
    ("api_type", "context_window", "expected_settings"),
    [
        (
            "openai-responses",
            1_050_000,
            {
                "openai_prompt_cache_key": "huddol-agent-2",
                "openai_include_web_search_sources": True,
                "openai_context_management": [
                    {"type": "compaction", "compact_threshold": 892_500}
                ],
            },
        ),
        (
            "anthropic",
            None,
            {
                "anthropic_context_management": {
                    "edits": [
                        {
                            "type": "compact_20260112",
                            "trigger": {"type": "input_tokens", "value": 150_000},
                        }
                    ]
                }
            },
        ),
    ],
)
def test_runner_applies_provider_compaction_context_management(
    tmp_path: Path,
    api_type: ApiType,
    context_window: int | None,
    expected_settings: dict[str, Any],
) -> None:
    settings: list[dict[str, Any] | None] = []

    async def respond(_messages: list[ModelMessage], info: AgentInfo):
        settings.append(info.model_settings)
        yield "Compaction configured"

    runner = PydanticAgentRunner(
        ModelConfig(
            api_type=api_type,
            base_url="https://example.invalid",
            api_key="test-key",
            model="test-model",
            context_window=context_window,
        )
    )
    reminder, context = activation_context(tmp_path)

    with runner._agent.override(model=FunctionModel(stream_function=respond)):
        runner.run(reminder, context)

    assert len(settings) == 1
    actual_settings = dict(settings[0] or {})
    timeout = actual_settings.pop("timeout")
    assert timeout.connect == 5
    assert timeout.read == 120
    assert timeout.write == 30
    assert timeout.pool == 30
    assert actual_settings == expected_settings


@pytest.mark.parametrize(
    ("api_type", "numeric_timeout"),
    [
        ("openai-chat", False),
        ("openai-responses", False),
        ("anthropic", False),
        ("google", True),
    ],
)
def test_runner_bounds_silent_requests_through_pydantic_settings(
    api_type: ApiType,
    numeric_timeout: bool,
) -> None:
    runner = PydanticAgentRunner(
        ModelConfig(
            api_type=api_type,
            base_url="https://example.invalid",
            api_key="test-key",
            model="test-model",
        )
    )

    timeout = runner._request_policy.get_model_settings()["timeout"]
    if numeric_timeout:
        assert timeout == 120
    else:
        assert timeout.connect == 5
        assert timeout.read == 120
        assert timeout.write == 30
        assert timeout.pool == 30


@pytest.mark.parametrize(
    ("api_type", "expected_settings"),
    [
        ("openai-chat", {"openai_prompt_cache_key": "huddol-agent-2"}),
        (
            "openai-responses",
            {
                "openai_prompt_cache_key": "huddol-agent-2",
                "openai_include_web_search_sources": True,
            },
        ),
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
        async def __aenter__(self) -> Any:
            return self

        async def __aexit__(self, *_args: object) -> None:
            return None

        async def run(self, *_args: Any, **kwargs: Any) -> SuccessfulResult:
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
        {**expected_settings, "openai_prompt_cache_key": "huddol-agent-7"}
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
        "history",
        "memory",
        "organization",
        "run",
        "todo",
    }
    discussion = runner._agent._function_toolset.tools["discussion"]
    assert "mention_ids" not in discussion.function_schema.json_schema["properties"]
    assert "@Name" in discussion.description


def test_pydantic_runner_executes_admin_discussion_tools(tmp_path: Path) -> None:
    calls = 0

    async def respond(_messages: list[ModelMessage], _info: AgentInfo):
        nonlocal calls
        calls += 1
        tool_calls = (
            ("organization", {"action": "permissions"}),
            ("organization", {"action": "metadata"}),
            (
                "discussion",
                {
                    "action": "update_members",
                    "discussion_id": 2,
                    "member_ids": [2, 3],
                    "expected_revision": 1,
                },
            ),
            (
                "discussion",
                {
                    "action": "delete",
                    "discussion_id": 2,
                    "expected_revision": 2,
                    "confirm_topic": "Cleanup",
                },
            ),
        )
        if calls <= len(tool_calls):
            name, arguments = tool_calls[calls - 1]
            yield {
                0: DeltaToolCall(
                    name=name,
                    json_args=json.dumps(arguments),
                    tool_call_id=f"management-{calls}",
                )
            }
        else:
            yield "Management completed"

    store = SQLiteStore(tmp_path / "data")
    state = OrganizationState()
    state.create_agent("Ada")
    state.create_agent("Lin")
    state.create_discussion("Work", 1, [2])
    state.create_discussion("Cleanup", 1, [3])
    state.send_message(1, 1, "@Ada Manage the Organization")
    store.save_organization(state.prepare_management_replacement().persistence_data)
    history = AgentHistory(store)
    todos = AgentTodos(store)
    memories = AgentMemory(tmp_path / "data")
    operations = OrganizationOperations(
        state,
        store,
        history=history,
        todos=todos,
        memories=memories,
    )
    operations.grant_admin(ActorContext.current_human(state), 0, 2)
    reminder, _ = state.claim_next_reminder()
    assert reminder is not None
    context = AgentRunContext(
        2,
        state,
        HostTools(tmp_path),
        operations=operations,
    )
    runner = PydanticAgentRunner(
        ModelConfig(
            api_type="openai-chat",
            base_url="https://example.invalid",
            api_key="test-key",
            model="test-model",
        )
    )

    with runner._agent.override(model=FunctionModel(stream_function=respond)):
        outcome = runner.run(reminder, context)

    assert [member["name"] for member in state.snapshot()["members"]] == [
        "You",
        "Ada",
        "Lin",
    ]
    assert [discussion["topic"] for discussion in state.snapshot()["discussions"]] == [
        "Work"
    ]
    assert "Management completed" in str(outcome.messages)


def test_runner_recovers_after_tool_execution_is_interrupted(tmp_path: Path) -> None:
    fail_persistence = False

    def persist(_snapshot: dict[str, Any]) -> None:
        if fail_persistence:
            raise sqlite3.OperationalError("write failed")

    async def send_message(_messages: list[ModelMessage], _info: AgentInfo):
        yield {
            0: DeltaToolCall(
                name="discussion",
                json_args=json.dumps(
                    {
                        "action": "send",
                        "discussion_id": 1,
                        "body": "Progress",
                    }
                ),
                tool_call_id="failed-send",
            )
        }

    state = OrganizationState(on_persist=persist)
    state.create_agent("Ada")
    state.create_discussion("Work", 1, [2])
    state.send_message(1, 1, "@Ada Continue")
    reminder, _ = state.claim_next_reminder()
    assert reminder is not None
    authorization_store = SQLiteStore(tmp_path / "authorization")
    authorization_store.save_organization(
        state.prepare_management_replacement().persistence_data
    )
    operations = OrganizationOperations(state, authorization_store)
    context = AgentRunContext(
        2,
        state,
        HostTools(tmp_path),
        operations=operations,
    )
    runner = PydanticAgentRunner(
        ModelConfig(
            api_type="openai-chat",
            base_url="https://example.invalid",
            api_key="test-key",
            model="test-model",
        )
    )

    fail_persistence = True
    with (
        runner._agent.override(model=FunctionModel(stream_function=send_message)),
        pytest.raises(AgentRunFailure) as caught,
    ):
        runner.run(reminder, context)

    assert isinstance(caught.value.messages[-1], ModelRequest)
    assert caught.value.messages[-1].state == "interrupted"
    assert caught.value.messages[-1].parts == []

    fail_persistence = False
    recovered = False

    async def continue_turn(messages: list[ModelMessage], _info: AgentInfo):
        nonlocal recovered
        recovered = any(
            isinstance(part, ToolReturnPart)
            and part.tool_call_id == "failed-send"
            and part.outcome == "interrupted"
            for message in messages
            for part in message.parts
        )
        yield "Recovered"

    with runner._agent.override(model=FunctionModel(stream_function=continue_turn)):
        outcome = runner.run(
            reminder,
            AgentRunContext(
                2,
                state,
                HostTools(tmp_path),
                message_history=caught.value.messages,
                operations=operations,
            ),
        )

    assert recovered
    assert "Recovered" in str(outcome.messages)


def test_runner_publishes_native_web_search_events(tmp_path: Path) -> None:
    call = NativeToolCallPart(
        tool_name="web_search",
        args={"query": "Huddol"},
        tool_call_id="search-1",
        provider_name="openai",
    )
    result_part = NativeToolReturnPart(
        tool_name="web_search",
        content={
            "status": "completed",
            "sources": [{"title": "Huddol", "url": "https://example.com"}],
        },
        tool_call_id="search-1",
        provider_name="openai",
    )
    messages = (
        ModelResponse(
            parts=[call, result_part, TextPart("Search complete")],
            model_name="test-model",
        ),
    )

    class SuccessfulResult:
        def __init__(self) -> None:
            self.usage: dict[str, Any] = {}

        def new_messages(self) -> tuple[ModelMessage, ...]:
            return messages

    class NativeSearchAgent:
        async def __aenter__(self) -> Any:
            return self

        async def __aexit__(self, *_args: object) -> None:
            return None

        async def run(self, *_args: Any, **kwargs: Any) -> SuccessfulResult:
            async def events():
                yield PartStartEvent(index=0, part=call)
                yield PartStartEvent(index=1, part=result_part)

            await kwargs["event_stream_handler"](None, events())
            return SuccessfulResult()

    runner = object.__new__(PydanticAgentRunner)
    runner._observability = None  # type: ignore[attr-defined]
    runner._api_type = "openai-responses"  # type: ignore[attr-defined]
    runner._model_name = "test-model"  # type: ignore[attr-defined]
    runner._agent = NativeSearchAgent()  # type: ignore[attr-defined]
    reminder, context = activation_context(tmp_path)
    events: list[tuple[str, dict[str, Any]]] = []

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

    assert events == [
        (
            "tool_call",
            {
                "tool_name": "web_search",
                "tool_call_id": "search-1",
                "content": {"query": "Huddol"},
            },
        ),
        (
            "tool_result",
            {
                "tool_name": "web_search",
                "tool_call_id": "search-1",
                "content": {
                    "status": "completed",
                    "sources": [{"title": "Huddol", "url": "https://example.com"}],
                },
            },
        ),
    ]
    assert outcome.messages == messages


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


def test_pydantic_runner_reads_compacted_history_without_repersisting_content(
    tmp_path: Path,
) -> None:
    history = AgentHistory(SQLiteStore(tmp_path / "data"))
    archived = history.start(Reminder(2, ()))
    private_detail = "Exact archived payload that must stay outside the recent tail"
    archived.complete(
        "completed",
        (ModelRequest(parts=[UserPromptPart(content=private_detail)]),),
    )
    checkpoint = history.start(Reminder(2, ()))
    checkpoint.complete(
        "completed",
        (
            ModelResponse(
                parts=[CompactionPart(content="checkpoint")],
                model_name="test-model",
            ),
        ),
    )
    match = history.search_compacted(2, "Exact archived")["matches"][0]
    seen_messages: list[list[ModelMessage]] = []

    async def respond(messages: list[ModelMessage], _info: AgentInfo):
        seen_messages.append(list(messages))
        if len(seen_messages) == 1:
            yield {
                0: DeltaToolCall(
                    name="history",
                    json_args=json.dumps(
                        {
                            "action": "read",
                            "entry_id": match["entry_id"],
                        }
                    ),
                    tool_call_id="history-read-1",
                )
            }
        else:
            yield "Recovered archived context"

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
                history_store=history,
            ),
        )

    assert private_detail in str(seen_messages[-1])
    assert private_detail not in str(outcome.messages)
    assert "'retrieved': True" in str(outcome.messages)
    assert match["entry_id"] in str(outcome.messages)
    assert "Recovered archived context" in str(outcome.messages)


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

    assert "<host_environment>" in str(seen_messages[0])
    assert str(tmp_path) in str(seen_messages[0])
    assert "<memory>" in str(seen_messages[0])
    assert "Fresh private insight" in str(seen_messages[0])
    assert "<host_environment>" not in str(outcome.messages)
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
    assert all(span.name != "Huddol activation" for span in visible_spans)
    assert len({span.context.trace_id for span in visible_spans}) == 1
    assert all("Here is your Reminder" not in str(item) for item in hidden_attributes)
    assert any("Here is your Reminder" in str(item) for item in visible_attributes)
    assert any("TRACE_RESPONSE" in str(item) for item in visible_attributes)
    assert all(
        item.get("langfuse.trace.metadata.agent_id") == 2
        and item.get("langfuse.session.id") == "huddol-agent-2"
        for item in visible_attributes
    )
    assert any("gen_ai.usage.output_tokens" in item for item in visible_attributes)


def test_active_message_history_uses_latest_compatible_compaction_window() -> None:
    messages: tuple[ModelMessage, ...] = (
        ModelRequest(parts=[UserPromptPart(content="Archived raw marker")]),
        ModelResponse(
            parts=[
                CompactionPart(
                    provider_name="openai",
                    provider_details={"encrypted_content": "opaque"},
                ),
                TextPart("Recent response"),
            ],
            model_name="test-model",
        ),
        ModelRequest(parts=[UserPromptPart(content="Recent request")]),
    )

    active = active_message_history(messages, "openai-responses")

    assert "Archived raw marker" not in str(active)
    assert "opaque" in str(active)
    assert "Recent response" in str(active)
    assert "Recent request" in str(active)


def test_active_message_history_falls_back_safely_after_provider_switch() -> None:
    messages: tuple[ModelMessage, ...] = (
        ModelRequest(parts=[UserPromptPart(content="Archived raw marker")]),
        ModelResponse(
            parts=[
                CompactionPart(
                    provider_name="openai",
                    provider_details={"encrypted_content": "opaque"},
                ),
                TextPart("Recent response"),
            ],
            model_name="test-model",
        ),
        ModelRequest(parts=[UserPromptPart(content="Recent request")]),
    )

    active = active_message_history(messages, "google")

    assert "Archived raw marker" not in str(active)
    assert "opaque" not in str(active)
    assert "Use the history tool" in str(active)
    assert "Recent response" in str(active)
    assert "Recent request" in str(active)


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
    state.send_message(1, 1, "@Ada Please inspect this")
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
    state.send_message(1, 1, "@Ada Continue")
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


def test_history_retrieval_receipt_keeps_coordinates_without_content() -> None:
    messages = (
        ModelRequest(
            parts=[
                ToolReturnPart(
                    "history",
                    {
                        "action": "search",
                        "checkpoint": {"sequence": 5, "provider": "openai"},
                        "matches": [
                            {
                                "entry_id": "run-2-3-4",
                                "snippet": "private archived content",
                            }
                        ],
                        "count": 1,
                        "offset": 0,
                        "next_offset": None,
                        "truncated": False,
                    },
                    "history-search-1",
                )
            ]
        ),
    )

    cleaned = clean_runtime_context(messages)
    receipt = cleaned[0].parts[0].content

    assert receipt["entry_ids"] == ["run-2-3-4"]
    assert receipt["checkpoint"] == {"sequence": 5, "provider": "openai"}
    assert receipt["returned_matches"] == 1
    assert "private archived content" not in str(receipt)
    assert "snippet" not in str(receipt)


def test_missing_model_config_returns_runner_that_fails_on_activation(
    tmp_path: Path,
) -> None:
    runner = create_runner()
    activation, context = activation_context(tmp_path)

    with pytest.raises(AgentRunFailure, match="configuration is incomplete"):
        runner.run(activation, context)


def test_model_api_error_is_mapped_to_safe_model_failure(tmp_path: Path) -> None:
    class FailingAgent:
        async def __aenter__(self) -> Any:
            return self

        async def __aexit__(self, *_args: object) -> None:
            return None

        async def run(
            self,
            prompt: str,
            deps: AgentRunContext,
            metadata: dict[str, Any],
            **_kwargs: Any,
        ) -> Any:
            del prompt, deps, metadata
            raise ModelAPIError("test-model", "connection failed")

    runner = object.__new__(PydanticAgentRunner)
    runner._observability = None  # type: ignore[attr-defined]
    runner._agent = FailingAgent()  # type: ignore[attr-defined]
    activation, context = activation_context(tmp_path)

    with pytest.raises(AgentRunFailure, match="^Model request failed$"):
        runner.run(activation, context)


def test_pydantic_model_errors_are_mapped_to_safe_message(tmp_path: Path) -> None:
    class FailingAgent:
        async def __aenter__(self) -> Any:
            return self

        async def __aexit__(self, *_args: object) -> None:
            return None

        async def run(
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


def test_pydantic_runner_records_exact_reminder_context_before_model_call(
    tmp_path: Path,
) -> None:
    reminder, base_context = activation_context(tmp_path)
    observed: list[dict[str, Any]] = []

    class SuccessfulResult:
        def __init__(self) -> None:
            self.usage: dict[str, Any] = {}

        def new_messages(self) -> tuple[ModelMessage, ...]:
            return ()

    class RecordingAgent:
        async def __aenter__(self) -> Any:
            return self

        async def __aexit__(self, *_args: object) -> None:
            return None

        async def run(self, *_args: Any, **_kwargs: Any) -> SuccessfulResult:
            observed.append(base_context.state._persistence_data())
            return SuccessfulResult()

    runner = object.__new__(PydanticAgentRunner)
    runner._observability = None  # type: ignore[attr-defined]
    runner._api_type = "openai-chat"  # type: ignore[attr-defined]
    runner._model_name = "test-model"  # type: ignore[attr-defined]
    runner._agent = RecordingAgent()  # type: ignore[attr-defined]
    context = AgentRunContext(
        agent_id=2,
        state=base_context.state,
        host_tools=base_context.host_tools,
        run_id="run-exact-123",
    )

    runner.run(reminder, context)

    receipts = observed[0]["discussions"][0]["messages"][0]["read_receipts"]
    assert receipts == [
        {
            "member_id": 2,
            "source": "agent_reminder_context",
            "agent_run_id": "run-exact-123",
        }
    ]
