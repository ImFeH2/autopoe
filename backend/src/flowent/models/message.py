from __future__ import annotations

import time
from dataclasses import dataclass, field

from flowent.models.content import (
    ContentPart,
    content_parts_to_text,
    deserialize_content_parts,
)


@dataclass
class Message:
    from_id: str
    to_id: str
    parts: list[ContentPart] = field(default_factory=list)
    content: str = ""
    message_id: str | None = None
    history_recorded: bool = False
    from_output_port_key: str | None = None
    to_input_port_key: str | None = None
    port_type: str | None = None
    value: object | None = None
    value_summary: str | None = None
    port_inbound_recorded: bool = False
    timestamp: float = field(default_factory=time.time)

    def __post_init__(self) -> None:
        if self.parts and not self.content:
            self.content = content_parts_to_text(self.parts)
        elif self.content and not self.parts:
            self.parts = deserialize_content_parts(None, fallback_text=self.content)
