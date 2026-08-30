from __future__ import annotations

from huddol.runtime.reminder import TurnOutcome, TurnRequest
from huddol.tools import AgentTools


class UnavailableRunner:
    def __init__(self, message: str) -> None:
        self._message = message

    def run(self, request: TurnRequest, tools: AgentTools) -> TurnOutcome:
        del tools
        return TurnOutcome(messages_json=request.history_json, error=self._message)
