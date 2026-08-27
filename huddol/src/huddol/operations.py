from __future__ import annotations

from threading import Lock
from typing import Any

from huddol.domain import OrganizationState
from huddol.history import AgentHistory
from huddol.memory import AgentMemory
from huddol.todos import AgentTodos


class OrganizationOperations:
    def __init__(
        self,
        state: OrganizationState,
        history: AgentHistory | None = None,
        todos: AgentTodos | None = None,
        memories: AgentMemory | None = None,
    ) -> None:
        self._state = state
        self._history = history
        self._todos = todos
        self._memories = memories
        self._lock = Lock()

    def delete_agent(self, agent_id: int) -> dict[str, Any]:
        with self._lock:
            if self._history is None:
                raise RuntimeError("Agent history is unavailable")
            snapshot = self._state.delete_agent(agent_id)
            self._history.delete(agent_id)
            if self._todos is not None:
                self._todos.delete_all(agent_id)
            if self._memories is not None:
                self._memories.delete_all(agent_id)
            return snapshot

    def pause_agent(self, agent_id: int) -> dict[str, Any]:
        with self._lock:
            return self._state.pause_agent(agent_id)

    def resume_agent(self, agent_id: int) -> dict[str, Any]:
        with self._lock:
            return self._state.resume_agent(agent_id)

    def delete_discussion(
        self,
        discussion_id: int,
        actor_id: int | None = None,
    ) -> dict[str, Any]:
        with self._lock:
            if actor_id is not None:
                self._state.discussion_info(actor_id, discussion_id)
            return self._state.delete_discussion(discussion_id)
