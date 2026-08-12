from __future__ import annotations

import json
from threading import Event

from flowent.domain import Activation, OrganizationState
from flowent.runtime import AgentRunContext, AgentRunFailure, AgentRuntime


def test_agent_tools_only_expose_message_bodies_through_read() -> None:
    state = OrganizationState()
    state.create_agent("Ada")
    state.create_discussion("Work", 1, [2])
    state.send_message(1, 1, "private request", [2])
    context = AgentRunContext(agent_id=2, state=state)

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


class FailingRunner:
    def __init__(self) -> None:
        self.calls = 0
        self.completed = Event()

    def run(self, activation: Activation, context: AgentRunContext) -> None:
        del activation, context
        self.calls += 1
        self.completed.set()
        raise AgentRunFailure("Model request failed")


def test_runtime_wakes_immediately_and_completes_discussion_flow() -> None:
    state = ObservableState()
    state.create_agent("Ada")
    state.create_discussion("Work", 1, [2])
    runner = RecordingRunner()
    runtime = AgentRuntime(state, runner)
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


def test_known_runner_failure_sets_error_without_immediate_retry() -> None:
    state = ObservableState()
    state.create_agent("Ada")
    state.create_discussion("Work", 1, [2])
    runner = FailingRunner()
    runtime = AgentRuntime(state, runner)
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
