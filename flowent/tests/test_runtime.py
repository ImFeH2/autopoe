from __future__ import annotations

import json
import sys
import time
from pathlib import Path
from threading import Event

import psutil
import pytest
from pydantic_ai.messages import (
    CompactionPart,
    ModelRequest,
    ModelResponse,
    UserPromptPart,
)

from flowent.diagnostics import configure_diagnostics, shutdown_diagnostics
from flowent.domain import DomainError, OrganizationState, Reminder
from flowent.history import AgentHistory
from flowent.host_tools import HostTools
from flowent.memory import AgentMemory
from flowent.operations import OrganizationOperations
from flowent.persistence import SQLiteStore
from flowent.runtime import AgentRunContext, AgentRunFailure, AgentRuntime
from flowent.todos import AgentTodos


def test_agent_tools_only_expose_message_bodies_through_read(tmp_path: Path) -> None:
    state = OrganizationState()
    state.create_agent("Ada")
    state.create_discussion("Work", 1, [2])
    state.send_message(1, 1, "@Ada private request")
    context = AgentRunContext(
        agent_id=2,
        state=state,
        host_tools=HostTools(tmp_path),
    )

    projections = [
        context.organization("create_agent", name="Lin"),
        context.discussion("list"),
        context.discussion("info", discussion_id=1),
        context.discussion("search", query="private"),
        context.discussion("send", discussion_id=1, body="response metadata"),
        context.discussion("create", topic="Another", member_ids=[1]),
    ]
    serialized = json.dumps(projections)
    assert "private request" not in serialized
    assert '"body"' not in serialized
    assert state.snapshot()["discussions"][0]["messages"][0]["mentions"] == [
        {"member_id": 2, "status": "pending"}
    ]

    read = context.discussion("read", discussion_id=1, end_message_id=1)
    assert read == {
        "discussion_id": 1,
        "messages": [
            {
                "id": 1,
                "sender_id": 1,
                "body": "@Ada private request",
                "references": [
                    {
                        "member_id": 2,
                        "name": "Ada",
                        "start": 0,
                        "end": 4,
                        "in_discussion": True,
                        "notified": True,
                        "deleted": False,
                    }
                ],
                "mentions": [{"member_id": 2, "status": "read"}],
            }
        ],
        "first_message_id": 1,
        "last_message_id": 1,
        "latest_message_id": 2,
        "has_earlier": False,
        "has_later": True,
    }


def test_agent_can_manage_other_agents_and_owned_discussions(tmp_path: Path) -> None:
    store = SQLiteStore(tmp_path / "data")
    state = OrganizationState(
        tmp_path,
        persisted=store.load_organization(),
        on_persist=store.save_organization,
    )
    state.create_agent("Ada")
    state.create_agent("Lin")
    state.create_discussion("Ada work", 1, [2])
    state.create_discussion("Lin work", 1, [3])
    history = AgentHistory(store)
    todos = AgentTodos(store)
    memories = AgentMemory(tmp_path / "data")
    todos.create(3, "Lin work")
    memories.write(3, "MEMORY.md", "Lin private Memory")
    operations = OrganizationOperations(state, history, todos, memories)
    context = AgentRunContext(
        2,
        state,
        HostTools(tmp_path),
        operations=operations,
    )

    assert context.organization("pause_agent", agent_id=3)["status"] == "paused"
    assert context.organization("resume_agent", agent_id=3)["status"] == "idle"
    assert context.discussion("delete", discussion_id=1) == {
        "discussion_id": 1,
        "deleted": True,
    }
    with pytest.raises(DomainError, match="Only Discussion Members"):
        context.discussion("delete", discussion_id=2)
    with pytest.raises(DomainError, match="cannot delete itself"):
        context.organization("delete_agent", agent_id=2)

    assert context.organization("delete_agent", agent_id=3) == {
        "agent_id": 3,
        "deleted": True,
    }
    assert todos.list(3)["todos"] == []
    assert memories.list(3)["paths"] == []


def test_agent_edit_tool_replaces_exact_file_content(tmp_path: Path) -> None:
    target = tmp_path / "source.txt"
    target.write_text("before\n")
    context = AgentRunContext(2, OrganizationState(), HostTools(tmp_path))

    result = context.edit("source.txt", "before", "after")

    assert result == {
        "edited": True,
        "path": "source.txt",
        "replacement_count": 1,
    }
    assert target.read_text() == "after\n"


def test_agent_todo_tool_updates_the_runtime_status_bar(tmp_path: Path) -> None:
    store = SQLiteStore(tmp_path / "data")
    state = OrganizationState(
        tmp_path,
        persisted=store.load_organization(),
        on_persist=store.save_organization,
    )
    state.create_agent("Ada")
    context = AgentRunContext(
        2,
        state,
        HostTools(tmp_path),
        todos=AgentTodos(store),
    )

    created = context.todo(
        "create",
        subject="Inspect failure",
        description="Find the root cause",
    )
    assert created["todo"]["status"] == "pending"
    assert "#1 Inspect failure" in context.todo_status_reminder()

    context.todo("start", todo_id=1)
    wrapped = context.model_tool_result({"ok": True})
    assert wrapped["result"] == {"ok": True}
    assert "Current: #1 Inspect failure" in wrapped["todo_status"]

    context.todo("complete", todo_id=1)
    assert context.todo_status_reminder() is None
    assert context.model_tool_result({"ok": True}) == {"ok": True}


def test_agent_memory_tool_is_private_and_exposes_current_index(tmp_path: Path) -> None:
    memories = AgentMemory(tmp_path / "data")
    context = AgentRunContext(
        2,
        OrganizationState(),
        HostTools(tmp_path),
        memories=memories,
    )

    assert (
        context.memory(
            "write",
            path="MEMORY.md",
            content="# Index\n- Read patterns.md\n",
        )["path"]
        == "MEMORY.md"
    )
    assert (
        context.memory(
            "write",
            path="patterns.md",
            content="Private insight",
        )["path"]
        == "patterns.md"
    )
    assert context.memory("list") == {
        "paths": ["MEMORY.md", "patterns.md"],
        "count": 2,
    }
    assert context.memory("read", path="patterns.md")["content"] == ("Private insight")
    assert "Read patterns.md" in context.memory_index_context()
    assert memories.list(3) == {"paths": [], "count": 0}


def test_agent_history_tool_only_reads_its_own_compacted_context(
    tmp_path: Path,
) -> None:
    history = AgentHistory(SQLiteStore(tmp_path / "data"))
    for agent_id, content in (
        (2, "Ada private archived detail"),
        (3, "Lin other-agent archived detail"),
    ):
        archived = history.start(Reminder(agent_id, ()))
        archived.complete(
            "completed",
            (ModelRequest(parts=[UserPromptPart(content=content)]),),
        )
        checkpoint = history.start(Reminder(agent_id, ()))
        checkpoint.complete(
            "completed",
            (
                ModelResponse(
                    parts=[CompactionPart(content="checkpoint")],
                    model_name="test-model",
                ),
            ),
        )
    context = AgentRunContext(
        2,
        OrganizationState(),
        HostTools(tmp_path),
        history_store=history,
    )

    own = context.history("search", query="Ada private")
    other = context.history("search", query="other-agent")

    assert own["count"] == 1
    assert "Ada private archived detail" in own["matches"][0]["snippet"]
    assert other["count"] == 0


def test_agent_discussion_send_derives_mentions_from_body(tmp_path: Path) -> None:
    state = OrganizationState()
    state.create_agent("Ada")
    state.create_agent("Lin")
    state.create_discussion("Work", 1, [2, 3])
    context = AgentRunContext(2, state, HostTools(tmp_path))

    result = context.discussion("send", discussion_id=1, body="@Lin please review")

    assert result == {
        "discussion_id": 1,
        "message_id": 1,
        "mentioned_agent_ids": [3],
    }
    assert state.snapshot()["discussions"][0]["messages"][0]["mentions"] == [
        {"member_id": 3, "status": "pending"}
    ]


def test_agent_discussion_tools_are_restricted_to_members(tmp_path: Path) -> None:
    state = OrganizationState()
    state.create_agent("Ada")
    state.create_agent("Lin")
    state.create_discussion("Ada work", 1, [2])
    state.create_discussion("Lin work", 1, [3])
    state.send_message(1, 1, "Ada context")
    state.send_message(2, 1, "Lin private context")
    context = AgentRunContext(2, state, HostTools(tmp_path))

    assert context.discussion("list") == [{"id": 1, "topic": "Ada work"}]
    assert context.discussion("search", query="context") == [
        {"discussion_id": 1, "message_id": 1, "sender_id": 1}
    ]
    with pytest.raises(DomainError, match="Only Discussion Members"):
        context.discussion("info", discussion_id=2)
    with pytest.raises(DomainError, match="Only Discussion Members"):
        context.discussion("read", discussion_id=2)
    with pytest.raises(DomainError, match="Only Discussion Members"):
        context.discussion("search", discussion_id=2, query="private")


class RecordingRunner:
    def __init__(self) -> None:
        self.activations: list[Reminder] = []
        self.completed = Event()

    def run(self, activation: Reminder, context: AgentRunContext) -> None:
        self.activations.append(activation)
        context.discussion(
            "read",
            discussion_id=activation.mentions[0].discussion_id,
            end_message_id=activation.mentions[0].message_id,
        )
        context.discussion(
            "send",
            discussion_id=activation.mentions[0].discussion_id,
            body="Handled immediately",
        )
        context.discussion(
            "ack",
            discussion_id=activation.mentions[0].discussion_id,
            message_ids=[activation.mentions[0].message_id],
        )
        self.completed.set()


class FollowUpRunner:
    def __init__(self) -> None:
        self.activations: list[Reminder] = []
        self.started = Event()
        self.release = Event()
        self.followed_up = Event()

    def run(self, activation: Reminder, context: AgentRunContext) -> None:
        self.activations.append(activation)
        if len(self.activations) == 1:
            self.started.set()
            self.release.wait(timeout=1)
        context.discussion(
            "read",
            discussion_id=activation.mentions[0].discussion_id,
            end_message_id=activation.mentions[0].message_id,
        )
        context.discussion(
            "ack",
            discussion_id=activation.mentions[0].discussion_id,
            message_ids=[activation.mentions[0].message_id],
        )
        if len(self.activations) == 2:
            self.followed_up.set()


def test_runtime_starts_a_follow_up_turn_for_a_new_mention(tmp_path: Path) -> None:
    state = OrganizationState()
    state.create_agent("Ada")
    state.create_discussion("Work", 1, [2])
    runner = FollowUpRunner()
    runtime = AgentRuntime(state, runner, HostTools(tmp_path))
    runtime.start()

    try:
        state.send_message(1, 1, "@Ada First")
        assert runner.started.wait(timeout=1)
        state.send_message(1, 1, "@Ada Second")
        runner.release.set()

        assert runner.followed_up.wait(timeout=1)
        assert [
            activation.mentions[0].message_id for activation in runner.activations
        ] == [1, 2]
    finally:
        runtime.stop()


def test_runtime_finishes_current_turn_before_pausing(tmp_path: Path) -> None:
    state = OrganizationState()
    state.create_agent("Ada")
    state.create_discussion("Work", 1, [2])
    runner = FollowUpRunner()
    runtime = AgentRuntime(state, runner, HostTools(tmp_path))
    runtime.start()

    try:
        state.send_message(1, 1, "@Ada First")
        assert runner.started.wait(timeout=1)
        assert state.pause_agent(2)["members"][1]["status"] == "pausing"
        state.send_message(1, 1, "@Ada Second")
        runner.release.set()

        deadline = time.monotonic() + 1
        while time.monotonic() < deadline:
            if state.member(2)["status"] == "paused":
                break
            time.sleep(0.01)
        assert state.member(2)["status"] == "paused"
        assert not runner.followed_up.wait(timeout=0.1)

        assert state.resume_agent(2)["members"][1]["status"] == "idle"
        assert runner.followed_up.wait(timeout=1)
        assert [
            activation.mentions[0].message_id for activation in runner.activations
        ] == [1, 2]
    finally:
        runtime.stop()


class UnproductiveRunner:
    def __init__(self) -> None:
        self.calls = 0
        self.stopped = Event()

    def run(self, reminder: Reminder, context: AgentRunContext) -> None:
        del reminder, context
        self.calls += 1
        if self.calls == 3:
            self.stopped.set()


def test_runtime_stops_after_three_turns_without_ack(tmp_path: Path) -> None:
    state = OrganizationState()
    state.create_agent("Ada")
    state.create_discussion("Work", 1, [2])
    runner = UnproductiveRunner()
    runtime = AgentRuntime(state, runner, HostTools(tmp_path))
    runtime.start()

    try:
        state.send_message(1, 1, "@Ada Pending")
        assert runner.stopped.wait(timeout=1)
        assert runner.calls == 3
        assert state.member(2)["status"] == "error"
    finally:
        runtime.stop()


class ObservableState(OrganizationState):
    def __init__(self) -> None:
        super().__init__()
        self.completed = Event()
        self.error_recorded = Event()

    def complete_turn(self, agent_id: int, error: str | None = None) -> None:
        super().complete_turn(agent_id, error)
        self.completed.set()
        if error:
            self.error_recorded.set()


class ExecutingRunner:
    def __init__(self, pid_path: Path) -> None:
        self.pid_path = pid_path
        self.started = Event()
        self.finished = Event()

    def run(self, activation: Reminder, context: AgentRunContext) -> None:
        del activation
        script = (
            "import os,pathlib,time; "
            f"pathlib.Path({str(self.pid_path)!r}).write_text(str(os.getpid())); "
            "time.sleep(60)"
        )
        self.started.set()
        try:
            context.run([sys.executable, "-c", script], timeout_seconds=60)
        finally:
            self.finished.set()


class AckThenFailRunner:
    def __init__(self) -> None:
        self.completed = Event()

    def run(self, activation: Reminder, context: AgentRunContext) -> None:
        context.discussion(
            "read",
            discussion_id=activation.mentions[0].discussion_id,
            end_message_id=activation.mentions[0].message_id,
        )
        context.discussion(
            "ack",
            discussion_id=activation.mentions[0].discussion_id,
            message_ids=[activation.mentions[0].message_id],
        )
        self.completed.set()
        raise AgentRunFailure("Late model failure")


class FailingRunner:
    def __init__(self) -> None:
        self.calls = 0
        self.completed = Event()

    def run(self, activation: Reminder, context: AgentRunContext) -> None:
        del activation, context
        self.calls += 1
        self.completed.set()
        raise AgentRunFailure("Model request failed")


def test_runtime_wakes_immediately_and_completes_discussion_flow(
    tmp_path: Path,
) -> None:
    state = ObservableState()
    state.create_agent("Ada")
    state.create_discussion("Work", 1, [2])
    runner = RecordingRunner()
    runtime = AgentRuntime(state, runner, HostTools(tmp_path))
    runtime.start()

    try:
        state.send_message(1, 1, "@Ada Please handle this")
        assert runner.completed.wait(timeout=1)
        assert state.completed.wait(timeout=1)

        snapshot = state.snapshot()
        assert runner.activations[0].mentions[0].message_id == 1
        assert snapshot["members"][1]["status"] == "idle"
        assert snapshot["discussions"][0]["messages"] == [
            {
                "id": 1,
                "sender_id": 1,
                "body": "@Ada Please handle this",
                "references": [
                    {
                        "member_id": 2,
                        "name": "Ada",
                        "start": 0,
                        "end": 4,
                        "in_discussion": True,
                        "notified": True,
                        "deleted": False,
                    }
                ],
                "mentions": [{"member_id": 2, "status": "acked"}],
            },
            {
                "id": 2,
                "sender_id": 2,
                "body": "Handled immediately",
                "references": [],
                "mentions": [],
            },
        ]
    finally:
        runtime.stop()


def test_runtime_stop_terminates_running_exec_and_worker(tmp_path: Path) -> None:
    log_path = configure_diagnostics(tmp_path / "data")
    assert log_path is not None
    state = ObservableState()
    state.create_agent("Ada")
    state.create_discussion("Work", 1, [2])
    pid_path = tmp_path / "agent.pid"
    runner = ExecutingRunner(pid_path)
    runtime = AgentRuntime(state, runner, HostTools(tmp_path))
    runtime.start()
    state.send_message(1, 1, "@Ada Run a command")
    assert runner.started.wait(timeout=1)
    deadline = time.monotonic() + 3
    while time.monotonic() < deadline and not pid_path.exists():
        time.sleep(0.01)
    assert pid_path.exists()
    pid = int(pid_path.read_text())

    runtime.stop(reason="stdin_eof")
    shutdown_diagnostics()

    assert runner.finished.wait(timeout=1)
    assert not psutil.pid_exists(pid)
    assert state.member(2)["status"] == "error"
    records = [json.loads(line) for line in log_path.read_text().splitlines()]
    started = next(
        record for record in records if record["event"] == "scheduler.stop.started"
    )
    completed = next(
        record for record in records if record["event"] == "scheduler.stop.completed"
    )
    turn_failed = next(
        record for record in records if record["event"] == "agent.turn.failed"
    )
    assert started["reason"] == "stdin_eof"
    assert started["worker_count"] == 1
    assert started["active_agent_ids"] == [2]
    assert len(started["active_turn_ids"]) == 0
    assert completed["reason"] == "stdin_eof"
    assert completed["worker_count"] == 0
    assert completed["duration_ms"] >= 0
    assert turn_failed["failure_reason"] == "runtime_stopped"


def test_runtime_can_stop_immediately_after_start(tmp_path: Path) -> None:
    for _ in range(25):
        runtime = AgentRuntime(
            OrganizationState(),
            FailingRunner(),
            HostTools(tmp_path),
        )
        runtime.start()
        runtime.stop()


def test_runtime_records_late_failure_after_ack(tmp_path: Path) -> None:
    state = ObservableState()
    state.create_agent("Ada")
    state.create_discussion("Work", 1, [2])
    runner = AckThenFailRunner()
    runtime = AgentRuntime(state, runner, HostTools(tmp_path))
    runtime.start()

    try:
        state.send_message(1, 1, "@Ada Complete before failing")
        assert runner.completed.wait(timeout=1)
        assert state.completed.wait(timeout=1)
        assert state.member(2) == {
            "id": 2,
            "type": "agent",
            "name": "Ada",
            "status": "error",
            "error": "Late model failure",
        }
        assert state.claim_next_reminder()[0] is None
    finally:
        runtime.stop()


def test_known_runner_failure_sets_error_without_immediate_retry(
    tmp_path: Path,
) -> None:
    state = ObservableState()
    state.create_agent("Ada")
    state.create_discussion("Work", 1, [2])
    runner = FailingRunner()
    runtime = AgentRuntime(state, runner, HostTools(tmp_path))
    runtime.start()

    try:
        state.send_message(1, 1, "@Ada Please handle this")
        assert runner.completed.wait(timeout=1)
        assert state.error_recorded.wait(timeout=1)
        assert state.member(2) == {
            "id": 2,
            "type": "agent",
            "name": "Ada",
            "status": "error",
            "error": "Model request failed",
        }
        assert runner.calls == 1
        assert state.snapshot()["discussions"][0]["messages"][0]["mentions"] == [
            {"member_id": 2, "status": "read"}
        ]
    finally:
        runtime.stop()
