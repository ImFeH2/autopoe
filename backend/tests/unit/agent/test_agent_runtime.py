import json
import threading
import time

import pytest
from loguru import logger

from flowent.agent import (
    Agent,
    ContextPreflight,
    InterruptRequestedError,
    PreparedLLMContext,
    WakeSignal,
)
from flowent.events import event_bus
from flowent.models import (
    AgentState,
    AssistantText,
    AssistantThinking,
    CommandResultEntry,
    ErrorEntry,
    EventType,
    ImagePart,
    LLMResponse,
    LLMUsage,
    Message,
    NodeConfig,
    NodeType,
    ReceivedMessage,
    SentMessage,
    StateEntry,
    SystemEntry,
    Tab,
    TodoItem,
    ToolCall,
    ToolCallResult,
)
from flowent.providers.errors import LLMProviderError
from flowent.registry import registry
from flowent.settings import ModelSettings, ProviderConfig, Settings
from flowent.stats_service import stats_store
from flowent.workspace_store import workspace_store


@pytest.fixture(autouse=True)
def reset_runtime_state(monkeypatch, tmp_path):
    import flowent.settings as settings_module

    settings_file = tmp_path / "settings.json"
    settings_file.write_text("{}", encoding="utf-8")
    monkeypatch.setattr(settings_module, "_SETTINGS_FILE", settings_file)
    monkeypatch.setattr(settings_module, "_cached_settings", None)
    registry.reset()
    workspace_store.reset_cache()
    stats_store.reset()
    yield
    registry.reset()
    workspace_store.reset_cache()
    stats_store.reset()
    monkeypatch.setattr(settings_module, "_cached_settings", None)


def _register_tab_leader(*, tab_id: str = "tab-1", leader_id: str = "leader") -> Agent:
    workspace_store.upsert_tab(Tab(id=tab_id, title="Task", leader_id=leader_id))
    leader = Agent(
        NodeConfig(
            node_type=NodeType.AGENT,
            role_name="Conductor",
            name="Leader",
            tab_id=tab_id,
        ),
        uuid=leader_id,
    )
    registry.register(leader)
    return leader


def test_agent_keeps_running_after_pure_text_response(monkeypatch):
    agent = Agent(NodeConfig(node_type=NodeType.AGENT))
    wait_calls = 0
    llm_messages: list[list[dict]] = []
    responses = iter([LLMResponse(content="working through the task"), LLMResponse()])

    def fake_wait_for_input() -> None:
        nonlocal wait_calls
        wait_calls += 1
        if wait_calls == 1:
            agent._append_history(
                ReceivedMessage(content="finish the task", from_id="tester")
            )
            agent.set_state(AgentState.RUNNING, "received message from tester")
            return
        raise AssertionError("agent should not auto-idle after pure assistant text")

    def fake_chat(
        messages,
        tools=None,
        on_chunk=None,
        register_interrupt=None,
        role_name=None,
    ):
        llm_messages.append(messages)
        if len(llm_messages) == 2:
            agent.request_termination("done")
        return next(responses)

    monkeypatch.setattr(agent, "_wait_for_input", fake_wait_for_input)
    monkeypatch.setattr("flowent.agent.gateway.chat", fake_chat)

    agent._run()

    assert wait_calls == 1
    assert len(llm_messages) == 2
    assert agent.state == AgentState.TERMINATED
    assert any(
        isinstance(entry, AssistantText) and entry.content == "working through the task"
        for entry in agent.get_history_snapshot()
    )
    assert any(
        msg.get("role") == "assistant"
        and msg.get("content") == "working through the task"
        for msg in llm_messages[1]
    )


def test_agent_retries_transient_llm_errors_before_succeeding(monkeypatch):
    agent = Agent(NodeConfig(node_type=NodeType.AGENT))
    wait_calls = 0
    llm_calls = 0

    def fake_wait_for_input() -> None:
        nonlocal wait_calls
        wait_calls += 1
        if wait_calls == 1:
            agent._append_history(
                ReceivedMessage(content="finish the task", from_id="tester")
            )
            agent.set_state(AgentState.RUNNING, "received message from tester")
            return
        raise AssertionError("agent should not return to idle while retrying")

    def fake_chat(
        messages,
        tools=None,
        on_chunk=None,
        register_interrupt=None,
        role_name=None,
    ):
        nonlocal llm_calls
        llm_calls += 1
        if llm_calls < 3:
            raise LLMProviderError(
                f"temporary failure {llm_calls}",
                transient=True,
                status_code=429,
            )
        if llm_calls == 4:
            agent.request_termination("done")
            return LLMResponse()
        if llm_calls == 3:
            return LLMResponse(content="Recovered answer")
        raise AssertionError("unexpected extra LLM call")

    monkeypatch.setattr(agent, "_wait_for_input", fake_wait_for_input)
    monkeypatch.setattr(agent, "_get_llm_retry_delay", lambda retry_number: 0.0)
    monkeypatch.setattr(
        "flowent.agent.get_settings",
        lambda: Settings(model=ModelSettings(max_retries=2)),
    )
    monkeypatch.setattr("flowent.agent.gateway.chat", fake_chat)

    agent._run()

    assert wait_calls == 1
    assert llm_calls == 4
    assert agent.state == AgentState.TERMINATED
    assert not any(
        isinstance(entry, ErrorEntry) for entry in agent.get_history_snapshot()
    )
    assert any(
        isinstance(entry, AssistantText) and entry.content == "Recovered answer"
        for entry in agent.get_history_snapshot()
    )


def test_chat_with_retries_records_single_request_stat(monkeypatch):
    workspace_store.upsert_tab(Tab(id="tab-1", title="Task", leader_id="leader-1"))
    agent = Agent(
        NodeConfig(
            node_type=NodeType.AGENT,
            role_name="Worker",
            name="Planner",
            tab_id="tab-1",
        ),
        uuid="agent-1",
    )
    settings = Settings(
        model=ModelSettings(
            active_provider_id="provider-1",
            active_model="gpt-5.2",
            retry_policy="limited",
            max_retries=2,
        ),
        providers=[
            ProviderConfig(
                id="provider-1",
                name="Primary",
                type="openai_responses",
                base_url="https://api.example.com/v1",
                api_key="secret",
            )
        ],
    )
    monkeypatch.setattr("flowent.agent.get_settings", lambda: settings)
    monkeypatch.setattr(agent, "_get_llm_retry_delay", lambda retry_number: 0.0)

    llm_calls = 0

    def fake_chat(
        messages,
        tools=None,
        on_chunk=None,
        register_interrupt=None,
        role_name=None,
    ):
        nonlocal llm_calls
        llm_calls += 1
        if llm_calls == 1:
            raise LLMProviderError(
                "temporary failure",
                transient=True,
                status_code=429,
            )
        return LLMResponse(
            content="Done",
            usage=LLMUsage(
                total_tokens=120,
                input_tokens=90,
                output_tokens=30,
                cache_read_tokens=12,
            ),
            raw_usage={"total_tokens": 120, "input_tokens": 90},
        )

    monkeypatch.setattr("flowent.agent.gateway.chat", fake_chat)

    response, _ = agent._chat_with_retries(
        prepared_context=PreparedLLMContext(
            messages=[{"role": "user", "content": "hello"}],
            system_messages=[],
            execution_context_messages=[],
            runtime_tail_messages=[],
        ),
        tools_schema=None,
    )

    records = stats_store.list_requests(since=0)

    assert response.content == "Done"
    assert len(records) == 1
    assert records[0]["node_id"] == "agent-1"
    assert records[0]["node_label"] == "Planner"
    assert records[0]["tab_title"] == "Task"
    assert records[0]["provider_id"] == "provider-1"
    assert records[0]["model"] == "gpt-5.2"
    assert records[0]["retry_count"] == 1
    assert records[0]["result"] == "success"
    assert records[0]["normalized_usage"]["cache_read_tokens"] == 12
    assert records[0]["raw_usage"] == {"total_tokens": 120, "input_tokens": 90}


def test_agent_does_not_retry_transient_llm_errors_when_retry_policy_is_no_retry(
    monkeypatch,
):
    agent = Agent(NodeConfig(node_type=NodeType.AGENT))
    wait_calls = 0
    llm_calls = 0

    def fake_wait_for_input() -> None:
        nonlocal wait_calls
        wait_calls += 1
        if wait_calls == 1:
            agent._append_history(
                ReceivedMessage(content="finish the task", from_id="tester")
            )
            agent.set_state(AgentState.RUNNING, "received message from tester")
            return
        agent.request_termination("done")

    def fake_chat(
        messages,
        tools=None,
        on_chunk=None,
        register_interrupt=None,
        role_name=None,
    ):
        nonlocal llm_calls
        llm_calls += 1
        raise LLMProviderError(
            "temporary failure",
            transient=True,
            status_code=429,
        )

    monkeypatch.setattr(agent, "_wait_for_input", fake_wait_for_input)
    monkeypatch.setattr(
        "flowent.agent.get_settings",
        lambda: Settings(
            model=ModelSettings(
                retry_policy="no_retry",
                max_retries=5,
            )
        ),
    )
    monkeypatch.setattr("flowent.agent.gateway.chat", fake_chat)

    agent._run()

    assert llm_calls == 1
    assert wait_calls == 2
    assert any(
        isinstance(entry, ErrorEntry) and entry.content == "temporary failure"
        for entry in agent.get_history_snapshot()
    )


def test_agent_does_not_retry_non_transient_llm_errors(monkeypatch):
    agent = Agent(NodeConfig(node_type=NodeType.AGENT))
    wait_calls = 0
    llm_calls = 0
    error_summary = (
        "LLM API error\n"
        "Provider: Test Provider\n"
        "Type: openai\n"
        "Model: gpt-5.2\n"
        "Base URL: http://example.invalid\n"
        "Status: 401\n"
        "Detail: Invalid API key"
    )

    def fake_wait_for_input() -> None:
        nonlocal wait_calls
        wait_calls += 1
        if wait_calls == 1:
            agent._append_history(
                ReceivedMessage(content="finish the task", from_id="tester")
            )
            agent.set_state(AgentState.RUNNING, "received message from tester")
            return
        agent.request_termination("done")

    def fake_chat(
        messages,
        tools=None,
        on_chunk=None,
        register_interrupt=None,
        role_name=None,
    ):
        nonlocal llm_calls
        llm_calls += 1
        raise LLMProviderError(
            error_summary,
            transient=False,
            status_code=401,
        )

    monkeypatch.setattr(agent, "_wait_for_input", fake_wait_for_input)
    monkeypatch.setattr(
        "flowent.agent.get_settings",
        lambda: Settings(model=ModelSettings(max_retries=5)),
    )
    monkeypatch.setattr("flowent.agent.gateway.chat", fake_chat)

    agent._run()

    assert llm_calls == 1
    assert wait_calls == 2
    assert any(
        isinstance(entry, ErrorEntry) and entry.content == error_summary
        for entry in agent.get_history_snapshot()
    )
    assert any(
        isinstance(entry, StateEntry)
        and entry.state == AgentState.ERROR.value
        and entry.reason == error_summary
        for entry in agent.get_history_snapshot()
    )
    assert not any(
        isinstance(entry, ErrorEntry)
        and (
            "traceback" in entry.content.lower() or "LLMProviderError:" in entry.content
        )
        for entry in agent.get_history_snapshot()
    )


def test_agent_interrupt_stops_retry_backoff(monkeypatch):
    agent = Agent(NodeConfig(node_type=NodeType.AGENT))
    wait_calls = 0
    llm_calls = 0
    interrupter: threading.Thread | None = None

    def fake_wait_for_input() -> None:
        nonlocal wait_calls
        wait_calls += 1
        if wait_calls == 1:
            agent._append_history(
                ReceivedMessage(content="finish the task", from_id="tester")
            )
            agent.set_state(AgentState.RUNNING, "received message from tester")
            return
        agent.request_termination("done")

    def fake_chat(
        messages,
        tools=None,
        on_chunk=None,
        register_interrupt=None,
        role_name=None,
    ):
        nonlocal llm_calls, interrupter
        llm_calls += 1
        if llm_calls == 1:
            interrupter = threading.Thread(
                target=lambda: (time.sleep(0.01), agent.request_interrupt())
            )
            interrupter.start()
            raise LLMProviderError(
                "temporary failure",
                transient=True,
                status_code=429,
            )
        raise AssertionError("interrupt should stop retry before next attempt")

    monkeypatch.setattr(agent, "_wait_for_input", fake_wait_for_input)
    monkeypatch.setattr(agent, "_get_llm_retry_delay", lambda retry_number: 1.0)
    monkeypatch.setattr(
        "flowent.agent.get_settings",
        lambda: Settings(model=ModelSettings(max_retries=5)),
    )
    monkeypatch.setattr("flowent.agent.gateway.chat", fake_chat)

    agent._run()
    if interrupter is not None:
        interrupter.join(timeout=1.0)

    assert llm_calls == 1
    assert wait_calls == 2
    assert not any(
        isinstance(entry, ErrorEntry) for entry in agent.get_history_snapshot()
    )


def test_agent_retries_transient_errors_when_retry_policy_is_unlimited(monkeypatch):
    agent = Agent(NodeConfig(node_type=NodeType.AGENT))
    wait_calls = 0
    llm_calls = 0

    def fake_wait_for_input() -> None:
        nonlocal wait_calls
        wait_calls += 1
        if wait_calls == 1:
            agent._append_history(
                ReceivedMessage(content="finish the task", from_id="tester")
            )
            agent.set_state(AgentState.RUNNING, "received message from tester")
            return
        raise AssertionError("agent should not return to idle while retrying")

    def fake_chat(
        messages,
        tools=None,
        on_chunk=None,
        register_interrupt=None,
        role_name=None,
    ):
        nonlocal llm_calls
        llm_calls += 1
        if llm_calls < 4:
            raise LLMProviderError(
                f"temporary failure {llm_calls}",
                transient=True,
                status_code=429,
            )
        if llm_calls == 5:
            agent.request_termination("done")
            return LLMResponse()
        if llm_calls == 4:
            return LLMResponse(content="Recovered after unlimited retries")
        raise AssertionError("unexpected extra LLM call")

    monkeypatch.setattr(agent, "_wait_for_input", fake_wait_for_input)
    monkeypatch.setattr(agent, "_get_llm_retry_delay", lambda retry_number: 0.0)
    monkeypatch.setattr(
        "flowent.agent.get_settings",
        lambda: Settings(
            model=ModelSettings(
                retry_policy="unlimited",
                max_retries=1,
            )
        ),
    )
    monkeypatch.setattr("flowent.agent.gateway.chat", fake_chat)

    agent._run()

    assert wait_calls == 1
    assert llm_calls == 5
    assert agent.state == AgentState.TERMINATED
    assert any(
        isinstance(entry, AssistantText)
        and entry.content == "Recovered after unlimited retries"
        for entry in agent.get_history_snapshot()
    )


def test_get_llm_retry_delay_uses_configured_backoff_settings(monkeypatch):
    agent = Agent(NodeConfig(node_type=NodeType.AGENT))

    monkeypatch.setattr(
        "flowent.agent.get_settings",
        lambda: Settings(
            model=ModelSettings(
                retry_initial_delay_seconds=0.75,
                retry_max_delay_seconds=5.0,
                retry_backoff_cap_retries=3,
            )
        ),
    )

    assert agent._get_llm_retry_delay(1) == 0.75
    assert agent._get_llm_retry_delay(2) == 1.5
    assert agent._get_llm_retry_delay(3) == 3.0
    assert agent._get_llm_retry_delay(4) == 3.0


def test_get_llm_retry_429_delay_uses_active_provider_only_for_429(monkeypatch):
    agent = Agent(NodeConfig(node_type=NodeType.AGENT, role_name="Worker"))

    monkeypatch.setattr(
        "flowent.agent.get_settings",
        lambda: Settings(
            model=ModelSettings(
                active_provider_id="provider-1",
                active_model="gpt-test",
            ),
            providers=[
                ProviderConfig(
                    id="provider-1",
                    name="Primary",
                    type="openai_compatible",
                    base_url="https://api.example.com/v1",
                    api_key="secret",
                    retry_429_delay_seconds=4,
                )
            ],
        ),
    )

    assert agent._get_llm_retry_429_delay(429) == 4.0
    assert agent._get_llm_retry_429_delay(500) == 0.0


def test_prepare_messages_records_auto_compact_stat(monkeypatch):
    workspace_store.upsert_tab(Tab(id="tab-1", title="Task", leader_id="leader-1"))
    agent = Agent(
        NodeConfig(
            node_type=NodeType.AGENT,
            role_name="Worker",
            name="Planner",
            tab_id="tab-1",
        ),
        uuid="agent-1",
    )
    settings = Settings(
        model=ModelSettings(
            active_provider_id="provider-1",
            active_model="gpt-5.2",
        ),
        providers=[
            ProviderConfig(
                id="provider-1",
                name="Primary",
                type="openai_responses",
                base_url="https://api.example.com/v1",
                api_key="secret",
            )
        ],
    )
    monkeypatch.setattr("flowent.agent.get_settings", lambda: settings)

    prepared_context = PreparedLLMContext(
        messages=[{"role": "user", "content": "hello"}],
        system_messages=[],
        execution_context_messages=[],
        runtime_tail_messages=[],
    )
    preflights = iter(
        [
            ContextPreflight(
                estimated_total_tokens=50,
                auto_compact_token_limit=10,
            ),
            ContextPreflight(
                estimated_total_tokens=2,
                auto_compact_token_limit=10,
            ),
        ]
    )

    monkeypatch.setattr(agent, "_build_prepared_llm_context", lambda: prepared_context)
    monkeypatch.setattr(
        agent,
        "_compute_context_preflight",
        lambda context: next(preflights),
    )
    compact_calls: list[str | None] = []
    monkeypatch.setattr(
        agent,
        "_compact_execution_context",
        lambda focus=None: compact_calls.append(focus) or "",
    )

    result = agent._prepare_messages_for_llm()
    records = stats_store.list_compacts(since=0)

    assert result == prepared_context
    assert compact_calls == [None]
    assert len(records) == 1
    assert records[0]["trigger_type"] == "auto"
    assert records[0]["result"] == "success"
    assert records[0]["provider_id"] == "provider-1"
    assert records[0]["model"] == "gpt-5.2"


def test_clear_assistant_chat_history_drops_conversation_entries():
    assistant = Agent(NodeConfig(node_type=NodeType.ASSISTANT), uuid="assistant")
    assistant.history.extend(
        [
            SystemEntry(content="system prompt"),
            ReceivedMessage(content="hello", from_id="human"),
            AssistantThinking(content="planning"),
            AssistantText(content="hi"),
            ToolCall(
                tool_name="idle",
                tool_call_id="tool-1",
                arguments={},
                result="idle 1.00s",
            ),
            ErrorEntry(content="boom"),
        ]
    )

    assistant.clear_chat_history()

    assert all(
        isinstance(entry, (SystemEntry, StateEntry))
        for entry in assistant.get_history_snapshot()
    )


@pytest.mark.parametrize(
    ("state", "reason"),
    [
        (AgentState.RUNNING, "processing"),
        (AgentState.SLEEPING, "waiting for reply"),
    ],
)
def test_clear_assistant_chat_history_interrupts_active_agent(
    monkeypatch,
    state,
    reason,
):
    assistant = Agent(NodeConfig(node_type=NodeType.ASSISTANT), uuid="assistant")
    assistant.set_state(state, reason)
    assistant.history.append(ReceivedMessage(content="hello", from_id="human"))
    interrupt_thread = threading.Thread(
        target=assistant._handle_interrupt,
        args=(None,),
        daemon=True,
    )

    def fake_request_interrupt() -> bool:
        if not interrupt_thread.is_alive():
            interrupt_thread.start()
        return True

    monkeypatch.setattr(assistant, "request_interrupt", fake_request_interrupt)

    assistant.clear_chat_history()

    assert assistant.state == AgentState.IDLE
    assert not any(
        isinstance(entry, ReceivedMessage) for entry in assistant.get_history_snapshot()
    )

    assistant.request_termination("done")
    interrupt_thread.join(timeout=1.0)
    assert interrupt_thread.is_alive() is False


def test_clear_assistant_chat_history_drops_queued_messages_after_interrupt(
    monkeypatch,
):
    assistant = Agent(NodeConfig(node_type=NodeType.ASSISTANT), uuid="assistant")
    assistant.set_state(AgentState.RUNNING, "processing")
    assistant._wake_queue.put(
        WakeSignal(
            reason="message",
            payload={"message": {"content": "queued message", "from": "human"}},
            resume_reason="received message from human",
        )
    )

    interrupt_thread = threading.Thread(
        target=assistant._handle_interrupt,
        args=(None,),
        daemon=True,
    )

    def fake_request_interrupt() -> bool:
        if not interrupt_thread.is_alive():
            interrupt_thread.start()
        return True

    monkeypatch.setattr(assistant, "request_interrupt", fake_request_interrupt)
    assistant.clear_chat_history()

    assert assistant.state == AgentState.IDLE
    assert not any(
        isinstance(entry, ReceivedMessage) and entry.content == "queued message"
        for entry in assistant.get_history_snapshot()
    )

    assistant.request_termination("done")
    interrupt_thread.join(timeout=1.0)
    assert interrupt_thread.is_alive() is False


def test_execute_clear_command_does_not_append_visible_feedback():
    assistant = Agent(NodeConfig(node_type=NodeType.ASSISTANT), uuid="assistant")
    assistant.history.extend(
        [
            ReceivedMessage(content="hello", from_id="human"),
            AssistantText(content="hi"),
        ]
    )

    entry = assistant.execute_assistant_command(command_name="/clear")
    history = assistant.get_history_snapshot()

    assert isinstance(entry, CommandResultEntry)
    assert entry.command_name == "/clear"
    assert entry.include_in_context is False
    assert not any(isinstance(item, ReceivedMessage) for item in history)
    assert not any(isinstance(item, AssistantText) for item in history)
    assert not any(
        isinstance(item, CommandResultEntry) and item.command_name == "/clear"
        for item in history
    )


def test_retry_human_message_replaces_selected_tail_and_requeues_input(monkeypatch):
    assistant = Agent(NodeConfig(node_type=NodeType.ASSISTANT), uuid="assistant")
    queued_messages: list[Message] = []
    monkeypatch.setattr(
        assistant,
        "enqueue_message",
        lambda message: queued_messages.append(message),
    )
    assistant.history.extend(
        [
            ReceivedMessage(
                content="Keep this message",
                from_id="human",
                message_id="msg-1",
            ),
            AssistantText(content="Keep this reply"),
            ReceivedMessage(
                content="Retry this request",
                from_id="human",
                message_id="msg-2",
            ),
            AssistantThinking(content="Old thinking"),
            AssistantText(content="Discard this reply"),
            ErrorEntry(content="Old failure"),
        ]
    )

    retried_message_id = assistant.retry_human_message(message_id="msg-2")
    history = assistant.get_history_snapshot()

    assert retried_message_id != "msg-2"
    assert any(
        isinstance(entry, ReceivedMessage)
        and entry.message_id == "msg-1"
        and entry.content == "Keep this message"
        for entry in history
    )
    assert any(
        isinstance(entry, AssistantText) and entry.content == "Keep this reply"
        for entry in history
    )
    assert not any(
        isinstance(entry, ReceivedMessage) and entry.message_id == "msg-2"
        for entry in history
    )
    assert not any(
        isinstance(entry, AssistantText) and entry.content == "Discard this reply"
        for entry in history
    )
    assert not any(
        isinstance(entry, ErrorEntry) and entry.content == "Old failure"
        for entry in history
    )
    assert any(
        isinstance(entry, ReceivedMessage)
        and entry.message_id == retried_message_id
        and entry.content == "Retry this request"
        for entry in history
    )
    assert len(queued_messages) == 1
    assert queued_messages[0].message_id == retried_message_id
    assert queued_messages[0].history_recorded is True
    assert queued_messages[0].content == "Retry this request"


def test_retry_human_message_reuses_image_parts(monkeypatch):
    assistant = Agent(NodeConfig(node_type=NodeType.ASSISTANT), uuid="assistant")
    queued_messages: list[Message] = []
    monkeypatch.setattr(assistant, "supports_input_image", lambda: True)
    monkeypatch.setattr(
        "flowent.agent.require_image_asset",
        lambda asset_id: object() if asset_id == "asset-1" else None,
    )
    monkeypatch.setattr(
        assistant,
        "enqueue_message",
        lambda message: queued_messages.append(message),
    )
    assistant.history.extend(
        [
            ReceivedMessage(
                from_id="human",
                parts=[
                    ImagePart(
                        asset_id="asset-1",
                        mime_type="image/png",
                        width=1,
                        height=1,
                    )
                ],
                message_id="msg-image",
            ),
            AssistantText(content="Old image reply"),
        ]
    )

    retried_message_id = assistant.retry_human_message(message_id="msg-image")

    assert retried_message_id
    assert len(queued_messages) == 1
    assert len(queued_messages[0].parts) == 1
    assert isinstance(queued_messages[0].parts[0], ImagePart)
    assert queued_messages[0].parts[0].asset_id == "asset-1"


def test_retry_human_message_missing_anchor_keeps_queued_messages():
    assistant = Agent(NodeConfig(node_type=NodeType.ASSISTANT), uuid="assistant")
    assistant._wake_queue.put(
        WakeSignal(
            reason="message",
            payload={"message": {"content": "queued message", "from": "human"}},
            resume_reason="received message from human",
        )
    )

    with pytest.raises(LookupError):
        assistant.retry_human_message(message_id="missing")

    signal = assistant._wake_queue.get_nowait()
    assert signal.reason == "message"
    assert signal.payload["message"]["content"] == "queued message"


def test_retry_human_message_rolls_back_when_persist_fails(monkeypatch):
    assistant = Agent(NodeConfig(node_type=NodeType.ASSISTANT), uuid="assistant")
    assistant.history.extend(
        [
            ReceivedMessage(
                content="Retry this request",
                from_id="human",
                message_id="msg-2",
            ),
            AssistantText(content="Discard this reply"),
        ]
    )
    persist_calls = 0

    def fake_persist() -> None:
        nonlocal persist_calls
        persist_calls += 1
        if persist_calls == 1:
            raise RuntimeError("persist failed")

    monkeypatch.setattr(assistant, "_persist_workspace_node", fake_persist)

    with pytest.raises(RuntimeError, match="persist failed"):
        assistant.retry_human_message(message_id="msg-2")

    history = assistant.get_history_snapshot()
    assert any(
        isinstance(entry, ReceivedMessage) and entry.message_id == "msg-2"
        for entry in history
    )
    assert any(
        isinstance(entry, AssistantText) and entry.content == "Discard this reply"
        for entry in history
    )


def test_leader_retry_received_message_requires_human_anchor(monkeypatch):
    leader = _register_tab_leader()
    leader.history.extend(
        [
            ReceivedMessage(
                content="Assistant brief",
                from_id="assistant",
                message_id="brief-1",
            ),
            ReceivedMessage(
                content="Human follow-up",
                from_id="human",
                message_id="msg-human",
            ),
        ]
    )
    monkeypatch.setattr(
        "flowent.graph_service.is_tab_leader",
        lambda **kwargs: kwargs["node_id"] == leader.uuid,
    )

    with pytest.raises(
        LookupError,
        match=r"Leader human message `brief-1` was not found\.",
    ):
        leader.retry_received_message(message_id="brief-1")


def test_execute_compact_command_replaces_history_with_summary(monkeypatch):
    assistant = Agent(NodeConfig(node_type=NodeType.ASSISTANT), uuid="assistant")
    assistant.history.extend(
        [
            ReceivedMessage(content="Summarize the rollout", from_id="human"),
            AssistantText(content="Working through the changes."),
            ErrorEntry(content="temporary failure"),
        ]
    )

    monkeypatch.setattr(
        "flowent.agent.gateway.chat",
        lambda *args, **kwargs: LLMResponse(
            content=(
                "## Current Goal\nShip the command layer.\n\n"
                "## Active Task Boundary\nKeep the change in Assistant chat.\n\n"
                "## Key Constraints\nPreserve persistence.\n\n"
                "## Confirmed Decisions\nUse built-in commands only.\n\n"
                "## Open Questions\nNone.\n\n"
                "## Next Actions\nFinish the UI."
            )
        ),
    )

    entry = assistant.execute_assistant_command(
        command_name="/compact",
        argument="slash rollout",
    )

    history = assistant.get_history_snapshot()

    assert isinstance(entry, CommandResultEntry)
    assert entry.include_in_context is False
    assert history[-1] == entry
    assert any(
        isinstance(item, ReceivedMessage) and item.content == "Summarize the rollout"
        for item in history
    )
    assert any(
        isinstance(item, AssistantText)
        and item.content == "Working through the changes."
        for item in history
    )
    assert (
        assistant.get_execution_context_summary().startswith("## Current Goal\n")
        is True
    )

    messages = assistant._build_messages()
    serialized = json.dumps(messages)

    assert "Summarize the rollout" not in serialized
    assert "Compacted execution context" in serialized
    assert "Ship the command layer." in serialized
    assert "Compacted this chat for future replies." not in serialized


def test_compact_command_excludes_queued_messages_from_summary(monkeypatch):
    assistant = Agent(NodeConfig(node_type=NodeType.ASSISTANT), uuid="assistant")
    assistant.history.extend(
        [
            ReceivedMessage(content="Existing history", from_id="human"),
            AssistantText(content="Existing reply"),
        ]
    )
    assistant.set_state(AgentState.RUNNING, "processing")
    assistant._wake_queue.put(
        WakeSignal(
            reason="message",
            payload={"message": {"content": "queued message", "from": "human"}},
            resume_reason="received message from human",
        )
    )

    captured_messages: list[list[dict]] = []

    def fake_chat(*, messages, **kwargs):
        captured_messages.append(messages)
        return LLMResponse(
            content=(
                "## Current Goal\nShip the command layer.\n\n"
                "## Active Task Boundary\nKeep the change in Assistant chat.\n\n"
                "## Key Constraints\nPreserve persistence.\n\n"
                "## Confirmed Decisions\nUse built-in commands only.\n\n"
                "## Open Questions\nNone.\n\n"
                "## Next Actions\nFinish the UI."
            )
        )

    interrupt_thread = threading.Thread(
        target=assistant._handle_interrupt,
        args=(None,),
        daemon=True,
    )

    def fake_request_interrupt() -> bool:
        if not interrupt_thread.is_alive():
            interrupt_thread.start()
        return True

    monkeypatch.setattr(assistant, "request_interrupt", fake_request_interrupt)
    monkeypatch.setattr("flowent.agent.gateway.chat", fake_chat)

    assistant.compact_chat_history()

    assert captured_messages
    assert "queued message" not in json.dumps(captured_messages[0])

    assistant.request_termination("done")
    interrupt_thread.join(timeout=1.0)
    assert interrupt_thread.is_alive() is False


def test_help_command_result_does_not_reenter_model_context():
    assistant = Agent(NodeConfig(node_type=NodeType.ASSISTANT), uuid="assistant")

    entry = assistant.execute_assistant_command(command_name="/help")
    messages = assistant._build_messages()
    serialized = json.dumps(messages)

    assert isinstance(entry, CommandResultEntry)
    assert entry.include_in_context is False
    assert "/compact" in entry.content
    assert "Available commands" not in serialized


def test_agent_normalizes_think_tags_in_final_content(monkeypatch):
    agent = Agent(NodeConfig(node_type=NodeType.ASSISTANT), uuid="assistant")
    wait_calls = 0
    llm_calls = 0

    def fake_wait_for_input() -> None:
        nonlocal wait_calls
        wait_calls += 1
        if wait_calls == 1:
            agent._append_history(
                ReceivedMessage(content="reply to me", from_id="human")
            )
            agent.set_state(AgentState.RUNNING, "received message from human")
            return
        agent.request_termination("done")

    def fake_chat(
        messages,
        tools=None,
        on_chunk=None,
        register_interrupt=None,
        role_name=None,
    ):
        nonlocal llm_calls
        llm_calls += 1
        if llm_calls == 2:
            agent.request_termination("done")
            return LLMResponse()
        return LLMResponse(content="<think>Drafting plan</think>\nHello there")

    monkeypatch.setattr(agent, "_wait_for_input", fake_wait_for_input)
    monkeypatch.setattr("flowent.agent.gateway.chat", fake_chat)

    agent._run()

    history = agent.get_history_snapshot()

    assert any(
        isinstance(entry, AssistantThinking) and entry.content == "Drafting plan"
        for entry in history
    )
    assert any(
        isinstance(entry, AssistantText) and entry.content == "Hello there"
        for entry in history
    )
    assert not any(
        isinstance(entry, AssistantText) and "<think>" in entry.content
        for entry in history
    )


def test_agent_dedupes_structured_thinking_and_raw_think_tags(monkeypatch):
    agent = Agent(NodeConfig(node_type=NodeType.ASSISTANT), uuid="assistant")
    wait_calls = 0
    llm_calls = 0

    def fake_wait_for_input() -> None:
        nonlocal wait_calls
        wait_calls += 1
        if wait_calls == 1:
            agent._append_history(
                ReceivedMessage(content="reply to me", from_id="human")
            )
            agent.set_state(AgentState.RUNNING, "received message from human")
            return
        agent.request_termination("done")

    def fake_chat(
        messages,
        tools=None,
        on_chunk=None,
        register_interrupt=None,
        role_name=None,
    ):
        nonlocal llm_calls
        llm_calls += 1
        if llm_calls == 2:
            agent.request_termination("done")
            return LLMResponse()
        return LLMResponse(
            content="<think>Drafting plan</think>\nHello there",
            thinking="Drafting plan",
        )

    monkeypatch.setattr(agent, "_wait_for_input", fake_wait_for_input)
    monkeypatch.setattr("flowent.agent.gateway.chat", fake_chat)

    agent._run()

    thinking_entries = [
        entry.content
        for entry in agent.get_history_snapshot()
        if isinstance(entry, AssistantThinking)
    ]

    assert thinking_entries == ["Drafting plan"]


def test_agent_unregisters_from_registry_after_termination_request(monkeypatch):
    registry.reset()
    agent = Agent(NodeConfig(node_type=NodeType.AGENT), uuid="agent-x")
    registry.register(agent)
    events = []

    def fake_wait_for_input() -> None:
        agent._append_history(
            ReceivedMessage(content="finish the task", from_id="tester")
        )
        agent.set_state(AgentState.RUNNING, "received message from tester")

    monkeypatch.setattr(agent, "_wait_for_input", fake_wait_for_input)

    def fake_chat(
        messages,
        tools=None,
        on_chunk=None,
        register_interrupt=None,
        role_name=None,
    ):
        agent.request_termination("done")
        return LLMResponse()

    monkeypatch.setattr("flowent.agent.gateway.chat", fake_chat)
    monkeypatch.setattr(event_bus, "emit", lambda event: events.append(event))

    agent._run()

    assert agent.state == AgentState.TERMINATED
    assert registry.get(agent.uuid) is None
    assert [event.type for event in events[-2:]] == [
        EventType.NODE_STATE_CHANGED,
        EventType.NODE_TERMINATED,
    ]
    assert events[-1].data == {"reason": "done"}


def test_finalize_termination_removes_bidirectional_connections():
    registry.reset()
    try:
        assistant = Agent(
            NodeConfig(node_type=NodeType.ASSISTANT),
        )
        worker = Agent(
            NodeConfig(node_type=NodeType.AGENT),
            uuid="worker",
        )
        registry.register(assistant)
        registry.register(worker)
        assistant.add_connection(worker.uuid)
        worker.add_connection(assistant.uuid)

        worker._finalize_termination("done")

        assert registry.get(worker.uuid) is None
        assert assistant.get_connections_snapshot() == []
        assert worker.get_connections_snapshot() == []
    finally:
        registry.reset()


def test_agent_interrupts_streaming_response_and_returns_to_idle(monkeypatch):
    monkeypatch.setattr("flowent.agent.get_settings", lambda: Settings())
    registry.reset()
    assistant = Agent(NodeConfig(node_type=NodeType.ASSISTANT), uuid="assistant")
    registry.register(assistant)
    events = []
    wait_calls = 0

    def fake_wait_for_input() -> None:
        nonlocal wait_calls
        wait_calls += 1
        if wait_calls == 1:
            assistant._append_history(
                ReceivedMessage(content="start working", from_id="human")
            )
            assistant.set_state(AgentState.RUNNING, "received message from human")
            return
        assistant.request_termination("done")

    def fake_chat(
        messages,
        tools=None,
        on_chunk=None,
        register_interrupt=None,
        role_name=None,
    ):
        assert on_chunk is not None
        on_chunk("thinking", "Drafting plan")
        on_chunk("content", "Working")
        assert assistant.request_interrupt() is True
        on_chunk("content", " on the task")
        raise AssertionError("interrupt should stop streaming before completion")

    monkeypatch.setattr(assistant, "_wait_for_input", fake_wait_for_input)
    monkeypatch.setattr("flowent.agent.gateway.chat", fake_chat)
    monkeypatch.setattr(event_bus, "emit", lambda event: events.append(event))

    try:
        assistant._run()
    finally:
        registry.reset()

    history = assistant.get_history_snapshot()

    assert any(
        isinstance(entry, AssistantThinking) and entry.content == "Drafting plan"
        for entry in history
    )
    assert any(
        isinstance(entry, AssistantText) and entry.content == "Working"
        for entry in history
    )
    assert any(
        event.type == EventType.NODE_STATE_CHANGED
        and event.data.get("new_state") == "idle"
        for event in events
    )


def test_agent_normalizes_think_tags_in_streaming_content(monkeypatch):
    assistant = Agent(NodeConfig(node_type=NodeType.ASSISTANT), uuid="assistant")
    wait_calls = 0
    events = []
    llm_calls = 0

    def fake_wait_for_input() -> None:
        nonlocal wait_calls
        wait_calls += 1
        if wait_calls == 1:
            assistant._append_history(
                ReceivedMessage(content="reply to me", from_id="human")
            )
            assistant.set_state(AgentState.RUNNING, "received message from human")
            return
        assistant.request_termination("done")

    def fake_chat(
        messages,
        tools=None,
        on_chunk=None,
        register_interrupt=None,
        role_name=None,
    ):
        nonlocal llm_calls
        llm_calls += 1
        if llm_calls == 2:
            assistant.request_termination("done")
            return LLMResponse()
        assert on_chunk is not None
        on_chunk("content", "<think>Drafting plan</think>\nHello there")
        return LLMResponse(content="<think>Drafting plan</think>\nHello there")

    monkeypatch.setattr(assistant, "_wait_for_input", fake_wait_for_input)
    monkeypatch.setattr("flowent.agent.gateway.chat", fake_chat)
    monkeypatch.setattr(event_bus, "emit", lambda event: events.append(event))

    assistant._run()

    history = assistant.get_history_snapshot()
    assistant_content_events = [
        event.data.get("content")
        for event in events
        if event.type == EventType.ASSISTANT_CONTENT
    ]

    assert any(
        isinstance(entry, AssistantThinking) and entry.content == "Drafting plan"
        for entry in history
    )
    assert any(
        isinstance(entry, AssistantText) and entry.content == "Hello there"
        for entry in history
    )
    assert assistant_content_events == ["Hello there"]


def test_agent_does_not_duplicate_thinking_when_provider_returns_both(monkeypatch):
    assistant = Agent(NodeConfig(node_type=NodeType.ASSISTANT), uuid="assistant")
    wait_calls = 0
    llm_calls = 0

    def fake_wait_for_input() -> None:
        nonlocal wait_calls
        wait_calls += 1
        if wait_calls == 1:
            assistant._append_history(
                ReceivedMessage(content="reply to me", from_id="human")
            )
            assistant.set_state(AgentState.RUNNING, "received message from human")
            return
        assistant.request_termination("done")

    def fake_chat(
        messages,
        tools=None,
        on_chunk=None,
        register_interrupt=None,
        role_name=None,
    ):
        nonlocal llm_calls
        llm_calls += 1
        if llm_calls == 2:
            assistant.request_termination("done")
            return LLMResponse()
        return LLMResponse(
            content="<think>Drafting plan</think>\nHello there",
            thinking="Drafting plan",
        )

    monkeypatch.setattr(assistant, "_wait_for_input", fake_wait_for_input)
    monkeypatch.setattr("flowent.agent.gateway.chat", fake_chat)

    assistant._run()

    thinking_entries = [
        entry
        for entry in assistant.get_history_snapshot()
        if isinstance(entry, AssistantThinking)
    ]

    assert [entry.content for entry in thinking_entries] == ["Drafting plan"]


def test_request_sleep_raises_interrupt_when_running_agent_is_interrupted():
    agent = Agent(NodeConfig(node_type=NodeType.AGENT), uuid="agent-a")
    agent.set_state(AgentState.RUNNING, "sleeping")
    assert agent.request_interrupt() is True

    try:
        agent.request_sleep(seconds=0.2)
    except InterruptRequestedError:
        pass
    else:
        raise AssertionError("expected interrupt during sleep")


def test_request_sleep_wakes_early_when_new_message_arrives():
    agent = Agent(NodeConfig(node_type=NodeType.AGENT), uuid="agent-a")
    agent.set_state(AgentState.RUNNING, "processing")

    def enqueue_message() -> None:
        time.sleep(0.02)
        agent.enqueue_message(
            Message(from_id="tester", to_id=agent.uuid, content="wake up")
        )

    wake_thread = threading.Thread(target=enqueue_message, daemon=True)
    wake_thread.start()

    result = agent.request_sleep(seconds=0.3)

    wake_thread.join(timeout=1.0)

    assert result.startswith("woken by message after ")
    assert agent.state == AgentState.RUNNING
    received_entries = [
        entry
        for entry in agent.get_history_snapshot()
        if isinstance(entry, ReceivedMessage)
    ]
    assert len(received_entries) == 1
    assert received_entries[0].content == "wake up"
    assert [
        entry.state
        for entry in agent.get_history_snapshot()
        if isinstance(entry, StateEntry)
    ][-2:] == ["sleeping", "running"]


def test_request_sleep_timeout_queues_deadline_notice():
    agent = Agent(NodeConfig(node_type=NodeType.AGENT), uuid="agent-a")
    agent.set_state(AgentState.RUNNING, "processing")

    result = agent.request_sleep(seconds=0.01)

    assert result.startswith("slept ")
    assert agent.state == AgentState.RUNNING
    assert agent._consume_runtime_notices() == [agent._build_sleep_deadline_notice()]
    assert [
        entry.state
        for entry in agent.get_history_snapshot()
        if isinstance(entry, StateEntry)
    ][-2:] == ["sleeping", "running"]


def test_agent_interrupts_blocked_provider_without_streaming_output(monkeypatch):
    monkeypatch.setattr("flowent.agent.get_settings", lambda: Settings())
    registry.reset()
    assistant = Agent(NodeConfig(node_type=NodeType.ASSISTANT), uuid="assistant")
    registry.register(assistant)
    events = []
    wait_calls = 0
    provider_started = threading.Event()

    def fake_wait_for_input() -> None:
        nonlocal wait_calls
        wait_calls += 1
        if wait_calls == 1:
            assistant._append_history(
                ReceivedMessage(content="start working", from_id="human")
            )
            assistant.set_state(AgentState.RUNNING, "received message from human")
            return
        assistant.request_termination("done")

    def fake_chat(
        messages,
        tools=None,
        on_chunk=None,
        register_interrupt=None,
        role_name=None,
    ):
        closed = threading.Event()
        assert register_interrupt is not None
        register_interrupt(closed.set)
        provider_started.set()
        while not closed.wait(0.01):
            continue
        raise RuntimeError("stream closed")

    def request_interrupt() -> None:
        provider_started.wait(timeout=1.0)
        assistant.request_interrupt()

    interrupter = threading.Thread(target=request_interrupt, daemon=True)
    interrupter.start()

    monkeypatch.setattr(assistant, "_wait_for_input", fake_wait_for_input)
    monkeypatch.setattr("flowent.agent.gateway.chat", fake_chat)
    monkeypatch.setattr(event_bus, "emit", lambda event: events.append(event))

    try:
        assistant._run()
    finally:
        registry.reset()

    interrupter.join(timeout=1.0)

    assert any(
        event.type == EventType.NODE_STATE_CHANGED
        and event.data.get("new_state") == "idle"
        for event in events
    )


def test_provider_resolution_error_is_recorded_in_history(monkeypatch):
    agent = Agent(NodeConfig(node_type=NodeType.AGENT), uuid="agent-y")
    wait_calls = 0

    def fake_wait_for_input() -> None:
        nonlocal wait_calls
        wait_calls += 1
        if wait_calls == 1:
            agent._append_history(
                ReceivedMessage(content="do the task", from_id="tester")
            )
            agent.set_state(AgentState.RUNNING, "received message from tester")
            return
        agent.request_termination("stop")

    monkeypatch.setattr(agent, "_wait_for_input", fake_wait_for_input)
    monkeypatch.setattr(
        "flowent.agent.gateway.chat",
        lambda messages, tools=None, on_chunk=None, register_interrupt=None, role_name=None: (
            (_ for _ in ()).throw(RuntimeError("No active provider configured"))
        ),
    )

    agent._run()

    assert wait_calls == 2
    assert agent.state == AgentState.TERMINATED
    assert any(
        isinstance(entry, ErrorEntry)
        and "No active provider configured" in entry.content
        for entry in agent.get_history_snapshot()
    )


def test_assistant_content_streams_even_when_response_has_tool_calls(monkeypatch):
    registry.reset()
    assistant = Agent(
        NodeConfig(node_type=NodeType.ASSISTANT, tools=["idle"]),
    )
    registry.register(assistant)
    events = []

    def fake_wait_for_input() -> None:
        assistant._append_history(
            ReceivedMessage(content="report progress", from_id="human")
        )
        assistant.set_state(AgentState.RUNNING, "received message from human")

    def fake_chat(
        messages,
        tools=None,
        on_chunk=None,
        register_interrupt=None,
        role_name=None,
    ):
        if on_chunk is not None:
            on_chunk("content", "Working on it")
        return LLMResponse(
            content="Working on it",
            tool_calls=[
                ToolCallResult(
                    id="call-idle",
                    name="idle",
                    arguments={},
                )
            ],
        )

    monkeypatch.setattr(assistant, "_wait_for_input", fake_wait_for_input)
    monkeypatch.setattr("flowent.agent.gateway.chat", fake_chat)
    monkeypatch.setattr(
        assistant,
        "_handle_tool_call",
        lambda name, arguments, call_id: assistant.request_termination("done"),
    )
    monkeypatch.setattr(event_bus, "emit", lambda event: events.append(event))

    assistant._run()

    assistant_events = [
        event for event in events if event.type == EventType.ASSISTANT_CONTENT
    ]
    assert [event.data for event in assistant_events] == [{"content": "Working on it"}]


def test_send_message_delivers_to_single_contact_and_records_histories(monkeypatch):
    registry.reset()
    leader = _register_tab_leader()
    child = Agent(NodeConfig(node_type=NodeType.AGENT, tab_id="tab-1"), uuid="child")
    registry.register(child)
    events = []

    monkeypatch.setattr(event_bus, "emit", lambda event: events.append(event))

    try:
        result = json.loads(
            child.send_message(
                target_ref="leader",
                raw_parts=[{"type": "text", "text": "investigate the error"}],
            )
        )
    finally:
        registry.reset()

    sent_entry = next(
        entry
        for entry in child.get_history_snapshot()
        if isinstance(entry, SentMessage)
    )
    received_entry = next(
        entry
        for entry in leader.get_history_snapshot()
        if isinstance(entry, ReceivedMessage)
    )
    signal = leader._wake_queue.get_nowait()

    assert result == {"status": "sent", "target_id": "leader"}
    assert sent_entry.to_id == "leader"
    assert sent_entry.content == "investigate the error"
    assert received_entry.from_id == "child"
    assert received_entry.content == "investigate the error"
    assert sent_entry.message_id == received_entry.message_id
    assert signal.payload == {
        "message": {
            "from": "child",
            "content": "investigate the error",
            "parts": [{"type": "text", "text": "investigate the error"}],
            "history_recorded": True,
            "message_id": sent_entry.message_id,
        }
    }
    assert [event.data for event in events if event.type == EventType.NODE_MESSAGE] == [
        {
            "to_id": "leader",
            "content": "investigate the error",
            "message_id": sent_entry.message_id,
        }
    ]


def test_send_message_reports_error_when_target_is_not_in_contacts():
    registry.reset()
    _register_tab_leader()
    child = Agent(NodeConfig(node_type=NodeType.AGENT, tab_id="tab-1"), uuid="child")
    peer = Agent(NodeConfig(node_type=NodeType.AGENT, tab_id="tab-1"), uuid="peer")
    registry.register(child)
    registry.register(peer)

    try:
        with pytest.raises(
            ValueError,
            match=r"Send failed: target `peer` is not in contacts\.",
        ):
            child.send_message(
                target_ref="peer",
                raw_parts=[{"type": "text", "text": "reply with the findings"}],
            )
    finally:
        registry.reset()


def test_send_message_validates_target_before_image_capability():
    registry.reset()
    _register_tab_leader()
    child = Agent(NodeConfig(node_type=NodeType.AGENT, tab_id="tab-1"), uuid="child")
    peer = Agent(NodeConfig(node_type=NodeType.AGENT, tab_id="tab-1"), uuid="peer")
    registry.register(child)
    registry.register(peer)

    try:
        with pytest.raises(
            ValueError,
            match=r"Send failed: target `peer` is not in contacts\.",
        ):
            child.send_message(
                target_ref="peer",
                raw_parts=[{"type": "image", "asset_id": "asset-1"}],
            )
    finally:
        registry.reset()


def test_send_message_reports_error_when_target_lacks_input_image_support():
    registry.reset()
    _register_tab_leader()
    child = Agent(NodeConfig(node_type=NodeType.AGENT, tab_id="tab-1"), uuid="child")
    registry.register(child)

    try:
        with pytest.raises(
            ValueError,
            match=r"Send failed: target `leader` does not support `input_image`\.",
        ):
            child.send_message(
                target_ref="leader",
                raw_parts=[{"type": "image", "asset_id": "asset-1"}],
            )
    finally:
        registry.reset()


def test_record_content_output_treats_target_like_text_as_plain_output(monkeypatch):
    registry.reset()
    assistant = Agent(NodeConfig(node_type=NodeType.ASSISTANT), uuid="assistant")
    registry.register(assistant)
    events = []

    monkeypatch.setattr(event_bus, "emit", lambda event: events.append(event))

    try:
        assistant._record_content_output(
            "@worker: do the follow-up task",
            emitted_human_content=False,
        )
    finally:
        registry.reset()

    history = assistant.get_history_snapshot()
    assert isinstance(history[-1], AssistantText)
    assert history[-1].content == "@worker: do the follow-up task"
    assert not any(isinstance(entry, SentMessage) for entry in history)
    assert any(
        event.type == EventType.ASSISTANT_CONTENT
        and event.data == {"content": "@worker: do the follow-up task"}
        for event in events
    )


def test_handle_tool_call_send_success_omits_toolcall_history(monkeypatch):
    registry.reset()
    _register_tab_leader()
    child = Agent(NodeConfig(node_type=NodeType.AGENT, tab_id="tab-1"), uuid="child")
    registry.register(child)

    try:
        result = child._handle_tool_call(
            "send",
            {
                "target": "leader",
                "parts": [{"type": "text", "text": "reply with the findings"}],
            },
            "call-send",
        )
    finally:
        registry.reset()

    assert json.loads(result) == {"status": "sent", "target_id": "leader"}
    assert not any(
        isinstance(entry, ToolCall) and entry.tool_call_id == "call-send"
        for entry in child.get_history_snapshot()
    )
    assert any(isinstance(entry, SentMessage) for entry in child.get_history_snapshot())


def test_handle_tool_call_send_failure_records_error_without_toolcall():
    registry.reset()
    _register_tab_leader()
    child = Agent(NodeConfig(node_type=NodeType.AGENT, tab_id="tab-1"), uuid="child")
    peer = Agent(NodeConfig(node_type=NodeType.AGENT, tab_id="tab-1"), uuid="peer")
    registry.register(child)
    registry.register(peer)

    try:
        result = child._handle_tool_call(
            "send",
            {
                "target": "peer",
                "parts": [{"type": "text", "text": "reply with the findings"}],
            },
            "call-send",
        )
    finally:
        registry.reset()

    assert json.loads(result) == {
        "error": "Send failed: target `peer` is not in contacts."
    }
    assert not any(
        isinstance(entry, ToolCall) and entry.tool_call_id == "call-send"
        for entry in child.get_history_snapshot()
    )
    assert any(
        isinstance(entry, ErrorEntry)
        and entry.content == "Send failed: target `peer` is not in contacts."
        for entry in child.get_history_snapshot()
    )


def test_multiple_send_tool_calls_stop_after_first_failure(monkeypatch):
    registry.reset()
    leader = _register_tab_leader()
    child = Agent(NodeConfig(node_type=NodeType.AGENT, tab_id="tab-1"), uuid="child")
    helper = Agent(NodeConfig(node_type=NodeType.AGENT, tab_id="tab-1"), uuid="helper")
    registry.register(child)
    registry.register(helper)

    wait_calls = 0
    chat_calls = 0

    def fake_wait_for_input() -> None:
        nonlocal wait_calls
        wait_calls += 1
        if wait_calls == 1:
            child._append_history(ReceivedMessage(content="begin", from_id="human"))
            child.set_state(AgentState.RUNNING, "received message from human")
            return
        child.request_termination("done")

    def fake_chat(
        messages,
        tools=None,
        on_chunk=None,
        register_interrupt=None,
        role_name=None,
    ):
        nonlocal chat_calls
        chat_calls += 1
        if chat_calls == 1:
            return LLMResponse(
                tool_calls=[
                    ToolCallResult(
                        id="call-send-1",
                        name="send",
                        arguments={
                            "target": "leader",
                            "parts": [{"type": "text", "text": "first"}],
                        },
                    ),
                    ToolCallResult(
                        id="call-send-2",
                        name="send",
                        arguments={
                            "target": "helper",
                            "parts": [{"type": "text", "text": "second"}],
                        },
                    ),
                    ToolCallResult(
                        id="call-send-3",
                        name="send",
                        arguments={
                            "target": "leader",
                            "parts": [{"type": "text", "text": "third"}],
                        },
                    ),
                ]
            )
        child.request_termination("done")
        return LLMResponse()

    monkeypatch.setattr(child, "_wait_for_input", fake_wait_for_input)
    monkeypatch.setattr("flowent.agent.gateway.chat", fake_chat)

    try:
        child._run()
    finally:
        registry.reset()

    sent_entries = [
        entry
        for entry in child.get_history_snapshot()
        if isinstance(entry, SentMessage)
    ]
    error_entries = [
        entry for entry in child.get_history_snapshot() if isinstance(entry, ErrorEntry)
    ]

    assert [entry.content for entry in sent_entries] == ["first"]
    assert [
        entry.content
        for entry in leader.get_history_snapshot()
        if isinstance(entry, ReceivedMessage)
    ] == ["first"]
    assert helper._wake_queue.empty()
    assert any(
        entry.content == "Send failed: target `helper` is not in contacts."
        for entry in error_entries
    )


def test_build_messages_replays_sent_messages_as_message_to_context(monkeypatch):
    monkeypatch.setattr("flowent.agent.get_settings", lambda: Settings())

    agent = Agent(NodeConfig(node_type=NodeType.AGENT), uuid="agent")
    agent._append_history(ReceivedMessage(content="begin", from_id="human"))
    agent._append_history(SentMessage(content="to peer", to_id="peer"))
    agent._append_history(AssistantText(content="final answer"))

    messages = agent._build_messages()

    assert messages == [
        {"role": "system", "content": messages[0]["content"]},
        {"role": "user", "content": '<message from="human">begin</message>'},
        {"role": "assistant", "content": '<message to="peer">to peer</message>'},
        {"role": "assistant", "content": "final answer"},
        {
            "role": "user",
            "content": "<system>Runtime post prompt:\n- Plain content is never delivered to other agents.\n- To send a formal message to another node, use `send` with a single `target` and ordered `parts`.\n- Use `contacts` to inspect the node ids and names you can currently message directly.\n- `@target:` or any other `@name:` text inside normal content is just text. It does not send anything.\n- If there is no unfinished TODO and the task is finished with no immediate next action, call `idle`.</system>",
        },
    ]


def test_context_preflight_prefers_usage_baseline_and_estimates_only_new_tail(
    monkeypatch,
):
    monkeypatch.setattr(
        "flowent.agent.get_settings",
        lambda: Settings(
            providers=[
                ProviderConfig(
                    id="provider-1",
                    name="Primary",
                    type="openai_responses",
                    base_url="https://api.example.com/v1",
                    api_key="secret",
                )
            ],
            model=ModelSettings(
                active_provider_id="provider-1",
                active_model="gpt-5.2",
                auto_compact_token_limit=48_000,
            ),
        ),
    )

    agent = Agent(NodeConfig(node_type=NodeType.ASSISTANT), uuid="assistant")
    agent._append_history(ReceivedMessage(content="first", from_id="human"))

    baseline_context = agent._build_prepared_llm_context()
    agent._record_context_token_usage_baseline(
        prepared_context=baseline_context,
        usage=LLMUsage(
            total_tokens=4_200,
            input_tokens=3_000,
            output_tokens=1_200,
        ),
    )

    agent._append_history(
        ToolCall(
            tool_name="read",
            tool_call_id="call-read",
            arguments={"path": "README.md"},
            result="done",
        )
    )
    next_context = agent._build_prepared_llm_context()
    preflight = agent._compute_context_preflight(next_context)

    expected_tail_tokens = agent._estimate_input_tokens(
        next_context.execution_context_messages[
            len(baseline_context.execution_context_messages) :
        ]
    )

    assert preflight.estimated_total_tokens == 4_200 + expected_tail_tokens
    assert preflight.auto_compact_token_limit == 48_000
    assert preflight.context_window_tokens == 128_000


def test_context_preflight_bootstraps_again_when_runtime_tail_changes(monkeypatch):
    monkeypatch.setattr(
        "flowent.agent.get_settings",
        lambda: Settings(
            providers=[
                ProviderConfig(
                    id="provider-1",
                    name="Primary",
                    type="openai_responses",
                    base_url="https://api.example.com/v1",
                    api_key="secret",
                )
            ],
            model=ModelSettings(
                active_provider_id="provider-1",
                active_model="gpt-5.2",
                auto_compact_token_limit=48_000,
            ),
        ),
    )

    agent = Agent(NodeConfig(node_type=NodeType.ASSISTANT), uuid="assistant")
    agent._append_history(ReceivedMessage(content="first", from_id="human"))

    baseline_context = agent._build_prepared_llm_context()
    agent._record_context_token_usage_baseline(
        prepared_context=baseline_context,
        usage=LLMUsage(total_tokens=4_200),
    )

    agent.set_todos([TodoItem(text="Inspect files")])
    next_context = agent._build_prepared_llm_context()
    preflight = agent._compute_context_preflight(next_context)

    assert preflight.estimated_total_tokens == agent._estimate_input_tokens(
        next_context.messages
    )


def test_prepare_messages_for_llm_uses_token_limit_even_without_context_window(
    monkeypatch,
):
    monkeypatch.setattr(
        "flowent.agent.get_settings",
        lambda: Settings(
            providers=[
                ProviderConfig(
                    id="provider-1",
                    name="Primary",
                    type="openai_compatible",
                    base_url="https://api.example.com/v1",
                    api_key="secret",
                )
            ],
            model=ModelSettings(
                active_provider_id="provider-1",
                active_model="custom-model",
                auto_compact_token_limit=1,
            ),
        ),
    )

    agent = Agent(NodeConfig(node_type=NodeType.ASSISTANT), uuid="assistant")
    agent._append_history(ReceivedMessage(content="hello", from_id="human"))
    compact_calls: list[str] = []

    monkeypatch.setattr(
        agent,
        "_compact_execution_context",
        lambda focus=None: compact_calls.append("compact") or "",
    )

    prepared_context = agent._prepare_messages_for_llm()

    assert compact_calls == ["compact"]
    assert len(prepared_context.messages) > 0


def test_idle_is_blocked_when_fresh_input_has_no_progress(monkeypatch):
    monkeypatch.setattr("flowent.agent.get_settings", lambda: Settings())
    agent = Agent(NodeConfig(node_type=NodeType.ASSISTANT), uuid="assistant")
    agent.set_state(AgentState.RUNNING, "processing")
    agent._turn_started_with_pending_input = True
    agent._turn_made_progress = False

    idle_result = agent.request_idle()
    messages = agent._build_messages()

    reminder = (
        "<system>Idle reminder: you received a new message this turn, but this "
        "response did not send a reply, call `send`, or use any non-idle "
        "tool. Do not call `idle` yet. First reply to the Human, dispatch/"
        "delegate work, or take another concrete step.</system>"
    )

    assert idle_result == ""
    assert agent.state == AgentState.RUNNING
    assert any(msg.get("content") == reminder for msg in messages)


def test_idle_is_blocked_when_first_todo_is_actionable(monkeypatch):
    monkeypatch.setattr("flowent.agent.get_settings", lambda: Settings())
    agent = Agent(NodeConfig(node_type=NodeType.ASSISTANT), uuid="assistant")
    agent.set_state(AgentState.RUNNING, "processing")
    agent.set_todos(
        [
            TodoItem(text="Forward pyproject summary to Project Synthesizer"),
            TodoItem(text="Wait for final synthesis"),
        ]
    )

    idle_result = agent.request_idle()
    messages = agent._build_messages()

    reminder = (
        "<system>Idle reminder: your first remaining TODO still looks actionable "
        "(`Forward pyproject summary to Project Synthesizer`). Do that next, or "
        "update the TODO list so the first remaining item is the actual waiting "
        "step, before calling `idle`.</system>"
    )

    assert idle_result == ""
    assert agent.state == AgentState.RUNNING
    assert any(msg.get("content") == reminder for msg in messages)


def test_build_messages_appends_runtime_todo_context_without_history_entry(monkeypatch):
    monkeypatch.setattr("flowent.agent.get_settings", lambda: Settings())

    agent = Agent(NodeConfig(node_type=NodeType.AGENT), uuid="agent")
    agent._append_history(ReceivedMessage(content="begin", from_id="human"))
    agent.set_todos([TodoItem(text="Inspect files"), TodoItem(text="Report results")])

    messages = agent._build_messages()
    history = agent.get_history_snapshot()

    received_entries = [
        entry for entry in history if isinstance(entry, ReceivedMessage)
    ]
    assert len(received_entries) == 1
    assert messages == [
        {"role": "system", "content": messages[0]["content"]},
        {"role": "user", "content": '<message from="human">begin</message>'},
        {
            "role": "user",
            "content": "<system>Current TODO list:\n  - Inspect files\n  - Report results</system>",
        },
        {
            "role": "user",
            "content": "<system>Runtime post prompt:\n- Plain content is never delivered to other agents.\n- To send a formal message to another node, use `send` with a single `target` and ordered `parts`.\n- Use `contacts` to inspect the node ids and names you can currently message directly.\n- `@target:` or any other `@name:` text inside normal content is just text. It does not send anything.\n- If the TODO list is not complete yet, use `todo` to replace it with the latest remaining items.</system>",
        },
    ]


def test_build_messages_appends_runtime_post_prompt_and_idle_guidance(monkeypatch):
    monkeypatch.setattr(
        "flowent.agent.get_settings",
        lambda: Settings(custom_post_prompt="Append this after history."),
    )

    agent = Agent(NodeConfig(node_type=NodeType.AGENT), uuid="agent")
    agent._append_history(ReceivedMessage(content="begin", from_id="human"))
    agent.set_todos([TodoItem(text="Inspect files")])
    agent.set_todos([])

    messages = agent._build_messages()
    history = agent.get_history_snapshot()

    received_entries = [
        entry for entry in history if isinstance(entry, ReceivedMessage)
    ]
    assert len(received_entries) == 1
    assert messages == [
        {"role": "system", "content": messages[0]["content"]},
        {"role": "user", "content": '<message from="human">begin</message>'},
        {
            "role": "user",
            "content": "<system>Runtime post prompt:\n- Plain content is never delivered to other agents.\n- To send a formal message to another node, use `send` with a single `target` and ordered `parts`.\n- Use `contacts` to inspect the node ids and names you can currently message directly.\n- `@target:` or any other `@name:` text inside normal content is just text. It does not send anything.\n- If there is no unfinished TODO and the task is finished with no immediate next action, call `idle`.</system>",
        },
        {
            "role": "user",
            "content": "<system>Append this after history.</system>",
        },
    ]


def test_build_messages_warns_about_newly_created_agents_waiting_for_first_task(
    monkeypatch,
):
    monkeypatch.setattr("flowent.agent.get_settings", lambda: Settings())

    agent = Agent(NodeConfig(node_type=NodeType.AGENT), uuid="agent")
    agent._append_history(ReceivedMessage(content="begin", from_id="human"))
    agent._append_history(
        ToolCall(
            tool_name="create_agent",
            tool_call_id="call-create-agent",
            arguments={
                "role_name": "Worker",
                "name": "Directory Worker",
            },
            result=json.dumps(
                {
                    "id": "12345678-aaaa-bbbb-cccc-ddddeeeeffff",
                    "config": {
                        "node_type": "agent",
                        "role_name": "Worker",
                        "tab_id": "tab-1",
                        "name": "Directory Worker",
                        "tools": ["idle", "sleep", "todo", "contacts", "read"],
                        "write_dirs": [],
                        "allow_network": False,
                    },
                    "state": "initializing",
                    "todos": [],
                    "history": [],
                    "position": None,
                    "created_at": 1.0,
                    "updated_at": 1.0,
                }
            ),
        )
    )

    messages = agent._build_messages()

    assert messages == [
        {"role": "system", "content": messages[0]["content"]},
        {"role": "user", "content": '<message from="human">begin</message>'},
        {
            "role": "assistant",
            "tool_calls": [
                {
                    "id": "call-create-agent",
                    "type": "function",
                    "function": {
                        "name": "create_agent",
                        "arguments": '{"role_name": "Worker", "name": "Directory Worker"}',
                    },
                }
            ],
        },
        {
            "role": "tool",
            "tool_call_id": "call-create-agent",
            "content": '{"id": "12345678-aaaa-bbbb-cccc-ddddeeeeffff", "config": {"node_type": "agent", "role_name": "Worker", "tab_id": "tab-1", "name": "Directory Worker", "tools": ["idle", "sleep", "todo", "contacts", "read"], "write_dirs": [], "allow_network": false}, "state": "initializing", "todos": [], "history": [], "position": null, "created_at": 1.0, "updated_at": 1.0}',
        },
        {
            "role": "user",
            "content": "<system>Runtime post prompt:\n- Plain content is never delivered to other agents.\n- To send a formal message to another node, use `send` with a single `target` and ordered `parts`.\n- Use `contacts` to inspect the node ids and names you can currently message directly.\n- `@target:` or any other `@name:` text inside normal content is just text. It does not send anything.\n- Newly created agents still waiting for their first task: Directory Worker (`12345678`).\n- `create_agent` only adds a new agent node to the current workflow. It does not start work by itself.\n- Before calling `idle`, dispatch each waiting agent a concrete first task with `send`.</system>",
        },
    ]


def test_build_messages_uses_role_name_when_created_agent_has_no_explicit_name(
    monkeypatch,
):
    monkeypatch.setattr("flowent.agent.get_settings", lambda: Settings())

    agent = Agent(NodeConfig(node_type=NodeType.AGENT), uuid="agent")
    agent._append_history(ReceivedMessage(content="begin", from_id="human"))
    agent._append_history(
        ToolCall(
            tool_name="create_agent",
            tool_call_id="call-create-agent",
            arguments={"role_name": "Worker"},
            result=json.dumps(
                {
                    "id": "12345678-aaaa-bbbb-cccc-ddddeeeeffff",
                    "config": {
                        "node_type": "agent",
                        "role_name": "Worker",
                        "tab_id": "tab-1",
                        "name": None,
                        "tools": ["idle", "sleep", "todo", "contacts", "read"],
                        "write_dirs": [],
                        "allow_network": False,
                    },
                    "state": "initializing",
                    "todos": [],
                    "history": [],
                    "position": None,
                    "created_at": 1.0,
                    "updated_at": 1.0,
                }
            ),
        )
    )

    messages = agent._build_messages()

    assert messages == [
        {"role": "system", "content": messages[0]["content"]},
        {"role": "user", "content": '<message from="human">begin</message>'},
        {
            "role": "assistant",
            "tool_calls": [
                {
                    "id": "call-create-agent",
                    "type": "function",
                    "function": {
                        "name": "create_agent",
                        "arguments": '{"role_name": "Worker"}',
                    },
                }
            ],
        },
        {
            "role": "tool",
            "tool_call_id": "call-create-agent",
            "content": '{"id": "12345678-aaaa-bbbb-cccc-ddddeeeeffff", "config": {"node_type": "agent", "role_name": "Worker", "tab_id": "tab-1", "name": null, "tools": ["idle", "sleep", "todo", "contacts", "read"], "write_dirs": [], "allow_network": false}, "state": "initializing", "todos": [], "history": [], "position": null, "created_at": 1.0, "updated_at": 1.0}',
        },
        {
            "role": "user",
            "content": "<system>Runtime post prompt:\n- Plain content is never delivered to other agents.\n- To send a formal message to another node, use `send` with a single `target` and ordered `parts`.\n- Use `contacts` to inspect the node ids and names you can currently message directly.\n- `@target:` or any other `@name:` text inside normal content is just text. It does not send anything.\n- Newly created agents still waiting for their first task: Worker (`12345678`).\n- `create_agent` only adds a new agent node to the current workflow. It does not start work by itself.\n- Before calling `idle`, dispatch each waiting agent a concrete first task with `send`.</system>",
        },
    ]


def test_build_messages_clears_new_agent_warning_after_first_sent_message(monkeypatch):
    monkeypatch.setattr("flowent.agent.get_settings", lambda: Settings())

    agent = Agent(NodeConfig(node_type=NodeType.AGENT), uuid="agent")
    agent._append_history(ReceivedMessage(content="begin", from_id="human"))
    agent._append_history(
        ToolCall(
            tool_name="create_agent",
            tool_call_id="call-create-agent",
            arguments={
                "role_name": "Worker",
                "name": "Directory Worker",
            },
            result=json.dumps(
                {
                    "id": "12345678-aaaa-bbbb-cccc-ddddeeeeffff",
                    "config": {
                        "node_type": "agent",
                        "role_name": "Worker",
                        "tab_id": "tab-1",
                        "name": "Directory Worker",
                        "tools": ["idle", "sleep", "todo", "contacts", "read"],
                        "write_dirs": [],
                        "allow_network": False,
                    },
                    "state": "initializing",
                    "todos": [],
                    "history": [],
                    "position": None,
                    "created_at": 1.0,
                    "updated_at": 1.0,
                }
            ),
        )
    )
    agent._append_history(
        SentMessage(
            content="inspect the current directory",
            to_id="12345678-aaaa-bbbb-cccc-ddddeeeeffff",
        )
    )

    messages = agent._build_messages()

    assert messages == [
        {"role": "system", "content": messages[0]["content"]},
        {"role": "user", "content": '<message from="human">begin</message>'},
        {
            "role": "assistant",
            "tool_calls": [
                {
                    "id": "call-create-agent",
                    "type": "function",
                    "function": {
                        "name": "create_agent",
                        "arguments": '{"role_name": "Worker", "name": "Directory Worker"}',
                    },
                }
            ],
        },
        {
            "role": "tool",
            "tool_call_id": "call-create-agent",
            "content": '{"id": "12345678-aaaa-bbbb-cccc-ddddeeeeffff", "config": {"node_type": "agent", "role_name": "Worker", "tab_id": "tab-1", "name": "Directory Worker", "tools": ["idle", "sleep", "todo", "contacts", "read"], "write_dirs": [], "allow_network": false}, "state": "initializing", "todos": [], "history": [], "position": null, "created_at": 1.0, "updated_at": 1.0}',
        },
        {
            "role": "assistant",
            "content": '<message to="12345678-aaaa-bbbb-cccc-ddddeeeeffff">inspect the current directory</message>',
        },
        {
            "role": "user",
            "content": "<system>Runtime post prompt:\n- Plain content is never delivered to other agents.\n- To send a formal message to another node, use `send` with a single `target` and ordered `parts`.\n- Use `contacts` to inspect the node ids and names you can currently message directly.\n- `@target:` or any other `@name:` text inside normal content is just text. It does not send anything.\n- If there is no unfinished TODO and the task is finished with no immediate next action, call `idle`.</system>",
        },
    ]


def test_build_messages_keeps_sleep_tool_results_in_context(monkeypatch):
    monkeypatch.setattr("flowent.agent.get_settings", lambda: Settings())

    agent = Agent(NodeConfig(node_type=NodeType.AGENT), uuid="agent")
    agent._append_history(
        ReceivedMessage(content="pause before continuing", from_id="human")
    )
    agent._append_history(
        ToolCall(
            tool_name="sleep",
            tool_call_id="call-sleep",
            arguments={"seconds": 0.5},
            result="slept 0.50s",
        )
    )

    messages = agent._build_messages()

    assert any(
        msg.get("role") == "assistant"
        and msg.get("tool_calls")
        == [
            {
                "id": "call-sleep",
                "type": "function",
                "function": {
                    "name": "sleep",
                    "arguments": '{"seconds": 0.5}',
                },
            }
        ]
        for msg in messages
    )
    assert any(
        msg.get("role") == "tool"
        and msg.get("tool_call_id") == "call-sleep"
        and msg.get("content") == "slept 0.50s"
        for msg in messages
    )


def test_build_messages_keeps_idle_tool_results_in_context(monkeypatch):
    monkeypatch.setattr("flowent.agent.get_settings", lambda: Settings())

    agent = Agent(NodeConfig(node_type=NodeType.AGENT), uuid="agent")
    agent._append_history(ReceivedMessage(content="resume after wait", from_id="human"))
    agent._append_history(
        ToolCall(
            tool_name="idle",
            tool_call_id="call-idle",
            arguments={},
            result="idle 1.25s",
        )
    )

    messages = agent._build_messages()

    assert any(
        msg.get("role") == "assistant"
        and msg.get("tool_calls")
        == [
            {
                "id": "call-idle",
                "type": "function",
                "function": {
                    "name": "idle",
                    "arguments": "{}",
                },
            }
        ]
        for msg in messages
    )
    assert any(
        msg.get("role") == "tool"
        and msg.get("tool_call_id") == "call-idle"
        and msg.get("content") == "idle 1.25s"
        for msg in messages
    )


def test_build_messages_keeps_error_entries_in_context(monkeypatch):
    monkeypatch.setattr("flowent.agent.get_settings", lambda: Settings())

    agent = Agent(NodeConfig(node_type=NodeType.AGENT), uuid="agent")
    agent._append_history(ReceivedMessage(content="begin", from_id="human"))
    agent._append_history(ErrorEntry(content="RuntimeError: boom\n\ntraceback"))

    messages = agent._build_messages()

    assert any(
        msg.get("role") == "user"
        and msg.get("content")
        == "<system>Previous runtime error:\nRuntimeError: boom\n\ntraceback</system>"
        for msg in messages
    )


def test_assistant_emits_human_content_for_plain_text_with_target_like_prefix(
    monkeypatch,
):
    registry.reset()
    _register_tab_leader()
    assistant = Agent(
        NodeConfig(node_type=NodeType.ASSISTANT),
        uuid="assistant",
    )
    registry.register(assistant)
    events = []
    responses = iter(
        [LLMResponse(content="@leader: investigate the error"), LLMResponse()]
    )

    def fake_wait_for_input() -> None:
        assistant._append_history(
            ReceivedMessage(content="please investigate", from_id="human")
        )
        assistant.set_state(AgentState.RUNNING, "received message from human")

    def fake_chat(
        messages,
        tools=None,
        on_chunk=None,
        register_interrupt=None,
        role_name=None,
    ):
        response = next(responses)
        if response.content and on_chunk is not None:
            on_chunk("content", response.content)
        if response.content is None:
            assistant.request_termination("done")
        return response

    monkeypatch.setattr(event_bus, "emit", lambda event: events.append(event))
    monkeypatch.setattr(assistant, "_wait_for_input", fake_wait_for_input)
    monkeypatch.setattr("flowent.agent.gateway.chat", fake_chat)

    try:
        assistant._run()
    finally:
        registry.reset()

    assert any(event.type == EventType.ASSISTANT_CONTENT for event in events)
    assert not any(
        isinstance(entry, SentMessage) for entry in assistant.get_history_snapshot()
    )
    assert any(
        isinstance(entry, AssistantText)
        and entry.content == "@leader: investigate the error"
        for entry in assistant.get_history_snapshot()
    )


def test_idle_tool_records_wakeup_message_as_new_input_block(monkeypatch):
    agent = Agent(NodeConfig(node_type=NodeType.AGENT, tools=["idle"]))
    wait_calls = 0
    llm_messages: list[list[dict]] = []
    responses = iter(
        [
            LLMResponse(
                tool_calls=[
                    ToolCallResult(
                        id="call-idle",
                        name="idle",
                        arguments={},
                    )
                ]
            ),
            LLMResponse(),
        ]
    )

    def fake_wait_for_input() -> None:
        nonlocal wait_calls
        wait_calls += 1
        agent._append_history(
            ReceivedMessage(content="start waiting", from_id="tester")
        )
        agent.set_state(AgentState.RUNNING, "received message from tester")

    def fake_chat(
        messages,
        tools=None,
        on_chunk=None,
        register_interrupt=None,
        role_name=None,
    ):
        llm_messages.append(messages)
        if len(llm_messages) == 1:
            timer = threading.Timer(
                0.01,
                lambda: agent.enqueue_message(
                    Message(
                        from_id="human",
                        to_id=agent.uuid,
                        content="wake up now",
                    )
                ),
            )
            timer.start()
        if len(llm_messages) == 2:
            agent.request_termination("done")
        return next(responses)

    monkeypatch.setattr(agent, "_wait_for_input", fake_wait_for_input)
    monkeypatch.setattr("flowent.agent.gateway.chat", fake_chat)

    agent._run()

    assert wait_calls == 1
    assert agent.state == AgentState.TERMINATED
    second_round = llm_messages[1]
    assert any(
        msg.get("role") == "assistant"
        and msg.get("tool_calls")
        == [
            {
                "id": "call-idle",
                "type": "function",
                "function": {
                    "name": "idle",
                    "arguments": "{}",
                },
            }
        ]
        for msg in second_round
    )
    assert any(
        msg.get("role") == "tool"
        and msg.get("tool_call_id") == "call-idle"
        and isinstance(msg.get("content"), str)
        and msg.get("content", "").startswith("idle ")
        for msg in second_round
    )
    assert any(
        msg.get("role") == "user"
        and msg.get("content") == '<message from="human">wake up now</message>'
        for msg in second_round
    )
    assert any(
        isinstance(entry, ToolCall)
        and entry.tool_name == "idle"
        and isinstance(entry.result, str)
        and entry.result.startswith("idle ")
        for entry in agent.get_history_snapshot()
    )


def test_agent_contextualizes_plain_loguru_calls(monkeypatch):
    agent = Agent(NodeConfig(node_type=NodeType.AGENT), uuid="agent-z")
    captured: list[tuple[str, str | None]] = []
    sink_id = logger.add(
        lambda message: captured.append(
            (message.record["message"], message.record["extra"].get("agent_id"))
        )
    )

    def fake_wait_for_input() -> None:
        agent._append_history(ReceivedMessage(content="do the task", from_id="tester"))
        agent.set_state(AgentState.RUNNING, "received message from tester")

    def fake_chat(
        messages,
        tools=None,
        on_chunk=None,
        register_interrupt=None,
        role_name=None,
    ):
        logger.info("plain log inside agent")
        agent.request_termination("done")
        return LLMResponse()

    monkeypatch.setattr(agent, "_wait_for_input", fake_wait_for_input)
    monkeypatch.setattr("flowent.agent.gateway.chat", fake_chat)

    try:
        agent._run()
    finally:
        logger.remove(sink_id)

    assert ("plain log inside agent", "agent-z") in captured


def test_agent_denies_tool_call_before_edit_execute(monkeypatch, tmp_path):
    agent = Agent(
        NodeConfig(node_type=NodeType.AGENT, tools=["edit"]),
        uuid="agent-security",
    )

    def fail_execute(*_args, **_kwargs):
        raise AssertionError("edit execute should not be called")

    monkeypatch.setattr("flowent.tools.edit.EditTool.execute", fail_execute)

    result = agent._handle_tool_call(
        "edit",
        {
            "path": str(tmp_path / "blocked.txt"),
            "edits": [
                {
                    "start_line": 1,
                    "end_line": 1,
                    "new_content": "hello\n",
                }
            ],
        },
        "call-edit",
    )

    assert result == json.dumps({"error": "Write access is disabled for this agent"})
    assert isinstance(agent.history[-1], ToolCall)
    assert agent.history[-1].result == result


def test_handle_tool_call_emits_streaming_tool_result_deltas(monkeypatch):
    agent = Agent(
        NodeConfig(node_type=NodeType.AGENT, tools=["streaming_tool"]),
        uuid="agent-stream",
    )
    events = []

    class FakeTool:
        def execute(self, agent, args, **kwargs):
            on_output = kwargs.get("on_output")
            assert on_output is not None
            on_output("chunk 1\n")
            on_output("chunk 2\n")
            return json.dumps({"status": "done"})

    class FakeRegistry:
        def get(self, name):
            if name == "streaming_tool":
                return FakeTool()
            return None

    monkeypatch.setattr("flowent.agent._get_tool_registry", lambda: FakeRegistry())
    monkeypatch.setattr(event_bus, "emit", lambda event: events.append(event))

    result = agent._handle_tool_call("streaming_tool", {}, "call-stream")

    assert result == json.dumps({"status": "done"})
    assert isinstance(agent.history[-1], ToolCall)
    assert agent.history[-1].tool_call_id == "call-stream"
    assert agent.history[-1].result == result
    assert agent.history[-1].streaming is False
    assert [
        event.data["text"]
        for event in events
        if event.type == EventType.HISTORY_ENTRY_DELTA
    ] == [
        "chunk 1\n",
        "chunk 2\n",
    ]
