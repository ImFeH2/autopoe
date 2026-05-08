from __future__ import annotations

import json
from typing import TYPE_CHECKING, Any, ClassVar

from flowent.models import NodeType
from flowent.tools import Tool

if TYPE_CHECKING:
    from flowent.agent import Agent


class SetPermissionsTool(Tool):
    name = "set_permissions"
    description = (
        "Update a workflow's permission boundary by patching its allow_network "
        "and write_dirs."
    )
    parameters: ClassVar[dict[str, Any]] = {
        "type": "object",
        "properties": {
            "workflow_id": {
                "type": "string",
                "description": "ID of the workflow whose permission boundary should be updated",
            },
            "allow_network": {
                "type": "boolean",
                "description": "Optional patched network permission for the workflow boundary",
            },
            "write_dirs": {
                "type": "array",
                "items": {"type": "string"},
                "description": "Optional patched writable directory boundary for the workflow",
            },
        },
        "required": ["workflow_id"],
    }

    def execute(self, agent: Agent, args: dict[str, Any], **_kwargs: Any) -> str:
        from flowent.graph_service import (
            resolve_effective_permissions_for_agent,
            set_tab_permissions,
        )
        from flowent.settings import (
            build_assistant_allow_network,
            build_assistant_write_dirs,
        )

        workflow_id = args.get("workflow_id")
        raw_allow_network = args.get("allow_network")
        raw_write_dirs = args.get("write_dirs")

        if not isinstance(workflow_id, str) or not workflow_id.strip():
            return json.dumps({"error": "workflow_id must be a non-empty string"})
        normalized_workflow_id = workflow_id.strip()
        if (
            agent.node_type != NodeType.ASSISTANT
            and agent.config.tab_id != normalized_workflow_id
        ):
            return json.dumps(
                {"error": "Workflow permissions can only be changed for this workflow"}
            )

        allow_network: bool | None = None
        if "allow_network" in args:
            try:
                allow_network = build_assistant_allow_network(
                    raw_allow_network,
                    field_name="allow_network",
                )
            except ValueError as exc:
                return json.dumps({"error": str(exc)})

        write_dirs: list[str] | None = None
        if "write_dirs" in args:
            try:
                write_dirs = build_assistant_write_dirs(
                    raw_write_dirs,
                    field_name="write_dirs",
                )
            except ValueError as exc:
                return json.dumps({"error": str(exc)})

        caller_allow_network, caller_write_dirs = (
            resolve_effective_permissions_for_agent(agent)
        )
        result, error = set_tab_permissions(
            tab_id=normalized_workflow_id,
            allow_network=allow_network,
            write_dirs=write_dirs,
            caller_allow_network=caller_allow_network,
            caller_write_dirs=caller_write_dirs,
            actor_id=agent.uuid,
        )
        if error is not None or result is None:
            return json.dumps(
                {"error": error or "Failed to update workflow permissions"}
            )
        return json.dumps(result)
