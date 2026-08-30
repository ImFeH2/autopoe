from __future__ import annotations

import json
from dataclasses import dataclass

KEEP_RECENT = 8


@dataclass(frozen=True)
class Compaction:
    kept: list[object]
    dropped: int
    before_bytes: int
    after_bytes: int

    @property
    def applied(self) -> bool:
        return self.dropped > 0


def _is_request(entry: object) -> bool:
    return isinstance(entry, dict) and entry.get("kind") == "request"


def compact(
    messages: list[object], threshold: int, *, keep: int = KEEP_RECENT
) -> Compaction:
    encoded = json.dumps(messages, ensure_ascii=False)
    before = len(encoded)
    if before <= threshold or len(messages) <= keep:
        return Compaction(messages, 0, before, before)

    boundary = len(messages) - keep
    while boundary < len(messages) and not _is_request(messages[boundary]):
        boundary += 1
    if boundary >= len(messages):
        return Compaction(messages, 0, before, before)

    kept = messages[boundary:]
    after = len(json.dumps(kept, ensure_ascii=False))
    return Compaction(kept, boundary, before, after)
