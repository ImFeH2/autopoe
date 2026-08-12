from __future__ import annotations

import json
import sys
import time
from pathlib import Path
from threading import Event

import psutil

from flowent.domain import Activation, OrganizationState
from flowent.host_tools import HostTools
from flowent.runtime import AgentRunContext, AgentRunFailure, AgentRuntime


def test_agent_tools_only_expose_message_bodies_through_read(tmp_path: Path) -> None:
    state = OrganizationState()
    state.create_agent("Ada")
    state.create_discussion("Work", 1, [2])
    state.send_message(1, 1, "private request", [2])
    context = AgentRunContext(
        agent_id=2,
        state=state,
        host_tools=HostTools(tmp_path),
    )

    projections = [
        context.organization("create_agent", name="Lin"),
        context.discussion("list"),
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

    read = context.discussion("read", discussion_id=1, message_ids=[1])
    assert read["messages"] == [
        {
            "id": 1,
            "sender_id": 1,
            "body": "private request",
            "mentions": [{"member_id": 2, "status": "read"}],
        }
    ]


class RecordingRunner:
    def __init__(self) -> None:
        self.activations: list[Activation] = []
        self.completed = Event()

    def run(self, activation: Activation, context: AgentRunContext) -> None:
        self.activations.append(activation)
        for item in activation.items:
            context.discussion(
                "read",
                discussion_id=item.discussion_id,
                message_ids=list(item.message_ids),
            )
            context.discussion(
                "send",
                discussion_id=item.discussion_id,
                body="Handled immediately",
            )
            context.discussion(
                "ack",
                discussion_id=item.discussion_id,
                message_ids=list(item.message_ids),
            )
        self.completed.set()


class ObservableState(OrganizationState):
    def __init__(self) -> None:
        super().__init__()
        self.completed = Event()
        self.error_recorded = Event()

    def complete_activation(self, agent_id: int, error: str | None = None) -> None:
        super().complete_activation(agent_id, error)
        self.completed.set()
        if error:
            self.error_recorded.set()


class ExecutingRunner:
    def __init__(self, pid_path: Path) -> None:
        self.pid_path = pid_path
        self.started = Event()
        self.finished = Event()

    def run(self, activation: Activation, context: AgentRunContext) -> None:
        del activation
        script = (
            "import os,pathlib,time; "
            f"pathlib.Path({str(self.pid_path)!r}).write_text(str(os.getpid())); "
            "time.sleep(60)"
        )
        self.started.set()
        try:
            context.exec([sys.executable, "-c", script], timeout_seconds=60)
        finally:
            self.finished.set()


class FailingRunner:
    def __init__(self) -> None:
        self.calls = 0
        self.completed = Event()

    def run(self, activation: Activation, context: AgentRunContext) -> None:
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
        state.send_message(1, 1, "Please handle this", [2])
        assert runner.completed.wait(timeout=1)
        assert state.completed.wait(timeout=1)

        snapshot = state.snapshot()
        assert runner.activations[0].items[0].message_ids == (1,)
        assert snapshot["members"][1]["status"] == "idle"
        assert snapshot["discussions"][0]["messages"] == [
            {
                "id": 1,
                "sender_id": 1,
                "body": "Please handle this",
                "mentions": [{"member_id": 2, "status": "acked"}],
            },
            {
                "id": 2,
                "sender_id": 2,
                "body": "Handled immediately",
                "mentions": [],
            },
        ]
    finally:
        runtime.stop()


def test_runtime_stop_terminates_running_exec_and_worker(tmp_path: Path) -> None:
    state = ObservableState()
    state.create_agent("Ada")
    state.create_discussion("Work", 1, [2])
    pid_path = tmp_path / "agent.pid"
    runner = ExecutingRunner(pid_path)
    runtime = AgentRuntime(state, runner, HostTools(tmp_path))
    runtime.start()
    state.send_message(1, 1, "Run a command", [2])
    assert runner.started.wait(timeout=1)
    deadline = time.monotonic() + 3
    while time.monotonic() < deadline and not pid_path.exists():
        time.sleep(0.01)
    assert pid_path.exists()
    pid = int(pid_path.read_text())

    runtime.stop()

    assert runner.finished.wait(timeout=1)
    assert not psutil.pid_exists(pid)
    assert state.member(2)["status"] == "error"


def test_runtime_can_stop_immediately_after_start(tmp_path: Path) -> None:
    for _ in range(25):
        runtime = AgentRuntime(
            OrganizationState(),
            FailingRunner(),
            HostTools(tmp_path),
        )
        runtime.start()
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
        state.send_message(1, 1, "Please handle this", [2])
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
    finally:
        runtime.stop()
