import asyncio
import copy
import json
from dataclasses import dataclass, field
from typing import Literal
from uuid import uuid4

from flowent.storage import StoredMessage


@dataclass
class WorkspaceRun:
    condition: asyncio.Condition
    active_output: Literal["text", "thinking"] | None = None
    discard_on_cancel: bool = False
    events: list[tuple[int, str, dict[str, object]]] = field(default_factory=list)
    generation: int = 0
    id: str = field(default_factory=lambda: str(uuid4()))
    is_done: bool = False
    latest_snapshot: StoredMessage | None = None
    task: asyncio.Task[None] | None = None

    @property
    def latest_event_index(self) -> int:
        return self.events[-1][0] if self.events else 0


def stream_event(
    event: str, data: dict[str, object], event_id: int | None = None
) -> str:
    id_line = f"id: {event_id}\n" if event_id is not None else ""
    return f"{id_line}event: {event}\ndata: {json.dumps(data)}\n\n"


def stream_message_data(
    message: StoredMessage, active_output: Literal["text", "thinking"] | None = None
) -> dict[str, object]:
    data = {**message.model_dump(), "status": message.status}
    if active_output is not None:
        data["active_output"] = active_output
    return data


def append_or_replace_message(
    messages: list[StoredMessage], message: StoredMessage
) -> list[StoredMessage]:
    return [
        *(current for current in messages if current.id != message.id),
        message,
    ]


def run_snapshot_data_at(
    run: WorkspaceRun, event_index: int
) -> dict[str, object] | None:
    snapshot_event_index = 0
    snapshot: dict[str, object] | None = None
    for current_event_index, event, data in run.events:
        if current_event_index > event_index:
            break
        if event != "snapshot":
            if event == "start" and snapshot is None:
                assistant_id = data.get("id")
                if isinstance(assistant_id, str):
                    snapshot_event_index = current_event_index
                    snapshot = {
                        "author": "assistant",
                        "content": "",
                        "groups": [],
                        "id": assistant_id,
                        "status": "running",
                        "tools": [],
                    }
            continue
        message = data.get("message")
        if isinstance(message, dict):
            snapshot_event_index = current_event_index
            snapshot = copy.deepcopy(message)
    if snapshot is None:
        return None
    for current_event_index, event, data in run.events:
        if current_event_index <= snapshot_event_index:
            continue
        if current_event_index > event_index:
            break
        apply_stream_event_to_snapshot(snapshot, event, data)
    return snapshot


def apply_stream_event_to_snapshot(
    snapshot: dict[str, object], event: str, data: dict[str, object]
) -> None:
    if event == "output_start":
        snapshot.pop("active_output", None)
        index = data.get("index")
        if isinstance(index, int):
            append_snapshot_group(snapshot, index)
    if event == "delta":
        append_snapshot_text(snapshot, str(data.get("content") or ""))
    if event == "thinking_delta":
        append_snapshot_thinking(snapshot, str(data.get("content") or ""))
    if event == "output_done":
        snapshot.pop("active_output", None)


def snapshot_groups(snapshot: dict[str, object]) -> list[dict[str, object]]:
    groups = snapshot.get("groups")
    if not isinstance(groups, list):
        groups = []
        snapshot["groups"] = groups
    return groups


def append_snapshot_group(
    snapshot: dict[str, object], index: int | None = None
) -> None:
    groups = snapshot_groups(snapshot)
    assistant_id = str(snapshot.get("id") or "assistant")
    group_index = index if index is not None else len(groups) + 1
    group_id = f"{assistant_id}-group-{group_index}"
    if groups and groups[-1].get("id") == group_id:
        return
    groups.append({"id": group_id, "items": []})


def append_snapshot_text(snapshot: dict[str, object], content: str) -> None:
    if not content:
        return
    snapshot["active_output"] = "text"
    snapshot["content"] = f"{snapshot.get('content') or ''}{content}"
    append_snapshot_item_content(snapshot, content, "text")


def append_snapshot_thinking(snapshot: dict[str, object], content: str) -> None:
    if not content:
        return
    snapshot["active_output"] = "thinking"
    snapshot["thinking"] = f"{snapshot.get('thinking') or ''}{content}"
    append_snapshot_item_content(snapshot, content, "thinking")


def append_snapshot_item_content(
    snapshot: dict[str, object], content: str, item_type: Literal["text", "thinking"]
) -> None:
    groups = snapshot_groups(snapshot)
    if not groups:
        append_snapshot_group(snapshot)
    group = groups[-1]
    items = group.get("items")
    if not isinstance(items, list):
        items = []
        group["items"] = items
    item = next(
        (
            current
            for current in reversed(items)
            if isinstance(current, dict) and current.get("type") == item_type
        ),
        None,
    )
    if item is None:
        assistant_id = str(snapshot.get("id") or "assistant")
        snapshot_item_count = 0
        for current_group in groups:
            current_items = current_group.get("items")
            if not isinstance(current_items, list):
                continue
            snapshot_item_count += sum(
                1
                for current_item in current_items
                if isinstance(current_item, dict)
                and current_item.get("type") == item_type
            )
        item = {
            "content": "",
            "id": f"{assistant_id}-{item_type}-{snapshot_item_count + 1}",
            "type": item_type,
        }
        items.append(item)
    item["content"] = f"{item.get('content') or ''}{content}"
