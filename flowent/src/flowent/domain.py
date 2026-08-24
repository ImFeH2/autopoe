from __future__ import annotations

import re
from collections.abc import Callable, Iterable
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from threading import Condition, Event, RLock
from typing import Any, Literal

from flowent.human_read_state import (
    HumanReadState,
    mark_human_messages_seen,
    normalize_human_read_state,
)
from flowent.mentions import (
    MentionName,
    find_mentions,
    mention_syntax_issues,
    normalized_mention_name,
    validate_mention_name,
)

MESSAGE_CREATED_AT_PATTERN = re.compile(
    r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3,}Z$"
)


def message_created_at() -> str:
    return datetime.now(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def validate_message_created_at(value: object) -> str | None:
    if value is None:
        return None
    if (
        not isinstance(value, str)
        or MESSAGE_CREATED_AT_PATTERN.fullmatch(value) is None
    ):
        raise RuntimeError("Persisted Message created_at is invalid")
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError as error:
        raise RuntimeError("Persisted Message created_at is invalid") from error
    if parsed.tzinfo is None or parsed.utcoffset() != UTC.utcoffset(parsed):
        raise RuntimeError("Persisted Message created_at must be UTC")
    return value


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
    deleted: bool = False
    paused: bool = False


@dataclass
class Mention:
    member_id: int
    read: bool = False
    acked: bool = False
    reminded: bool = False


@dataclass
class HumanMentionNotification:
    member_id: int
    read: bool = False


@dataclass
class MentionReference:
    member_id: int
    name: str
    start: int | None
    end: int | None
    in_discussion: bool
    notified: bool
    deleted: bool = False


@dataclass
class Message:
    id: int
    sender_id: int
    sender_name: str
    body: str
    created_at: str | None = None
    references: list[MentionReference] = field(default_factory=list)
    mentions: dict[int, Mention] = field(default_factory=dict)
    human_mentions: dict[int, HumanMentionNotification] = field(default_factory=dict)


@dataclass(frozen=True)
class DiscussionMembership:
    member_id: int
    active: bool = True
    joined_after_message_id: int = 0


@dataclass
class Discussion:
    id: int
    topic: str
    memberships: list[DiscussionMembership]
    messages: list[Message] = field(default_factory=list)
    human_read_states: dict[int, HumanReadState] = field(default_factory=dict)

    @property
    def member_ids(self) -> tuple[int, ...]:
        return tuple(
            membership.member_id for membership in self.memberships if membership.active
        )

    def membership(self, member_id: int) -> DiscussionMembership | None:
        return next(
            (
                membership
                for membership in self.memberships
                if membership.member_id == member_id
            ),
            None,
        )


@dataclass
class AgentExecution:
    status: Literal["idle", "running", "error"] = "idle"
    error: str | None = None
    acknowledged_in_turn: int = 0
    consecutive_unproductive_turns: int = 0


@dataclass(frozen=True)
class ReminderMention:
    discussion_id: int
    message_id: int
    sender_id: int
    body: str
    previously_reminded: bool


@dataclass(frozen=True)
class Reminder:
    agent_id: int
    mentions: tuple[ReminderMention, ...]


class OrganizationState:
    def __init__(
        self,
        working_directory: Path | str | None = None,
        persisted: dict[str, Any] | None = None,
        on_persist: Callable[[dict[str, Any]], None] | None = None,
        message_clock: Callable[[], str] | None = None,
    ) -> None:
        if working_directory is None:
            self._working_directory = str(Path.cwd().resolve())
        elif isinstance(working_directory, Path):
            self._working_directory = str(working_directory.resolve())
        elif isinstance(working_directory, str) and working_directory:
            self._working_directory = working_directory
        else:
            raise ValueError("working_directory must be a non-empty path")
        self._on_persist = on_persist
        self._message_clock = message_clock or message_created_at
        self._members: dict[int, Member] = {}
        self._discussions: dict[int, Discussion] = {}
        self._agent_execution: dict[int, AgentExecution] = {}
        repaired_memberships = False
        if persisted is None:
            self._members[1] = Member(id=1, type="human", name="You")
        else:
            repaired_memberships = self._restore(persisted)
        self._next_member_id = max(self._members, default=1) + 1
        self._next_discussion_id = max(self._discussions, default=0) + 1
        self._revision = 0
        self._condition = Condition(RLock())
        if repaired_memberships and self._on_persist is not None:
            self._on_persist(self._persistence_data())

    def create_agent(self, name: str) -> dict[str, Any]:
        try:
            normalized_name = validate_mention_name(name)
        except ValueError as error:
            raise DomainError("invalid_name", str(error)) from error

        with self._condition:
            normalized_key = normalized_mention_name(normalized_name)
            if any(
                not member.deleted
                and normalized_mention_name(member.name) == normalized_key
                for member in self._members.values()
            ):
                raise DomainError("duplicate_name", "Member names must be unique")
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

    def rename_member(self, member_id: int, new_name: str) -> dict[str, Any]:
        if new_name != new_name.strip():
            raise DomainError(
                "invalid_name", "Member name cannot start or end with whitespace"
            )
        try:
            normalized_name = validate_mention_name(new_name)
        except ValueError as error:
            raise DomainError("invalid_name", str(error)) from error

        with self._condition:
            member = self._members.get(member_id)
            if member is None:
                raise DomainError("member_not_found", "Member not found")
            if member.deleted:
                raise DomainError("member_deleted", "Deleted Members cannot be renamed")
            if (
                member.type == "agent"
                and self._agent_execution[member_id].status == "running"
            ):
                raise DomainError(
                    "agent_busy", "Running or pausing Agents cannot be renamed"
                )
            normalized_key = normalized_mention_name(normalized_name)
            if any(
                candidate.id != member_id
                and not candidate.deleted
                and normalized_mention_name(candidate.name) == normalized_key
                for candidate in self._members.values()
            ):
                raise DomainError("duplicate_name", "Member names must be unique")
            if member.name == normalized_name:
                return self._snapshot()
            self._members[member_id] = Member(
                id=member.id,
                type=member.type,
                name=normalized_name,
                deleted=member.deleted,
                paused=member.paused,
            )
            self._changed(persist=True)
            return self._snapshot()

    def delete_agent(self, agent_id: int) -> dict[str, Any]:
        with self._condition:
            self._require_agent(agent_id)
            execution = self._agent_execution[agent_id]
            if execution.status == "running":
                raise DomainError("agent_running", "Running Agents cannot be deleted")
            member = self._members[agent_id]
            self._members[agent_id] = Member(
                id=member.id,
                type=member.type,
                name=member.name,
                deleted=True,
                paused=member.paused,
            )
            for discussion in self._discussions.values():
                for message in discussion.messages:
                    for reference in message.references:
                        if reference.member_id == agent_id:
                            reference.deleted = True
                discussion.memberships = [
                    DiscussionMembership(
                        member_id=membership.member_id,
                        active=False,
                        joined_after_message_id=membership.joined_after_message_id,
                    )
                    if membership.member_id == agent_id
                    else membership
                    for membership in discussion.memberships
                ]
            del self._agent_execution[agent_id]
            self._changed(persist=True)
            return self._snapshot()

    def pause_agent(self, agent_id: int) -> dict[str, Any]:
        with self._condition:
            member = self._require_agent(agent_id)
            if member.paused:
                return self._snapshot()
            self._members[agent_id] = Member(
                id=member.id,
                type=member.type,
                name=member.name,
                paused=True,
            )
            self._changed(persist=True)
            return self._snapshot()

    def resume_agent(self, agent_id: int) -> dict[str, Any]:
        with self._condition:
            member = self._require_agent(agent_id)
            if not member.paused:
                return self._snapshot()
            self._members[agent_id] = Member(
                id=member.id,
                type=member.type,
                name=member.name,
            )
            execution = self._agent_execution[agent_id]
            if execution.status != "running":
                execution.status = "idle"
                execution.error = None
                execution.acknowledged_in_turn = 0
                execution.consecutive_unproductive_turns = 0
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
            requested_members = tuple(dict.fromkeys((creator_id, *member_ids)))
            self._require_members(requested_members)
            participants = tuple(
                dict.fromkeys(
                    (
                        *self._active_human_ids(),
                        *requested_members,
                    )
                )
            )
            if len(participants) < 2:
                raise DomainError(
                    "invalid_members",
                    "A Discussion requires at least two Members",
                )

            discussion_id = self._next_discussion_id
            self._next_discussion_id += 1
            self._discussions[discussion_id] = Discussion(
                id=discussion_id,
                topic=normalized_topic,
                memberships=[
                    DiscussionMembership(member_id=member_id)
                    for member_id in participants
                ],
                human_read_states={
                    member_id: HumanReadState(member_id)
                    for member_id in participants
                    if self._members[member_id].type == "human"
                },
            )
            self._changed(persist=True)
            return self._snapshot()

    def delete_discussion(self, discussion_id: int) -> dict[str, Any]:
        with self._condition:
            self._require_discussion(discussion_id)
            del self._discussions[discussion_id]
            self._changed(persist=True)
            return self._snapshot()

    def send_message(
        self,
        discussion_id: int,
        sender_id: int,
        body: str,
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

            occurrences = (
                find_mentions(
                    normalized_body,
                    self._mention_names(active_only=True),
                    excluded_member_ids=(sender_id,),
                )
                if self._mention_syntax_data()["enabled"]
                else ()
            )
            references = [
                MentionReference(
                    member_id=occurrence.member_id,
                    name=self._members[occurrence.member_id].name,
                    start=occurrence.start,
                    end=occurrence.end,
                    in_discussion=occurrence.member_id in discussion.member_ids,
                    notified=(
                        occurrence.member_id != sender_id
                        and occurrence.member_id in discussion.member_ids
                    ),
                )
                for occurrence in occurrences
            ]
            targets = tuple(
                dict.fromkeys(
                    reference.member_id
                    for reference in references
                    if reference.notified
                )
            )
            agent_targets = tuple(
                target_id
                for target_id in targets
                if self._members[target_id].type == "agent"
            )
            human_targets = tuple(
                target_id
                for target_id in targets
                if self._members[target_id].type == "human"
            )
            message = Message(
                id=len(discussion.messages) + 1,
                sender_id=sender_id,
                sender_name=self._members[sender_id].name,
                body=normalized_body,
                created_at=validate_message_created_at(self._message_clock()),
                references=references,
                mentions={
                    target_id: Mention(member_id=target_id)
                    for target_id in agent_targets
                },
                human_mentions={
                    target_id: HumanMentionNotification(member_id=target_id)
                    for target_id in human_targets
                },
            )
            discussion.messages.append(message)
            previous_execution = {
                target_id: (
                    self._agent_execution[target_id].status,
                    self._agent_execution[target_id].error,
                )
                for target_id in agent_targets
            }
            previous_human_read_state = None
            if self._members[sender_id].type == "human":
                previous_human_read_state = discussion.human_read_states.get(sender_id)
                state = discussion.human_read_states.setdefault(
                    sender_id, HumanReadState(sender_id)
                )
                discussion.human_read_states[sender_id] = mark_human_messages_seen(
                    state,
                    human_member_id=sender_id,
                    ordered_message_ids=[item.id for item in discussion.messages],
                    message_ids=[message.id],
                )
            for target_id in agent_targets:
                execution = self._agent_execution[target_id]
                if execution.status == "error":
                    execution.status = "idle"
                    execution.error = None
            try:
                self._changed(persist=True)
            except BaseException:
                discussion.messages.pop()
                if self._members[sender_id].type == "human":
                    if previous_human_read_state is None:
                        discussion.human_read_states.pop(sender_id, None)
                    else:
                        discussion.human_read_states[sender_id] = (
                            previous_human_read_state
                        )
                for target_id, (status, error) in previous_execution.items():
                    execution = self._agent_execution[target_id]
                    execution.status = status
                    execution.error = error
                raise
            return self._snapshot()

    def list_members(self) -> list[dict[str, Any]]:
        with self._condition:
            return [
                self._member_data(member)
                for member in self._members.values()
                if not member.deleted
            ]

    def list_discussions(self, member_id: int | None = None) -> list[dict[str, Any]]:
        with self._condition:
            if member_id is not None:
                self._require_member(member_id)
            return [
                self._discussion_data(discussion)
                for discussion in self._discussions.values()
                if member_id is None or member_id in discussion.member_ids
            ]

    def discussion_info(
        self,
        member_id: int,
        discussion_id: int,
    ) -> dict[str, Any]:
        with self._condition:
            self._require_member(member_id)
            discussion = self._require_discussion_member(member_id, discussion_id)
            return self._discussion_info_data(discussion)

    def read_discussion(
        self,
        agent_id: int,
        discussion_id: int,
        start_message_id: int | None = None,
        end_message_id: int | None = None,
        limit: int = 100,
    ) -> dict[str, Any]:
        if start_message_id is not None and start_message_id < 1:
            raise DomainError("invalid_range", "start_message_id must be positive")
        if end_message_id is not None and end_message_id < 1:
            raise DomainError("invalid_range", "end_message_id must be positive")
        if (
            start_message_id is not None
            and end_message_id is not None
            and start_message_id > end_message_id
        ):
            raise DomainError(
                "invalid_range", "start_message_id cannot exceed end_message_id"
            )
        if limit < 1 or limit > 200:
            raise DomainError("invalid_limit", "limit must be between 1 and 200")

        with self._condition:
            self._require_agent(agent_id)
            discussion = self._require_discussion_member(agent_id, discussion_id)
            messages = discussion.messages
            if start_message_id is None:
                candidates = [
                    message
                    for message in messages
                    if end_message_id is None or message.id <= end_message_id
                ]
                selected_messages = candidates[-limit:]
            else:
                candidates = [
                    message
                    for message in messages
                    if message.id >= start_message_id
                    and (end_message_id is None or message.id <= end_message_id)
                ]
                selected_messages = candidates[:limit]

            changed = False
            for message in selected_messages:
                mention = message.mentions.get(agent_id)
                if mention is not None and not mention.read:
                    mention.read = True
                    changed = True
            if changed:
                self._changed(persist=True)
            return self._discussion_selection_data(discussion, selected_messages)

    def see_human_messages(
        self,
        human_id: int,
        discussion_id: int,
        message_ids: Iterable[int],
    ) -> dict[str, Any]:
        target_ids = tuple(dict.fromkeys(message_ids))
        if not target_ids:
            raise DomainError("invalid_seen", "At least one Message ID is required")

        with self._condition:
            member = self._require_member(human_id)
            if member.type != "human":
                raise DomainError("not_a_human", "Member is not a Human")
            discussion = self._require_discussion_member(human_id, discussion_id)
            messages_by_id = {message.id: message for message in discussion.messages}
            if any(message_id not in messages_by_id for message_id in target_ids):
                raise DomainError("message_not_found", "Message not found")

            state = discussion.human_read_states.setdefault(
                human_id, HumanReadState(human_id)
            )
            next_state = mark_human_messages_seen(
                state,
                human_member_id=human_id,
                ordered_message_ids=[message.id for message in discussion.messages],
                message_ids=target_ids,
            )
            if next_state != state:
                discussion.human_read_states[human_id] = next_state
                self._changed(persist=True)
            return self._snapshot()

    def read_human_mention(
        self,
        member_id: int,
        discussion_id: int,
        message_id: int,
    ) -> dict[str, Any]:
        with self._condition:
            member = self._require_member(member_id)
            if member.type != "human":
                raise DomainError("not_a_human", "Member is not a Human")
            discussion = self._require_discussion_member(member_id, discussion_id)
            if message_id < 1 or message_id > len(discussion.messages):
                raise DomainError("message_not_found", "Message not found")
            notification = discussion.messages[message_id - 1].human_mentions.get(
                member_id
            )
            if notification is None:
                raise DomainError(
                    "invalid_human_mention", "Message did not notify this Human"
                )
            if not notification.read:
                notification.read = True
                self._changed(persist=True)
            return self._snapshot()

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
            discussion = self._require_discussion_member(agent_id, discussion_id)
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
            newly_acked = 0
            for message_id in target_ids:
                mention = messages_by_id[message_id].mentions[agent_id]
                if not mention.acked:
                    mention.acked = True
                    newly_acked += 1
            execution = self._agent_execution[agent_id]
            if execution.status == "running":
                execution.acknowledged_in_turn += newly_acked
            self._changed(persist=True)
            return {"acked_message_ids": list(target_ids)}

    def search_messages(
        self,
        query: str,
        discussion_id: int | None = None,
        sender_id: int | None = None,
        member_id: int | None = None,
    ) -> list[dict[str, Any]]:
        normalized_query = query.strip().casefold()
        if not normalized_query:
            raise DomainError("invalid_query", "Search query is required")

        with self._condition:
            if member_id is not None:
                self._require_member(member_id)
            if discussion_id is not None:
                discussion = self._require_discussion(discussion_id)
                if member_id is not None and member_id not in discussion.member_ids:
                    raise DomainError(
                        "not_a_member",
                        "Only Discussion Members can search Messages",
                    )
                discussions = [discussion]
            else:
                discussions = [
                    discussion
                    for discussion in self._discussions.values()
                    if member_id is None or member_id in discussion.member_ids
                ]
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

    def claim_next_reminder(self) -> tuple[Reminder | None, int]:
        with self._condition:
            for member in self._members.values():
                if member.type != "agent" or member.deleted or member.paused:
                    continue
                execution = self._agent_execution[member.id]
                if execution.status != "idle":
                    continue
                mentions = self._pending_reminder_mentions(member.id)
                if not mentions:
                    continue
                for item in mentions:
                    mention = (
                        self._discussions[item.discussion_id]
                        .messages[item.message_id - 1]
                        .mentions[member.id]
                    )
                    mention.read = True
                    mention.reminded = True
                execution.status = "running"
                execution.error = None
                execution.acknowledged_in_turn = 0
                self._changed(persist=True)
                return Reminder(member.id, mentions), self._revision
            return None, self._revision

    def agent_execution_diagnostics(self, agent_id: int) -> dict[str, Any]:
        with self._condition:
            execution = self._agent_execution[agent_id]
            return {
                "status": self._member_data(self._members[agent_id])["status"],
                "acknowledged_in_turn": execution.acknowledged_in_turn,
                "consecutive_unproductive_turns": (
                    execution.consecutive_unproductive_turns
                ),
            }

    def complete_turn(self, agent_id: int, error: str | None = None) -> None:
        with self._condition:
            execution = self._agent_execution[agent_id]
            if self._members[agent_id].paused:
                execution.status = "idle"
                execution.error = None
                execution.acknowledged_in_turn = 0
                self._changed()
                return
            if error is not None:
                execution.status = "error"
                execution.error = error
            elif execution.acknowledged_in_turn > 0:
                execution.status = "idle"
                execution.error = None
                execution.consecutive_unproductive_turns = 0
            else:
                execution.consecutive_unproductive_turns += 1
                if execution.consecutive_unproductive_turns >= 3:
                    execution.status = "error"
                    execution.error = "Agent did not acknowledge any pending Mentions in three consecutive Turns"
                else:
                    execution.status = "idle"
                    execution.error = None
            execution.acknowledged_in_turn = 0
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

    def _pending_reminder_mentions(
        self,
        agent_id: int,
    ) -> tuple[ReminderMention, ...]:
        return tuple(
            ReminderMention(
                discussion_id=discussion.id,
                message_id=message.id,
                sender_id=message.sender_id,
                body=message.body,
                previously_reminded=mention.reminded,
            )
            for discussion in self._discussions.values()
            for message in discussion.messages
            if (mention := message.mentions.get(agent_id)) is not None
            and not mention.acked
        )

    def _mention_names(self, *, active_only: bool = False) -> tuple[MentionName, ...]:
        return tuple(
            MentionName(member.id, member.name)
            for member in self._members.values()
            if not active_only or not member.deleted
        )

    def _active_human_ids(self) -> tuple[int, ...]:
        return tuple(
            member.id
            for member in self._members.values()
            if member.type == "human" and not member.deleted
        )

    def _human_names(self) -> tuple[MentionName, ...]:
        return tuple(
            MentionName(member.id, member.name)
            for member in self._members.values()
            if member.type == "human" and not member.deleted
        )

    def _mention_syntax_data(self) -> dict[str, Any]:
        issues = mention_syntax_issues(self._mention_names(active_only=True))
        return {
            "enabled": not issues,
            "issues": [
                {
                    "code": issue.code,
                    "member_ids": list(issue.member_ids),
                    "names": list(issue.names),
                    **(
                        {"normalized_name": issue.normalized_name}
                        if issue.normalized_name is not None
                        else {}
                    ),
                }
                for issue in issues
            ],
        }

    def _snapshot(self) -> dict[str, Any]:
        return {
            "organization": {"id": 1},
            "working_directory": self._working_directory,
            "mention_syntax": self._mention_syntax_data(),
            "members": [
                self._member_data(member)
                for member in self._members.values()
                if not member.deleted
            ],
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
            if member.paused:
                data["status"] = (
                    "pausing" if execution.status == "running" else "paused"
                )
            else:
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
            "human_read_states": [
                {
                    "member_id": state.human_member_id,
                    "joined_after_message_id": membership.joined_after_message_id,
                    "read_through_message_id": state.read_through_message_id,
                    "seen_message_ids": list(state.sparse_seen_message_ids),
                }
                for state in discussion.human_read_states.values()
                if (membership := discussion.membership(state.human_member_id))
                is not None
                and membership.active
            ],
        }

    def _discussion_selection_data(
        self,
        discussion: Discussion,
        messages: Iterable[Message],
    ) -> dict[str, Any]:
        selected_messages = list(messages)
        first_message_id = selected_messages[0].id if selected_messages else None
        last_message_id = selected_messages[-1].id if selected_messages else None
        latest_message_id = discussion.messages[-1].id if discussion.messages else None
        return {
            "discussion_id": discussion.id,
            "messages": [self._message_data(message) for message in selected_messages],
            "first_message_id": first_message_id,
            "last_message_id": last_message_id,
            "latest_message_id": latest_message_id,
            "has_earlier": first_message_id is not None and first_message_id > 1,
            "has_later": (
                last_message_id is not None
                and latest_message_id is not None
                and last_message_id < latest_message_id
            ),
        }

    def _discussion_info_data(self, discussion: Discussion) -> dict[str, Any]:
        return {
            "id": discussion.id,
            "topic": discussion.topic,
            "members": [
                {
                    "id": self._members[member_id].id,
                    "type": self._members[member_id].type,
                    "name": self._members[member_id].name,
                }
                for member_id in discussion.member_ids
            ],
            "message_count": len(discussion.messages),
            "latest_message_id": (
                discussion.messages[-1].id if discussion.messages else None
            ),
        }

    def _message_data(self, message: Message) -> dict[str, Any]:
        return {
            "id": message.id,
            "sender_id": message.sender_id,
            **(
                {"sender_name": message.sender_name}
                if (sender := self._members.get(message.sender_id)) is None
                or sender.deleted
                or sender.name != message.sender_name
                else {}
            ),
            "body": message.body,
            "created_at": message.created_at,
            "references": [
                {
                    "member_id": reference.member_id,
                    "name": reference.name,
                    "start": reference.start,
                    "end": reference.end,
                    "in_discussion": reference.in_discussion,
                    "notified": reference.notified,
                    "deleted": reference.deleted,
                }
                for reference in message.references
            ],
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
            **(
                {
                    "human_mentions": [
                        {
                            "member_id": notification.member_id,
                            "status": "read" if notification.read else "unread",
                        }
                        for notification in message.human_mentions.values()
                    ]
                }
                if message.human_mentions
                else {}
            ),
        }

    def _restore(self, persisted: dict[str, Any]) -> bool:
        repaired_memberships = False
        for item in persisted["members"]:
            member = Member(
                id=item["id"],
                type=item["type"],
                name=item["name"],
                deleted=item.get("deleted", False),
                paused=item.get("paused", False),
            )
            self._members[member.id] = member
            if member.type == "agent" and not member.deleted:
                self._agent_execution[member.id] = AgentExecution()
        current_human = self._members.get(1)
        if (
            current_human is None
            or current_human.type != "human"
            or current_human.deleted
        ):
            raise RuntimeError("Persisted Organization is missing its Human Member")
        for item in persisted["discussions"]:
            messages: list[Message] = []
            for message_data in item["messages"]:
                references = [
                    MentionReference(
                        member_id=reference["member_id"],
                        name=reference.get(
                            "name", self._members[reference["member_id"]].name
                        ),
                        start=reference.get("start"),
                        end=reference.get("end"),
                        in_discussion=reference.get("in_discussion", True),
                        notified=(
                            reference.get("notified", False)
                            and reference["member_id"] != message_data["sender_id"]
                        ),
                        deleted=reference.get(
                            "deleted",
                            self._members[reference["member_id"]].deleted,
                        ),
                    )
                    for reference in message_data.get("references", [])
                ]
                mentions = {
                    mention["member_id"]: Mention(
                        member_id=mention["member_id"],
                        read=mention["read"],
                        acked=mention["acked"],
                        reminded=mention.get("reminded", False),
                    )
                    for mention in message_data["mentions"]
                    if mention["member_id"] != message_data["sender_id"]
                }
                for member_id in mentions:
                    if not any(
                        reference.member_id == member_id and reference.notified
                        for reference in references
                    ):
                        member = self._members[member_id]
                        references.append(
                            MentionReference(
                                member_id=member_id,
                                name=member.name,
                                start=None,
                                end=None,
                                in_discussion=True,
                                notified=True,
                                deleted=member.deleted,
                            )
                        )
                human_mentions = {
                    notification["member_id"]: HumanMentionNotification(
                        member_id=notification["member_id"],
                        read=notification.get("read", False),
                    )
                    for notification in message_data.get("human_mentions", [])
                    if notification["member_id"] != message_data["sender_id"]
                }
                messages.append(
                    Message(
                        id=message_data["id"],
                        sender_id=message_data["sender_id"],
                        sender_name=message_data.get(
                            "sender_name",
                            self._members[message_data["sender_id"]].name,
                        ),
                        body=message_data["body"],
                        created_at=validate_message_created_at(
                            message_data.get("created_at")
                        ),
                        references=references,
                        mentions=mentions,
                        human_mentions=human_mentions,
                    )
                )
            ordered_message_ids = [message.id for message in messages]
            latest_message_id = ordered_message_ids[-1] if ordered_message_ids else 0
            membership_data = item.get("memberships")
            if membership_data is None:
                membership_data = [
                    {
                        "member_id": member_id,
                        "active": True,
                        "joined_after_message_id": 0,
                    }
                    for member_id in item["member_ids"]
                ]
            memberships: list[DiscussionMembership] = []
            membership_ids: set[int] = set()
            for membership_item in membership_data:
                member_id = membership_item["member_id"]
                if member_id in membership_ids:
                    raise RuntimeError("Persisted Discussion membership is duplicated")
                member = self._members.get(member_id)
                if member is None:
                    raise RuntimeError("Persisted Discussion membership is unknown")
                joined_after_message_id = membership_item.get(
                    "joined_after_message_id", 0
                )
                if (
                    type(joined_after_message_id) is not int
                    or joined_after_message_id < 0
                    or joined_after_message_id > latest_message_id
                ):
                    raise RuntimeError(
                        "Persisted Discussion membership cutoff is invalid"
                    )
                active = membership_item.get("active", True)
                if type(active) is not bool:
                    raise RuntimeError(
                        "Persisted Discussion membership active is invalid"
                    )
                if member.deleted and active:
                    active = False
                    repaired_memberships = True
                memberships.append(
                    DiscussionMembership(
                        member_id=member_id,
                        active=active,
                        joined_after_message_id=joined_after_message_id,
                    )
                )
                membership_ids.add(member_id)
            human_read_states: dict[int, HumanReadState] = {}
            for state_data in item.get("human_read_states", []):
                human_id = state_data["member_id"]
                member = self._members.get(human_id)
                membership = next(
                    (
                        candidate
                        for candidate in memberships
                        if candidate.member_id == human_id
                    ),
                    None,
                )
                if (
                    member is None
                    or member.type != "human"
                    or membership is None
                    or human_id in human_read_states
                ):
                    raise RuntimeError("Persisted Human read state is invalid")
                human_read_states[human_id] = normalize_human_read_state(
                    human_member_id=human_id,
                    ordered_message_ids=ordered_message_ids,
                    read_through_message_id=state_data.get("read_through_message_id"),
                    sparse_seen_message_ids=state_data.get("seen_message_ids", []),
                )
            for membership in memberships:
                member = self._members[membership.member_id]
                if member.type != "human" or member.id in human_read_states:
                    continue
                human_read_states[member.id] = normalize_human_read_state(
                    human_member_id=member.id,
                    ordered_message_ids=ordered_message_ids,
                    sparse_seen_message_ids=[
                        message.id
                        for message in messages
                        if message.sender_id == member.id
                    ],
                )
            discussion = Discussion(
                id=item["id"],
                topic=item["topic"],
                memberships=memberships,
                messages=messages,
                human_read_states=human_read_states,
            )
            self._discussions[discussion.id] = discussion
        if self._ensure_active_humans_in_all_discussions():
            repaired_memberships = True
        return repaired_memberships

    def _ensure_active_humans_in_discussion(self, discussion: Discussion) -> bool:
        latest_message_id = discussion.messages[-1].id if discussion.messages else 0
        changed = False
        for human_id in self._active_human_ids():
            membership = discussion.membership(human_id)
            if membership is None:
                discussion.memberships.append(
                    DiscussionMembership(
                        member_id=human_id,
                        joined_after_message_id=latest_message_id,
                    )
                )
                discussion.human_read_states.setdefault(
                    human_id, HumanReadState(human_id)
                )
                changed = True
            elif not membership.active:
                raise RuntimeError(
                    "Persisted active Human has inactive Discussion membership"
                )
        return changed

    def _ensure_active_humans_in_all_discussions(self) -> bool:
        changed = False
        for discussion in self._discussions.values():
            if self._ensure_active_humans_in_discussion(discussion):
                changed = True
        return changed

    def _persistence_data(self) -> dict[str, Any]:
        return {
            "members": [
                {
                    "id": member.id,
                    "type": member.type,
                    "name": member.name,
                    "deleted": member.deleted,
                    "paused": member.paused,
                }
                for member in self._members.values()
            ],
            "discussions": [
                {
                    "id": discussion.id,
                    "topic": discussion.topic,
                    "memberships": [
                        {
                            "member_id": membership.member_id,
                            "active": membership.active,
                            "joined_after_message_id": (
                                membership.joined_after_message_id
                            ),
                        }
                        for membership in discussion.memberships
                    ],
                    "human_read_states": [
                        {
                            "member_id": state.human_member_id,
                            "read_through_message_id": state.read_through_message_id,
                            "seen_message_ids": list(state.sparse_seen_message_ids),
                        }
                        for state in discussion.human_read_states.values()
                    ],
                    "messages": [
                        {
                            "id": message.id,
                            "sender_id": message.sender_id,
                            "sender_name": message.sender_name,
                            "body": message.body,
                            "created_at": message.created_at,
                            "references": [
                                {
                                    "member_id": reference.member_id,
                                    "name": reference.name,
                                    "start": reference.start,
                                    "end": reference.end,
                                    "in_discussion": reference.in_discussion,
                                    "notified": reference.notified,
                                    "deleted": reference.deleted,
                                }
                                for reference in message.references
                            ],
                            "mentions": [
                                {
                                    "member_id": mention.member_id,
                                    "read": mention.read,
                                    "acked": mention.acked,
                                    "reminded": mention.reminded,
                                }
                                for mention in message.mentions.values()
                            ],
                            "human_mentions": [
                                {
                                    "member_id": notification.member_id,
                                    "read": notification.read,
                                }
                                for notification in message.human_mentions.values()
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
        if member is None or member.deleted:
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

    def _require_discussion_member(
        self,
        member_id: int,
        discussion_id: int,
    ) -> Discussion:
        discussion = self._require_discussion(discussion_id)
        if member_id not in discussion.member_ids:
            raise DomainError(
                "not_a_member",
                "Only Discussion Members can access Messages",
            )
        return discussion

    def _changed(self, persist: bool = False) -> None:
        if persist and self._on_persist is not None:
            self._on_persist(self._persistence_data())
        self._revision += 1
        self._condition.notify_all()
