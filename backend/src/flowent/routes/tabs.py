from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict

from flowent.graph_service import (
    create_agent_node,
    create_edge,
    create_graph_node,
    create_tab,
    delete_agent_node,
    delete_edge,
    delete_tab,
    list_node_connection_ids,
    list_tab_edges,
    list_workflow_nodes,
    serialize_tab_summary,
    update_tab_definition,
)
from flowent.models import AgentState, WorkflowNodeKind
from flowent.registry import registry
from flowent.workspace_store import workspace_store

router = APIRouter()


class CreateTabRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: str
    allow_network: bool = False
    write_dirs: list[str] = []


class CreateTabNodeRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    node_type: str = WorkflowNodeKind.AGENT.value
    role_name: str | None = None
    name: str | None = None
    config: dict[str, object] = {}
    tools: list[str] = []


class CreateTabEdgeRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    from_node_id: str
    from_port_key: str = "out"
    to_node_id: str
    to_port_key: str = "in"
    kind: str | None = None


class UpdateTabDefinitionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    definition: dict[str, object]


def _serialize_workflow_node(
    *,
    tab_id: str,
    node_id: str,
) -> dict[str, object]:
    tab = workspace_store.get_tab(tab_id)
    if tab is None:
        raise HTTPException(status_code=404, detail="Workflow not found")
    definition = tab.definition.get_node(node_id)
    if definition is None:
        raise HTTPException(status_code=404, detail="Node not found")
    record = workspace_store.get_node_record(node_id)
    live_node = registry.get(node_id)
    config = dict(definition.config)
    role_name = config.get("role_name")
    name = config.get("name")
    position = tab.definition.view.positions.get(node_id)
    todos = (
        [todo.serialize() for todo in live_node.get_todos_snapshot()]
        if live_node is not None
        else [todo.serialize() for todo in (record.todos if record is not None else [])]
    )
    state = (
        live_node.state.value
        if live_node is not None
        else (record.state.value if record is not None else AgentState.IDLE.value)
    )
    return {
        "id": definition.id,
        "node_type": definition.type.value,
        "workflow_id": tab_id,
        "role_name": role_name if isinstance(role_name, str) else None,
        "is_leader": False,
        "state": state,
        "connections": list_node_connection_ids(tab_id=tab_id, node_id=definition.id)
        if definition.type == WorkflowNodeKind.AGENT
        else [],
        "name": name if isinstance(name, str) else None,
        "todos": todos if definition.type == WorkflowNodeKind.AGENT else [],
        "position": position.serialize() if position is not None else None,
        "config": config,
        "inputs": [port.serialize() for port in definition.inputs],
        "outputs": [port.serialize() for port in definition.outputs],
    }


@router.get("/api/workflows")
async def list_workflows() -> dict[str, object]:
    tabs = workspace_store.list_tabs()
    return {"workflows": [serialize_tab_summary(tab) for tab in tabs]}


@router.post("/api/workflows")
async def create_workflow_route(req: CreateTabRequest) -> dict[str, object]:
    title = req.title.strip()
    if not title:
        raise HTTPException(status_code=400, detail="title must not be empty")
    try:
        tab = create_tab(
            title=title,
            allow_network=req.allow_network,
            write_dirs=req.write_dirs,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return serialize_tab_summary(tab)


@router.get("/api/workflows/{tab_id}")
async def get_workflow(tab_id: str) -> dict[str, object]:
    tab = workspace_store.get_tab(tab_id)
    if tab is None:
        raise HTTPException(status_code=404, detail="Workflow not found")
    nodes = [
        _serialize_workflow_node(tab_id=tab_id, node_id=node.id)
        for node in list_workflow_nodes(tab_id)
    ]
    edges = [edge.serialize() for edge in list_tab_edges(tab_id)]
    return {
        "workflow": serialize_tab_summary(tab),
        "nodes": nodes,
        "edges": edges,
    }


@router.put("/api/workflows/{tab_id}/definition")
async def update_workflow_definition_route(
    tab_id: str,
    req: UpdateTabDefinitionRequest,
) -> dict[str, object]:
    updated, error = update_tab_definition(
        tab_id=tab_id,
        definition_payload=req.definition,
        actor_id=tab_id,
    )
    if error is not None or updated is None:
        raise HTTPException(
            status_code=400 if error and not error.endswith("not found") else 404,
            detail=error or "Failed to update workflow definition",
        )
    return serialize_tab_summary(updated)


@router.delete("/api/workflows/{tab_id}")
async def delete_workflow_route(tab_id: str) -> dict[str, object]:
    deleted, error = delete_tab(tab_id=tab_id)
    if error is not None or deleted is None:
        status_code = 404 if error and error.endswith("not found") else 400
        raise HTTPException(
            status_code=status_code,
            detail=error or "Failed to delete workflow",
        )
    return deleted


@router.post("/api/workflows/{tab_id}/nodes")
async def create_workflow_node(
    tab_id: str,
    req: CreateTabNodeRequest,
) -> dict[str, object]:
    try:
        node_type = WorkflowNodeKind(req.node_type.strip())
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Invalid node_type") from exc

    if node_type == WorkflowNodeKind.AGENT:
        if not isinstance(req.role_name, str) or not req.role_name.strip():
            raise HTTPException(status_code=400, detail="role_name is required")
        record, error = create_agent_node(
            role_name=req.role_name,
            tab_id=tab_id,
            name=req.name,
            tools=req.tools,
        )
        if error is not None or record is None:
            raise HTTPException(
                status_code=400, detail=error or "Failed to create node"
            )
        return _serialize_workflow_node(tab_id=tab_id, node_id=record.id)

    node, error = create_graph_node(
        tab_id=tab_id,
        node_type=node_type,
        config={
            **req.config,
            **(
                {"name": req.name}
                if isinstance(req.name, str) and req.name.strip()
                else {}
            ),
        },
        actor_id=tab_id,
    )
    if error is not None or node is None:
        raise HTTPException(status_code=400, detail=error or "Failed to create node")
    return _serialize_workflow_node(tab_id=tab_id, node_id=node.id)


@router.post("/api/workflows/{tab_id}/edges")
async def create_workflow_edge(
    tab_id: str,
    req: CreateTabEdgeRequest,
) -> dict[str, object]:
    tab = workspace_store.get_tab(tab_id)
    if tab is None:
        raise HTTPException(status_code=404, detail="Workflow not found")
    edge, error = create_edge(
        tab_id=tab_id,
        from_node_id=req.from_node_id,
        from_port_key=req.from_port_key,
        to_node_id=req.to_node_id,
        to_port_key=req.to_port_key,
        kind=req.kind or "",
    )
    if error is not None or edge is None:
        raise HTTPException(status_code=400, detail=error or "Failed to create edge")
    return edge.serialize()


@router.delete("/api/workflows/{tab_id}/nodes/{node_id}")
async def delete_workflow_node(tab_id: str, node_id: str) -> dict[str, object]:
    deleted, error = delete_agent_node(
        tab_id=tab_id,
        node_id=node_id,
    )
    if error is not None or deleted is None:
        status_code = 404 if error and error.endswith("not found") else 400
        raise HTTPException(
            status_code=status_code, detail=error or "Failed to delete node"
        )
    return deleted


@router.delete("/api/workflows/{tab_id}/edges")
async def delete_workflow_edge(
    tab_id: str,
    edge_id: str | None = None,
    from_node_id: str | None = None,
    to_node_id: str | None = None,
    from_port_key: str | None = None,
    to_port_key: str | None = None,
) -> dict[str, object]:
    deleted, error = delete_edge(
        tab_id=tab_id,
        edge_id=edge_id,
        from_node_id=from_node_id,
        to_node_id=to_node_id,
        from_port_key=from_port_key,
        to_port_key=to_port_key,
    )
    if error is not None or deleted is None:
        status_code = 404 if error and error.endswith("not found") else 400
        raise HTTPException(
            status_code=status_code, detail=error or "Failed to delete edge"
        )
    return deleted
