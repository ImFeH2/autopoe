from pathlib import Path

import pytest
from pydantic_ai.messages import (
    CompactionPart,
    ModelRequest,
    ModelResponse,
    NativeToolCallPart,
    NativeToolReturnPart,
    SystemPromptPart,
    TextPart,
    ThinkingPart,
    ToolCallPart,
    ToolReturnPart,
    UserPromptPart,
)

from flowent.domain import DomainError, Reminder, ReminderMention
from flowent.history import AgentHistory
from flowent.persistence import SQLiteStore


def reminder() -> Reminder:
    return Reminder(
        agent_id=2,
        mentions=(ReminderMention(1, 3, 1, "Please handle this", False),),
    )


def test_persists_complete_agent_history_and_restores_model_messages(
    tmp_path: Path,
) -> None:
    store = SQLiteStore(tmp_path / "data")
    history = AgentHistory(store)
    first = history.start(reminder())
    messages = (
        ModelRequest(
            parts=[
                SystemPromptPart(content="You are a Flowent Agent"),
                UserPromptPart(content="Process the Reminder"),
            ],
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
    second = restored.start(reminder())

    assert second.message_history == messages
    snapshot = restored.snapshot(2)
    first_run = snapshot["runs"][0]
    assert first_run["status"] == "completed"
    assert [entry["type"] for entry in first_run["entries"]] == [
        "reminder",
        "system",
        "thinking",
        "tool_call",
        "tool_result",
        "assistant",
    ]
    assert first_run["entries"][1]["content"] == "You are a Flowent Agent"
    assert "private reasoning" not in str(first_run)
    assert first_run["entries"][-1]["content"] == "Work completed"
    assert first_run["usage"] == {"input_tokens": 12}


def test_native_web_search_is_visible_and_searchable_after_compaction(
    tmp_path: Path,
) -> None:
    history = AgentHistory(SQLiteStore(tmp_path / "data"))
    first = history.start(reminder())
    first.complete(
        "completed",
        (
            ModelResponse(
                parts=[
                    NativeToolCallPart(
                        tool_name="web_search",
                        args={"query": "Flowent agent collaboration"},
                        tool_call_id="search-1",
                        provider_name="openai",
                    ),
                    NativeToolReturnPart(
                        tool_name="web_search",
                        content={
                            "status": "completed",
                            "sources": [
                                {
                                    "title": "Flowent",
                                    "url": "https://example.com/flowent",
                                }
                            ],
                        },
                        tool_call_id="search-1",
                        provider_name="openai",
                        provider_details={"private": "provider-only"},
                    ),
                    TextPart("Found the source"),
                ],
                model_name="test-model",
            ),
        ),
    )

    snapshot = history.snapshot(2)
    first_run = snapshot["runs"][0]
    assert [entry["type"] for entry in first_run["entries"]] == [
        "reminder",
        "tool_call",
        "tool_result",
        "assistant",
    ]
    assert first_run["entries"][1]["tool_name"] == "web_search"
    assert "Flowent agent collaboration" in first_run["entries"][1]["content"]
    assert "https://example.com/flowent" in first_run["entries"][2]["content"]
    assert "provider-only" not in str(first_run)

    second = history.start(reminder())
    second.complete(
        "completed",
        (
            ModelResponse(
                parts=[CompactionPart(provider_name="anthropic")],
                model_name="test-model",
            ),
        ),
    )
    searched = history.search_compacted(2, "example.com/flowent")
    turn = history.read_compacted(2, sequence=1)

    assert searched["count"] == 1
    assert searched["matches"][0]["tool_name"] == "web_search"
    assert [entry["type"] for entry in turn["entries"][:2]] == [
        "tool_call",
        "tool_result",
    ]
    assert turn["entries"][0]["paired_entry_id"] == turn["entries"][1]["entry_id"]
    assert turn["entries"][1]["paired_entry_id"] == turn["entries"][0]["entry_id"]
    assert "provider-only" not in str(turn)


def test_compacted_history_is_searchable_read_only_and_private(tmp_path: Path) -> None:
    data = tmp_path / "data"
    history = AgentHistory(SQLiteStore(data))
    first = history.start(reminder())
    archived_detail = "Archived needle detail " + "x" * 600
    first.complete(
        "completed",
        (
            ModelRequest(
                parts=[
                    SystemPromptPart(content="Private standing instruction"),
                    UserPromptPart(content="Original compacted request"),
                ]
            ),
            ModelResponse(
                parts=[
                    ThinkingPart(content="hidden compacted reasoning"),
                    ToolCallPart("run", {"argv": ["pwd"]}, "archived-call"),
                ],
                model_name="test-model",
            ),
            ModelRequest(
                parts=[
                    ToolReturnPart("run", archived_detail, "archived-call"),
                ]
            ),
            ModelResponse(
                parts=[TextPart("Original compacted response")],
                model_name="test-model",
            ),
        ),
    )
    second = history.start(reminder())
    second.complete(
        "completed",
        (
            ModelRequest(parts=[UserPromptPart(content="Create checkpoint")]),
            ModelResponse(
                parts=[
                    CompactionPart(
                        provider_name="openai",
                        provider_details={
                            "encrypted_content": "provider-private-checkpoint"
                        },
                    ),
                    TextPart("Active response after checkpoint"),
                ],
                model_name="test-model",
            ),
        ),
    )

    restored = AgentHistory(SQLiteStore(data))
    listed = restored.list_compacted(2)
    searched = restored.search_compacted(2, "needle")
    first_page = restored.search_compacted(2, "compacted", limit=1)
    second_page = restored.search_compacted(
        2,
        "compacted",
        offset=first_page["next_offset"],
        limit=1,
    )
    turn = restored.read_compacted(2, sequence=1, limit=100)
    tool_group = restored.read_compacted(2, sequence=1, offset=2, limit=1)
    entry_id = searched["matches"][0]["entry_id"]
    first_chunk = restored.read_compacted(
        2,
        entry_id=entry_id,
        max_chars=24,
    )
    second_chunk = restored.read_compacted(
        2,
        entry_id=entry_id,
        offset=first_chunk["next_offset"],
        max_chars=24,
    )

    assert [item["sequence"] for item in listed["turns"]] == [2, 1]
    assert listed["checkpoint"]["sequence"] == 2
    assert listed["checkpoint"]["provider"] == "openai"
    assert searched["count"] == 1
    assert "Archived needle detail" in searched["matches"][0]["snippet"]
    assert first_page["truncated"] is True
    assert first_page["next_offset"] == 1
    assert first_page["matches"][0]["entry_id"] != second_page["matches"][0]["entry_id"]
    assert all(entry["type"] != "thinking" for entry in turn["entries"])
    assert [entry["type"] for entry in tool_group["entries"]] == [
        "tool_call",
        "tool_result",
    ]
    assert tool_group["total_groups"] == 4
    assert {entry["tool_call_id"] for entry in tool_group["entries"]} == {
        "archived-call"
    }
    assert (
        tool_group["entries"][0]["paired_entry_id"]
        == tool_group["entries"][1]["entry_id"]
    )
    assert (
        tool_group["entries"][1]["paired_entry_id"]
        == tool_group["entries"][0]["entry_id"]
    )
    assert "hidden compacted reasoning" not in str(turn)
    assert "provider-private-checkpoint" not in str(listed)
    assert first_chunk["content"] + second_chunk["content"] == archived_detail[:48]
    assert first_chunk["truncated"] is True
    assert first_chunk["next_offset"] == 24
    assert restored.list_compacted(3) == {
        "action": "list",
        "checkpoint": None,
        "turns": [],
        "count": 0,
        "has_more": False,
    }
    with pytest.raises(DomainError, match="not found"):
        restored.read_compacted(3, entry_id=entry_id)


def test_pending_compaction_exposes_prior_turns_without_publishing_an_event(
    tmp_path: Path,
) -> None:
    events: list[dict[str, object]] = []
    history = AgentHistory(SQLiteStore(tmp_path / "data"), events.append)
    archived = history.start(reminder())
    archived.complete(
        "completed",
        (ModelRequest(parts=[UserPromptPart(content="Prior raw detail")]),),
    )
    active = history.start(reminder())
    event_count = len(events)

    active.mark_compacted("openai")
    listed = history.list_compacted(2)

    assert listed["checkpoint"]["pending"] is True
    assert listed["checkpoint"]["provider"] == "openai"
    assert [turn["sequence"] for turn in listed["turns"]] == [1]
    assert len(events) == event_count

    active.complete("failed", (), None, "Interrupted after compaction")
    assert history.list_compacted(2)["checkpoint"] is None


def test_compacted_history_rejects_ambiguous_or_unbounded_reads(
    tmp_path: Path,
) -> None:
    history = AgentHistory(SQLiteStore(tmp_path / "data"))

    with pytest.raises(DomainError, match="exactly one"):
        history.read_compacted(2)
    with pytest.raises(DomainError, match="between 1 and 50"):
        history.search_compacted(2, "query", limit=51)
    with pytest.raises(DomainError, match="at most 500"):
        history.search_compacted(2, "x" * 501)


def test_deletes_all_history_for_an_agent(tmp_path: Path) -> None:
    history = AgentHistory(SQLiteStore(tmp_path / "data"))
    run = history.start(reminder())
    run.complete("completed", ())

    history.delete(2)

    assert history.snapshot(2) == {"agent_id": 2, "runs": []}


def test_keeps_failed_interrupted_messages_in_the_next_agent_context(
    tmp_path: Path,
) -> None:
    history = AgentHistory(SQLiteStore(tmp_path / "data"))
    first = history.start(reminder())
    interrupted = ModelResponse(
        parts=[TextPart(content="Partial response")],
        model_name="test-model",
        run_id=first.run_id,
        conversation_id="agent-2",
        state="interrupted",
    )
    first.complete("failed", [interrupted], None, "Model request failed")

    second = AgentHistory(SQLiteStore(tmp_path / "data")).start(reminder())

    assert second.message_history == (interrupted,)
    failed_run = history.snapshot(2)["runs"][0]
    assert failed_run["entries"][1]["state"] == "interrupted"
    assert failed_run["entries"][-1]["type"] == "error"


def test_merges_live_text_deltas_and_publishes_ordered_events(tmp_path: Path) -> None:
    events: list[dict[str, object]] = []
    history = AgentHistory(SQLiteStore(tmp_path / "data"), events.append)
    run = history.start(reminder())

    run.emit("thinking", part_id="0-0")
    run.emit("thinking", part_id="0-0")
    run.emit("text_delta", part_id="0-1", content="Flow")
    run.emit("text_delta", part_id="0-1", content="ent")
    run.emit("tool_call", tool_name="run", content={"argv": ["pwd"]})

    active = history.snapshot(2)["runs"][0]
    assert [entry["type"] for entry in active["entries"]] == [
        "reminder",
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
