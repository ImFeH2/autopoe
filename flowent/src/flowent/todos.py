from __future__ import annotations

from datetime import UTC, datetime
from threading import Lock
from typing import Any, Literal, Protocol

from flowent.domain import DomainError

TodoStatus = Literal["pending", "in_progress", "completed"]
MAX_ACTIVE_TODOS = 100
MAX_SUBJECT_LENGTH = 160
MAX_DESCRIPTION_LENGTH = 4000
STATUS_PENDING_LIMIT = 8
TODO_STATUS_START = "<todo_status>"
TODO_STATUS_END = "</todo_status>"
TODO_RESULT_KEY = "result"
TODO_STATUS_KEY = "todo_status"


class AgentTodoRepository(Protocol):
    def create_todo(
        self,
        agent_id: int,
        subject: str,
        description: str,
        created_at: str,
    ) -> dict[str, Any]: ...

    def load_todos(
        self,
        agent_id: int,
        status: TodoStatus | None = None,
    ) -> list[dict[str, Any]]: ...

    def load_todo(self, agent_id: int, todo_id: int) -> dict[str, Any] | None: ...

    def update_todo(
        self,
        agent_id: int,
        todo_id: int,
        subject: str,
        description: str,
        updated_at: str,
    ) -> None: ...

    def set_todo_status(
        self,
        agent_id: int,
        todo_id: int,
        status: TodoStatus,
        updated_at: str,
        completed_at: str | None,
    ) -> None: ...

    def delete_todo(self, agent_id: int, todo_id: int) -> None: ...

    def delete_agent_todos(self, agent_id: int) -> None: ...


class AgentTodos:
    def __init__(self, repository: AgentTodoRepository) -> None:
        self._repository = repository
        self._lock = Lock()

    def create(
        self,
        agent_id: int,
        subject: str,
        description: str = "",
    ) -> dict[str, Any]:
        normalized_subject = self._subject(subject)
        normalized_description = self._description(description)
        with self._lock:
            active_count = len(self._repository.load_todos(agent_id, "pending")) + len(
                self._repository.load_todos(agent_id, "in_progress")
            )
            if active_count >= MAX_ACTIVE_TODOS:
                raise DomainError(
                    "todo_limit",
                    f"An Agent can have at most {MAX_ACTIVE_TODOS} unfinished Todos",
                )
            todo = self._repository.create_todo(
                agent_id,
                normalized_subject,
                normalized_description,
                self._timestamp(),
            )
        return {"todo": todo}

    def list(
        self,
        agent_id: int,
        status: TodoStatus | None = None,
    ) -> dict[str, Any]:
        if status not in (None, "pending", "in_progress", "completed"):
            raise DomainError("invalid_todo_status", "Todo status is invalid")
        if status is None:
            todos = sorted(
                [
                    *self._repository.load_todos(agent_id, "pending"),
                    *self._repository.load_todos(agent_id, "in_progress"),
                ],
                key=lambda todo: todo["id"],
            )
        else:
            todos = self._repository.load_todos(agent_id, status)
        return {"todos": todos, "count": len(todos)}

    def read(self, agent_id: int, todo_id: int) -> dict[str, Any]:
        return {"todo": self._require_todo(agent_id, todo_id)}

    def start(self, agent_id: int, todo_id: int) -> dict[str, Any]:
        with self._lock:
            todo = self._require_todo(agent_id, todo_id)
            if todo["status"] == "completed":
                raise DomainError("todo_completed", "Completed Todos cannot be started")
            current = self._repository.load_todos(agent_id, "in_progress")
            if current and current[0]["id"] != todo_id:
                raise DomainError(
                    "todo_in_progress",
                    f"Todo {current[0]['id']} is already in progress",
                )
            if todo["status"] != "in_progress":
                self._repository.set_todo_status(
                    agent_id,
                    todo_id,
                    "in_progress",
                    self._timestamp(),
                    None,
                )
            todo = self._require_todo(agent_id, todo_id)
        return {"todo": todo}

    def update(
        self,
        agent_id: int,
        todo_id: int,
        subject: str | None = None,
        description: str | None = None,
    ) -> dict[str, Any]:
        if subject is None and description is None:
            raise DomainError(
                "invalid_todo_update",
                "subject or description is required",
            )
        with self._lock:
            todo = self._require_todo(agent_id, todo_id)
            normalized_subject = (
                todo["subject"] if subject is None else self._subject(subject)
            )
            normalized_description = (
                todo["description"]
                if description is None
                else self._description(description)
            )
            self._repository.update_todo(
                agent_id,
                todo_id,
                normalized_subject,
                normalized_description,
                self._timestamp(),
            )
            todo = self._require_todo(agent_id, todo_id)
        return {"todo": todo}

    def complete(self, agent_id: int, todo_id: int) -> dict[str, Any]:
        with self._lock:
            todo = self._require_todo(agent_id, todo_id)
            if todo["status"] != "completed":
                timestamp = self._timestamp()
                self._repository.set_todo_status(
                    agent_id,
                    todo_id,
                    "completed",
                    timestamp,
                    timestamp,
                )
            todo = self._require_todo(agent_id, todo_id)
        return {"todo": todo}

    def delete(self, agent_id: int, todo_id: int) -> dict[str, Any]:
        with self._lock:
            self._require_todo(agent_id, todo_id)
            self._repository.delete_todo(agent_id, todo_id)
        return {"deleted_todo_id": todo_id}

    def delete_all(self, agent_id: int) -> None:
        with self._lock:
            self._repository.delete_agent_todos(agent_id)

    def status_reminder(self, agent_id: int) -> str | None:
        with self._lock:
            current = self._repository.load_todos(agent_id, "in_progress")
            pending = self._repository.load_todos(agent_id, "pending")
        if not current and not pending:
            return None
        lines = [TODO_STATUS_START]
        if current:
            lines.append(f"Current: #{current[0]['id']} {current[0]['subject']}")
        else:
            lines.append("Current: none")
        if pending:
            lines.append("Pending:")
            lines.extend(
                f"- #{todo['id']} {todo['subject']}"
                for todo in pending[:STATUS_PENDING_LIMIT]
            )
            remaining = len(pending) - STATUS_PENDING_LIMIT
            if remaining > 0:
                lines.append(f"- +{remaining} more")
        lines.append(TODO_STATUS_END)
        return "\n".join(lines)

    def _require_todo(self, agent_id: int, todo_id: int) -> dict[str, Any]:
        if type(todo_id) is not int or todo_id < 1:
            raise DomainError("invalid_todo_id", "Todo ID must be a positive integer")
        todo = self._repository.load_todo(agent_id, todo_id)
        if todo is None:
            raise DomainError("todo_not_found", "Todo not found")
        return todo

    @staticmethod
    def _subject(subject: str) -> str:
        if not isinstance(subject, str):
            raise DomainError("invalid_todo_subject", "Todo subject must be a string")
        normalized = " ".join(subject.split())
        if not normalized:
            raise DomainError("invalid_todo_subject", "Todo subject is required")
        if len(normalized) > MAX_SUBJECT_LENGTH:
            raise DomainError(
                "invalid_todo_subject",
                f"Todo subject cannot exceed {MAX_SUBJECT_LENGTH} characters",
            )
        return normalized

    @staticmethod
    def _description(description: str) -> str:
        if not isinstance(description, str):
            raise DomainError(
                "invalid_todo_description",
                "Todo description must be a string",
            )
        normalized = description.strip()
        if len(normalized) > MAX_DESCRIPTION_LENGTH:
            raise DomainError(
                "invalid_todo_description",
                f"Todo description cannot exceed {MAX_DESCRIPTION_LENGTH} characters",
            )
        return normalized

    @staticmethod
    def _timestamp() -> str:
        return datetime.now(UTC).isoformat()


def wrap_tool_result(result: Any, status_reminder: str | None) -> Any:
    if status_reminder is None:
        return result
    return {
        TODO_RESULT_KEY: result,
        TODO_STATUS_KEY: status_reminder,
    }


def unwrap_tool_result(result: Any) -> Any:
    if (
        isinstance(result, dict)
        and set(result) == {TODO_RESULT_KEY, TODO_STATUS_KEY}
        and isinstance(result[TODO_STATUS_KEY], str)
    ):
        return result[TODO_RESULT_KEY]
    return result
