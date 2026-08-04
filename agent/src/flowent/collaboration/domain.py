from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from pydantic_ai.messages import ModelMessage


@dataclass(frozen=True, slots=True)
class AgentRecord:
    id: str
    project_id: str
    name: str
    role: str
    kind: str


@dataclass(frozen=True, slots=True)
class Chat:
    id: str
    project_id: str
    title: str
    purpose: str

    def to_dict(self) -> dict[str, str]:
        return {
            "id": self.id,
            "title": self.title,
            "purpose": self.purpose,
        }


@dataclass(frozen=True, slots=True)
class ChatMessage:
    id: str
    chat_id: str
    turn_id: str | None
    author: str
    content: str
    status: str

    def to_dict(self) -> dict[str, str | None]:
        return {
            "id": self.id,
            "chat_id": self.chat_id,
            "turn_id": self.turn_id,
            "author": self.author,
            "content": self.content,
            "status": self.status,
        }


@dataclass(frozen=True, slots=True)
class TurnStart:
    id: str
    user_message: ChatMessage
    agent_message: ChatMessage
    snapshot: dict[str, Any]


@dataclass(frozen=True, slots=True)
class CollaborationSnapshot:
    agent: AgentRecord
    chat: Chat
    messages: list[ChatMessage]
    last_turn: dict[str, Any] | None
    history: list[ModelMessage]
