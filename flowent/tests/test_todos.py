from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest

from flowent.domain import DomainError, OrganizationState
from flowent.persistence import SQLiteStore
from flowent.todos import TODO_STATUS_END, TODO_STATUS_START, AgentTodos


def todo_setup(tmp_path: Path) -> tuple[SQLiteStore, OrganizationState, AgentTodos]:
    store = SQLiteStore(tmp_path / "data")
    state = OrganizationState(
        tmp_path,
        persisted=store.load_organization(),
        on_persist=store.save_organization,
    )
    state.create_agent("Ada")
    return store, state, AgentTodos(store)


def test_maintains_one_current_todo_and_completed_history(tmp_path: Path) -> None:
    _store, _state, todos = todo_setup(tmp_path)

    first = todos.create(2, "  Inspect   persistence  ", "Find the failure")["todo"]
    second = todos.create(2, "Add regression test")["todo"]
    assert first["id"] == 1
    assert first["subject"] == "Inspect persistence"
    assert first["status"] == "pending"
    assert second["id"] == 2

    started = todos.start(2, 1)["todo"]
    assert started["status"] == "in_progress"
    with pytest.raises(DomainError, match="Todo 1 is already in progress"):
        todos.start(2, 2)

    updated = todos.update(2, 1, description="Root cause found")["todo"]
    assert updated["subject"] == "Inspect persistence"
    assert updated["description"] == "Root cause found"

    completed = todos.complete(2, 1)["todo"]
    assert completed["status"] == "completed"
    assert completed["completed_at"] is not None
    assert todos.start(2, 2)["todo"]["status"] == "in_progress"
    assert todos.list(2, "completed")["todos"] == [completed]
    assert [item["id"] for item in todos.list(2)["todos"]] == [2]

    assert todos.delete(2, 1) == {"deleted_todo_id": 1}
    assert todos.create(2, "Later work")["todo"]["id"] == 3
    with pytest.raises(DomainError, match="Todo not found"):
        todos.read(2, 1)


def test_status_reminder_is_bounded_and_omits_descriptions(tmp_path: Path) -> None:
    _store, _state, todos = todo_setup(tmp_path)
    for index in range(1, 11):
        todos.create(2, f"Task {index}", f"private description {index}")
    todos.start(2, 1)

    reminder = todos.status_reminder(2)

    assert reminder is not None
    assert reminder.startswith(TODO_STATUS_START)
    assert reminder.endswith(TODO_STATUS_END)
    assert "Current: #1 Task 1" in reminder
    assert "#2 Task 2" in reminder
    assert "#9 Task 9" in reminder
    assert "#10 Task 10" not in reminder
    assert "+1 more" in reminder
    assert "private description" not in reminder


def test_todos_survive_restart_and_organization_rewrites(tmp_path: Path) -> None:
    store, state, todos = todo_setup(tmp_path)
    todos.create(2, "Persistent work", "Continue after restart")
    todos.start(2, 1)

    state.create_agent("Lin")
    state.create_discussion("Work", 1, [2])
    state.send_message(1, 1, "Organization rewrite")

    restored_store = SQLiteStore(store.directory)
    restored = AgentTodos(restored_store)

    todo = restored.read(2, 1)["todo"]
    assert todo["subject"] == "Persistent work"
    assert todo["description"] == "Continue after restart"
    assert todo["status"] == "in_progress"


def test_rejects_invalid_todo_content_and_transitions(tmp_path: Path) -> None:
    _store, _state, todos = todo_setup(tmp_path)

    with pytest.raises(DomainError, match="subject is required"):
        todos.create(2, " \n ")
    with pytest.raises(DomainError, match="cannot exceed 160"):
        todos.create(2, "x" * 161)
    with pytest.raises(DomainError, match="cannot exceed 4000"):
        todos.create(2, "Valid", "x" * 4001)
    with pytest.raises(DomainError, match="positive integer"):
        todos.read(2, 0)

    todos.create(2, "Done")
    todos.complete(2, 1)
    with pytest.raises(DomainError, match="Completed Todos cannot be started"):
        todos.start(2, 1)
    with pytest.raises(DomainError, match="subject or description is required"):
        todos.update(2, 1)


def test_store_startup_removes_todos_left_by_interrupted_agent_deletion(
    tmp_path: Path,
) -> None:
    store, state, todos = todo_setup(tmp_path)
    todos.create(2, "Orphaned work")

    state.delete_agent(2)
    assert store.load_todo(2, 1) is not None

    restored = SQLiteStore(store.directory)
    assert restored.load_todos(2) == []
    connection = sqlite3.connect(restored.path)
    assert (
        connection.execute(
            "SELECT COUNT(*) FROM agent_todo_sequences WHERE agent_id = 2"
        ).fetchone()[0]
        == 0
    )
    connection.close()


def test_todos_are_isolated_by_agent(tmp_path: Path) -> None:
    store, state, todos = todo_setup(tmp_path)
    state.create_agent("Lin")

    todos.create(2, "Ada work")
    todos.create(3, "Lin work")

    assert [item["subject"] for item in todos.list(2)["todos"]] == ["Ada work"]
    assert [item["subject"] for item in todos.list(3)["todos"]] == ["Lin work"]
    assert "Lin work" not in todos.status_reminder(2)
    assert "Ada work" not in todos.status_reminder(3)
    assert store.load_todo(2, 1)["subject"] == "Ada work"
    assert store.load_todo(3, 1)["subject"] == "Lin work"


def test_completed_todos_do_not_produce_a_status_reminder(tmp_path: Path) -> None:
    _store, _state, todos = todo_setup(tmp_path)
    todos.create(2, "Done")
    todos.complete(2, 1)

    assert todos.status_reminder(2) is None


def test_todo_pages_use_stable_status_specific_id_cursors(tmp_path: Path) -> None:
    _store, _state, todos = todo_setup(tmp_path)
    for index in range(1, 7):
        todos.create(2, f"Task {index}")
    for todo_id in (2, 4, 6):
        todos.complete(2, todo_id)

    pending_first = todos.list_page(2, "pending", limit=2)
    pending_second = todos.list_page(
        2, "pending", limit=2, cursor=pending_first["next_cursor"]
    )
    completed_first = todos.list_page(2, "completed", limit=2)
    completed_second = todos.list_page(
        2, "completed", limit=2, cursor=completed_first["next_cursor"]
    )

    assert [todo["id"] for todo in pending_first["todos"]] == [1, 3]
    assert pending_first["next_cursor"] == 3
    assert [todo["id"] for todo in pending_second["todos"]] == [5]
    assert pending_second["has_more"] is False
    assert [todo["id"] for todo in completed_first["todos"]] == [6, 4]
    assert completed_first["next_cursor"] == 4
    assert [todo["id"] for todo in completed_second["todos"]] == [2]


def test_todo_page_rejects_invalid_limits_and_cursors(tmp_path: Path) -> None:
    _store, _state, todos = todo_setup(tmp_path)

    with pytest.raises(DomainError, match="Todo status is invalid"):
        todos.list_page(2, "unknown")  # type: ignore[arg-type]
    with pytest.raises(DomainError, match="Todo limit"):
        todos.list_page(2, "pending", limit=0)
    with pytest.raises(DomainError, match="Todo cursor"):
        todos.list_page(2, "pending", cursor=0)
