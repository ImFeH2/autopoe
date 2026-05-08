from __future__ import annotations

import json
from typing import TYPE_CHECKING, Any, ClassVar

from flowent.graph_service import create_agent_node
from flowent.models import NodeType
from flowent.tools import Tool

if TYPE_CHECKING:
    from flowent.agent import Agent


class CreateAgentTool(Tool):
    name = "create_agent"
    description = "Create a new agent node inside your current workflow."
    parameters: ClassVar[dict[str, Any]] = {
        "type": "object",
        "properties": {
            "role_name": {
                "type": "string",
                "description": "Role assigned to the new agent",
            },
            "name": {
                "type": "string",
                "description": "Optional human-readable node name",
            },
            "tools": {
                "type": "array",
                "items": {"type": "string"},
                "description": "Optional additional tools",
            },
            "placement": {
                "type": "string",
                "enum": ["standalone", "after", "between"],
                "description": (
                    "How to place the new agent inside the current workflow graph"
                ),
                "default": "standalone",
            },
            "after_node_id": {
                "type": "string",
                "description": "Anchor node id when placement is `after`",
            },
            "between_from_node_id": {
                "type": "string",
                "description": "Upstream node id when placement is `between`",
            },
            "between_to_node_id": {
                "type": "string",
                "description": "Downstream node id when placement is `between`",
            },
        },
        "required": ["role_name"],
    }

    def execute(self, agent: Agent, args: dict[str, Any], **_kwargs: Any) -> str:
        if "workflow_id" in args or "tab_id" in args:
            return json.dumps({"error": "create_agent does not accept workflow_id"})
        if "write_dirs" in args or "allow_network" in args:
            return json.dumps(
                {
                    "error": (
                        "create_agent uses the current workflow permissions; "
                        "update the workflow permissions instead"
                    )
                }
            )
        if "connect_to_creator" in args:
            return json.dumps(
                {
                    "error": "create_agent no longer supports connect_to_creator; use placement"
                }
            )
        role_name = args.get("role_name")
        name = args.get("name")
        tools = args.get("tools", [])
        placement = args.get("placement", "standalone")
        after_node_id = args.get("after_node_id")
        between_from_node_id = args.get("between_from_node_id")
        between_to_node_id = args.get("between_to_node_id")

        if not isinstance(role_name, str) or not role_name.strip():
            return json.dumps({"error": "role_name must be a non-empty string"})
        if name is not None and not isinstance(name, str):
            return json.dumps({"error": "name must be a string"})
        if not isinstance(tools, list) or not all(
            isinstance(item, str) for item in tools
        ):
            return json.dumps({"error": "tools must be an array of strings"})
        if placement not in {"standalone", "after", "between"}:
            return json.dumps(
                {"error": "placement must be standalone, after, or between"}
            )
        if after_node_id is not None and not isinstance(after_node_id, str):
            return json.dumps({"error": "after_node_id must be a string"})
        if between_from_node_id is not None and not isinstance(
            between_from_node_id, str
        ):
            return json.dumps({"error": "between_from_node_id must be a string"})
        if between_to_node_id is not None and not isinstance(between_to_node_id, str):
            return json.dumps({"error": "between_to_node_id must be a string"})
        normalized_role_name = role_name.strip()
        if agent.node_type == NodeType.ASSISTANT:
            return json.dumps(
                {"error": "Assistant may not create ordinary task nodes directly"}
            )
        if not agent.config.tab_id:
            return json.dumps(
                {
                    "error": "Only a node inside a workflow may create ordinary task nodes"
                }
            )
        if "create_agent" not in agent.config.tools:
            return json.dumps({"error": "create_agent is not enabled for this node"})
        from flowent.graph_service import get_tab_leader_id

        leader_id = get_tab_leader_id(agent.config.tab_id)
        if leader_id is None:
            return json.dumps(
                {"error": "Current workflow does not have a bound Leader"}
            )
        from flowent.registry import registry
        from flowent.workspace_store import workspace_store

        leader = registry.get(leader_id)
        leader_record = workspace_store.get_node_record(leader_id)
        if leader is None and leader_record is None:
            return json.dumps({"error": f"Leader '{leader_id}' was not found"})

        record, error = create_agent_node(
            role_name=normalized_role_name,
            tab_id=agent.config.tab_id,
            name=name,
            tools=tools,
        )
        if error is not None or record is None:
            return json.dumps({"error": error or "Failed to create agent"})
        if placement == "after":
            if not isinstance(after_node_id, str) or not after_node_id.strip():
                return json.dumps(
                    {"error": "after_node_id is required when placement=after"}
                )
            from flowent.graph_service import create_edge

            edge, edge_error = create_edge(
                tab_id=agent.config.tab_id,
                from_node_id=after_node_id,
                to_node_id=record.id,
            )
            if edge_error is not None or edge is None:
                return json.dumps({"error": edge_error or "Failed to place agent"})
        elif placement == "between":
            if (
                not isinstance(between_from_node_id, str)
                or not between_from_node_id.strip()
            ):
                return json.dumps(
                    {"error": "between_from_node_id is required when placement=between"}
                )
            if (
                not isinstance(between_to_node_id, str)
                or not between_to_node_id.strip()
            ):
                return json.dumps(
                    {"error": "between_to_node_id is required when placement=between"}
                )
            from flowent.graph_service import create_edge, delete_edge

            deleted, delete_error = delete_edge(
                tab_id=agent.config.tab_id,
                from_node_id=between_from_node_id,
                to_node_id=between_to_node_id,
            )
            if delete_error is not None or deleted is None:
                return json.dumps({"error": delete_error or "Failed to place agent"})
            first_edge, first_error = create_edge(
                tab_id=agent.config.tab_id,
                from_node_id=between_from_node_id,
                to_node_id=record.id,
            )
            if first_error is not None or first_edge is None:
                return json.dumps({"error": first_error or "Failed to place agent"})
            second_edge, second_error = create_edge(
                tab_id=agent.config.tab_id,
                from_node_id=record.id,
                to_node_id=between_to_node_id,
            )
            if second_error is not None or second_edge is None:
                return json.dumps({"error": second_error or "Failed to place agent"})
        return json.dumps(record.serialize())
