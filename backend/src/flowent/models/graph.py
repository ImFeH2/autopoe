from __future__ import annotations

import time
from dataclasses import dataclass, field
from enum import StrEnum

from flowent.models.agent import AgentState, NodeConfig, NodeType
from flowent.models.history import HistoryEntry, deserialize_history_entries
from flowent.models.todo import TodoItem


class WorkflowNodeKind(StrEnum):
    TRIGGER = "trigger"
    LLM = "llm"
    AGENT = "agent"
    CODE = "code"
    IF = "if"
    MERGE = "merge"


class PortDirection(StrEnum):
    INPUT = "in"
    OUTPUT = "out"


class PortType(StrEnum):
    PARTS = "parts"
    STRING = "string"
    JSON = "json"


class EdgeKind(StrEnum):
    CONTROL = "control"
    DATA = "data"
    EVENT = "event"


def _parse_port_direction(raw_direction: object) -> PortDirection:
    if raw_direction == "input":
        return PortDirection.INPUT
    if raw_direction == "output":
        return PortDirection.OUTPUT
    return PortDirection(str(raw_direction))


def _port_type_from_legacy_kind(raw_kind: object) -> PortType | None:
    try:
        kind = EdgeKind(str(raw_kind))
    except ValueError:
        return None
    if kind == EdgeKind.DATA:
        return PortType.JSON
    return PortType.PARTS


@dataclass
class NodePosition:
    x: float
    y: float

    def serialize(self) -> dict[str, float]:
        return {"x": self.x, "y": self.y}

    @classmethod
    def from_mapping(cls, data: dict[str, object] | None) -> NodePosition | None:
        if not isinstance(data, dict):
            return None
        x = data.get("x")
        y = data.get("y")
        if not isinstance(x, (int, float)) or not isinstance(y, (int, float)):
            return None
        return cls(x=float(x), y=float(y))


@dataclass
class WorkflowPort:
    key: str
    direction: PortDirection
    type: PortType
    required: bool = False
    multiple: bool = False

    def serialize(self) -> dict[str, object]:
        return {
            "key": self.key,
            "direction": self.direction.value,
            "type": self.type.value,
            "required": self.required,
            "multiple": self.multiple,
        }

    @classmethod
    def from_mapping(cls, data: dict[str, object]) -> WorkflowPort | None:
        key = data.get("key")
        direction = data.get("direction")
        port_type = data.get("type")
        if not isinstance(key, str) or not key.strip():
            return None
        try:
            parsed_direction = _parse_port_direction(direction)
        except ValueError:
            return None
        try:
            parsed_type = PortType(str(port_type))
        except ValueError:
            legacy_type = _port_type_from_legacy_kind(data.get("kind"))
            if legacy_type is None:
                return None
            parsed_type = legacy_type
        return cls(
            key=key.strip(),
            direction=parsed_direction,
            type=parsed_type,
            required=bool(data.get("required", False)),
            multiple=bool(data.get("multiple", False)),
        )


@dataclass
class GraphEdge:
    id: str
    from_node_id: str
    from_port_key: str
    to_node_id: str
    to_port_key: str
    kind: EdgeKind = EdgeKind.CONTROL
    tab_id: str | None = None
    created_at: float = field(default_factory=time.time)

    def serialize(self) -> dict[str, object]:
        payload: dict[str, object] = {
            "id": self.id,
            "from_node_id": self.from_node_id,
            "from_port_key": self.from_port_key,
            "to_node_id": self.to_node_id,
            "to_port_key": self.to_port_key,
            "created_at": self.created_at,
        }
        if self.tab_id is not None:
            payload["tab_id"] = self.tab_id
        return payload

    @classmethod
    def from_mapping(cls, data: dict[str, object]) -> GraphEdge:
        created_at = data.get("created_at")
        kind = data.get("kind")
        try:
            parsed_kind = EdgeKind(str(kind))
        except ValueError:
            parsed_kind = EdgeKind.CONTROL
        from_port_key = data.get("from_port_key")
        to_port_key = data.get("to_port_key")
        return cls(
            id=str(data.get("id", "")),
            tab_id=str(data["tab_id"]) if isinstance(data.get("tab_id"), str) else None,
            from_node_id=str(data.get("from_node_id", "")),
            from_port_key=(
                str(from_port_key)
                if isinstance(from_port_key, str) and from_port_key.strip()
                else "out"
            ),
            to_node_id=str(data.get("to_node_id", "")),
            to_port_key=(
                str(to_port_key)
                if isinstance(to_port_key, str) and to_port_key.strip()
                else "in"
            ),
            kind=parsed_kind,
            created_at=created_at
            if isinstance(created_at, (int, float))
            else time.time(),
        )


@dataclass
class WorkflowNodeDefinition:
    id: str
    type: WorkflowNodeKind
    config: dict[str, object] = field(default_factory=dict)
    inputs: list[WorkflowPort] = field(default_factory=list)
    outputs: list[WorkflowPort] = field(default_factory=list)

    def serialize(self) -> dict[str, object]:
        return {
            "id": self.id,
            "type": self.type.value,
            "config": dict(self.config),
            "inputs": [port.serialize() for port in self.inputs],
            "outputs": [port.serialize() for port in self.outputs],
        }

    @classmethod
    def from_mapping(
        cls,
        data: dict[str, object],
    ) -> WorkflowNodeDefinition | None:
        node_id = data.get("id")
        node_type = data.get("type")
        if not isinstance(node_id, str) or not node_id.strip():
            return None
        try:
            parsed_type = WorkflowNodeKind(str(node_type))
        except ValueError:
            return None
        raw_config = data.get("config")
        raw_inputs = data.get("inputs")
        raw_outputs = data.get("outputs")
        return cls(
            id=node_id.strip(),
            type=parsed_type,
            config=dict(raw_config) if isinstance(raw_config, dict) else {},
            inputs=[
                port
                for port in (
                    WorkflowPort.from_mapping(item)
                    for item in (raw_inputs if isinstance(raw_inputs, list) else [])
                    if isinstance(item, dict)
                )
                if port is not None
            ],
            outputs=[
                port
                for port in (
                    WorkflowPort.from_mapping(item)
                    for item in (raw_outputs if isinstance(raw_outputs, list) else [])
                    if isinstance(item, dict)
                )
                if port is not None
            ],
        )


@dataclass
class WorkflowViewDefinition:
    positions: dict[str, NodePosition] = field(default_factory=dict)

    def serialize(self) -> dict[str, object]:
        if not self.positions:
            return {}
        return {
            "positions": {
                node_id: position.serialize()
                for node_id, position in self.positions.items()
            }
        }

    @classmethod
    def from_mapping(cls, data: dict[str, object] | None) -> WorkflowViewDefinition:
        if not isinstance(data, dict):
            return cls()
        raw_positions = data.get("positions")
        if not isinstance(raw_positions, dict):
            return cls()
        positions = {
            str(node_id): position
            for node_id, position in (
                (
                    node_id,
                    NodePosition.from_mapping(payload),
                )
                for node_id, payload in raw_positions.items()
                if isinstance(node_id, str) and isinstance(payload, dict)
            )
            if position is not None
        }
        return cls(positions=positions)


@dataclass
class WorkflowDefinition:
    version: int = 1
    nodes: list[WorkflowNodeDefinition] = field(default_factory=list)
    edges: list[GraphEdge] = field(default_factory=list)
    view: WorkflowViewDefinition = field(default_factory=WorkflowViewDefinition)

    def serialize(self) -> dict[str, object]:
        payload: dict[str, object] = {
            "version": self.version,
            "nodes": [node.serialize() for node in self.nodes],
            "edges": [edge.serialize() for edge in self.edges],
        }
        serialized_view = self.view.serialize()
        if serialized_view:
            payload["view"] = serialized_view
        return payload

    @classmethod
    def from_mapping(cls, data: dict[str, object] | None) -> WorkflowDefinition:
        if not isinstance(data, dict):
            return cls()
        raw_version = data.get("version")
        raw_nodes = data.get("nodes")
        raw_edges = data.get("edges")
        raw_view = data.get("view")
        return cls(
            version=raw_version
            if isinstance(raw_version, int) and raw_version > 0
            else 1,
            nodes=[
                node
                for node in (
                    WorkflowNodeDefinition.from_mapping(item)
                    for item in (raw_nodes if isinstance(raw_nodes, list) else [])
                    if isinstance(item, dict)
                )
                if node is not None
            ],
            edges=[
                GraphEdge.from_mapping(item)
                for item in (raw_edges if isinstance(raw_edges, list) else [])
                if isinstance(item, dict)
            ],
            view=WorkflowViewDefinition.from_mapping(
                raw_view if isinstance(raw_view, dict) else None
            ),
        )

    def get_node(self, node_id: str) -> WorkflowNodeDefinition | None:
        return next((node for node in self.nodes if node.id == node_id), None)


@dataclass
class GraphNodeRecord:
    id: str
    config: NodeConfig
    state: AgentState
    todos: list[TodoItem] = field(default_factory=list)
    history: list[HistoryEntry] = field(default_factory=list)
    execution_context_summary: str = ""
    execution_context_history_cutoff: int = 0
    position: NodePosition | None = None
    created_at: float = field(default_factory=time.time)
    updated_at: float = field(default_factory=time.time)

    def serialize(self) -> dict[str, object]:
        return {
            "id": self.id,
            "config": {
                "node_type": self.config.node_type.value,
                "role_name": self.config.role_name,
                "tab_id": self.config.tab_id,
                "name": self.config.name,
                "tools": list(self.config.tools),
                "write_dirs": list(self.config.write_dirs),
                "allow_network": self.config.allow_network,
            },
            "state": self.state.value,
            "todos": [item.serialize() for item in self.todos],
            "history": [entry.serialize() for entry in self.history],
            "execution_context_summary": self.execution_context_summary,
            "execution_context_history_cutoff": self.execution_context_history_cutoff,
            "position": self.position.serialize()
            if self.position is not None
            else None,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
        }

    @classmethod
    def from_mapping(cls, data: dict[str, object]) -> GraphNodeRecord:
        from flowent.settings import (
            build_assistant_write_dirs,
            normalize_tool_names,
        )

        raw_config = data.get("config")
        config = raw_config if isinstance(raw_config, dict) else {}
        raw_todos = data.get("todos")
        raw_history = data.get("history")
        raw_execution_context_summary = data.get("execution_context_summary")
        raw_execution_context_history_cutoff = data.get(
            "execution_context_history_cutoff"
        )
        created_at = data.get("created_at")
        updated_at = data.get("updated_at")
        raw_state = data.get("state")

        node_type = config.get("node_type")
        try:
            parsed_node_type = NodeType(str(node_type))
        except ValueError:
            parsed_node_type = NodeType.AGENT

        try:
            state = AgentState(str(raw_state))
        except ValueError:
            state = AgentState.INITIALIZING

        todos = []
        if isinstance(raw_todos, list):
            todos = [
                TodoItem(text=str(item.get("text", "")))
                for item in raw_todos
                if isinstance(item, dict)
            ]

        history_items: list[HistoryEntry] = []
        if isinstance(raw_history, list):
            history_items = deserialize_history_entries(
                [item for item in raw_history if isinstance(item, dict)]
            )
        raw_position = data.get("position")

        raw_write_dirs = (
            [
                str(item)
                for item in config.get("write_dirs", [])
                if isinstance(item, str)
            ]
            if isinstance(config.get("write_dirs"), list)
            else []
        )

        return cls(
            id=str(data.get("id", "")),
            config=NodeConfig(
                node_type=parsed_node_type,
                role_name=(
                    str(config["role_name"])
                    if isinstance(config.get("role_name"), str)
                    else None
                ),
                tab_id=str(config["tab_id"])
                if isinstance(config.get("tab_id"), str)
                else None,
                name=str(config["name"])
                if isinstance(config.get("name"), str)
                else None,
                tools=normalize_tool_names(
                    [
                        str(item)
                        for item in config.get("tools", [])
                        if isinstance(item, str)
                    ]
                    if isinstance(config.get("tools"), list)
                    else []
                ),
                write_dirs=build_assistant_write_dirs(
                    raw_write_dirs,
                    field_name="write_dirs",
                ),
                allow_network=bool(config.get("allow_network", False)),
            ),
            state=state,
            todos=todos,
            history=history_items,
            execution_context_summary=(
                str(raw_execution_context_summary)
                if isinstance(raw_execution_context_summary, str)
                else ""
            ),
            execution_context_history_cutoff=(
                raw_execution_context_history_cutoff
                if isinstance(raw_execution_context_history_cutoff, int)
                and raw_execution_context_history_cutoff >= 0
                else 0
            ),
            position=NodePosition.from_mapping(
                raw_position if isinstance(raw_position, dict) else None
            ),
            created_at=created_at
            if isinstance(created_at, (int, float))
            else time.time(),
            updated_at=updated_at
            if isinstance(updated_at, (int, float))
            else time.time(),
        )
