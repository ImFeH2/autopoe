from __future__ import annotations

import json
from typing import TYPE_CHECKING, Any, ClassVar

from flowent.graph_service import create_tab, serialize_tab_summary
from flowent.tools import Tool

if TYPE_CHECKING:
    from flowent.agent import Agent


class CreateTabTool(Tool):
    name = "create_workflow"
    description = "Create a new workflow with its own permission boundary."
    parameters: ClassVar[dict[str, Any]] = {
        "type": "object",
        "properties": {
            "title": {
                "type": "string",
                "description": "Human-readable workflow title",
            },
            "allow_network": {
                "type": "boolean",
                "description": "Whether this workflow should have network access (default False)",
            },
            "write_dirs": {
                "type": "array",
                "items": {"type": "string"},
                "description": "List of directory paths this workflow is allowed to write to",
            },
        },
        "required": ["title"],
    }

    def execute(self, agent: Agent, args: dict[str, Any], **_kwargs: Any) -> str:
        title = args.get("title")
        allow_network = args.get("allow_network", False)
        write_dirs = args.get("write_dirs", [])
        if not isinstance(title, str) or not title.strip():
            return json.dumps({"error": "title must be a non-empty string"})
        if not isinstance(allow_network, bool):
            return json.dumps({"error": "allow_network must be a boolean"})
        if not isinstance(write_dirs, list) or not all(
            isinstance(x, str) for x in write_dirs
        ):
            return json.dumps({"error": "write_dirs must be a list of strings"})

        try:
            tab = create_tab(
                title=title,
                allow_network=allow_network,
                write_dirs=write_dirs,
            )
        except ValueError as exc:
            return json.dumps({"error": str(exc)})
        return json.dumps(serialize_tab_summary(tab))
