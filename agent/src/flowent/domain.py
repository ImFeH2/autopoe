from __future__ import annotations

from collections.abc import Callable, Iterable
from dataclasses import dataclass, field
from pathlib import Path
from threading import Condition, Event, RLock
from typing import Any, Literal


class DomainError(Exception):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


@dataclass(frozen=True)
class Member:
    id: int
    type: Literal["human", "agent"]
    name: str


@dataclass
class Mention:
    member_id: int
    read: bool = False
    acked: bool = False


@dataclass
class Message:
    id: int
    sender_id: int
    body: str
    mentions: dict[int, Mention] = field(default_factory=dict)


@dataclass
class Discussion:
    id: int
    topic: str
    member_ids: tuple[int, ...]
    messages: list[Message] = field(default_factory=list)


@dataclass
class AgentExecution:
    status: Literal["idle", "running", "error"] = "idle"
    error: str | None = None
    claimed_mentions: frozenset[tuple[int, int]] = frozenset()


@dataclass(frozen=True)
class ActivationItem:
    discussion_id: int
    message_ids: tuple[int, ...]


@dataclass(frozen=True)
class Activation:
    agent_id: int
    items: tuple[ActivationItem, ...]


class OrganizationState:
    def __init__(
        self,
        working_directory: Path | None = None,
        persisted: dict[str, Any] | None = None,
        on_persist: Callable[[dict[str, Any]], None] | None = None,
    ) -> None:
        self._working_directory = (working_directory or Path.cwd()).resolve()
        self._on_persist = on_persist
        self._members: dict[int, Member] = {}
        self._discussions: dict[int, Discussion] = {}
        self._agent_execution: dict[int, AgentExecution] = {}
        if persisted is None:
            self._members[1] = Member(id=1, type="human", name="You")
        else:
            self._restore(persisted)
        self._next_member_id = max(self._members, default=1) + 1
        self._next_discussion_id = max(self._discussions, default=0) + 1
        self._revision = 0
        self._condition = Condition(RLock())

    def create_agent(self, name: str) -> dict[str, Any]:
        normalized_name = name.strip()
        if not normalized_name:
            raise DomainError("invalid_name", "Agent name is required")

        with self._condition:
            member_id = self._next_member_id
            self._next_member_id += 1
            self._members[member_id] = Member(
                id=member_id,
                type="agent",
                name=normalized_name,
            )
            self._agent_execution[member_id] = AgentExecution()
            self._changed(persist=True)
            return self._snapshot()

    def create_discussion(
        self,
        topic: str,
        creator_id: int,
        member_ids: Iterable[int],
    ) -> dict[str, Any]:
        normalized_topic = topic.strip()
        if not normalized_topic:
            raise DomainError("invalid_topic", "Discussion topic is required")

        with self._condition:
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
            self._changed(persist=True)
            return self._snapshot()

    def send_message(
        self,
        discussion_id: int,
        sender_id: int,
        body: str,
        mention_ids: Iterable[int] = (),
    ) -> dict[str, Any]:
        normalized_body = body.strip()
        if not normalized_body:
            raise DomainError("invalid_message", "Message cannot be empty")

        with self._condition:
            discussion = self._require_discussion(discussion_id)
            if sender_id not in discussion.member_ids:
                raise DomainError(
                    "not_a_member",
                    "Only Discussion Members can send Messages",
                )

            targets = tuple(dict.fromkeys(mention_ids))
            for target_id in targets:
                if target_id == sender_id:
                    raise DomainError(
                        "invalid_mention", "A Member cannot mention itself"
                    )
                if target_id not in discussion.member_ids:
                    raise DomainError(
                        "invalid_mention",
                        "Mentioned Agents must belong to the Discussion",
                    )
                target = self._members[target_id]
                if target.type != "agent":
                    raise DomainError("invalid_mention", "Only Agents can be mentioned")

            message = Message(
                id=len(discussion.messages) + 1,
                sender_id=sender_id,
                body=normalized_body,
                mentions={
                    target_id: Mention(member_id=target_id) for target_id in targets
                },
            )
            discussion.messages.append(message)
            for target_id in targets:
                execution = self._agent_execution[target_id]
                if execution.status == "error":
                    execution.status = "idle"
                    execution.error = None
            self._changed(persist=True)
            return self._snapshot()

    def retry_agent(self, agent_id: int) -> dict[str, Any]:
        with self._condition:
            self._require_agent(agent_id)
            execution = self._agent_execution[agent_id]
            if execution.status != "error":
                raise DomainError("invalid_retry", "Only failed Agents can be retried")
            execution.status = "idle"
            execution.error = None
            self._changed()
            return self._snapshot()

    def list_members(self) -> list[dict[str, Any]]:
        with self._condition:
            return [self._member_data(member) for member in self._members.values()]

    def list_discussions(self) -> list[dict[str, Any]]:
        with self._condition:
            return [
                self._discussion_data(discussion)
                for discussion in self._discussions.values()
            ]

    def read_discussion(
        self,
        agent_id: int,
        discussion_id: int,
        message_ids: Iterable[int] = (),
    ) -> dict[str, Any]:
        with self._condition:
            self._require_agent(agent_id)
            discussion = self._require_discussion(discussion_id)
            target_ids = tuple(dict.fromkeys(message_ids))
            messages_by_id = {message.id: message for message in discussion.messages}
            selected_messages: list[Message] = []
            for message_id in target_ids:
                message = messages_by_id.get(message_id)
                if message is None:
                    raise DomainError("message_not_found", "Message not found")
                selected_messages.append(message)

            changed = False
            for message in selected_messages:
                mention = message.mentions.get(agent_id)
                if mention is not None and not mention.read:
                    mention.read = True
                    changed = True
            if changed:
                self._changed(persist=True)
            return self._discussion_selection_data(discussion, selected_messages)

    def ack_messages(
        self,
        agent_id: int,
        discussion_id: int,
        message_ids: Iterable[int],
    ) -> dict[str, Any]:
        target_ids = tuple(dict.fromkeys(message_ids))
        if not target_ids:
            raise DomainError("invalid_ack", "At least one Message ID is required")

        with self._condition:
            self._require_agent(agent_id)
            discussion = self._require_discussion(discussion_id)
            messages_by_id = {message.id: message for message in discussion.messages}
            for message_id in target_ids:
                message = messages_by_id.get(message_id)
                if message is None:
                    raise DomainError("message_not_found", "Message not found")
                mention = message.mentions.get(agent_id)
                if mention is None:
                    raise DomainError(
                        "invalid_ack", "Message did not mention this Agent"
                    )
                if not mention.read:
                    raise DomainError("invalid_ack", "Message must be read before ack")
            for message_id in target_ids:
                messages_by_id[message_id].mentions[agent_id].acked = True
            self._changed(persist=True)
            return {"acked_message_ids": list(target_ids)}

    def search_messages(
        self,
        query: str,
        discussion_id: int | None = None,
        sender_id: int | None = None,
    ) -> list[dict[str, Any]]:
        normalized_query = query.strip().casefold()
        if not normalized_query:
            raise DomainError("invalid_query", "Search query is required")

        with self._condition:
            if discussion_id is not None:
                discussions = [self._require_discussion(discussion_id)]
            else:
                discussions = list(self._discussions.values())
            if sender_id is not None:
                self._require_member(sender_id)

            results: list[dict[str, Any]] = []
            for discussion in discussions:
                for message in discussion.messages:
                    if normalized_query not in message.body.casefold():
                        continue
                    if sender_id is not None and message.sender_id != sender_id:
                        continue
                    results.append(
                        {
                            "discussion_id": discussion.id,
                            **self._message_data(message),
                        }
                    )
            return results

    def claim_next_activation(self) -> tuple[Activation | None, int]:
        with self._condition:
            for member in self._members.values():
                if member.type != "agent":
                    continue
                execution = self._agent_execution[member.id]
                if execution.status != "idle":
                    continue
                items = self._pending_items(member.id)
                if not items:
                    continue
                execution.status = "running"
                execution.error = None
                execution.claimed_mentions = frozenset(
                    (item.discussion_id, message_id)
                    for item in items
                    for message_id in item.message_ids
                )
                self._changed()
                return Activation(agent_id=member.id, items=items), self._revision
            return None, self._revision

    def complete_activation(self, agent_id: int, error: str | None = None) -> None:
        with self._condition:
            execution = self._agent_execution[agent_id]
            pending_mentions = self._pending_mentions(agent_id)
            has_new_work = bool(pending_mentions - execution.claimed_mentions)
            execution.status = (
                "error" if error and pending_mentions and not has_new_work else "idle"
            )
            execution.error = error if execution.status == "error" else None
            execution.claimed_mentions = frozenset()
            self._changed()

    def wait_for_change(self, revision: int, stop_event: Event) -> None:
        with self._condition:
            self._condition.wait_for(
                lambda: self._revision != revision or stop_event.is_set()
            )

    def wake(self) -> None:
        with self._condition:
            self._condition.notify_all()

    def member(self, member_id: int) -> dict[str, Any]:
        with self._condition:
            return self._member_data(self._require_member(member_id))

    def snapshot(self) -> dict[str, Any]:
        with self._condition:
            return self._snapshot()

    def _pending_mentions(self, agent_id: int) -> frozenset[tuple[int, int]]:
        return frozenset(
            (discussion.id, message.id)
            for discussion in self._discussions.values()
            for message in discussion.messages
            if (mention := message.mentions.get(agent_id)) is not None
            and not mention.acked
        )

    def _pending_items(self, agent_id: int) -> tuple[ActivationItem, ...]:
        items: list[ActivationItem] = []
        for discussion in self._discussions.values():
            message_ids = tuple(
                message.id
                for message in discussion.messages
                if (mention := message.mentions.get(agent_id)) is not None
                and not mention.acked
            )
            if message_ids:
                items.append(
                    ActivationItem(
                        discussion_id=discussion.id,
                        message_ids=message_ids,
                    )
                )
        return tuple(items)

    def _snapshot(self) -> dict[str, Any]:
        return {
            "organization": {"id": 1},
            "working_directory": str(self._working_directory),
            "members": [self._member_data(member) for member in self._members.values()],
            "discussions": [
                self._discussion_data(discussion)
                for discussion in self._discussions.values()
            ],
        }

    def _member_data(self, member: Member) -> dict[str, Any]:
        data: dict[str, Any] = {
            "id": member.id,
            "type": member.type,
            "name": member.name,
        }
        if member.type == "agent":
            execution = self._agent_execution[member.id]
            data["status"] = execution.status
            if execution.error:
                data["error"] = execution.error
        return data

    def _discussion_data(self, discussion: Discussion) -> dict[str, Any]:
        return {
            "id": discussion.id,
            "topic": discussion.topic,
            "member_ids": list(discussion.member_ids),
            "messages": [
                self._message_data(message) for message in discussion.messages
            ],
        }

    def _discussion_selection_data(
        self,
        discussion: Discussion,
        messages: Iterable[Message],
    ) -> dict[str, Any]:
        return {
            "id": discussion.id,
            "topic": discussion.topic,
            "member_ids": list(discussion.member_ids),
            "messages": [self._message_data(message) for message in messages],
        }

    def _message_data(self, message: Message) -> dict[str, Any]:
        return {
            "id": message.id,
            "sender_id": message.sender_id,
            "body": message.body,
            "mentions": [
                {
                    "member_id": mention.member_id,
                    "status": (
                        "acked"
                        if mention.acked
                        else "read"
                        if mention.read
                        else "pending"
                    ),
                }
                for mention in message.mentions.values()
            ],
        }

    def _restore(self, persisted: dict[str, Any]) -> None:
        for item in persisted["members"]:
            member = Member(id=item["id"], type=item["type"], name=item["name"])
            self._members[member.id] = member
            if member.type == "agent":
                self._agent_execution[member.id] = AgentExecution()
        if self._members.get(1) != Member(id=1, type="human", name="You"):
            raise RuntimeError("Persisted Organization is missing its Human Member")
        for item in persisted["discussions"]:
            messages = [
                Message(
                    id=message["id"],
                    sender_id=message["sender_id"],
                    body=message["body"],
                    mentions={
                        mention["member_id"]: Mention(
                            member_id=mention["member_id"],
                            read=mention["read"],
                            acked=mention["acked"],
                        )
                        for mention in message["mentions"]
                    },
                )
                for message in item["messages"]
            ]
            discussion = Discussion(
                id=item["id"],
                topic=item["topic"],
                member_ids=tuple(item["member_ids"]),
                messages=messages,
            )
            self._discussions[discussion.id] = discussion

    def _persistence_data(self) -> dict[str, Any]:
        return {
            "members": [
                {"id": member.id, "type": member.type, "name": member.name}
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
                            "mentions": [
                                {
                                    "member_id": mention.member_id,
                                    "read": mention.read,
                                    "acked": mention.acked,
                                }
                                for mention in message.mentions.values()
                            ],
                        }
                        for message in discussion.messages
                    ],
                }
                for discussion in self._discussions.values()
            ],
        }

    def _require_member(self, member_id: int) -> Member:
        member = self._members.get(member_id)
        if member is None:
            raise DomainError("member_not_found", "Member not found")
        return member

    def _require_members(self, member_ids: Iterable[int]) -> None:
        for member_id in member_ids:
            self._require_member(member_id)

    def _require_agent(self, member_id: int) -> Member:
        member = self._require_member(member_id)
        if member.type != "agent":
            raise DomainError("not_an_agent", "Member is not an Agent")
        return member

    def _require_discussion(self, discussion_id: int) -> Discussion:
        discussion = self._discussions.get(discussion_id)
        if discussion is None:
            raise DomainError("discussion_not_found", "Discussion not found")
        return discussion

    def _changed(self, persist: bool = False) -> None:
        if persist and self._on_persist is not None:
            self._on_persist(self._persistence_data())
        self._revision += 1
        self._condition.notify_all()
