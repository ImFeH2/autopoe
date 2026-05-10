from __future__ import annotations

import json
from typing import TYPE_CHECKING, Any, ClassVar

from flowent.tools import Tool

if TYPE_CHECKING:
    from flowent.agent import Agent


class ListRolesTool(Tool):
    name = "list_roles"
    description = "List all registered roles with builtin and optional tool views."
    parameters: ClassVar[dict[str, Any]] = {
        "type": "object",
        "properties": {},
        "required": [],
    }

    def execute(self, agent: Agent, args: dict[str, Any], **_kwargs: Any) -> str:
        from flowent.models import NodeType
        from flowent.settings import get_settings, normalize_tool_names
        from flowent.tools import (
            MINIMUM_TOOLS,
            build_tool_registry,
            is_assistant_only_mcp_tool_name,
            is_assistant_only_tool_name,
            is_removed_workflow_copy_mcp_tool_name,
        )

        settings = get_settings()
        tool_registry = build_tool_registry()
        all_tool_names: list[str] = []
        for tool in tool_registry.list_tools(agent_visible_only=True):
            descriptor = getattr(tool, "_descriptor", None)
            descriptor_tool_name = getattr(descriptor, "tool_name", None)
            if isinstance(descriptor_tool_name, str) and (
                is_removed_workflow_copy_mcp_tool_name(descriptor_tool_name)
                or is_assistant_only_mcp_tool_name(descriptor_tool_name)
            ):
                continue
            all_tool_names.append(tool.name)
        if agent.node_type != NodeType.ASSISTANT:
            all_tool_names = [
                tool_name
                for tool_name in all_tool_names
                if not is_assistant_only_tool_name(tool_name)
            ]
        payload: list[dict[str, object]] = []

        for role in settings.roles:
            builtin_tools = normalize_tool_names([*MINIMUM_TOOLS, *role.included_tools])
            if agent.node_type != NodeType.ASSISTANT:
                builtin_tools = [
                    tool_name
                    for tool_name in builtin_tools
                    if not is_removed_workflow_copy_mcp_tool_name(tool_name)
                    and not is_assistant_only_tool_name(tool_name)
                    and not is_assistant_only_mcp_tool_name(tool_name)
                ]
            optional_tools = [
                tool_name
                for tool_name in all_tool_names
                if tool_name not in builtin_tools
                and tool_name not in role.excluded_tools
            ]
            payload.append(
                {
                    "name": role.name,
                    "description": role.description,
                    "system_prompt": role.system_prompt,
                    "builtin_tools": builtin_tools,
                    "optional_tools": optional_tools,
                }
            )

        return json.dumps(payload)
