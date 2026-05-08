from __future__ import annotations

import json
from typing import TYPE_CHECKING, Any, ClassVar

from flowent.tools import Tool

if TYPE_CHECKING:
    from flowent.agent import Agent


class ListToolsTool(Tool):
    name = "list_tools"
    description = "List all registered tools with their names and descriptions."
    parameters: ClassVar[dict[str, Any]] = {
        "type": "object",
        "properties": {},
        "required": [],
    }

    def execute(self, agent: Agent, args: dict[str, Any], **_kwargs: Any) -> str:
        from flowent.models import NodeType
        from flowent.tools import list_agent_visible_tool_descriptors

        descriptors = list_agent_visible_tool_descriptors(
            include_assistant_only=agent.node_type == NodeType.ASSISTANT
        )
        return json.dumps(descriptors)
