from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

from huddol.core.mention import Mention
from huddol.ports.agent import HistoryStore
from huddol.ports.store import OrganizationStore
from huddol.tools import AgentTools


@dataclass(frozen=True)
class ReminderItem:
    discussion_id: int
    topic: str
    message_id: int
    sender_id: int
    sender_name: str
    previously_reminded: bool


@dataclass(frozen=True)
class Reminder:
    agent_id: int
    agent_name: str
    items: tuple[ReminderItem, ...]

    def render(self) -> str:
        lines = [
            f"- [{'previously reminded' if item.previously_reminded else 'new'}]"
            f" Discussion {item.discussion_id} ({item.topic}),"
            f" Message {item.message_id} from {item.sender_name}"
            for item in self.items
        ]
        prompt = (
            f"You are {self.agent_name} (Member {self.agent_id})."
            " These Messages mention you and are waiting for you:\n\n"
            + "\n".join(lines)
            + "\n\nUse discussion action=read to see what they say and the surrounding"
            " context, then decide what to do."
        )
        if any(item.previously_reminded for item in self.items):
            prompt += (
                " Some of these were already shown to you and are still waiting."
                " Only discussion ack marks one as handled."
            )
        return prompt


def build_reminder(
    store: OrganizationStore,
    history: HistoryStore,
    agent_id: int,
    agent_name: str,
) -> Reminder | None:
    pending: tuple[Mention, ...] = store.pending(agent_id)
    if not pending:
        return None
    reminded = history.previously_reminded(
        agent_id, [(item.discussion_id, item.message_id) for item in pending]
    )
    members = {item.id: item.name for item in store.list_members(include_deleted=True)}
    items: list[ReminderItem] = []
    for mention in pending:
        discussion = store.get_discussion(mention.discussion_id)
        if discussion is None:
            continue
        message = store.messages(
            mention.discussion_id,
            after=mention.message_id - 1,
            before=mention.message_id + 1,
        )
        if not message:
            continue
        sender_id = message[0].sender_id
        items.append(
            ReminderItem(
                discussion_id=mention.discussion_id,
                topic=discussion.topic,
                message_id=mention.message_id,
                sender_id=sender_id,
                sender_name=members.get(sender_id, f"Member {sender_id}"),
                previously_reminded=mention.message_id in reminded,
            )
        )
    if not items:
        return None
    return Reminder(agent_id, agent_name, tuple(items))


@dataclass(frozen=True)
class TurnRequest:
    reminder: Reminder
    history_json: str
    runtime_context: str


@dataclass(frozen=True)
class TurnOutcome:
    messages_json: str
    usage_json: str | None = None
    error: str | None = None


class ModelRunner(Protocol):
    def run(self, request: TurnRequest, tools: AgentTools) -> TurnOutcome: ...
