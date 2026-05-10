from __future__ import annotations

from typing import TYPE_CHECKING, Any

from flowent.sandbox import is_path_writable

if TYPE_CHECKING:
    from flowent.agent import Agent


def authorize(tool_name: str, agent: Agent, args: dict[str, Any]) -> str | None:
    from flowent.graph_service import resolve_effective_permissions_for_agent
    from flowent.models import NodeType
    from flowent.tools import (
        is_assistant_only_tool_name,
    )

    if agent.node_type != NodeType.ASSISTANT and is_assistant_only_tool_name(tool_name):
        return "Ask the Assistant to manage workflows or settings"

    allow_network, write_dirs = resolve_effective_permissions_for_agent(agent)

    if tool_name.startswith("mcp__"):
        return f"Tool not found: {tool_name}"

    if tool_name == "edit":
        if not write_dirs:
            return "Write access is disabled for this workflow"
        path = args.get("path")
        if isinstance(path, str) and not is_path_writable(path, write_dirs):
            return f"Path not in write_dirs: {path}"
        return None

    if tool_name == "fetch" and not allow_network:
        return "Network access is disabled for this workflow"

    return None
