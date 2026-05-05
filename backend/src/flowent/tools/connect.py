from __future__ import annotations

import json
from typing import TYPE_CHECKING, Any, ClassVar

from flowent.graph_runtime import resolve_node_ref
from flowent.models import NodeType
from flowent.tools import Tool
from flowent.workspace_store import workspace_store

if TYPE_CHECKING:
    from flowent.agent import Agent


def _resolve_workflow_node_ref(
    *,
    tab_id: str,
    node_ref: str,
) -> tuple[str, str] | None:
    target = resolve_node_ref(node_ref)
    if target is not None and target.config.tab_id == tab_id:
        return target.uuid, target.config.tab_id

    tab = workspace_store.get_tab(tab_id)
    if tab is None:
        return None

    definition_nodes = list(tab.definition.nodes)
    exact_match = next(
        (node for node in definition_nodes if node.id == node_ref),
        None,
    )
    if exact_match is not None:
        return exact_match.id, tab_id

    named_matches = [
        node
        for node in definition_nodes
        if isinstance(node.config.get("name"), str) and node.config["name"] == node_ref
    ]
    if len(named_matches) == 1:
        return named_matches[0].id, tab_id

    if 4 <= len(node_ref) < 36:
        prefix_matches = [
            node for node in definition_nodes if node.id.startswith(node_ref)
        ]
        if len(prefix_matches) == 1:
            return prefix_matches[0].id, tab_id
    return None


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
        from flowent.graph_service import create_edge, is_tab_leader

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

        source = _resolve_workflow_node_ref(
            tab_id=agent.config.tab_id,
            node_ref=from_ref,
        )
        target = _resolve_workflow_node_ref(
            tab_id=agent.config.tab_id,
            node_ref=to_ref,
        )
        if source is None:
            return json.dumps({"error": f"Node '{from_ref}' not found"})
        if target is None:
            return json.dumps({"error": f"Node '{to_ref}' not found"})

        source_id, source_tab_id = source
        target_id, target_tab_id = target
        if source_tab_id != target_tab_id:
            return json.dumps({"error": "Both nodes must belong to the same workflow"})
        if agent.node_type == NodeType.ASSISTANT:
            return json.dumps(
                {"error": "Assistant may not rewire a Workflow Graph directly"}
            )
        if agent.config.tab_id != source_tab_id:
            return json.dumps(
                {
                    "error": "A workflow Leader may only connect peers inside its own workflow"
                }
            )
        if not is_tab_leader(node_id=agent.uuid, tab_id=agent.config.tab_id):
            return json.dumps(
                {"error": "Only a workflow Leader may connect task nodes"}
            )

        edge, error = create_edge(
            tab_id=source_tab_id,
            from_node_id=source_id,
            from_port_key=from_port_key,
            to_node_id=target_id,
            to_port_key=to_port_key,
        )
        if error is not None or edge is None:
            return json.dumps({"error": error or "Failed to connect nodes"})

        return json.dumps(edge.serialize())
