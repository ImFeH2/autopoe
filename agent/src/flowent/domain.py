from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any


class DomainError(Exception):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


@dataclass(frozen=True)
class Member:
    id: int
    type: str
    name: str


@dataclass(frozen=True)
class Message:
    id: int
    sender_id: int
    body: str


@dataclass
class Discussion:
    id: int
    topic: str
    member_ids: tuple[int, ...]
    messages: list[Message] = field(default_factory=list)


class OrganizationState:
    def __init__(self, working_directory: Path | None = None) -> None:
        self._working_directory = (working_directory or Path.cwd()).resolve()
        self._members: dict[int, Member] = {1: Member(id=1, type="human", name="You")}
        self._discussions: dict[int, Discussion] = {}
        self._next_member_id = 2
        self._next_discussion_id = 1

    def create_agent(self, name: str) -> dict[str, Any]:
        normalized_name = name.strip()
        if not normalized_name:
            raise DomainError("invalid_name", "Agent name is required")

        member_id = self._next_member_id
        self._next_member_id += 1
        self._members[member_id] = Member(
            id=member_id,
            type="agent",
            name=normalized_name,
        )
        return self.snapshot()

    def create_discussion(
        self,
        topic: str,
        creator_id: int,
        member_ids: Iterable[int],
    ) -> dict[str, Any]:
        normalized_topic = topic.strip()
        if not normalized_topic:
            raise DomainError("invalid_topic", "Discussion topic is required")

        participants = tuple(dict.fromkeys((creator_id, *member_ids)))
        if len(participants) < 2:
            raise DomainError(
                "invalid_members",
                "A Discussion requires at least two Members",
            )
        self._require_members(participants)

        discussion_id = self._next_discussion_id
        self._next_discussion_id += 1
        self._discussions[discussion_id] = Discussion(
            id=discussion_id,
            topic=normalized_topic,
            member_ids=participants,
        )
        return self.snapshot()

    def send_message(
        self,
        discussion_id: int,
        sender_id: int,
        body: str,
    ) -> dict[str, Any]:
        discussion = self._discussions.get(discussion_id)
        if discussion is None:
            raise DomainError("discussion_not_found", "Discussion not found")
        if sender_id not in discussion.member_ids:
            raise DomainError(
                "not_a_member",
                "Only Discussion Members can send Messages",
            )

        normalized_body = body.strip()
        if not normalized_body:
            raise DomainError("invalid_message", "Message cannot be empty")

        discussion.messages.append(
            Message(
                id=len(discussion.messages) + 1,
                sender_id=sender_id,
                body=normalized_body,
            )
        )
        return self.snapshot()

    def snapshot(self) -> dict[str, Any]:
        return {
            "organization": {"id": 1},
            "working_directory": str(self._working_directory),
            "members": [
                {
                    "id": member.id,
                    "type": member.type,
                    "name": member.name,
                    **({"status": "idle"} if member.type == "agent" else {}),
                }
                for member in self._members.values()
            ],
            "discussions": [
                {
                    "id": discussion.id,
                    "topic": discussion.topic,
                    "member_ids": list(discussion.member_ids),
                    "messages": [
                        {
                            "id": message.id,
                            "sender_id": message.sender_id,
                            "body": message.body,
                        }
                        for message in discussion.messages
                    ],
                }
                for discussion in self._discussions.values()
            ],
        }

    def _require_members(self, member_ids: Iterable[int]) -> None:
        if any(member_id not in self._members for member_id in member_ids):
            raise DomainError("member_not_found", "Member not found")
