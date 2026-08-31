from __future__ import annotations

from huddol.ports.agent import AgentRun, HistoryStore


class History:
    def __init__(self, store: HistoryStore, agent_id: int) -> None:
        self._store = store
        self._agent_id = agent_id

    def runs(self, *, limit: int = 50) -> tuple[AgentRun, ...]:
        return self._store.runs(self._agent_id, limit=limit)

    def search(self, query: str, *, limit: int = 20) -> tuple[AgentRun, ...]:
        return self._store.search_runs(self._agent_id, query, limit=limit)

    def read(self, sequence: int) -> AgentRun | None:
        for run in self._store.runs(self._agent_id, limit=1000):
            if run.sequence == sequence:
                return run
        return None
