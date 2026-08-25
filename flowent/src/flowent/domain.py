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
from flowent.member_names import (
    MemberNameValidationError,
    member_name_policy_data,
    normalized_member_name_key,
    validate_member_name_for_mutation,
)
from flowent.mentions import MentionName, find_mentions, mention_syntax_issues

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


ReadReceiptSource = Literal[
    "human_viewport",
    "human_mark_all",
    "agent_reminder_context",
    "agent_discussion_read",
    "legacy_human_seen",
]
AckSource = Literal["human_explicit", "agent_tool", "legacy_agent_ack"]


@dataclass(frozen=True)
class MessageRecipient:
    member_id: int
    member_type_at_send: Literal["human", "agent"]
    member_name_at_send: str
    mentioned: bool = False


@dataclass(frozen=True)
class MessageReadReceipt:
    member_id: int
    source: ReadReceiptSource
    agent_run_id: str | None = None


@dataclass(frozen=True)
class MessageMentionAcknowledgement:
    member_id: int
    source: AckSource


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
    recipient_snapshot_known: bool = False
    recipients: dict[int, MessageRecipient] = field(default_factory=dict)
    read_receipts: dict[int, MessageReadReceipt] = field(default_factory=dict)
    mention_acknowledgements: dict[int, MessageMentionAcknowledgement] = field(
        default_factory=dict
    )


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
    activity_frontiers: dict[int, int] = field(default_factory=dict)

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
        current_human_member_id: int = 1,
    ) -> None:
        if working_directory is None:
            self._working_directory = str(Path.cwd().resolve())
        elif isinstance(working_directory, Path):
            self._working_directory = str(working_directory.resolve())
        elif isinstance(working_directory, str) and working_directory:
            self._working_directory = working_directory
        else:
            raise ValueError("working_directory must be a non-empty path")
        if type(current_human_member_id) is not int or current_human_member_id < 1:
            raise ValueError("current_human_member_id must be a positive integer")
        self._current_human_member_id = current_human_member_id
        self._on_persist = on_persist
        self._message_clock = message_clock or message_created_at
        self._members: dict[int, Member] = {}
        self._discussions: dict[int, Discussion] = {}
        self._agent_execution: dict[int, AgentExecution] = {}
        repaired_memberships = False
        if persisted is None:
            self._members[current_human_member_id] = Member(
                id=current_human_member_id, type="human", name="You"
            )
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
            normalized_name = validate_member_name_for_mutation(name)
        except MemberNameValidationError as error:
            raise DomainError(error.code, str(error)) from error

        with self._condition:
            normalized_key = normalized_member_name_key(normalized_name)
            if any(
                not member.deleted
                and normalized_member_name_key(member.name) == normalized_key
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
        try:
            normalized_name = validate_member_name_for_mutation(new_name)
        except MemberNameValidationError as error:
            raise DomainError(error.code, str(error)) from error

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
            normalized_key = normalized_member_name_key(normalized_name)
            if any(
                candidate.id != member_id
                and not candidate.deleted
                and normalized_member_name_key(candidate.name) == normalized_key
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
            message_id = len(discussion.messages) + 1
            recipients = {
                membership.member_id: MessageRecipient(
                    member_id=membership.member_id,
                    member_type_at_send=self._members[membership.member_id].type,
                    member_name_at_send=self._members[membership.member_id].name,
                    mentioned=membership.member_id in targets,
                )
                for membership in discussion.memberships
                if membership.active
                and membership.member_id != sender_id
                and message_id > membership.joined_after_message_id
            }
            message = Message(
                id=message_id,
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
                recipient_snapshot_known=True,
                recipients=recipients,
            )
            discussion.messages.append(message)
            previous_sender_frontier = discussion.activity_frontiers.get(sender_id)
            discussion.activity_frontiers[sender_id] = message.id
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
                if previous_sender_frontier is None:
                    discussion.activity_frontiers.pop(sender_id, None)
                else:
                    discussion.activity_frontiers[sender_id] = previous_sender_frontier
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
            messages = [
                message
                for message in discussion.messages
                if self._message_is_read_eligible(agent_id, discussion, message)
            ]
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
            self._record_message_reads_locked(
                agent_id,
                ((discussion_id, message.id) for message in selected_messages),
                source="agent_discussion_read",
                agent_run_id=None,
                persist=True,
            )
            return self._discussion_selection_data(discussion, selected_messages)

    def human_discussion_messages_page(
        self,
        human_id: int,
        discussion_id: int,
        *,
        limit: int = 50,
        before_message_id: int | None = None,
        after_message_id: int | None = None,
        anchor_message_id: int | None = None,
    ) -> dict[str, Any]:
        from flowent.discussion_paging import select_message_page

        with self._condition:
            member = self._require_member(human_id)
            if member.type != "human":
                raise DomainError("not_a_human", "Member is not a Human")
            discussion = self._require_discussion_member(human_id, discussion_id)
            return select_message_page(
                discussion.messages,
                discussion_id=discussion_id,
                limit=limit,
                before_message_id=before_message_id,
                after_message_id=after_message_id,
                anchor_message_id=anchor_message_id,
                project=self._message_data,
            )

    def record_message_reads(
        self,
        member_id: int,
        coordinates: Iterable[tuple[int, int]],
        *,
        source: ReadReceiptSource,
        agent_run_id: str | None = None,
    ) -> dict[str, Any]:
        with self._condition:
            self._require_member(member_id)
            changed = self._record_message_reads_locked(
                member_id,
                coordinates,
                source=source,
                agent_run_id=agent_run_id,
                persist=False,
            )
            if changed:
                try:
                    self._changed(persist=True)
                except Exception:  # noqa: BLE001
                    # The receipt is already present in memory. Preserve model-call
                    # recovery so a later state change can retry durable persistence.
                    self._changed(persist=False)
            return self._snapshot()

    @staticmethod
    def _message_is_read_eligible(
        member_id: int,
        discussion: Discussion,
        message: Message,
    ) -> bool:
        membership = discussion.membership(member_id)
        if membership is None or message.id <= membership.joined_after_message_id:
            return False
        return (
            message.sender_id == member_id
            or not message.recipient_snapshot_known
            or member_id in message.recipients
        )

    def _record_message_reads_locked(
        self,
        member_id: int,
        coordinates: Iterable[tuple[int, int]],
        *,
        source: ReadReceiptSource,
        agent_run_id: str | None,
        persist: bool,
    ) -> bool:
        targets = tuple(dict.fromkeys(coordinates))
        if not targets:
            return False
        resolved: list[tuple[Discussion, Message]] = []
        for discussion_id, message_id in targets:
            discussion = self._require_discussion_member(member_id, discussion_id)
            if message_id < 1 or message_id > len(discussion.messages):
                raise DomainError("message_not_found", "Message not found")
            message = discussion.messages[message_id - 1]
            if not self._message_is_read_eligible(member_id, discussion, message):
                raise DomainError(
                    "invalid_read", "Message was not eligible for this Member"
                )
            resolved.append((discussion, message))
        changed = False
        human_ids_by_discussion: dict[int, list[int]] = {}
        for discussion, message in resolved:
            if message.sender_id == member_id:
                frontier = discussion.activity_frontiers.get(member_id, 0)
                if message.id > frontier:
                    discussion.activity_frontiers[member_id] = message.id
                    changed = True
                continue
            if member_id not in message.read_receipts:
                message.read_receipts[member_id] = MessageReadReceipt(
                    member_id=member_id,
                    source=source,
                    agent_run_id=agent_run_id,
                )
                changed = True
            frontier = discussion.activity_frontiers.get(member_id, 0)
            if message.id > frontier:
                discussion.activity_frontiers[member_id] = message.id
                changed = True
            mention = message.mentions.get(member_id)
            if mention is not None and not mention.read:
                mention.read = True
                changed = True
            notification = message.human_mentions.get(member_id)
            if notification is not None and not notification.read:
                notification.read = True
                changed = True
            if self._members[member_id].type == "human":
                human_ids_by_discussion.setdefault(discussion.id, []).append(message.id)
        if self._members[member_id].type == "human":
            for discussion_id, message_ids in human_ids_by_discussion.items():
                discussion = self._discussions[discussion_id]
                state = discussion.human_read_states.setdefault(
                    member_id, HumanReadState(member_id)
                )
                next_state = mark_human_messages_seen(
                    state,
                    human_member_id=member_id,
                    ordered_message_ids=[message.id for message in discussion.messages],
                    message_ids=message_ids,
                )
                if next_state != state:
                    discussion.human_read_states[member_id] = next_state
                    changed = True
        if changed and persist:
            self._changed(persist=True)
        return changed

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
            self._record_message_reads_locked(
                human_id,
                ((discussion_id, message_id) for message_id in target_ids),
                source="human_viewport",
                agent_run_id=None,
                persist=True,
            )
            return self._snapshot()

    def mark_all_human_messages_read(
        self, human_id: int, discussion_id: int, through_message_id: int
    ) -> dict[str, Any]:
        with self._condition:
            member = self._require_member(human_id)
            if member.type != "human":
                raise DomainError("not_a_human", "Member is not a Human")
            discussion = self._require_discussion_member(human_id, discussion_id)
            latest = discussion.messages[-1].id if discussion.messages else 0
            if through_message_id < 0 or through_message_id > latest:
                raise DomainError(
                    "invalid_range", "through_message_id is outside the Discussion"
                )
            membership = discussion.membership(human_id)
            assert membership is not None
            coordinates = []
            for message in discussion.messages:
                if (
                    message.id > through_message_id
                    or message.id <= membership.joined_after_message_id
                ):
                    continue
                if message.sender_id == human_id:
                    continue
                if (
                    message.recipient_snapshot_known
                    and human_id not in message.recipients
                ):
                    continue
                coordinates.append((discussion_id, message.id))
            changed = self._record_message_reads_locked(
                human_id,
                coordinates,
                source="human_mark_all",
                agent_run_id=None,
                persist=False,
            )
            if through_message_id > discussion.activity_frontiers.get(human_id, 0):
                discussion.activity_frontiers[human_id] = through_message_id
                changed = True
            if changed:
                self._changed(persist=True)
            return self._summary_snapshot()

    def read_human_mention(
        self, member_id: int, discussion_id: int, message_id: int
    ) -> dict[str, Any]:
        with self._condition:
            member = self._require_member(member_id)
            if member.type != "human":
                raise DomainError("not_a_human", "Member is not a Human")
            discussion = self._require_discussion_member(member_id, discussion_id)
            if message_id < 1 or message_id > len(discussion.messages):
                raise DomainError("message_not_found", "Message not found")
            if member_id not in discussion.messages[message_id - 1].human_mentions:
                raise DomainError(
                    "invalid_human_mention", "Message did not notify this Human"
                )
            self._record_message_reads_locked(
                member_id,
                [(discussion_id, message_id)],
                source="human_viewport",
                agent_run_id=None,
                persist=True,
            )
            return self._snapshot()

    def ack_human_mention(
        self, human_id: int, discussion_id: int, message_id: int
    ) -> dict[str, Any]:
        with self._condition:
            member = self._require_member(human_id)
            if member.type != "human":
                raise DomainError("not_a_human", "Member is not a Human")
            discussion = self._require_discussion_member(human_id, discussion_id)
            self._ack_message_mention_locked(
                human_id, discussion, message_id, source="human_explicit"
            )
            return self._summary_snapshot()

    def _ack_message_mention_locked(
        self,
        member_id: int,
        discussion: Discussion,
        message_id: int,
        *,
        source: AckSource,
        persist: bool = True,
    ) -> bool:
        if message_id < 1 or message_id > len(discussion.messages):
            raise DomainError("message_not_found", "Message not found")
        message = discussion.messages[message_id - 1]
        if source == "human_explicit":
            mentioned = member_id in message.human_mentions
        elif source == "agent_tool":
            mentioned = member_id in message.mentions
        else:
            mentioned = (
                member_id in message.mentions
                or member_id in message.human_mentions
                or any(
                    reference.member_id == member_id and reference.notified
                    for reference in message.references
                )
            )
        if not mentioned:
            raise DomainError("invalid_ack", "Message did not notify this Member")
        if member_id in message.mention_acknowledgements:
            return False
        if member_id not in message.read_receipts:
            raise DomainError("invalid_ack", "Message must be read before ack")
        message.mention_acknowledgements[member_id] = MessageMentionAcknowledgement(
            member_id=member_id, source=source
        )
        mention = message.mentions.get(member_id)
        if mention is not None:
            mention.acked = True
        if persist:
            self._changed(persist=True)
        return True

    def ack_messages(
        self, agent_id: int, discussion_id: int, message_ids: Iterable[int]
    ) -> dict[str, Any]:
        target_ids = tuple(dict.fromkeys(message_ids))
        if not target_ids:
            raise DomainError("invalid_ack", "At least one Message ID is required")
        with self._condition:
            self._require_agent(agent_id)
            discussion = self._require_discussion_member(agent_id, discussion_id)
            for message_id in target_ids:
                if message_id < 1 or message_id > len(discussion.messages):
                    raise DomainError("message_not_found", "Message not found")
                message = discussion.messages[message_id - 1]
                if agent_id not in message.mentions:
                    raise DomainError(
                        "invalid_ack", "Message did not mention this Agent"
                    )
                if (
                    agent_id not in message.mention_acknowledgements
                    and agent_id not in message.read_receipts
                ):
                    raise DomainError("invalid_ack", "Message must be read before ack")
            newly_acked = sum(
                self._ack_message_mention_locked(
                    agent_id,
                    discussion,
                    message_id,
                    source="agent_tool",
                    persist=False,
                )
                for message_id in target_ids
            )
            execution = self._agent_execution[agent_id]
            if execution.status == "running":
                execution.acknowledged_in_turn += newly_acked
            if newly_acked:
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

    def summary(self) -> dict[str, Any]:
        with self._condition:
            return self._summary_snapshot()

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

    def _summary_snapshot(self) -> dict[str, Any]:
        return {
            "organization": {
                "id": 1,
                "current_human_member_id": self._current_human_member_id,
            },
            "working_directory": self._working_directory,
            "mention_syntax": self._mention_syntax_data(),
            "member_name_policy": member_name_policy_data(),
            "members": [
                self._member_data(member)
                for member in self._members.values()
                if not member.deleted
            ],
            "discussions": [
                self._discussion_summary_data(discussion)
                for discussion in self._discussions.values()
            ],
        }

    def _snapshot(self) -> dict[str, Any]:
        return {
            "organization": {
                "id": 1,
                "current_human_member_id": self._current_human_member_id,
            },
            "working_directory": self._working_directory,
            "mention_syntax": self._mention_syntax_data(),
            "member_name_policy": member_name_policy_data(),
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

    def _discussion_summary_data(self, discussion: Discussion) -> dict[str, Any]:
        first_message_id = discussion.messages[0].id if discussion.messages else None
        latest_message_id = discussion.messages[-1].id if discussion.messages else None
        human_activity = []
        for state in discussion.human_read_states.values():
            membership = discussion.membership(state.human_member_id)
            if membership is None or not membership.active:
                continue
            frontier = discussion.activity_frontiers.get(state.human_member_id, 0)
            eligible = [
                message
                for message in discussion.messages
                if message.id > membership.joined_after_message_id
                and message.sender_id != state.human_member_id
                and (
                    not message.recipient_snapshot_known
                    or state.human_member_id in message.recipients
                )
            ]
            unread = [message for message in eligible if message.id > frontier]
            unread_mentions = [
                message
                for message in eligible
                if (notification := message.human_mentions.get(state.human_member_id))
                is not None
                and not notification.read
            ]
            human_activity.append(
                {
                    "member_id": state.human_member_id,
                    "joined_after_message_id": membership.joined_after_message_id,
                    "read_through_message_id": state.read_through_message_id,
                    "seen_message_ids": list(state.sparse_seen_message_ids),
                    "unread_count": len(unread),
                    "first_unread_message_id": unread[0].id if unread else None,
                    "unread_human_mention_count": len(unread_mentions),
                    "next_human_mention_message_id": (
                        unread_mentions[0].id if unread_mentions else None
                    ),
                }
            )
        return {
            "id": discussion.id,
            "topic": discussion.topic,
            "member_ids": list(discussion.member_ids),
            "message_count": len(discussion.messages),
            "first_message_id": first_message_id,
            "latest_message_id": latest_message_id,
            "human_activity": human_activity,
        }

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
            "activity_frontiers": [
                {"member_id": member_id, "latest_activity_message_id": frontier}
                for member_id, frontier in sorted(discussion.activity_frontiers.items())
                if (membership := discussion.membership(member_id)) is not None
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
            "delivery": self._delivery_data(message),
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

    def _delivery_data(self, message: Message) -> dict[str, Any]:
        recipients = dict(message.recipients)
        if not message.recipient_snapshot_known:
            factual_member_ids = set(message.read_receipts) | set(
                message.mention_acknowledgements
            )
            factual_member_ids.update(message.mentions)
            factual_member_ids.update(message.human_mentions)
            for reference in message.references:
                if reference.notified:
                    factual_member_ids.add(reference.member_id)
            for member_id in factual_member_ids:
                if member_id == message.sender_id or member_id in recipients:
                    continue
                member = self._members.get(member_id)
                reference = next(
                    (
                        item
                        for item in message.references
                        if item.member_id == member_id
                    ),
                    None,
                )
                recipients[member_id] = MessageRecipient(
                    member_id=member_id,
                    member_type_at_send=(
                        member.type if member is not None else "agent"
                    ),
                    member_name_at_send=(
                        reference.name
                        if reference is not None
                        else member.name
                        if member is not None
                        else str(member_id)
                    ),
                    mentioned=(
                        member_id in message.mentions
                        or member_id in message.human_mentions
                        or (reference is not None and reference.notified)
                    ),
                )
        recipient_data = []
        for recipient in recipients.values():
            receipt = message.read_receipts.get(recipient.member_id)
            acknowledgement = message.mention_acknowledgements.get(recipient.member_id)
            if not recipient.mentioned:
                ack_status = "not_applicable"
            elif acknowledgement is not None:
                ack_status = "acked"
            elif message.recipient_snapshot_known:
                ack_status = "pending"
            else:
                ack_status = "unknown"
            active_member = self._members.get(recipient.member_id)
            recipient_data.append(
                {
                    "member_id": recipient.member_id,
                    "member_type_at_send": recipient.member_type_at_send,
                    "member_name_at_send": recipient.member_name_at_send,
                    "available": active_member is not None
                    and not active_member.deleted,
                    "mentioned": recipient.mentioned,
                    "read": True
                    if receipt is not None
                    else False
                    if message.recipient_snapshot_known
                    else None,
                    "ack": ack_status,
                }
            )
        return {
            "recipients_known": message.recipient_snapshot_known,
            "recipients": recipient_data,
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
        current_human = self._members.get(self._current_human_member_id)
        if (
            current_human is None
            or current_human.type != "human"
            or current_human.deleted
        ):
            raise RuntimeError(
                "Persisted Organization is missing its current Human Member"
            )
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
                recipients = {
                    recipient["member_id"]: MessageRecipient(
                        member_id=recipient["member_id"],
                        member_type_at_send=recipient["member_type_at_send"],
                        member_name_at_send=recipient["member_name_at_send"],
                        mentioned=recipient.get("mentioned", False),
                    )
                    for recipient in message_data.get("recipients", [])
                    if recipient["member_id"] != message_data["sender_id"]
                }
                read_receipts = {
                    receipt["member_id"]: MessageReadReceipt(
                        member_id=receipt["member_id"],
                        source=receipt["source"],
                        agent_run_id=receipt.get("agent_run_id"),
                    )
                    for receipt in message_data.get("read_receipts", [])
                    if receipt["member_id"] != message_data["sender_id"]
                }
                acknowledgements = {
                    acknowledgement["member_id"]: MessageMentionAcknowledgement(
                        member_id=acknowledgement["member_id"],
                        source=acknowledgement["source"],
                    )
                    for acknowledgement in message_data.get(
                        "mention_acknowledgements", []
                    )
                    if acknowledgement["member_id"] != message_data["sender_id"]
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
                        recipient_snapshot_known=message_data.get(
                            "recipient_snapshot_known", False
                        ),
                        recipients=recipients,
                        read_receipts=read_receipts,
                        mention_acknowledgements=acknowledgements,
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
            memberships_by_id = {
                membership.member_id: membership for membership in memberships
            }
            for message in messages:
                if not message.recipient_snapshot_known and message.recipients:
                    raise RuntimeError(
                        "Persisted legacy Message cannot contain inferred recipients"
                    )
                for recipient in message.recipients.values():
                    membership = memberships_by_id.get(recipient.member_id)
                    if (
                        recipient.member_id == message.sender_id
                        or membership is None
                        or message.id <= membership.joined_after_message_id
                    ):
                        raise RuntimeError(
                            "Persisted Message recipient snapshot is invalid"
                        )
                for receipt in message.read_receipts.values():
                    membership = memberships_by_id.get(receipt.member_id)
                    if (
                        receipt.member_id == message.sender_id
                        or membership is None
                        or message.id <= membership.joined_after_message_id
                        or (
                            message.recipient_snapshot_known
                            and receipt.member_id not in message.recipients
                        )
                    ):
                        raise RuntimeError("Persisted Message read receipt is invalid")
                notified_member_ids = set(message.mentions) | set(
                    message.human_mentions
                )
                notified_member_ids.update(
                    reference.member_id
                    for reference in message.references
                    if reference.notified
                )
                for acknowledgement in message.mention_acknowledgements.values():
                    if (
                        acknowledgement.member_id == message.sender_id
                        or acknowledgement.member_id not in notified_member_ids
                        or (
                            acknowledgement.source != "legacy_agent_ack"
                            and acknowledgement.member_id not in message.read_receipts
                        )
                    ):
                        raise RuntimeError(
                            "Persisted Message mention acknowledgement is invalid"
                        )
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
            activity_frontiers = {
                frontier["member_id"]: frontier["latest_activity_message_id"]
                for frontier in item.get("activity_frontiers", [])
            }
            discussion = Discussion(
                id=item["id"],
                topic=item["topic"],
                memberships=memberships,
                messages=messages,
                human_read_states=human_read_states,
                activity_frontiers=activity_frontiers,
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
                    "activity_frontiers": [
                        {
                            "member_id": member_id,
                            "latest_activity_message_id": frontier,
                        }
                        for member_id, frontier in sorted(
                            discussion.activity_frontiers.items()
                        )
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
                            "recipient_snapshot_known": (
                                message.recipient_snapshot_known
                            ),
                            "recipients": [
                                {
                                    "member_id": recipient.member_id,
                                    "member_type_at_send": (
                                        recipient.member_type_at_send
                                    ),
                                    "member_name_at_send": (
                                        recipient.member_name_at_send
                                    ),
                                    "mentioned": recipient.mentioned,
                                }
                                for recipient in message.recipients.values()
                            ],
                            "read_receipts": [
                                {
                                    "member_id": receipt.member_id,
                                    "source": receipt.source,
                                    "agent_run_id": receipt.agent_run_id,
                                }
                                for receipt in message.read_receipts.values()
                            ],
                            "mention_acknowledgements": [
                                {
                                    "member_id": acknowledgement.member_id,
                                    "source": acknowledgement.source,
                                }
                                for acknowledgement in (
                                    message.mention_acknowledgements.values()
                                )
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
