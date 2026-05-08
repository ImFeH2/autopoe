from __future__ import annotations

from typing import TYPE_CHECKING, Any, ClassVar

from flowent.tools import Tool

if TYPE_CHECKING:
    from flowent.agent import Agent


class SendTool(Tool):
    name = "send"
    description = "Send to one current contact or output-port path."
    parameters: ClassVar[dict[str, Any]] = {
        "type": "object",
        "properties": {
            "target": {
                "type": "string",
                "description": "One target id, name, or unique short id from contacts.",
            },
            "from_output_port_key": {
                "type": "string",
                "description": "Source output port key for workflow path sends.",
            },
            "to_input_port_key": {
                "type": "string",
                "description": "Target input port key for workflow path sends.",
            },
            "value": {
                "description": "Typed value for workflow path sends. Use ordered parts for parts ports, a string for string ports, or an object for json ports.",
            },
            "parts": {
                "type": "array",
                "description": "Ordered message parts for Assistant and Leader entry contacts.",
                "items": {
                    "type": "object",
                    "properties": {
                        "type": {"type": "string", "enum": ["text", "image"]},
                        "text": {"type": "string"},
                        "asset_id": {"type": "string"},
                        "mime_type": {"type": "string"},
                        "width": {"type": "integer"},
                        "height": {"type": "integer"},
                        "alt": {"type": "string"},
                    },
                    "required": ["type"],
                },
            },
        },
        "required": ["target"],
        "additionalProperties": False,
    }

    def execute(self, agent: Agent, args: dict[str, Any], **_kwargs: Any) -> str:
        target = args.get("target")
        if not isinstance(target, str) or not target.strip():
            raise ValueError("send.target must be a non-empty string")
        if not agent._is_entry_level_sender():
            return agent.send_port_value(
                target_ref=target.strip(),
                from_output_port_key=args.get("from_output_port_key"),
                to_input_port_key=args.get("to_input_port_key"),
                raw_value=args.get("value", args.get("parts")),
            )
        return agent.send_message(
            target_ref=target.strip(),
            raw_parts=args.get("parts"),
        )
