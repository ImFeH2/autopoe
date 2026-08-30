from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Literal

from huddol.core.errors import DomainError

TodoStatus = Literal["pending", "in_progress", "done"]
MAX_TITLE_LENGTH = 200


@dataclass(frozen=True)
class Todo:
    id: int
    title: str
    status: TodoStatus


def validate_title(value: object) -> str:
    if not isinstance(value, str):
        raise DomainError("invalid_title", "Todo title must be a string")
    title = " ".join(value.split())
    if not title:
        raise DomainError("invalid_title", "Todo title must not be empty")
    if len(title) > MAX_TITLE_LENGTH:
        raise DomainError(
            "invalid_title", f"Todo title must be at most {MAX_TITLE_LENGTH} characters"
        )
    return title


def in_progress(todos: Sequence[Todo]) -> Todo | None:
    for todo in todos:
        if todo.status == "in_progress":
            return todo
    return None


def validate_start(todos: Sequence[Todo], todo_id: int) -> None:
    current = in_progress(todos)
    if current is not None and current.id != todo_id:
        raise DomainError(
            "todo_already_in_progress",
            f"Todo {current.id} is already in progress; complete it first",
        )


def status_reminder(todos: Sequence[Todo]) -> str:
    if not todos:
        return ""
    open_items = [todo for todo in todos if todo.status != "done"]
    if not open_items:
        return ""
    lines = [
        f"- [{'>' if todo.status == 'in_progress' else ' '}] {todo.id}. {todo.title}"
        for todo in open_items
    ]
    return "Your current todos:\n" + "\n".join(lines)
