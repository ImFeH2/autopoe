from __future__ import annotations

import json
from typing import TYPE_CHECKING, Any, ClassVar

from flowent.graph_service import (
    is_tab_leader,
    list_tab_edges,
    list_tab_nodes,
    list_workflow_nodes,
    serialize_tab_summary,
)
from flowent.models import NodeType
from flowent.tools import Tool
from flowent.workspace_store import workspace_store

if TYPE_CHECKING:
    from flowent.agent import Agent


class ListTabsTool(Tool):
    name = "list_workflows"
    description = "List persistent workflows. Optionally include the full Workflow Graph for one workflow."
    parameters: ClassVar[dict[str, Any]] = {
        "type": "object",
        "properties": {
            "workflow_id": {
                "type": "string",
                "description": "Optional workflow ID to inspect in detail",
            }
        },
        "required": [],
    }

    def execute(self, agent: Agent, args: dict[str, Any], **_kwargs: Any) -> str:
        if agent.node_type != NodeType.ASSISTANT:
            return json.dumps({"error": "Only the Assistant may list workflows"})

        workflow_id = args.get("workflow_id")
        if workflow_id is not None and not isinstance(workflow_id, str):
            return json.dumps({"error": "workflow_id must be a string"})

        if isinstance(workflow_id, str) and workflow_id.strip():
            tab = workspace_store.get_tab(workflow_id.strip())
            if tab is None:
                return json.dumps(
                    {"error": f"Workflow '{workflow_id.strip()}' not found"}
                )
            nodes = [
                {
                    "id": node.id,
                    "node_type": node.type.value,
                    "name": (
                        node.config["name"]
                        if isinstance(node.config.get("name"), str)
                        else None
                    ),
                    "role_name": (
                        node.config["role_name"]
                        if isinstance(node.config.get("role_name"), str)
                        else None
                    ),
                    "is_leader": False,
                    "position": (
                        tab.definition.view.positions[node.id].serialize()
                        if node.id in tab.definition.view.positions
                        else None
                    ),
                }
                for node in list_workflow_nodes(tab.id)
            ]
            return json.dumps(
                {
                    "workflow": serialize_tab_summary(tab),
                    "nodes": nodes,
                    "runtime_nodes": [
                        {
                            "id": node.id,
                            "name": node.config.name,
                            "role_name": node.config.role_name,
                            "is_leader": is_tab_leader(
                                node_id=node.id,
                                tab_id=tab.id,
                            ),
                            "state": node.state.value,
                            "position": (
                                node.position.serialize()
                                if node.position is not None
                                else None
                            ),
                        }
                        for node in list_tab_nodes(tab.id)
                    ],
                    "edges": [edge.serialize() for edge in list_tab_edges(tab.id)],
                }
            )

        return json.dumps(
            [serialize_tab_summary(tab) for tab in workspace_store.list_tabs()]
        )
