from pathlib import Path

from pydantic_ai.messages import (
    ModelRequest,
    ModelResponse,
    TextPart,
    ThinkingPart,
    ToolCallPart,
    ToolReturnPart,
    UserPromptPart,
)

from flowent.domain import Activation
from flowent.history import AgentHistory
from flowent.persistence import SQLiteStore


def activation() -> Activation:
    return Activation(agent_id=2, discussion_id=1, message_id=3)


def test_persists_complete_agent_history_and_restores_model_messages(
    tmp_path: Path,
) -> None:
    store = SQLiteStore(tmp_path / "data")
    history = AgentHistory(store)
    first = history.start(activation())
    messages = (
        ModelRequest(
            parts=[UserPromptPart(content="Process the activation")],
            run_id=first.run_id,
            conversation_id="agent-2",
        ),
        ModelResponse(
            parts=[
                ThinkingPart(content="private reasoning"),
                ToolCallPart(
                    tool_name="discussion",
                    args={"action": "read", "discussion_id": 1},
                    tool_call_id="call-1",
                ),
            ],
            model_name="test-model",
            run_id=first.run_id,
            conversation_id="agent-2",
        ),
        ModelRequest(
            parts=[
                ToolReturnPart(
                    tool_name="discussion",
                    content={"messages": [{"body": "Continue the work"}]},
                    tool_call_id="call-1",
                )
            ],
            run_id=first.run_id,
            conversation_id="agent-2",
        ),
        ModelResponse(
            parts=[TextPart(content="Work completed")],
            model_name="test-model",
            run_id=first.run_id,
            conversation_id="agent-2",
        ),
    )
    first.complete("completed", messages, {"input_tokens": 12}, None)

    restored = AgentHistory(SQLiteStore(tmp_path / "data"))
    second = restored.start(activation())

    assert second.message_history == messages
    snapshot = restored.snapshot(2)
    first_run = snapshot["runs"][0]
    assert first_run["status"] == "completed"
    assert [entry["type"] for entry in first_run["entries"]] == [
        "activation",
        "thinking",
        "tool_call",
        "tool_result",
        "assistant",
    ]
    assert "private reasoning" not in str(first_run)
    assert first_run["entries"][-1]["content"] == "Work completed"
    assert first_run["usage"] == {"input_tokens": 12}


def test_keeps_failed_interrupted_messages_in_the_next_agent_context(
    tmp_path: Path,
) -> None:
    history = AgentHistory(SQLiteStore(tmp_path / "data"))
    first = history.start(activation())
    interrupted = ModelResponse(
        parts=[TextPart(content="Partial response")],
        model_name="test-model",
        run_id=first.run_id,
        conversation_id="agent-2",
        state="interrupted",
    )
    first.complete("failed", [interrupted], None, "Model request failed")

    second = AgentHistory(SQLiteStore(tmp_path / "data")).start(activation())

    assert second.message_history == (interrupted,)
    failed_run = history.snapshot(2)["runs"][0]
    assert failed_run["entries"][1]["state"] == "interrupted"
    assert failed_run["entries"][-1]["type"] == "error"


def test_merges_live_text_deltas_and_publishes_ordered_events(tmp_path: Path) -> None:
    events: list[dict[str, object]] = []
    history = AgentHistory(SQLiteStore(tmp_path / "data"), events.append)
    run = history.start(activation())

    run.emit("thinking", part_id="0-0")
    run.emit("thinking", part_id="0-0")
    run.emit("text_delta", part_id="0-1", content="Flow")
    run.emit("text_delta", part_id="0-1", content="ent")
    run.emit("tool_call", tool_name="exec", content={"argv": ["pwd"]})

    active = history.snapshot(2)["runs"][0]
    assert [entry["type"] for entry in active["entries"]] == [
        "activation",
        "thinking",
        "assistant",
        "tool_call",
    ]
    assert active["entries"][2]["content"] == "Flowent"
    assert active["event_sequence"] == 6
    assert [event["sequence"] for event in events] == list(range(1, 7))
    assert events[0]["type"] == "run_started"


def test_marks_running_history_interrupted_after_restart(tmp_path: Path) -> None:
    data = tmp_path / "data"
    store = SQLiteStore(data)
    store.begin_agent_run(2, "unfinished", "2026-08-15T00:00:00+00:00", [])

    restored = SQLiteStore(data)

    run = restored.load_agent_runs(2)[0]
    assert run["status"] == "interrupted"
    assert run["completed_at"] is not None
    assert run["error"] == "Flowent stopped before this run completed"
