from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any

from huddol.core.context import advance_watermark, context_window
from huddol.core.discussion import validate_body, validate_topic
from huddol.core.errors import DomainError
from huddol.core.member import validate_name
from huddol.ports.agent import HistoryStore, SettingsStore, TodoStore
from huddol.ports.files import ConflictError, FileTree
from huddol.ports.sandbox import Sandbox
from huddol.ports.store import OrganizationStore
from huddol.services.history import History
from huddol.services.library import Library
from huddol.services.memory import Memory
from huddol.services.todo import Todos
from huddol.tools.authorize import Actor, Authorizer

CONTEXT_LEAD = 1


@dataclass
class Dependencies:
    store: OrganizationStore
    todos: TodoStore
    history: HistoryStore
    settings: SettingsStore
    sandbox: Sandbox
    library_tree: FileTree
    memory_tree_for: Any


class AgentTools:
    def __init__(
        self,
        deps: Dependencies,
        actor: Actor,
        authorizer: Authorizer | None = None,
    ) -> None:
        self._deps = deps
        self._actor = actor
        self._auth = authorizer or Authorizer()

    def _check(self, capability: str, target: object = None) -> None:
        self._auth.check(self._actor, capability, target)

    def _require_membership(self, discussion_id: int) -> None:
        discussion = self._deps.store.get_discussion(discussion_id)
        if discussion is None:
            raise DomainError("not_found", f"Discussion {discussion_id} does not exist")
        if not discussion.has_member(self._actor.member_id):
            raise DomainError(
                "not_a_member", f"You do not belong to Discussion {discussion_id}"
            )

    def list_members(self, include_deleted: bool = False) -> list[dict[str, Any]]:
        self._check("organization.list_members")
        return [
            {"id": item.id, "type": item.type, "name": item.name, "state": item.state}
            for item in self._deps.store.list_members(include_deleted=include_deleted)
        ]

    def create_agent(self, name: str) -> dict[str, Any]:
        self._check("organization.create_agent")
        validated = validate_name(name)
        if self._deps.store.name_taken(validated):
            raise DomainError("duplicate_name", "Member names must be unique")
        member = self._deps.store.create_member("agent", validated)
        return {"id": member.id, "name": member.name, "state": member.state}

    def rename_member(self, member_id: int, name: str) -> dict[str, Any]:
        self._check("organization.rename_member", member_id)
        validated = validate_name(name)
        existing = self._deps.store.get_member(member_id)
        if existing is None:
            raise DomainError("not_found", f"Member {member_id} does not exist")
        if existing.name != validated and self._deps.store.name_taken(validated):
            raise DomainError("duplicate_name", "Member names must be unique")
        member = self._deps.store.rename_member(member_id, validated)
        return {"id": member.id, "name": member.name}

    def pause_agent(self, agent_id: int) -> dict[str, Any]:
        self._check("organization.pause_agent", agent_id)
        self._deps.store.set_agent_state(agent_id, "paused")
        return {"id": agent_id, "state": "paused"}

    def resume_agent(self, agent_id: int) -> dict[str, Any]:
        self._check("organization.resume_agent", agent_id)
        self._deps.store.set_agent_state(agent_id, "idle")
        return {"id": agent_id, "state": "idle"}

    def delete_agent(self, agent_id: int) -> dict[str, Any]:
        self._check("organization.delete_agent", agent_id)
        member = self._deps.store.get_member(agent_id)
        if member is None or not member.is_agent:
            raise DomainError("not_found", f"Agent {agent_id} does not exist")
        if member.state == "running":
            raise DomainError(
                "agent_running",
                "Pause the Agent and let its Turn finish before deleting",
            )
        self._deps.store.delete_member(agent_id)
        self._deps.todos.clear_todos(agent_id)
        return {"id": agent_id, "deleted": True}

    def create_discussion(
        self, topic: str, member_ids: Sequence[int]
    ) -> dict[str, Any]:
        self._check("discussion.create")
        validated = validate_topic(topic)
        others = [
            item for item in dict.fromkeys(member_ids) if item != self._actor.member_id
        ]
        if not others:
            raise DomainError(
                "needs_members", "A Discussion needs at least one other Member"
            )
        known = {item.id for item in self._deps.store.list_members()}
        unknown = [item for item in others if item not in known]
        if unknown:
            raise DomainError("not_found", f"Unknown Members: {unknown}")
        discussion = self._deps.store.create_discussion(
            validated, [self._actor.member_id, *others]
        )
        return {
            "id": discussion.id,
            "topic": discussion.topic,
            "member_ids": sorted(discussion.member_ids),
        }

    def list_discussions(self, include_archived: bool = False) -> list[dict[str, Any]]:
        self._check("discussion.list")
        unread = self._deps.store.unread_counts(self._actor.member_id)
        return [
            {
                "id": item.id,
                "topic": item.topic,
                "member_ids": sorted(item.member_ids),
                "archived": item.archived,
                "unread": unread.get(item.id, 0),
            }
            for item in self._deps.store.list_discussions(
                member_id=self._actor.member_id, include_archived=include_archived
            )
        ]

    def read_discussion(
        self,
        discussion_id: int,
        message_id: int | None = None,
        limit: int | None = None,
    ) -> dict[str, Any]:
        self._check("discussion.read", discussion_id)
        self._require_membership(discussion_id)
        store = self._deps.store
        discussion = store.get_discussion(discussion_id)
        assert discussion is not None
        everything = store.messages(discussion_id)

        if message_id is None:
            selected = everything[-limit:] if limit else everything
        else:
            mentions = store.mentions_by_message(discussion_id)
            watermark = store.watermark(discussion_id, self._actor.member_id)
            try:
                selected = context_window(
                    everything,
                    message_id,
                    self._actor.member_id,
                    mentions,
                    watermark,
                )
            except ValueError as error:
                raise DomainError(
                    "not_found", f"Message {message_id} is not in this Discussion"
                ) from error
            start = everything.index(selected[0])
            lead = everything[max(0, start - CONTEXT_LEAD) : start]
            selected = (*lead, *selected)

        if selected:
            store.set_watermark(
                discussion_id,
                self._actor.member_id,
                advance_watermark(
                    store.watermark(discussion_id, self._actor.member_id), selected
                ),
            )

        members = {
            item.id: item.name for item in store.list_members(include_deleted=True)
        }
        return {
            "id": discussion.id,
            "topic": discussion.topic,
            "members": [
                {"id": item, "name": members.get(item, f"Member {item}")}
                for item in sorted(discussion.member_ids)
            ],
            "total_messages": store.message_count(discussion_id),
            "messages": [
                {
                    "id": item.id,
                    "sender_id": item.sender_id,
                    "sender_name": item.sender_name,
                    "body": item.body,
                    "created_at": item.created_at,
                }
                for item in selected
            ],
        }

    def send_message(self, discussion_id: int, body: str) -> dict[str, Any]:
        self._check("discussion.send", discussion_id)
        self._require_membership(discussion_id)
        validated = validate_body(body)
        message, mentions = self._deps.store.append_message(
            discussion_id, self._actor.member_id, validated
        )
        self._deps.store.set_watermark(discussion_id, self._actor.member_id, message.id)
        return {
            "discussion_id": message.discussion_id,
            "id": message.id,
            "created_at": message.created_at,
            "mentioned": [item.member_id for item in mentions],
        }

    def ack(self, discussion_id: int, message_ids: Sequence[int]) -> dict[str, Any]:
        self._check("discussion.ack", discussion_id)
        self._require_membership(discussion_id)
        watermark = self._deps.store.watermark(discussion_id, self._actor.member_id)
        unread = [item for item in message_ids if item > watermark]
        if unread:
            raise DomainError(
                "not_read", f"Read messages {unread} before acknowledging them"
            )
        acked = self._deps.store.ack(
            discussion_id, list(message_ids), self._actor.member_id
        )
        return {"discussion_id": discussion_id, "acked": acked}

    def search_messages(
        self,
        query: str,
        sender_id: int | None = None,
        discussion_id: int | None = None,
    ) -> list[dict[str, Any]]:
        self._check("discussion.search")
        mine = {
            item.id
            for item in self._deps.store.list_discussions(
                member_id=self._actor.member_id, include_archived=True
            )
        }
        found = self._deps.store.search_messages(
            query, sender_id=sender_id, discussion_id=discussion_id
        )
        return [
            {
                "discussion_id": item.discussion_id,
                "id": item.id,
                "sender_name": item.sender_name,
                "body": item.body,
            }
            for item in found
            if item.discussion_id in mine
        ]

    def run(
        self,
        argv: Sequence[str],
        cwd: str | None = None,
        timeout: int | None = None,
    ) -> dict[str, Any]:
        self._check("run")
        result = self._deps.sandbox.run(list(argv), cwd=cwd, timeout=timeout)
        return {
            "exit_code": result.exit_code,
            "stdout": result.stdout,
            "stderr": result.stderr,
            "truncated": result.truncated,
        }

    def edit(
        self,
        path: str,
        old_text: str,
        new_text: str,
        replace_all: bool = False,
    ) -> dict[str, Any]:
        self._check("edit", path)
        result = self._deps.sandbox.edit(
            path, old_text, new_text, replace_all=replace_all
        )
        return {
            "path": result.path,
            "diff": result.diff,
            "replacements": result.replacements,
        }

    def _todos(self) -> Todos:
        return Todos(self._deps.todos, self._actor.member_id)

    def list_todos(self) -> list[dict[str, Any]]:
        self._check("todo.list")
        return [
            {
                "id": item.id,
                "title": item.title,
                "status": item.status,
                "detail": item.detail,
            }
            for item in self._todos().list()
        ]

    def add_todo(self, title: str, detail: str | None = None) -> dict[str, Any]:
        self._check("todo.add")
        item = self._todos().add(title, detail)
        return {"id": item.id, "title": item.title, "status": item.status}

    def start_todo(self, todo_id: int) -> dict[str, Any]:
        self._check("todo.start", todo_id)
        item = self._todos().start(todo_id)
        return {"id": item.id, "status": item.status}

    def complete_todo(self, todo_id: int) -> dict[str, Any]:
        self._check("todo.complete", todo_id)
        item = self._todos().complete(todo_id)
        return {"id": item.id, "status": item.status}

    def remove_todo(self, todo_id: int) -> dict[str, Any]:
        self._check("todo.remove", todo_id)
        self._todos().remove(todo_id)
        return {"id": todo_id, "removed": True}

    def _memory(self) -> Memory:
        return Memory(self._deps.memory_tree_for(self._actor.member_id))

    def list_memory(self) -> list[dict[str, Any]]:
        self._check("memory.list")
        return [
            {"path": item.path, "size": item.size, "hash": item.content_hash}
            for item in self._memory().list()
        ]

    def read_memory(self, path: str) -> dict[str, Any]:
        self._check("memory.read", path)
        content, digest = self._memory().read(path)
        return {"path": path, "content": content, "hash": digest}

    def write_memory(
        self, path: str, content: str, expected_hash: str | None = None
    ) -> dict[str, Any]:
        self._check("memory.write", path)
        entry = self._memory().write(path, content, expected_hash=expected_hash)
        return {"path": entry.path, "hash": entry.content_hash}

    def delete_memory(self, path: str) -> dict[str, Any]:
        self._check("memory.delete", path)
        self._memory().delete(path)
        return {"path": path, "deleted": True}

    def _library(self) -> Library:
        return Library(self._deps.library_tree)

    def list_library(self, path: str | None = None) -> list[dict[str, Any]]:
        self._check("library.list")
        return [
            {"path": item.path, "size": item.size, "hash": item.content_hash}
            for item in self._library().list(path)
        ]

    def read_library(self, path: str) -> dict[str, Any]:
        self._check("library.read", path)
        document = self._library().read(path)
        return {
            "path": document.path,
            "content": document.content,
            "hash": document.content_hash,
        }

    def write_library(
        self, path: str, content: str, expected_hash: str | None = None
    ) -> dict[str, Any]:
        self._check("library.write", path)
        try:
            entry = self._library().write(path, content, expected_hash=expected_hash)
        except ConflictError as conflict:
            current, digest = self._library()._tree.read(path)
            return {
                "conflict": True,
                "path": conflict.path,
                "current_hash": digest,
                "current_content": current,
            }
        return {"path": entry.path, "hash": entry.content_hash}

    def delete_library(self, path: str) -> dict[str, Any]:
        self._check("library.delete", path)
        self._library().delete(path)
        return {"path": path, "deleted": True}

    def move_library(self, source: str, destination: str) -> dict[str, Any]:
        self._check("library.move", source)
        entry = self._library().move(source, destination)
        return {"path": entry.path, "hash": entry.content_hash}

    def _history(self) -> History:
        return History(self._deps.history, self._actor.member_id)

    def search_history(self, query: str) -> list[dict[str, Any]]:
        self._check("history.search")
        return [
            {
                "sequence": item.sequence,
                "status": item.status,
                "started_at": item.started_at,
            }
            for item in self._history().search(query)
        ]

    def read_history(self, sequence: int) -> dict[str, Any]:
        self._check("history.read", sequence)
        run = self._history().read(sequence)
        if run is None:
            raise DomainError("not_found", f"Run {sequence} does not exist")
        return {
            "sequence": run.sequence,
            "status": run.status,
            "started_at": run.started_at,
            "messages": run.messages_json,
        }
