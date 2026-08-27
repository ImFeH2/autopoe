from __future__ import annotations

import json
import logging
from collections.abc import Callable, Sequence
from dataclasses import dataclass, field
from datetime import UTC, datetime
from threading import Lock
from typing import Any, Literal, Protocol
from uuid import uuid4

from pydantic_ai import ModelMessagesTypeAdapter
from pydantic_ai.messages import ModelMessage

from huddol.diagnostics import log_event
from huddol.domain import DomainError, Reminder

RunStatus = Literal["running", "completed", "failed", "interrupted"]
HistoryEventSink = Callable[[dict[str, Any]], None]
HISTORY_LIST_MAX = 100
HISTORY_SEARCH_MAX = 50
HISTORY_READ_MAX = 100
HISTORY_ENTRY_MAX_CHARS = 16_000
HISTORY_PREVIEW_CHARS = 500
HISTORY_SNIPPET_CHARS = 400


class AgentHistoryRepository(Protocol):
    def begin_agent_run(
        self,
        agent_id: int,
        run_id: str,
        started_at: str,
        reminder: dict[str, Any],
    ) -> int: ...

    def complete_agent_run(
        self,
        agent_id: int,
        run_id: str,
        status: RunStatus,
        completed_at: str,
        messages_json: str,
        usage: dict[str, Any] | None,
        error: str | None,
    ) -> None: ...

    def load_agent_runs(self, agent_id: int) -> list[dict[str, Any]]: ...

    def load_agent_run_page(
        self, agent_id: int, before_sequence: int | None, limit: int
    ) -> list[dict[str, Any]]: ...

    def load_agent_run(self, agent_id: int, run_id: str) -> dict[str, Any] | None: ...

    def delete_agent_runs(self, agent_id: int) -> None: ...


@dataclass
class AgentHistoryRun:
    _history: AgentHistory
    agent_id: int
    run_id: str
    sequence: int
    started_at: str
    reminder: dict[str, Any]
    message_history: tuple[ModelMessage, ...]
    _event_sequence: int = 0
    _live_entries: list[dict[str, Any]] = field(default_factory=list)
    _text_entries: dict[str, dict[str, Any]] = field(default_factory=dict)
    _thinking_parts: set[str] = field(default_factory=set)
    _compaction_provider: str | None = None
    _compaction_timestamp: str | None = None

    def emit(self, event_type: str, **data: Any) -> None:
        self._history._record_event(self, event_type, data)

    def mark_compacted(self, provider: str | None) -> None:
        self._history._mark_compacted(self, provider)

    def complete(
        self,
        status: RunStatus,
        messages: Sequence[ModelMessage],
        usage: dict[str, Any] | None = None,
        error: str | None = None,
    ) -> None:
        self._history._complete(self, status, messages, usage, error)


class AgentHistory:
    def __init__(
        self,
        repository: AgentHistoryRepository,
        event_sink: HistoryEventSink | None = None,
    ) -> None:
        self._repository = repository
        self._event_sink = event_sink
        self._lock = Lock()
        self._active_runs: dict[int, AgentHistoryRun] = {}

    def start(self, reminder: Reminder) -> AgentHistoryRun:
        message_history = tuple(self._load_messages(reminder.agent_id))
        run_id = str(uuid4())
        started_at = _timestamp()
        reminder_data = {
            "mentions": [
                {
                    "discussion_id": mention.discussion_id,
                    "message_id": mention.message_id,
                    "sender_id": mention.sender_id,
                    "body": mention.body,
                    "previously_reminded": mention.previously_reminded,
                }
                for mention in reminder.mentions
            ]
        }
        sequence = self._repository.begin_agent_run(
            reminder.agent_id,
            run_id,
            started_at,
            reminder_data,
        )
        run = AgentHistoryRun(
            self,
            reminder.agent_id,
            run_id,
            sequence,
            started_at,
            reminder_data,
            message_history,
        )
        with self._lock:
            self._active_runs[reminder.agent_id] = run
        log_event(
            "history.turn.started",
            agent_id=reminder.agent_id,
            turn_id=run_id,
            sequence=sequence,
            reminder_count=len(reminder.mentions),
            previous_message_count=len(message_history),
        )
        self._publish(run, "run_started", reminder=reminder_data)
        return run

    def delete(self, agent_id: int) -> None:
        with self._lock:
            if agent_id in self._active_runs:
                raise RuntimeError("Running Agent history cannot be deleted")
        self._repository.delete_agent_runs(agent_id)
        log_event("history.agent.deleted", agent_id=agent_id)

    def snapshot(self, agent_id: int) -> dict[str, Any]:
        runs = [
            self._project_run(run) for run in self._repository.load_agent_runs(agent_id)
        ]
        with self._lock:
            active = self._active_runs.get(agent_id)
            if active is not None:
                live_entries = [dict(entry) for entry in active._live_entries]
                event_sequence = active._event_sequence
            else:
                live_entries = []
                event_sequence = 0
        if active is not None:
            for run in runs:
                if run["run_id"] == active.run_id:
                    run["entries"].extend(live_entries)
                    run["event_sequence"] = event_sequence
                    break
        log_event(
            "history.agent.loaded",
            level=logging.DEBUG,
            agent_id=agent_id,
            turn_count=len(runs),
            active=active is not None,
        )
        return {"agent_id": agent_id, "runs": runs}

    def runs_page(
        self,
        agent_id: int,
        *,
        before_sequence: int | None = None,
        limit: int = 30,
    ) -> dict[str, Any]:
        limit = _bounded_history_value("limit", limit, 1, 100)
        if before_sequence is not None and before_sequence < 1:
            raise DomainError(
                "invalid_history_arguments", "before_sequence must be positive"
            )
        rows = self._repository.load_agent_run_page(
            agent_id, before_sequence, limit + 1
        )
        has_earlier = len(rows) > limit
        selected = rows[:limit]
        with self._lock:
            active = self._active_runs.get(agent_id)
        metadata = []
        for row in reversed(selected):
            item = {
                "run_id": row["run_id"],
                "sequence": row["sequence"],
                "status": row["status"],
                "started_at": row["started_at"],
                "completed_at": row["completed_at"],
                "usage": row["usage"],
                "error": row["error"],
                "entry_count": row["entry_count"],
                "event_sequence": 0,
            }
            if active is not None and row["run_id"] == active.run_id:
                item["entry_count"] = 1 + len(active._live_entries)
                item["event_sequence"] = active._event_sequence
            metadata.append(item)
        return {
            "agent_id": agent_id,
            "runs": metadata,
            "has_earlier": has_earlier,
            "next_before_sequence": selected[-1]["sequence"]
            if has_earlier and selected
            else None,
        }

    def run_detail(self, agent_id: int, run_id: str) -> dict[str, Any]:
        row = self._repository.load_agent_run(agent_id, run_id)
        if row is None:
            raise DomainError(
                "history_run_not_found", "Agent History run was not found"
            )
        projected = self._project_run(row)
        with self._lock:
            active = self._active_runs.get(agent_id)
            if active is not None and active.run_id == run_id:
                projected["entries"].extend(
                    dict(entry) for entry in active._live_entries
                )
                projected["event_sequence"] = active._event_sequence
        entries = []
        for entry in projected["entries"]:
            content = entry.get("content")
            length = len(content) if isinstance(content, str) else 0
            entries.append(
                {
                    **entry,
                    **(
                        {"content": content[:HISTORY_PREVIEW_CHARS]}
                        if isinstance(content, str)
                        else {}
                    ),
                    "content_length": length,
                    "content_truncated": length > HISTORY_PREVIEW_CHARS,
                }
            )
        return {**projected, "sequence": row["sequence"], "entries": entries}

    def entry_detail(
        self,
        agent_id: int,
        run_id: str,
        entry_id: str,
        *,
        offset: int = 0,
        max_chars: int = 8_000,
    ) -> dict[str, Any]:
        if offset < 0:
            raise DomainError(
                "invalid_history_arguments", "offset must be non-negative"
            )
        max_chars = _bounded_history_value(
            "max_chars", max_chars, 1, HISTORY_ENTRY_MAX_CHARS
        )
        row = self._repository.load_agent_run(agent_id, run_id)
        if row is None:
            raise DomainError(
                "history_run_not_found", "Agent History run was not found"
            )
        projected = self._project_run(row)
        with self._lock:
            active = self._active_runs.get(agent_id)
            if active is not None and active.run_id == run_id:
                projected["entries"].extend(dict(item) for item in active._live_entries)
        entry = next(
            (item for item in projected["entries"] if item["id"] == entry_id), None
        )
        if entry is None:
            raise DomainError(
                "history_entry_not_found", "Agent History entry was not found"
            )
        content = entry.get("content")
        if not isinstance(content, str):
            content = json.dumps(
                entry.get("reminder", {}), ensure_ascii=False, indent=2
            )
        if offset > len(content):
            raise DomainError(
                "invalid_history_arguments", "offset exceeds content length"
            )
        end = min(len(content), offset + max_chars)
        return {
            "agent_id": agent_id,
            "run_id": run_id,
            "entry_id": entry_id,
            "type": entry["type"],
            "tool_name": entry.get("tool_name"),
            "paired_entry_id": entry.get("paired_entry_id"),
            "content": content[offset:end],
            "content_length": len(content),
            "offset": offset,
            "next_offset": end if end < len(content) else None,
            "truncated": end < len(content),
        }

    def list_compacted(
        self,
        agent_id: int,
        before_sequence: int | None = None,
        limit: int = 20,
    ) -> dict[str, Any]:
        limit = _bounded_history_value("limit", limit, 1, HISTORY_LIST_MAX)
        if before_sequence is not None and before_sequence < 1:
            raise DomainError(
                "invalid_history_arguments",
                "before_sequence must be a positive integer",
            )
        entries, checkpoint = self._compacted_archive(agent_id)
        turns: dict[int, dict[str, Any]] = {}
        for entry in entries:
            sequence = entry["sequence"]
            if before_sequence is not None and sequence >= before_sequence:
                continue
            turn = turns.setdefault(
                sequence,
                {
                    "sequence": sequence,
                    "run_id": entry["run_id"],
                    "status": entry["status"],
                    "started_at": entry["started_at"],
                    "entry_count": 0,
                },
            )
            turn["entry_count"] += 1
        ordered = sorted(
            turns.values(), key=lambda item: item["sequence"], reverse=True
        )
        selected = ordered[:limit]
        return {
            "action": "list",
            "checkpoint": checkpoint,
            "turns": selected,
            "count": len(selected),
            "has_more": len(ordered) > limit,
        }

    def search_compacted(
        self,
        agent_id: int,
        query: str,
        before_sequence: int | None = None,
        offset: int = 0,
        limit: int = 10,
    ) -> dict[str, Any]:
        query = query.strip()
        if not query:
            raise DomainError("invalid_history_arguments", "query is required")
        if len(query) > 500:
            raise DomainError(
                "invalid_history_arguments",
                "query must be at most 500 characters",
            )
        if before_sequence is not None and before_sequence < 1:
            raise DomainError(
                "invalid_history_arguments",
                "before_sequence must be a positive integer",
            )
        if offset < 0:
            raise DomainError(
                "invalid_history_arguments",
                "offset must be zero or greater",
            )
        limit = _bounded_history_value("limit", limit, 1, HISTORY_SEARCH_MAX)
        entries, checkpoint = self._compacted_archive(agent_id)
        normalized_query = query.casefold()
        matches: list[dict[str, Any]] = []
        for entry in reversed(entries):
            if before_sequence is not None and entry["sequence"] >= before_sequence:
                continue
            searchable = (
                f"{entry.get('tool_name') or ''}\n"
                f"{entry.get('tool_call_id') or ''}\n{entry['content']}"
            )
            match_index = searchable.casefold().find(normalized_query)
            if match_index < 0:
                continue
            content_index = entry["content"].casefold().find(normalized_query)
            matches.append(
                {
                    "sequence": entry["sequence"],
                    "entry_id": entry["id"],
                    "type": entry["type"],
                    "tool_name": entry.get("tool_name"),
                    "tool_call_id": entry.get("tool_call_id"),
                    "paired_entry_id": entry.get("paired_entry_id"),
                    "snippet": _history_snippet(
                        entry["content"],
                        max(content_index, 0),
                    ),
                }
            )
        selected = matches[offset : offset + limit]
        end = offset + len(selected)
        return {
            "action": "search",
            "checkpoint": checkpoint,
            "matches": selected,
            "count": len(selected),
            "offset": offset,
            "next_offset": end if end < len(matches) else None,
            "truncated": end < len(matches),
        }

    def read_compacted(
        self,
        agent_id: int,
        sequence: int | None = None,
        entry_id: str | None = None,
        offset: int = 0,
        limit: int = 20,
        max_chars: int = 8_000,
    ) -> dict[str, Any]:
        if (sequence is None) == (entry_id is None):
            raise DomainError(
                "invalid_history_arguments",
                "Provide exactly one of sequence or entry_id",
            )
        if offset < 0:
            raise DomainError(
                "invalid_history_arguments",
                "offset must be zero or greater",
            )
        entries, checkpoint = self._compacted_archive(agent_id)
        if entry_id is not None:
            max_chars = _bounded_history_value(
                "max_chars",
                max_chars,
                1,
                HISTORY_ENTRY_MAX_CHARS,
            )
            entry = next((item for item in entries if item["id"] == entry_id), None)
            if entry is None:
                raise DomainError(
                    "history_entry_not_found",
                    "Compacted History entry was not found",
                )
            content = entry["content"]
            if offset > len(content):
                raise DomainError(
                    "invalid_history_arguments",
                    "offset exceeds the entry content length",
                )
            end = min(len(content), offset + max_chars)
            return {
                "action": "read",
                "mode": "entry",
                "checkpoint": checkpoint,
                "sequence": entry["sequence"],
                "entry_id": entry["id"],
                "type": entry["type"],
                "tool_name": entry.get("tool_name"),
                "tool_call_id": entry.get("tool_call_id"),
                "paired_entry_id": entry.get("paired_entry_id"),
                "content": content[offset:end],
                "offset": offset,
                "next_offset": end if end < len(content) else None,
                "content_length": len(content),
                "truncated": end < len(content),
            }
        assert sequence is not None
        if sequence < 1:
            raise DomainError(
                "invalid_history_arguments",
                "sequence must be a positive integer",
            )
        limit = _bounded_history_value("limit", limit, 1, HISTORY_READ_MAX)
        turn_entries = [item for item in entries if item["sequence"] == sequence]
        if not turn_entries:
            raise DomainError(
                "history_turn_not_found",
                "Compacted History Turn was not found",
            )
        groups = _history_entry_groups(turn_entries)
        if offset > len(groups):
            raise DomainError(
                "invalid_history_arguments",
                "offset exceeds the Turn entry group count",
            )
        selected_groups = groups[offset : offset + limit]
        selected = [entry for group in selected_groups for entry in group]
        end = offset + len(selected_groups)
        return {
            "action": "read",
            "mode": "turn",
            "checkpoint": checkpoint,
            "sequence": sequence,
            "entries": [_history_entry_preview(entry) for entry in selected],
            "offset": offset,
            "next_offset": end if end < len(groups) else None,
            "total_entries": len(turn_entries),
            "total_groups": len(groups),
            "truncated": end < len(groups),
        }

    def _compacted_archive(
        self,
        agent_id: int,
    ) -> tuple[list[dict[str, Any]], dict[str, Any] | None]:
        runs = self._repository.load_agent_runs(agent_id)
        decoded_runs: list[list[dict[str, Any]]] = []
        boundary: tuple[int, int, int] | None = None
        checkpoint: dict[str, Any] | None = None
        for run_index, run in enumerate(runs):
            raw_messages = json.loads(run["messages_json"])
            if not isinstance(raw_messages, list):
                raise TypeError("Persisted Agent messages are invalid")
            decoded_runs.append(raw_messages)
            for message_index, message in enumerate(raw_messages):
                if not isinstance(message, dict):
                    raise TypeError("Persisted Agent message is invalid")
                parts = message.get("parts", [])
                if not isinstance(parts, list):
                    raise TypeError("Persisted Agent message parts are invalid")
                for part_index, part in enumerate(parts):
                    if (
                        not isinstance(part, dict)
                        or part.get("part_kind") != "compaction"
                    ):
                        continue
                    boundary = (run_index, message_index, part_index)
                    checkpoint = {
                        "sequence": run["sequence"],
                        "run_id": run["run_id"],
                        "entry_id": (f"{run['run_id']}-{message_index}-{part_index}"),
                        "provider": part.get("provider_name"),
                        "timestamp": message.get("timestamp") or run["started_at"],
                    }
        with self._lock:
            active = self._active_runs.get(agent_id)
            active_provider = (
                active._compaction_provider if active is not None else None
            )
        if active is not None and active_provider is not None:
            boundary = (len(runs), 0, 0)
            checkpoint = {
                "sequence": active.sequence,
                "run_id": active.run_id,
                "entry_id": f"{active.run_id}-pending-compaction",
                "provider": active_provider,
                "timestamp": active._compaction_timestamp,
                "pending": True,
            }
        if boundary is None:
            return [], None
        entries: list[dict[str, Any]] = []
        for run_index, (run, raw_messages) in enumerate(
            zip(runs, decoded_runs, strict=True)
        ):
            for message_index, message in enumerate(raw_messages):
                for part_index, part in enumerate(message.get("parts", [])):
                    if (run_index, message_index, part_index) >= boundary:
                        continue
                    entry = _compacted_history_entry(
                        run,
                        message,
                        message_index,
                        part,
                        part_index,
                    )
                    if entry is not None:
                        entries.append(entry)
        _link_tool_entries(entries)
        return entries, checkpoint

    def _load_messages(self, agent_id: int) -> list[ModelMessage]:
        messages: list[ModelMessage] = []
        for run in self._repository.load_agent_runs(agent_id):
            messages.extend(
                ModelMessagesTypeAdapter.validate_json(run["messages_json"])
            )
        return messages

    def _mark_compacted(
        self,
        run: AgentHistoryRun,
        provider: str | None,
    ) -> None:
        with self._lock:
            if self._active_runs.get(run.agent_id) is run:
                run._compaction_provider = provider or "unknown"
                if run._compaction_timestamp is None:
                    run._compaction_timestamp = _timestamp()

    def _record_event(
        self,
        run: AgentHistoryRun,
        event_type: str,
        data: dict[str, Any],
    ) -> None:
        with self._lock:
            if self._active_runs.get(run.agent_id) is not run:
                return
            if event_type == "text_delta":
                part_id = str(data["part_id"])
                entry = run._text_entries.get(part_id)
                if entry is None:
                    entry = {
                        "id": f"live-text-{part_id}",
                        "type": "assistant",
                        "timestamp": _timestamp(),
                        "content": "",
                        "state": "streaming",
                    }
                    run._text_entries[part_id] = entry
                    run._live_entries.append(entry)
                entry["content"] += str(data.get("content", ""))
            elif event_type == "thinking":
                part_id = str(data["part_id"])
                if part_id not in run._thinking_parts:
                    run._thinking_parts.add(part_id)
                    run._live_entries.append(
                        {
                            "id": f"live-thinking-{part_id}",
                            "type": "thinking",
                            "timestamp": _timestamp(),
                            "state": "streaming",
                        }
                    )
            elif event_type in ("tool_call", "tool_result", "retry"):
                run._live_entries.append(
                    {
                        "id": f"live-{event_type}-{len(run._live_entries) + 1}",
                        "type": event_type,
                        "timestamp": _timestamp(),
                        "tool_name": data.get("tool_name"),
                        "content": _format_content(data.get("content")),
                        "state": "complete",
                    }
                )
            run._event_sequence += 1
            event = {
                "agent_id": run.agent_id,
                "run_id": run.run_id,
                "sequence": run._event_sequence,
                "type": event_type,
                "timestamp": _timestamp(),
                **data,
            }
        self._send_event(event)

    def _complete(
        self,
        run: AgentHistoryRun,
        status: RunStatus,
        messages: Sequence[ModelMessage],
        usage: dict[str, Any] | None,
        error: str | None,
    ) -> None:
        completed_at = _timestamp()
        messages_json = ModelMessagesTypeAdapter.dump_json(list(messages)).decode(
            "utf-8"
        )
        self._repository.complete_agent_run(
            run.agent_id,
            run.run_id,
            status,
            completed_at,
            messages_json,
            usage,
            error,
        )
        with self._lock:
            if self._active_runs.get(run.agent_id) is run:
                del self._active_runs[run.agent_id]
        log_event(
            "history.turn.completed",
            agent_id=run.agent_id,
            turn_id=run.run_id,
            sequence=run.sequence,
            status=status,
            message_count=len(messages),
            has_usage=usage is not None,
            has_error=error is not None,
        )
        self._publish(
            run,
            "run_completed" if status == "completed" else "run_failed",
            status=status,
            error=error,
        )

    def _publish(
        self,
        run: AgentHistoryRun,
        event_type: str,
        **data: Any,
    ) -> None:
        with self._lock:
            run._event_sequence += 1
            event = {
                "agent_id": run.agent_id,
                "run_id": run.run_id,
                "sequence": run._event_sequence,
                "type": event_type,
                "timestamp": _timestamp(),
                **data,
            }
        self._send_event(event)

    def _send_event(self, event: dict[str, Any]) -> None:
        if self._event_sink is not None:
            self._event_sink(event)

    @staticmethod
    def _project_run(run: dict[str, Any]) -> dict[str, Any]:
        entries: list[dict[str, Any]] = [
            {
                "id": f"{run['run_id']}-reminder",
                "type": "reminder",
                "timestamp": run["started_at"],
                "reminder": _reminder_data(run["reminder"]),
                "state": "complete",
            }
        ]
        raw_messages = json.loads(run["messages_json"])
        for message_index, message in enumerate(raw_messages):
            message_timestamp = message.get("timestamp") or run["started_at"]
            message_state = message.get("state", "complete")
            for part_index, part in enumerate(message.get("parts", [])):
                part_kind = part.get("part_kind")
                entry_id = f"{run['run_id']}-{message_index}-{part_index}"
                if part_kind == "system-prompt":
                    entries.append(
                        {
                            "id": entry_id,
                            "type": "system",
                            "timestamp": message_timestamp,
                            "content": _format_content(part.get("content")),
                            "state": message_state,
                        }
                    )
                elif part_kind == "text":
                    entries.append(
                        {
                            "id": entry_id,
                            "type": "assistant",
                            "timestamp": message_timestamp,
                            "content": _format_content(part.get("content")),
                            "state": message_state,
                        }
                    )
                elif part_kind == "thinking":
                    entries.append(
                        {
                            "id": entry_id,
                            "type": "thinking",
                            "timestamp": message_timestamp,
                            "state": message_state,
                        }
                    )
                elif part_kind in ("tool-call", "builtin-tool-call"):
                    entries.append(
                        {
                            "id": entry_id,
                            "type": "tool_call",
                            "timestamp": message_timestamp,
                            "tool_name": part.get("tool_name"),
                            "tool_call_id": part.get("tool_call_id"),
                            "content": _format_content(part.get("args")),
                            "state": message_state,
                        }
                    )
                elif part_kind in ("tool-return", "builtin-tool-return"):
                    entries.append(
                        {
                            "id": entry_id,
                            "type": "tool_result",
                            "timestamp": part.get("timestamp") or message_timestamp,
                            "tool_name": part.get("tool_name"),
                            "tool_call_id": part.get("tool_call_id"),
                            "content": _format_content(part.get("content")),
                            "state": message_state,
                        }
                    )
                elif part_kind == "retry-prompt":
                    entries.append(
                        {
                            "id": entry_id,
                            "type": "retry",
                            "timestamp": part.get("timestamp") or message_timestamp,
                            "tool_name": part.get("tool_name"),
                            "tool_call_id": part.get("tool_call_id"),
                            "content": _format_content(part.get("content")),
                            "state": message_state,
                        }
                    )
        if run["error"]:
            entries.append(
                {
                    "id": f"{run['run_id']}-error",
                    "type": "error",
                    "timestamp": run["completed_at"] or run["started_at"],
                    "content": run["error"],
                    "state": "complete",
                }
            )
        _link_tool_entries(entries)
        return {
            "run_id": run["run_id"],
            "status": run["status"],
            "started_at": run["started_at"],
            "completed_at": run["completed_at"],
            "usage": run["usage"],
            "event_sequence": 0,
            "entries": entries,
        }


def _reminder_data(value: Any) -> dict[str, Any]:
    if isinstance(value, dict) and isinstance(value.get("mentions"), list):
        return value
    if isinstance(value, dict):
        return {
            "mentions": [
                {
                    "discussion_id": int(value["discussion_id"]),
                    "message_id": int(value["message_id"]),
                    "sender_id": 0,
                    "body": "",
                    "previously_reminded": False,
                }
            ]
        }
    if (
        isinstance(value, list)
        and len(value) == 1
        and isinstance(value[0], dict)
        and isinstance(value[0].get("discussion_id"), int)
        and isinstance(value[0].get("message_ids"), list)
        and len(value[0]["message_ids"]) == 1
        and isinstance(value[0]["message_ids"][0], int)
    ):
        return {
            "mentions": [
                {
                    "discussion_id": value[0]["discussion_id"],
                    "message_id": value[0]["message_ids"][0],
                    "sender_id": 0,
                    "body": "",
                    "previously_reminded": False,
                }
            ]
        }
    raise RuntimeError("Persisted Reminder is invalid")


def _compacted_history_entry(
    run: dict[str, Any],
    message: dict[str, Any],
    message_index: int,
    part: dict[str, Any],
    part_index: int,
) -> dict[str, Any] | None:
    part_kind = part.get("part_kind")
    entry_type: str | None = None
    content: Any = None
    if part_kind == "system-prompt":
        entry_type = "system"
        content = part.get("content")
    elif part_kind == "user-prompt":
        entry_type = "user"
        content = part.get("content")
    elif part_kind == "text":
        entry_type = "assistant"
        content = part.get("content")
    elif part_kind in ("tool-call", "builtin-tool-call"):
        entry_type = "tool_call"
        content = part.get("args")
    elif part_kind in ("tool-return", "builtin-tool-return"):
        entry_type = "tool_result"
        content = part.get("content")
    elif part_kind == "retry-prompt":
        entry_type = "retry"
        content = part.get("content")
    if entry_type is None:
        return None
    return {
        "sequence": run["sequence"],
        "run_id": run["run_id"],
        "status": run["status"],
        "started_at": run["started_at"],
        "id": f"{run['run_id']}-{message_index}-{part_index}",
        "type": entry_type,
        "timestamp": part.get("timestamp")
        or message.get("timestamp")
        or run["started_at"],
        "tool_name": part.get("tool_name"),
        "tool_call_id": part.get("tool_call_id"),
        "content": _format_content(content),
    }


def _history_entry_preview(entry: dict[str, Any]) -> dict[str, Any]:
    content = entry["content"]
    truncated = len(content) > HISTORY_PREVIEW_CHARS
    return {
        "entry_id": entry["id"],
        "type": entry["type"],
        "timestamp": entry["timestamp"],
        "tool_name": entry.get("tool_name"),
        "tool_call_id": entry.get("tool_call_id"),
        "paired_entry_id": entry.get("paired_entry_id"),
        "content": content[:HISTORY_PREVIEW_CHARS],
        "content_length": len(content),
        "content_truncated": truncated,
    }


def _link_tool_entries(entries: list[dict[str, Any]]) -> None:
    by_call_id: dict[tuple[str, str], list[dict[str, Any]]] = {}
    for entry in entries:
        tool_call_id = entry.get("tool_call_id")
        if isinstance(tool_call_id, str) and tool_call_id:
            key = (str(entry.get("run_id", "")), tool_call_id)
            by_call_id.setdefault(key, []).append(entry)
    for related in by_call_id.values():
        if len(related) != 2:
            continue
        related[0]["paired_entry_id"] = related[1]["id"]
        related[1]["paired_entry_id"] = related[0]["id"]


def _history_entry_groups(
    entries: list[dict[str, Any]],
) -> list[list[dict[str, Any]]]:
    by_call_id: dict[str, list[dict[str, Any]]] = {}
    for entry in entries:
        tool_call_id = entry.get("tool_call_id")
        if isinstance(tool_call_id, str) and tool_call_id:
            by_call_id.setdefault(tool_call_id, []).append(entry)
    groups: list[list[dict[str, Any]]] = []
    grouped_call_ids: set[str] = set()
    for entry in entries:
        tool_call_id = entry.get("tool_call_id")
        if not isinstance(tool_call_id, str) or not tool_call_id:
            groups.append([entry])
            continue
        if tool_call_id not in grouped_call_ids:
            grouped_call_ids.add(tool_call_id)
            groups.append(by_call_id[tool_call_id])
    return groups


def _history_snippet(content: str, match_index: int) -> str:
    start = max(0, match_index - HISTORY_SNIPPET_CHARS // 3)
    end = min(len(content), start + HISTORY_SNIPPET_CHARS)
    return content[start:end]


def _bounded_history_value(name: str, value: int, minimum: int, maximum: int) -> int:
    if value < minimum or value > maximum:
        raise DomainError(
            "invalid_history_arguments",
            f"{name} must be between {minimum} and {maximum}",
        )
    return value


def _timestamp() -> str:
    return datetime.now(UTC).isoformat()


def _format_content(content: Any) -> str:
    if isinstance(content, str):
        return content
    return json.dumps(content, ensure_ascii=False, indent=2, sort_keys=True)
