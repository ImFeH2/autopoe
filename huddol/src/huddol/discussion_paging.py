from __future__ import annotations

from collections.abc import Callable, Sequence
from typing import Any, Literal

from huddol.domain import DomainError

MessagePageMode = Literal["latest", "before", "after", "anchor"]


def select_message_page(
    messages: Sequence[Any],
    *,
    discussion_id: int,
    limit: int = 50,
    before_message_id: int | None = None,
    after_message_id: int | None = None,
    anchor_message_id: int | None = None,
    project: Callable[[Any], dict[str, Any]],
) -> dict[str, Any]:
    """Select a stable-ID page without assuming IDs are contiguous."""
    if limit < 1 or limit > 100:
        raise DomainError("invalid_limit", "limit must be between 1 and 100")
    cursors = [before_message_id, after_message_id, anchor_message_id]
    if sum(cursor is not None for cursor in cursors) > 1:
        raise DomainError("invalid_range", "Provide at most one message cursor")
    if any(cursor is not None and cursor < 1 for cursor in cursors):
        raise DomainError("invalid_range", "Message cursors must be positive")

    ordered = sorted(messages, key=lambda message: message.id)
    ids = [message.id for message in ordered]
    if len(ids) != len(set(ids)):
        raise ValueError("Message IDs must be unique")

    mode: MessagePageMode
    selected: list[Any]
    anchor_index: int | None = None
    if anchor_message_id is not None:
        mode = "anchor"
        try:
            absolute_anchor_index = ids.index(anchor_message_id)
        except ValueError as error:
            raise DomainError("message_not_found", "Message not found") from error
        before_count = min(24, absolute_anchor_index)
        start = absolute_anchor_index - before_count
        end = min(len(ordered), start + limit)
        start = max(0, end - limit)
        selected = ordered[start:end]
        anchor_index = absolute_anchor_index - start
    elif before_message_id is not None:
        mode = "before"
        candidates = [message for message in ordered if message.id < before_message_id]
        selected = candidates[-limit:]
    elif after_message_id is not None:
        mode = "after"
        candidates = [message for message in ordered if message.id > after_message_id]
        selected = candidates[:limit]
    else:
        mode = "latest"
        selected = ordered[-limit:]

    oldest = selected[0].id if selected else None
    newest = selected[-1].id if selected else None
    latest = ids[-1] if ids else None
    has_earlier = oldest is not None and any(message_id < oldest for message_id in ids)
    has_later = newest is not None and any(message_id > newest for message_id in ids)
    result: dict[str, Any] = {
        "discussion_id": discussion_id,
        "mode": mode,
        "messages": [project(message) for message in selected],
        "oldest_message_id": oldest,
        "newest_message_id": newest,
        "latest_message_id": latest,
        "has_earlier": has_earlier,
        "has_later": has_later,
        "next_before_message_id": oldest if has_earlier else None,
        "next_after_message_id": newest if has_later else None,
    }
    if mode == "anchor":
        result["anchor_message_id"] = anchor_message_id
        result["anchor_index"] = anchor_index
    return result
