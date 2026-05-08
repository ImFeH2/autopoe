from __future__ import annotations

import json
from typing import TYPE_CHECKING, Any, ClassVar

from flowent.models import NodeType
from flowent.tools import Tool

if TYPE_CHECKING:
    from flowent.agent import Agent


class ConnectTool(Tool):
    name = "connect"
    description = (
        "Create a directed workflow edge between two nodes in the same workflow."
    )
    parameters: ClassVar[dict[str, Any]] = {
        "type": "object",
        "properties": {
            "from": {
                "type": "string",
                "description": "Source node UUID or name",
            },
            "to": {
                "type": "string",
                "description": "Target node UUID or name",
            },
            "from_port_key": {
                "type": "string",
                "description": "Source output port key",
                "default": "out",
            },
            "to_port_key": {
                "type": "string",
                "description": "Target input port key",
                "default": "in",
            },
        },
        "required": ["from", "to"],
    }

    def execute(self, agent: Agent, args: dict[str, Any], **_kwargs: Any) -> str:
        from flowent.graph_service import (
            create_edge,
            is_tab_leader,
            resolve_workflow_node_ref,
        )

        from_ref = args.get("from")
        to_ref = args.get("to")
        from_port_key = args.get("from_port_key", "out")
        to_port_key = args.get("to_port_key", "in")

        if not isinstance(from_ref, str) or not from_ref:
            return json.dumps({"error": "from must be a non-empty string"})
        if not isinstance(to_ref, str) or not to_ref:
            return json.dumps({"error": "to must be a non-empty string"})
        if not isinstance(from_port_key, str) or not from_port_key.strip():
            return json.dumps({"error": "from_port_key must be a non-empty string"})
        if not isinstance(to_port_key, str) or not to_port_key.strip():
            return json.dumps({"error": "to_port_key must be a non-empty string"})
        if not agent.config.tab_id:
            return json.dumps(
                {"error": "Only a workflow Leader may connect task nodes"}
            )

        source_id = resolve_workflow_node_ref(
            tab_id=agent.config.tab_id,
            node_ref=from_ref,
        )
        target_id = resolve_workflow_node_ref(
            tab_id=agent.config.tab_id,
            node_ref=to_ref,
        )
        if source_id is None:
            return json.dumps({"error": f"Node '{from_ref}' not found"})
        if target_id is None:
            return json.dumps({"error": f"Node '{to_ref}' not found"})

        if agent.node_type == NodeType.ASSISTANT:
            return json.dumps(
                {"error": "Assistant may not rewire a Workflow Graph directly"}
            )
        if not is_tab_leader(node_id=agent.uuid, tab_id=agent.config.tab_id):
            return json.dumps(
                {"error": "Only a workflow Leader may connect task nodes"}
            )

        edge, error = create_edge(
            tab_id=agent.config.tab_id,
            from_node_id=source_id,
            from_port_key=from_port_key,
            to_node_id=target_id,
            to_port_key=to_port_key,
        )
        if error is not None or edge is None:
            return json.dumps({"error": error or "Failed to connect nodes"})

        return json.dumps(edge.serialize())
