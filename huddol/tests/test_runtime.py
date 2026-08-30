from __future__ import annotations

import json
from pathlib import Path

import pytest

from huddol.adapters.files.tree import MarkdownTree
from huddol.adapters.sandbox.native import NativeSandbox
from huddol.adapters.sqlite.agent import SqliteAgentStore
from huddol.adapters.sqlite.store import SqliteStore
from huddol.runtime.reminder import TurnOutcome, TurnRequest, build_reminder
from huddol.runtime.scheduler import Scheduler
from huddol.tools import AgentTools, Dependencies

HUMAN = 1
MAIN = 2
HELPER = 3


class RecordingRunner:
    def __init__(self, behaviour=None) -> None:
        self.requests: list[TurnRequest] = []
        self._behaviour = behaviour

    def run(self, request: TurnRequest, tools: AgentTools) -> TurnOutcome:
        self.requests.append(request)
        if self._behaviour is not None:
            return self._behaviour(request, tools)
        return TurnOutcome(messages_json=json.dumps([{"kind": "response"}]))


@pytest.fixture
def world(tmp_path: Path):
    store = SqliteStore(tmp_path / "huddol.sqlite3")
    agent_store = SqliteAgentStore(store._db)
    store.create_member("human", "You")
    store.create_member("agent", "Main")
    store.create_member("agent", "Helper")
    deps = Dependencies(
        store=store,
        todos=agent_store,
        history=agent_store,
        settings=agent_store,
        sandbox=NativeSandbox(tmp_path, [str(tmp_path)], enforce=False),
        library_tree=MarkdownTree(tmp_path / "library"),
        memory_tree_for=lambda member_id: MarkdownTree(
            tmp_path / "agents" / str(member_id) / "memory"
        ),
    )
    yield deps
    store.close()


def mention(deps: Dependencies, body: str = "@Main please help") -> int:
    room = deps.store.create_discussion("work", [HUMAN, MAIN])
    deps.store.append_message(room.id, HUMAN, body)
    return room.id


def test_reminder_never_contains_the_message_body(world) -> None:
    mention(world, "@Main the secret passphrase is hunter2")
    reminder = build_reminder(world.store, world.history, MAIN, "Main")
    assert reminder is not None
    rendered = reminder.render()
    assert "hunter2" not in rendered
    assert "secret passphrase" not in rendered
    assert "Discussion 1" in rendered
    assert "Message 1" in rendered
    assert "discussion action=read" in rendered


def test_reminder_names_the_topic_and_sender(world) -> None:
    mention(world)
    reminder = build_reminder(world.store, world.history, MAIN, "Main")
    assert reminder is not None
    assert reminder.items[0].topic == "work"
    assert reminder.items[0].sender_name == "You"


def test_no_reminder_without_pending_mentions(world) -> None:
    assert build_reminder(world.store, world.history, MAIN, "Main") is None


def test_turn_records_history_and_returns_to_idle(world) -> None:
    mention(world)
    runner = RecordingRunner()
    scheduler = Scheduler(world, runner)
    record = scheduler.run_turn(MAIN)
    assert record is not None
    assert record.status == "completed"
    assert world.store.get_member(MAIN).state == "idle"
    assert world.history.latest_messages(MAIN) == json.dumps([{"kind": "response"}])


def test_runtime_context_is_not_persisted_into_history(world) -> None:
    mention(world)
    runner = RecordingRunner()
    Scheduler(world, runner).run_turn(MAIN)
    assert "You can only write inside" in runner.requests[0].runtime_context
    assert "You can only write inside" not in world.history.latest_messages(MAIN)


def test_runtime_context_carries_memory_and_todo_state(world) -> None:
    mention(world)
    MarkdownTree(world.memory_tree_for(MAIN).root).write(
        "MEMORY.md", "- prior knowledge"
    )
    world.todos.add_todo(MAIN, "unfinished work", "detail")
    runner = RecordingRunner()
    Scheduler(world, runner).run_turn(MAIN)
    context = runner.requests[0].runtime_context
    assert "prior knowledge" in context
    assert "unfinished work" in context


def test_a_failing_turn_is_recorded_and_the_agent_recovers(world) -> None:
    mention(world)

    def explode(request, tools):
        raise RuntimeError("model exploded")

    scheduler = Scheduler(world, RecordingRunner(explode))
    record = scheduler.run_turn(MAIN)
    assert record is not None
    assert record.status == "failed"
    assert "model exploded" in (record.error or "")
    assert world.store.get_member(MAIN).state == "idle"


def test_paused_agents_are_not_runnable(world) -> None:
    mention(world)
    world.store.set_agent_state(MAIN, "paused")
    scheduler = Scheduler(world, RecordingRunner())
    assert scheduler.runnable_agents() == ()
    assert scheduler.run_turn(MAIN) is None


def test_only_agents_with_pending_work_are_runnable(world) -> None:
    mention(world)
    scheduler = Scheduler(world, RecordingRunner())
    assert scheduler.runnable_agents() == (MAIN,)


def test_acking_inside_the_turn_stops_the_next_one(world) -> None:
    room = mention(world)

    def handle(request, tools):
        tools.read_discussion(room, message_id=1)
        tools.ack(room, [1])
        return TurnOutcome(messages_json="[]")

    scheduler = Scheduler(world, RecordingRunner(handle))
    scheduler.run_turn(MAIN)
    assert scheduler.runnable_agents() == ()


def test_an_agent_can_wake_another_by_mentioning_it(world) -> None:
    room = mention(world)
    world.store.set_discussion_members(room, [HUMAN, MAIN, HELPER])

    def handle(request, tools):
        tools.read_discussion(room, message_id=1)
        tools.send_message(room, "@Helper your turn")
        tools.ack(room, [1])
        return TurnOutcome(messages_json="[]")

    scheduler = Scheduler(world, RecordingRunner(handle))
    scheduler.run_turn(MAIN)
    assert scheduler.runnable_agents() == (HELPER,)


def test_events_are_emitted_around_a_turn(world) -> None:
    mention(world)
    seen: list[str] = []
    scheduler = Scheduler(
        world, RecordingRunner(), on_event=lambda name, payload: seen.append(name)
    )
    scheduler.run_turn(MAIN)
    assert seen == ["turn.started", "turn.finished"]


def test_previously_reminded_is_flagged_on_the_second_turn(world) -> None:
    mention(world)
    scheduler = Scheduler(world, RecordingRunner())
    first = build_reminder(world.store, world.history, MAIN, "Main")
    assert first is not None
    assert first.items[0].previously_reminded is False

    scheduler.run_turn(MAIN)
    second = build_reminder(world.store, world.history, MAIN, "Main")
    assert second is not None
    assert second.items[0].previously_reminded is True
    assert "still waiting" in second.render()
