from __future__ import annotations

import json
from collections.abc import Callable, Sequence
from dataclasses import dataclass, field
from datetime import UTC, datetime
from threading import Lock
from typing import Any, Literal, Protocol
from uuid import uuid4

from pydantic_ai import ModelMessagesTypeAdapter
from pydantic_ai.messages import ModelMessage

from flowent.domain import Reminder

RunStatus = Literal["running", "completed", "failed", "interrupted"]
HistoryEventSink = Callable[[dict[str, Any]], None]


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

    def emit(self, event_type: str, **data: Any) -> None:
        self._history._record_event(self, event_type, data)

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
        self._publish(run, "run_started", reminder=reminder_data)
        return run

    def delete(self, agent_id: int) -> None:
        with self._lock:
            if agent_id in self._active_runs:
                raise RuntimeError("Running Agent history cannot be deleted")
        self._repository.delete_agent_runs(agent_id)

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
        return {"agent_id": agent_id, "runs": runs}

    def _load_messages(self, agent_id: int) -> list[ModelMessage]:
        messages: list[ModelMessage] = []
        for run in self._repository.load_agent_runs(agent_id):
            messages.extend(
                ModelMessagesTypeAdapter.validate_json(run["messages_json"])
            )
        return messages

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
                if part_kind == "text":
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
                elif part_kind == "tool-call":
                    entries.append(
                        {
                            "id": entry_id,
                            "type": "tool_call",
                            "timestamp": message_timestamp,
                            "tool_name": part.get("tool_name"),
                            "content": _format_content(part.get("args")),
                            "state": message_state,
                        }
                    )
                elif part_kind == "tool-return":
                    entries.append(
                        {
                            "id": entry_id,
                            "type": "tool_result",
                            "timestamp": part.get("timestamp") or message_timestamp,
                            "tool_name": part.get("tool_name"),
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


def _timestamp() -> str:
    return datetime.now(UTC).isoformat()


def _format_content(content: Any) -> str:
    if isinstance(content, str):
        return content
    return json.dumps(content, ensure_ascii=False, indent=2, sort_keys=True)
