from __future__ import annotations

from pathlib import Path

import pytest

from huddol.adapters.sqlite.agent import SqliteAgentStore
from huddol.adapters.sqlite.store import SqliteStore
from huddol.core.errors import DomainError
from huddol.services.history import History
from huddol.services.todo import Todos

AGENT = 13


@pytest.fixture
def agent_store(tmp_path: Path) -> SqliteAgentStore:
    base = SqliteStore(tmp_path / "huddol.sqlite3")
    yield SqliteAgentStore(base._db)
    base.close()


@pytest.fixture
def todos(agent_store: SqliteAgentStore) -> Todos:
    return Todos(agent_store, AGENT)


def test_at_most_one_todo_may_be_in_progress(todos: Todos) -> None:
    first = todos.add("write the store")
    second = todos.add("write the runtime")
    todos.start(first.id)

    with pytest.raises(DomainError) as error:
        todos.start(second.id)
    assert error.value.code == "todo_already_in_progress"

    todos.complete(first.id)
    assert todos.start(second.id).status == "in_progress"


def test_starting_the_same_todo_twice_is_allowed(todos: Todos) -> None:
    item = todos.add("keep going")
    todos.start(item.id)
    assert todos.start(item.id).status == "in_progress"


def test_titles_are_normalized_and_validated(todos: Todos) -> None:
    assert todos.add("  spaced   out  ").title == "spaced out"
    with pytest.raises(DomainError):
        todos.add("   ")


def test_reminder_lists_open_items_and_marks_the_active_one(todos: Todos) -> None:
    first = todos.add("alpha")
    todos.add("beta")
    todos.start(first.id)
    reminder = todos.reminder()
    assert "[>] 1. alpha" in reminder
    assert "[ ] 2. beta" in reminder


def test_reminder_is_empty_when_everything_is_done(todos: Todos) -> None:
    item = todos.add("only")
    todos.complete(item.id)
    assert todos.reminder() == ""


def test_todos_are_private_to_each_agent(agent_store: SqliteAgentStore) -> None:
    Todos(agent_store, 13).add("mine")
    assert Todos(agent_store, 36).list() == ()


def test_runs_append_and_report_the_latest_history(
    agent_store: SqliteAgentStore,
) -> None:
    first = agent_store.start_run(AGENT)
    agent_store.finish_run(
        AGENT, first.sequence, status="completed", messages_json='[{"kind":"request"}]'
    )
    second = agent_store.start_run(AGENT)
    assert second.sequence == 2
    assert agent_store.latest_messages(AGENT) == '[{"kind":"request"}]'


def test_unfinished_runs_are_marked_interrupted(agent_store: SqliteAgentStore) -> None:
    agent_store.start_run(AGENT)
    assert agent_store.mark_interrupted() == 1
    assert agent_store.runs(AGENT)[0].status == "interrupted"


def test_history_search_finds_runs_by_content(agent_store: SqliteAgentStore) -> None:
    run = agent_store.start_run(AGENT)
    agent_store.finish_run(
        AGENT, run.sequence, status="completed", messages_json='[{"text":"bubblewrap"}]'
    )
    history = History(agent_store, AGENT)
    assert len(history.search("bubblewrap")) == 1
    assert history.search("nothing") == ()


def test_settings_round_trip_and_write_directories(
    agent_store: SqliteAgentStore,
) -> None:
    agent_store.set_settings("model", {"model": "claude-opus-5", "compaction": 200})
    assert agent_store.get_settings("model") == {
        "model": "claude-opus-5",
        "compaction": 200,
    }
    assert agent_store.get_settings("missing") is None

    agent_store.set_write_directories(["/project/huddol", "/tmp", "/project/huddol"])
    assert agent_store.write_directories() == ("/project/huddol", "/tmp")
