from __future__ import annotations

import ast
import json
import shutil
import subprocess
import uuid
from copy import deepcopy
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from flowent import settings as settings_module
from flowent.events import event_bus
from flowent.models import (
    AgentState,
    EdgeKind,
    Event,
    EventType,
    GraphEdge,
    GraphNodeRecord,
    Message,
    NodeConfig,
    NodeType,
    PortDirection,
    PortType,
    ReceivedMessage,
    Tab,
    WorkflowActivationState,
    WorkflowDefinition,
    WorkflowNodeDefinition,
    WorkflowNodeKind,
    WorkflowPort,
)
from flowent.registry import registry
from flowent.runtime import SYSTEM_NODE_TIMEOUT
from flowent.settings import (
    CONDUCTOR_ROLE_INCLUDED_TOOLS,
    CONDUCTOR_ROLE_NAME,
    DESIGNER_ROLE_INCLUDED_TOOLS,
    DESIGNER_ROLE_NAME,
    STEWARD_ROLE_INCLUDED_TOOLS,
    STEWARD_ROLE_NAME,
    build_assistant_write_dirs,
    find_provider,
    find_role,
    resolve_model_info,
    resolve_path,
)
from flowent.tools import (
    MINIMUM_TOOLS,
    is_assistant_only_mcp_tool_name,
    is_assistant_only_tool_name,
)
from flowent.workspace_store import workspace_store

LEADER_NODE_NAME = "Leader"


def build_tools_for_role(
    role_name: str,
    *,
    requested_tools: list[str] | None = None,
    settings=None,
    assistant_boundary: bool = False,
) -> list[str]:
    current_settings = settings or settings_module.get_settings()
    normalized_role_name = role_name.strip()
    role = find_role(current_settings, normalized_role_name)
    if role is None:
        if normalized_role_name == CONDUCTOR_ROLE_NAME:
            included_tools = list(CONDUCTOR_ROLE_INCLUDED_TOOLS)
        elif normalized_role_name == DESIGNER_ROLE_NAME:
            included_tools = list(DESIGNER_ROLE_INCLUDED_TOOLS)
        elif normalized_role_name == STEWARD_ROLE_NAME:
            included_tools = list(STEWARD_ROLE_INCLUDED_TOOLS)
        else:
            included_tools = []
        excluded_tools: set[str] = set()
    else:
        included_tools = list(role.included_tools)
        excluded_tools = set(role.excluded_tools)

    final_tools: list[str] = []
    seen_tools: set[str] = set()
    for tool_name in [*MINIMUM_TOOLS, *included_tools, *(requested_tools or [])]:
        if tool_name in seen_tools:
            continue
        if not assistant_boundary and (
            is_assistant_only_tool_name(tool_name)
            or is_assistant_only_mcp_tool_name(tool_name)
        ):
            continue
        if tool_name in excluded_tools and tool_name not in MINIMUM_TOOLS:
            continue
        final_tools.append(tool_name)
        seen_tools.add(tool_name)
    return final_tools


def build_assistant_tools(*, settings=None) -> list[str]:
    current_settings = settings or settings_module.get_settings()
    assistant_tools = build_tools_for_role(
        current_settings.assistant.role_name,
        settings=current_settings,
        assistant_boundary=True,
    )
    final_tools: list[str] = []
    seen_tools: set[str] = set()
    for tool_name in [
        *MINIMUM_TOOLS,
        *STEWARD_ROLE_INCLUDED_TOOLS,
        *assistant_tools,
    ]:
        if tool_name in seen_tools:
            continue
        final_tools.append(tool_name)
        seen_tools.add(tool_name)
    return final_tools


def resolve_leader_role_name(*, settings=None) -> str:
    current_settings = settings or settings_module.get_settings()
    configured_role_name = current_settings.leader.role_name.strip()
    if configured_role_name and find_role(current_settings, configured_role_name):
        return configured_role_name
    return CONDUCTOR_ROLE_NAME


def get_tab_leader_id(tab_id: str) -> str | None:
    tab = workspace_store.get_tab(tab_id)
    if tab is None:
        return None
    return tab.leader_id


def is_tab_leader(*, node_id: str, tab_id: str | None = None) -> bool:
    resolved_tab_id = tab_id
    if resolved_tab_id is None:
        record = workspace_store.get_node_record(node_id)
        if record is not None:
            resolved_tab_id = record.config.tab_id
        else:
            live_node = registry.get(node_id)
            resolved_tab_id = live_node.config.tab_id if live_node is not None else None
    if not resolved_tab_id:
        return False
    return get_tab_leader_id(resolved_tab_id) == node_id


def _coerce_port_type(raw_value: object, default: PortType) -> PortType:
    try:
        return PortType(str(raw_value))
    except ValueError:
        return default


def _port_from_code_config(
    raw_port: object,
    *,
    direction: PortDirection,
) -> WorkflowPort | None:
    if not isinstance(raw_port, dict):
        return None
    key = raw_port.get("key")
    if not isinstance(key, str) or not key.strip():
        return None
    try:
        port_type = PortType(str(raw_port.get("type")))
    except ValueError:
        return None
    return WorkflowPort(
        key=key.strip(),
        direction=direction,
        type=port_type,
        required=bool(raw_port.get("required", direction == PortDirection.INPUT)),
        multiple=bool(raw_port.get("multiple", False)),
    )


def _build_code_ports(
    config: dict[str, object],
) -> tuple[list[WorkflowPort], list[WorkflowPort]]:
    raw_inputs = config.get("inputs")
    raw_outputs = config.get("outputs")
    inputs = [
        port
        for port in (
            _port_from_code_config(item, direction=PortDirection.INPUT)
            for item in (raw_inputs if isinstance(raw_inputs, list) else [])
        )
        if port is not None
    ]
    outputs = [
        port
        for port in (
            _port_from_code_config(item, direction=PortDirection.OUTPUT)
            for item in (raw_outputs if isinstance(raw_outputs, list) else [])
        )
        if port is not None
    ]
    if not inputs:
        inputs = [
            WorkflowPort(
                key="in",
                direction=PortDirection.INPUT,
                type=PortType.PARTS,
                required=True,
            )
        ]
    if not outputs:
        outputs = [
            WorkflowPort(
                key="out",
                direction=PortDirection.OUTPUT,
                type=PortType.PARTS,
                multiple=True,
            )
        ]
    return inputs, outputs


def _default_ports(
    node_kind: WorkflowNodeKind,
    config: dict[str, object] | None = None,
) -> tuple[list[WorkflowPort], list[WorkflowPort]]:
    node_config = config or {}
    if node_kind == WorkflowNodeKind.TRIGGER:
        output_type = _coerce_port_type(node_config.get("output_type"), PortType.PARTS)
        return (
            [],
            [
                WorkflowPort(
                    key="out",
                    direction=PortDirection.OUTPUT,
                    type=output_type,
                    multiple=True,
                )
            ],
        )
    if node_kind == WorkflowNodeKind.LLM:
        input_type = _coerce_port_type(node_config.get("input_type"), PortType.PARTS)
        output_type = _coerce_port_type(node_config.get("output_type"), PortType.PARTS)
        return (
            [
                WorkflowPort(
                    key="in",
                    direction=PortDirection.INPUT,
                    type=input_type,
                    required=True,
                )
            ],
            [
                WorkflowPort(
                    key="out",
                    direction=PortDirection.OUTPUT,
                    type=output_type,
                    multiple=True,
                )
            ],
        )
    if node_kind == WorkflowNodeKind.CODE:
        return _build_code_ports(node_config)
    if node_kind == WorkflowNodeKind.IF:
        input_type = _coerce_port_type(node_config.get("input_type"), PortType.PARTS)
        return (
            [
                WorkflowPort(
                    key="in",
                    direction=PortDirection.INPUT,
                    type=input_type,
                    required=True,
                ),
            ],
            [
                WorkflowPort(
                    key="then",
                    direction=PortDirection.OUTPUT,
                    type=input_type,
                    multiple=True,
                ),
                WorkflowPort(
                    key="else",
                    direction=PortDirection.OUTPUT,
                    type=input_type,
                    multiple=True,
                ),
            ],
        )
    if node_kind == WorkflowNodeKind.MERGE:
        input_type = _coerce_port_type(node_config.get("input_type"), PortType.PARTS)
        strategy = node_config.get("strategy")
        output_type = (
            input_type
            if strategy == "first_completed"
            else _coerce_port_type(node_config.get("output_type"), PortType.JSON)
        )
        return (
            [
                WorkflowPort(
                    key="in",
                    direction=PortDirection.INPUT,
                    type=input_type,
                    required=True,
                    multiple=True,
                )
            ],
            [
                WorkflowPort(
                    key="out",
                    direction=PortDirection.OUTPUT,
                    type=output_type,
                    multiple=True,
                )
            ],
        )
    if node_kind == WorkflowNodeKind.AGENT:
        return (
            [
                WorkflowPort(
                    key="in",
                    direction=PortDirection.INPUT,
                    type=PortType.PARTS,
                    required=False,
                )
            ],
            [
                WorkflowPort(
                    key="out",
                    direction=PortDirection.OUTPUT,
                    type=PortType.PARTS,
                    multiple=True,
                )
            ],
        )
    return (
        [
            WorkflowPort(
                key="in",
                direction=PortDirection.INPUT,
                type=PortType.PARTS,
                required=True,
            )
        ],
        [
            WorkflowPort(
                key="out",
                direction=PortDirection.OUTPUT,
                type=PortType.PARTS,
                multiple=True,
            )
        ],
    )


def build_workflow_node_definition(
    *,
    node_id: str,
    node_kind: WorkflowNodeKind,
    config: dict[str, object] | None = None,
) -> WorkflowNodeDefinition:
    inputs, outputs = _default_ports(node_kind, config)
    return WorkflowNodeDefinition(
        id=node_id,
        type=node_kind,
        config=deepcopy(config or {}),
        inputs=inputs,
        outputs=outputs,
    )


def list_workflow_nodes(tab_id: str) -> list[WorkflowNodeDefinition]:
    tab = workspace_store.get_tab(tab_id)
    if tab is None:
        return []
    return list(tab.definition.nodes)


def get_workflow_node(tab_id: str, node_id: str) -> WorkflowNodeDefinition | None:
    tab = workspace_store.get_tab(tab_id)
    if tab is None:
        return None
    return tab.definition.get_node(node_id)


def _sync_runtime_positions_into_definition(tab: Tab) -> bool:
    changed = False
    for record in workspace_store.list_node_records(tab.id):
        if is_tab_leader(node_id=record.id, tab_id=tab.id):
            continue
        if record.position is None:
            continue
        current = tab.definition.view.positions.get(record.id)
        if current == record.position:
            continue
        tab.definition.view.positions[record.id] = record.position
        changed = True
    return changed


def serialize_tab_summary(tab: Tab) -> dict[str, object]:
    if _sync_runtime_positions_into_definition(tab):
        workspace_store.upsert_tab(tab)
    return {
        "id": tab.id,
        "title": tab.title,
        "leader_id": tab.leader_id,
        "activation_state": tab.activation_state.value,
        "allow_network": tab.allow_network,
        "write_dirs": list(tab.write_dirs),
        "created_at": tab.created_at,
        "updated_at": tab.updated_at,
        "definition": tab.definition.serialize(),
        "node_count": len(tab.definition.nodes),
        "edge_count": len(tab.definition.edges),
    }


def _build_leader_record(
    *,
    tab_id: str,
    leader_id: str,
    settings,
) -> GraphNodeRecord:
    role_name = resolve_leader_role_name(settings=settings)
    return GraphNodeRecord(
        id=leader_id,
        config=NodeConfig(
            node_type=NodeType.AGENT,
            role_name=role_name,
            tab_id=tab_id,
            name=LEADER_NODE_NAME,
            tools=build_tools_for_role(role_name, settings=settings),
        ),
        state=AgentState.INITIALIZING,
    )


def _sync_tab_permissions_from_legacy_leader(tab: Tab) -> bool:
    if tab.permissions_initialized:
        return False
    tab.permissions_initialized = True
    if not tab.leader_id:
        workspace_store.upsert_tab(tab)
        return False
    record = workspace_store.get_node_record(tab.leader_id)
    if record is None:
        workspace_store.upsert_tab(tab)
        return False
    tab.allow_network = record.config.allow_network
    tab.write_dirs = list(record.config.write_dirs)
    workspace_store.upsert_tab(tab)
    return True


def _sync_leader_record(
    *,
    tab_id: str,
    record: GraphNodeRecord,
    settings,
) -> bool:
    role_name = resolve_leader_role_name(settings=settings)
    tools = build_tools_for_role(role_name, settings=settings)
    changed = False
    if record.config.node_type != NodeType.AGENT:
        record.config.node_type = NodeType.AGENT
        changed = True
    if record.config.tab_id != tab_id:
        record.config.tab_id = tab_id
        changed = True
    if record.config.role_name != role_name:
        record.config.role_name = role_name
        changed = True
    if record.config.name != LEADER_NODE_NAME:
        record.config.name = LEADER_NODE_NAME
        changed = True
    if record.config.tools != tools:
        record.config.tools = tools
        changed = True
    return changed


def _start_persisted_agent(
    *,
    record: GraphNodeRecord,
) -> tuple[GraphNodeRecord | None, str | None]:
    from flowent.agent import Agent

    allow_network, write_dirs = resolve_effective_permissions_for_node_record(record)
    node = Agent(
        NodeConfig(
            node_type=record.config.node_type,
            role_name=record.config.role_name,
            tab_id=record.config.tab_id,
            name=record.config.name,
            tools=list(record.config.tools),
            write_dirs=write_dirs,
            allow_network=allow_network,
        ),
        uuid=record.id,
    )
    registry.register(node)
    node.start()
    return workspace_store.get_node_record(record.id), None


def ensure_tab_leaders(*, start_nodes: bool = False) -> bool:
    settings = settings_module.get_settings()
    changed = False
    should_start_nodes = start_nodes and bool(registry.get_all())

    for tab in workspace_store.list_tabs():
        tab_nodes = list_tab_nodes(tab.id)
        leader_record: GraphNodeRecord | None = None

        if tab.leader_id:
            current_leader = workspace_store.get_node_record(tab.leader_id)
            if (
                current_leader is not None
                and current_leader.config.tab_id == tab.id
                and current_leader.state != AgentState.TERMINATED
            ):
                leader_record = current_leader
            elif (
                current_leader is not None
                and current_leader.config.tab_id == tab.id
                and current_leader.state == AgentState.TERMINATED
            ):
                workspace_store.delete_node_record(current_leader.id)
                changed = True

        if leader_record is None:
            conductor_candidates = sorted(
                (
                    node
                    for node in tab_nodes
                    if node.state != AgentState.TERMINATED
                    and node.config.role_name == CONDUCTOR_ROLE_NAME
                ),
                key=lambda node: (node.created_at, node.id),
            )
            if conductor_candidates:
                leader_record = conductor_candidates[0]
            else:
                leader_record = _build_leader_record(
                    tab_id=tab.id,
                    leader_id=str(uuid.uuid4()),
                    settings=settings,
                )
                workspace_store.upsert_node_record(leader_record)
                changed = True

        if tab.leader_id != leader_record.id:
            tab.leader_id = leader_record.id
            workspace_store.upsert_tab(tab)
            changed = True

        if _sync_tab_permissions_from_legacy_leader(tab):
            changed = True

        if _sync_leader_record(tab_id=tab.id, record=leader_record, settings=settings):
            workspace_store.upsert_node_record(leader_record)
            changed = True

        if should_start_nodes and registry.get(leader_record.id) is None:
            _start_persisted_agent(record=leader_record)

    return changed


def sync_assistant_role(*, reason: str) -> None:
    assistant = registry.get_assistant()
    if assistant is None:
        return
    settings = settings_module.get_settings()
    assistant.config.role_name = settings.assistant.role_name
    assistant.config.tools = build_assistant_tools(settings=settings)
    assistant.config.write_dirs = list(settings.assistant.write_dirs)
    assistant.config.allow_network = settings.assistant.allow_network
    assistant._sync_system_prompt_entry()
    assistant.set_state(
        assistant.state,
        reason,
        force_emit=True,
    )


def sync_tab_leaders(*, reason: str) -> None:
    ensure_tab_leaders()
    settings = settings_module.get_settings()
    for tab in workspace_store.list_tabs():
        if not tab.leader_id:
            continue
        record = workspace_store.get_node_record(tab.leader_id)
        if record is None:
            continue
        if _sync_leader_record(tab_id=tab.id, record=record, settings=settings):
            workspace_store.upsert_node_record(record)
        live_node = registry.get(record.id)
        if live_node is None:
            continue
        live_node.config.role_name = record.config.role_name
        live_node.config.name = record.config.name
        live_node.config.tools = list(record.config.tools)
        live_node._sync_system_prompt_entry()
        live_node.set_state(
            live_node.state,
            reason,
            force_emit=True,
        )


def _emit_tab_updated(*, tab_id: str, agent_id: str) -> None:
    tab = workspace_store.get_tab(tab_id)
    if tab is None:
        return
    event_bus.emit(
        Event(
            type=EventType.TAB_UPDATED,
            agent_id=agent_id,
            data=serialize_tab_summary(tab),
        )
    )


def _start_tab_runtime(tab_id: str) -> None:
    tab = workspace_store.get_tab(tab_id)
    if tab is None:
        return
    ordered_records = sorted(
        list_tab_nodes(tab_id),
        key=lambda record: (
            record.id != tab.leader_id,
            record.created_at,
            record.id,
        ),
    )
    for record in ordered_records:
        if registry.get(record.id) is not None:
            continue
        _start_persisted_agent(record=record)


def create_tab(
    *,
    title: str,
    allow_network: bool = False,
    write_dirs: list[str] | None = None,
) -> Tab:
    settings = settings_module.get_settings()
    leader_id = str(uuid.uuid4())
    tab = Tab(
        id=str(uuid.uuid4()),
        title=title.strip(),
        leader_id=leader_id,
        definition=WorkflowDefinition(),
        allow_network=allow_network,
        write_dirs=build_assistant_write_dirs(
            write_dirs or [],
            field_name="write_dirs",
        ),
        permissions_initialized=True,
    )
    workspace_store.upsert_tab(tab)
    leader_record = _build_leader_record(
        tab_id=tab.id,
        leader_id=leader_id,
        settings=settings,
    )
    workspace_store.upsert_node_record(leader_record)
    if registry.get_all():
        _start_tab_runtime(tab.id)
    event_bus.emit(
        Event(
            type=EventType.TAB_CREATED,
            agent_id="assistant",
            data=serialize_tab_summary(tab),
        )
    )
    return tab


def duplicate_tab(
    *,
    tab_id: str,
) -> tuple[Tab | None, str | None]:
    source_tab = workspace_store.get_tab(tab_id)
    if source_tab is None:
        return None, f"Tab '{tab_id}' not found"

    _sync_tab_permissions_from_legacy_leader(source_tab)
    duplicated_definition = WorkflowDefinition.from_mapping(
        source_tab.definition.serialize()
    )
    id_map: dict[str, str] = {}
    duplicated_nodes: list[WorkflowNodeDefinition] = []

    for node in duplicated_definition.nodes:
        new_node_id = str(uuid.uuid4())
        id_map[node.id] = new_node_id
        duplicated_node = build_workflow_node_definition(
            node_id=new_node_id,
            node_kind=node.type,
            config=node.config,
        )
        duplicated_nodes.append(duplicated_node)

    duplicated_edges = [
        GraphEdge(
            id=str(uuid.uuid4()),
            from_node_id=id_map.get(edge.from_node_id, edge.from_node_id),
            from_port_key=edge.from_port_key,
            to_node_id=id_map.get(edge.to_node_id, edge.to_node_id),
            to_port_key=edge.to_port_key,
            kind=edge.kind,
        )
        for edge in duplicated_definition.edges
    ]
    duplicated_view_positions = {
        id_map.get(node_id, node_id): position
        for node_id, position in duplicated_definition.view.positions.items()
        if id_map.get(node_id, node_id) in id_map.values()
    }

    settings = settings_module.get_settings()
    new_tab = Tab(
        id=str(uuid.uuid4()),
        title=f"{source_tab.title} Copy",
        leader_id=str(uuid.uuid4()),
        allow_network=source_tab.allow_network,
        write_dirs=list(source_tab.write_dirs),
        permissions_initialized=True,
        definition=WorkflowDefinition(
            version=duplicated_definition.version,
            nodes=duplicated_nodes,
            edges=duplicated_edges,
            view=duplicated_definition.view.__class__(
                positions=duplicated_view_positions
            ),
        ),
    )
    assert new_tab.leader_id is not None
    workspace_store.upsert_tab(new_tab)
    workspace_store.upsert_node_record(
        _build_leader_record(
            tab_id=new_tab.id,
            leader_id=new_tab.leader_id,
            settings=settings,
        )
    )

    for node in source_tab.definition.nodes:
        if node.type != WorkflowNodeKind.AGENT:
            continue
        duplicated_node_id = id_map.get(node.id)
        if duplicated_node_id is None:
            continue
        config, error = build_node_config(
            role_name=str(node.config.get("role_name", "")),
            tab_id=new_tab.id,
            name=str(node.config["name"])
            if isinstance(node.config.get("name"), str)
            else None,
        )
        if error is not None or config is None:
            return None, error or "Failed to duplicate workflow"
        workspace_store.upsert_node_record(
            GraphNodeRecord(
                id=duplicated_node_id,
                config=config,
                state=AgentState.INITIALIZING,
                position=duplicated_view_positions.get(duplicated_node_id),
            )
        )

    if registry.get_all():
        _start_tab_runtime(new_tab.id)
    event_bus.emit(
        Event(
            type=EventType.TAB_CREATED,
            agent_id="assistant",
            data=serialize_tab_summary(new_tab),
        )
    )
    return new_tab, None


def _is_path_within_boundary(path: str, boundary_dirs: list[str]) -> bool:
    resolved_path = resolve_path(path)
    return any(
        resolved_path.is_relative_to(resolve_path(boundary_dir))
        for boundary_dir in boundary_dirs
    )


def resolve_effective_permissions_for_agent(agent) -> tuple[bool, list[str]]:
    if agent.config.node_type == NodeType.ASSISTANT:
        settings = settings_module.get_settings()
        return settings.assistant.allow_network, list(settings.assistant.write_dirs)
    if agent.config.tab_id:
        tab = workspace_store.get_tab(agent.config.tab_id)
        if tab is not None:
            _sync_tab_permissions_from_legacy_leader(tab)
            return tab.allow_network, list(tab.write_dirs)
    return agent.config.allow_network, list(agent.config.write_dirs)


def resolve_effective_permissions_for_node_record(
    record: GraphNodeRecord,
) -> tuple[bool, list[str]]:
    if record.config.node_type == NodeType.ASSISTANT:
        settings = settings_module.get_settings()
        return settings.assistant.allow_network, list(settings.assistant.write_dirs)
    if record.config.tab_id:
        tab = workspace_store.get_tab(record.config.tab_id)
        if tab is not None:
            _sync_tab_permissions_from_legacy_leader(tab)
            return tab.allow_network, list(tab.write_dirs)
    return record.config.allow_network, list(record.config.write_dirs)


def set_tab_permissions(
    *,
    tab_id: str,
    allow_network: bool | None = None,
    write_dirs: list[str] | None = None,
    caller_allow_network: bool,
    caller_write_dirs: list[str],
    actor_id: str,
) -> tuple[dict[str, object] | None, str | None]:
    tab = workspace_store.get_tab(tab_id)
    if tab is None:
        return None, f"Tab '{tab_id}' not found"
    _sync_tab_permissions_from_legacy_leader(tab)
    if _is_active(tab):
        return None, _active_edit_error("permissions")

    leader_id = get_tab_leader_id(tab_id)
    if not leader_id:
        return None, f"Tab '{tab_id}' does not have a bound Leader"

    leader_record = workspace_store.get_node_record(leader_id)
    if leader_record is None:
        return None, f"Leader '{leader_id}' not found"

    if allow_network is not None and allow_network and not caller_allow_network:
        return (
            None,
            "allow_network boundary exceeded: caller disallows network access",
        )
    if write_dirs is not None:
        invalid_write_dirs = sorted(
            path
            for path in write_dirs
            if not _is_path_within_boundary(path, caller_write_dirs)
        )
        if invalid_write_dirs:
            return (
                None,
                "write_dirs boundary exceeded: " + ", ".join(invalid_write_dirs),
            )

    next_allow_network = tab.allow_network if allow_network is None else allow_network
    next_write_dirs = list(tab.write_dirs) if write_dirs is None else list(write_dirs)

    changed_node_ids: list[str] = []
    if tab.allow_network != next_allow_network or tab.write_dirs != next_write_dirs:
        tab.allow_network = next_allow_network
        tab.write_dirs = list(next_write_dirs)
        workspace_store.upsert_tab(tab)
        changed_node_ids = [
            record.id for record in list_tab_nodes(tab_id) if record.id != leader_id
        ]
        if leader_record.id:
            changed_node_ids.insert(0, leader_record.id)

    for node_id in changed_node_ids:
        live_node = registry.get(node_id)
        if live_node is not None:
            live_node.set_state(
                live_node.state,
                "tab_permissions_updated",
                force_emit=True,
            )

    updated_tab = workspace_store.get_tab(tab_id)
    if updated_tab is not None:
        event_bus.emit(
            Event(
                type=EventType.TAB_UPDATED,
                agent_id=actor_id,
                data=serialize_tab_summary(updated_tab),
            )
        )

    return (
        {
            "tab_id": tab_id,
            "leader_id": leader_id,
            "allow_network": next_allow_network,
            "write_dirs": list(next_write_dirs),
            "updated_node_ids": changed_node_ids,
        },
        None,
    )


def delete_tab(
    *,
    tab_id: str,
    timeout: float = SYSTEM_NODE_TIMEOUT,
) -> tuple[dict[str, object] | None, str | None]:
    tab = workspace_store.get_tab(tab_id)
    if tab is None:
        return None, f"Tab '{tab_id}' not found"
    if _is_active(tab):
        _, deactivate_error = deactivate_tab(
            tab_id=tab_id,
            actor_id="assistant",
            timeout=timeout,
        )
        if deactivate_error is not None:
            return None, deactivate_error
        tab = workspace_store.get_tab(tab_id)
        if tab is None:
            return None, f"Tab '{tab_id}' not found"

    stored_nodes = list_tab_nodes(tab_id)
    live_nodes = [node for node in registry.get_all() if node.config.tab_id == tab_id]

    removed_node_ids = list(
        dict.fromkeys(
            [
                *(node.id for node in stored_nodes),
                *(node.uuid for node in live_nodes),
                *(node.id for node in tab.definition.nodes),
            ]
        )
    )
    removed_edge_ids = [edge.id for edge in tab.definition.edges]

    for node in live_nodes:
        node.request_termination("tab_deleted")

    lingering_node_ids: list[str] = []
    for node in live_nodes:
        if not node.wait_for_termination(timeout=timeout):
            lingering_node_ids.append(node.uuid)

    if lingering_node_ids:
        return (
            None,
            "Failed to delete workflow because some nodes did not terminate: "
            + ", ".join(node_id[:8] for node_id in lingering_node_ids),
        )

    workspace_store.delete_tab(tab_id)
    payload = {
        **tab.serialize(),
        "removed_node_ids": removed_node_ids,
        "removed_edge_ids": removed_edge_ids,
    }
    event_bus.emit(
        Event(
            type=EventType.TAB_DELETED,
            agent_id="assistant",
            data=payload,
        )
    )
    return payload, None


def build_node_config(
    *,
    role_name: str,
    tab_id: str,
    name: str | None = None,
    tools: list[str] | None = None,
) -> tuple[NodeConfig | None, str | None]:
    settings = settings_module.get_settings()
    role = find_role(settings, role_name.strip())
    if role is None:
        return None, f"Role '{role_name.strip()}' not found"

    requested_tools = tools or []
    if not all(isinstance(item, str) for item in requested_tools):
        return None, "tools must be an array of strings"

    return (
        NodeConfig(
            node_type=NodeType.AGENT,
            role_name=role.name,
            tab_id=tab_id,
            name=name.strip() if isinstance(name, str) and name.strip() else None,
            tools=build_tools_for_role(
                role.name,
                requested_tools=requested_tools,
                settings=settings,
            ),
        ),
        None,
    )


def _persist_tab(tab: Tab, *, actor_id: str) -> Tab:
    workspace_store.upsert_tab(tab)
    _emit_tab_updated(tab_id=tab.id, agent_id=actor_id)
    return tab


def _is_active(tab: Tab) -> bool:
    return tab.activation_state == WorkflowActivationState.ACTIVE


def _active_edit_error(noun: str) -> str:
    return f"Workflow is active; deactivate it before changing {noun}"


def create_graph_node(
    *,
    tab_id: str,
    node_type: WorkflowNodeKind,
    config: dict[str, object] | None = None,
    actor_id: str,
) -> tuple[WorkflowNodeDefinition | None, str | None]:
    tab = workspace_store.get_tab(tab_id)
    if tab is None:
        return None, f"Tab '{tab_id}' not found"
    if _is_active(tab):
        return None, _active_edit_error("nodes")
    node_id = str(uuid.uuid4())
    node = build_workflow_node_definition(
        node_id=node_id,
        node_kind=node_type,
        config=config,
    )
    tab.definition.nodes.append(node)
    _persist_tab(tab, actor_id=actor_id)
    return node, None


def create_agent_node(
    *,
    role_name: str,
    tab_id: str,
    name: str | None = None,
    tools: list[str] | None = None,
    creator_node_id: str | None = None,
    connect_to_creator: bool | None = None,
) -> tuple[GraphNodeRecord | None, str | None]:
    del creator_node_id, connect_to_creator
    tab = workspace_store.get_tab(tab_id)
    if tab is None:
        return None, f"Tab '{tab_id}' not found"
    if _is_active(tab):
        return None, _active_edit_error("nodes")

    config, error = build_node_config(
        role_name=role_name,
        tab_id=tab_id,
        name=name,
        tools=tools,
    )
    if error is not None or config is None:
        return None, error
    if config.role_name == CONDUCTOR_ROLE_NAME:
        return None, f"Role '{CONDUCTOR_ROLE_NAME}' is reserved for a workflow Leader"

    node_id = str(uuid.uuid4())
    record = GraphNodeRecord(
        id=node_id,
        config=config,
        state=AgentState.INITIALIZING,
    )
    workspace_store.upsert_node_record(record)
    tab.definition.nodes.append(
        build_workflow_node_definition(
            node_id=node_id,
            node_kind=WorkflowNodeKind.AGENT,
            config={
                "role_name": config.role_name or "",
                **({"name": config.name} if config.name else {}),
            },
        )
    )
    workspace_store.upsert_tab(tab)
    started_record, start_error = _start_persisted_agent(record=record)
    if start_error is not None or started_record is None:
        return None, start_error or "Failed to create agent"
    _emit_tab_updated(tab_id=tab_id, agent_id=node_id)
    return started_record, None


def update_tab_definition(
    *,
    tab_id: str,
    definition_payload: dict[str, object],
    actor_id: str,
) -> tuple[Tab | None, str | None]:
    tab = workspace_store.get_tab(tab_id)
    if tab is None:
        return None, f"Tab '{tab_id}' not found"
    next_definition = WorkflowDefinition.from_mapping(definition_payload)
    node_ids = [node.id for node in next_definition.nodes]
    if len(node_ids) != len(set(node_ids)):
        return None, "Workflow definition contains duplicate node ids"
    edge_ids = [edge.id for edge in next_definition.edges]
    if len(edge_ids) != len(set(edge_ids)):
        return None, "Workflow definition contains duplicate edge ids"
    if _is_active(tab) and _semantic_definition(tab.definition) != _semantic_definition(
        next_definition
    ):
        return None, _active_edit_error("workflow structure")

    current_agent_ids = {
        node.id for node in tab.definition.nodes if node.type == WorkflowNodeKind.AGENT
    }
    next_agent_ids = {
        node.id for node in next_definition.nodes if node.type == WorkflowNodeKind.AGENT
    }
    if current_agent_ids != next_agent_ids:
        return None, "Agent nodes must be created or deleted through workflow node APIs"

    current_records = {
        record.id: record
        for record in list_tab_nodes(tab_id)
        if not is_tab_leader(node_id=record.id, tab_id=tab_id)
    }
    for node in next_definition.nodes:
        if node.type != WorkflowNodeKind.AGENT:
            continue
        role_name = node.config.get("role_name")
        if not isinstance(role_name, str) or not role_name.strip():
            return None, f"Agent node '{node.id}' requires role_name"
        record = current_records.get(node.id)
        if record is None:
            return None, f"Runtime agent '{node.id}' was not found"
        config, error = build_node_config(
            role_name=role_name,
            tab_id=tab_id,
            name=str(node.config["name"])
            if isinstance(node.config.get("name"), str)
            else None,
        )
        if error is not None or config is None:
            return None, error or f"Failed to validate agent node '{node.id}'"
        record.config.role_name = config.role_name
        record.config.name = config.name
        record.config.tools = config.tools
        workspace_store.upsert_node_record(record)
        live_node = registry.get(node.id)
        if live_node is not None:
            live_node.config.role_name = record.config.role_name
            live_node.config.name = record.config.name
            live_node.config.tools = list(record.config.tools)
            live_node._sync_system_prompt_entry()
            live_node.set_state(
                live_node.state,
                "workflow_definition_updated",
                force_emit=True,
            )

    seen_target_ports: set[tuple[str, str]] = set()
    for edge in next_definition.edges:
        source_node = next_definition.get_node(edge.from_node_id)
        target_node = next_definition.get_node(edge.to_node_id)
        if source_node is None:
            return None, f"Edge source node '{edge.from_node_id}' does not exist"
        if target_node is None:
            return None, f"Edge target node '{edge.to_node_id}' does not exist"
        source_port = _port_matches(
            source_node.outputs,
            port_key=edge.from_port_key,
            direction=PortDirection.OUTPUT,
        )
        if source_port is None:
            return None, f"Output port '{edge.from_port_key}' is invalid"
        target_port = _port_matches(
            target_node.inputs,
            port_key=edge.to_port_key,
            direction=PortDirection.INPUT,
        )
        if target_port is None:
            return None, f"Input port '{edge.to_port_key}' is invalid"
        if source_port.type != target_port.type:
            return (
                None,
                f"Port type mismatch: '{source_node.id}.{source_port.key}' is {source_port.type.value} "
                f"but '{target_node.id}.{target_port.key}' is {target_port.type.value}",
            )
        target_key = (edge.to_node_id, edge.to_port_key)
        if target_key in seen_target_ports and not target_port.multiple:
            return None, f"Input port '{edge.to_port_key}' already has an incoming edge"
        seen_target_ports.add(target_key)

    tab.definition = next_definition
    _persist_tab(tab, actor_id=actor_id)
    return tab, None


def _port_matches(
    ports: list[WorkflowPort],
    *,
    port_key: str,
    direction: PortDirection,
) -> WorkflowPort | None:
    return next(
        (
            port
            for port in ports
            if port.key == port_key and port.direction == direction
        ),
        None,
    )


def _semantic_definition(definition: WorkflowDefinition) -> dict[str, object]:
    payload = definition.serialize()
    payload.pop("view", None)
    return payload


_PORT_TYPES = {item.value for item in PortType}
_TRIGGER_KINDS = {"manual", "cron"}
_LLM_RESPONSE_FORMAT_KINDS = {"text", "json_schema"}
_IF_OPERATORS = {
    "eq",
    "neq",
    "contains",
    "not_contains",
    "is_empty",
    "is_not_empty",
    "gt",
    "lt",
    "gte",
    "lte",
    "is_truthy",
    "is_falsy",
}
_MERGE_STRATEGIES = {"collect", "named_object", "first_completed"}
_CODE_RUNTIMES = {"javascript", "python"}


def _validation_error(
    errors: list[dict[str, str]],
    *,
    message: str,
    node_id: str | None = None,
    edge_id: str | None = None,
    path: str | None = None,
) -> None:
    error: dict[str, str] = {"message": message}
    if node_id is not None:
        error["node_id"] = node_id
    if edge_id is not None:
        error["edge_id"] = edge_id
    if path is not None:
        error["path"] = path
    errors.append(error)


def _is_json_serializable(value: object) -> bool:
    try:
        json.dumps(value)
    except (TypeError, ValueError):
        return False
    return True


def _is_valid_parts_value(value: object) -> bool:
    if not isinstance(value, list) or not value:
        return False
    for part in value:
        if not isinstance(part, dict):
            return False
        part_type = part.get("type")
        if part_type == "text":
            text = part.get("text")
            if not isinstance(text, str) or not text:
                return False
            continue
        if part_type == "image":
            asset_id = part.get("asset_id")
            if not isinstance(asset_id, str) or not asset_id.strip():
                return False
            continue
        return False
    return True


def _validate_typed_value(value: object, port_type: PortType) -> bool:
    if port_type == PortType.PARTS:
        return _is_valid_parts_value(value)
    if port_type == PortType.STRING:
        return isinstance(value, str) and bool(value)
    return isinstance(value, dict) and _is_json_serializable(value)


def _get_string_config(config: dict[str, object], key: str) -> str:
    value = config.get(key)
    return value.strip() if isinstance(value, str) else ""


def _parse_response_format_kind(value: object) -> str:
    if isinstance(value, str):
        return value.strip()
    if isinstance(value, dict):
        kind = value.get("kind")
        return kind.strip() if isinstance(kind, str) else ""
    return ""


def _response_format_schema(value: object) -> object:
    if not isinstance(value, dict):
        return None
    return value.get("schema")


def _validate_cron_expression(value: object) -> bool:
    if not isinstance(value, str):
        return False
    fields = value.split()
    if len(fields) not in {5, 6}:
        return False
    return all(field.strip() for field in fields)


def _validate_timezone(value: object) -> bool:
    if not isinstance(value, str) or not value.strip():
        return False
    try:
        ZoneInfo(value.strip())
    except ZoneInfoNotFoundError:
        return False
    return True


def _validate_trigger_node(
    node: WorkflowNodeDefinition,
    errors: list[dict[str, str]],
) -> None:
    kind = _get_string_config(node.config, "kind")
    if kind not in _TRIGGER_KINDS:
        _validation_error(
            errors,
            node_id=node.id,
            path="config.kind",
            message="trigger kind must be manual or cron",
        )
    output_type = _coerce_port_type(node.config.get("output_type"), PortType.PARTS)
    if str(node.config.get("output_type", output_type.value)) not in _PORT_TYPES:
        _validation_error(
            errors,
            node_id=node.id,
            path="config.output_type",
            message="trigger output_type must be parts, string, or json",
        )
    if not node.outputs or any(port.type != output_type for port in node.outputs):
        _validation_error(
            errors,
            node_id=node.id,
            path="outputs",
            message="trigger output port type must match config.output_type",
        )
    if "message" not in node.config or not _validate_typed_value(
        node.config.get("message"),
        output_type,
    ):
        _validation_error(
            errors,
            node_id=node.id,
            path="config.message",
            message="trigger message must match output_type",
        )
    if kind == "cron":
        if not _validate_cron_expression(node.config.get("cron")):
            _validation_error(
                errors,
                node_id=node.id,
                path="config.cron",
                message="cron trigger requires a 5-field or 6-field expression",
            )
        if not _validate_timezone(node.config.get("timezone")):
            _validation_error(
                errors,
                node_id=node.id,
                path="config.timezone",
                message="cron trigger requires an IANA timezone",
            )


def _resolve_llm_model(
    node: WorkflowNodeDefinition,
) -> tuple[str, str]:
    model_config = node.config.get("model")
    if isinstance(model_config, dict):
        provider_id = model_config.get("provider_id")
        model = model_config.get("model")
        return (
            provider_id.strip() if isinstance(provider_id, str) else "",
            model.strip() if isinstance(model, str) else "",
        )
    provider_id = node.config.get("provider_id")
    model = node.config.get("model")
    return (
        provider_id.strip() if isinstance(provider_id, str) else "",
        model.strip() if isinstance(model, str) else "",
    )


def _validate_llm_node(
    node: WorkflowNodeDefinition,
    errors: list[dict[str, str]],
) -> None:
    input_type = _coerce_port_type(node.config.get("input_type"), PortType.PARTS)
    output_type = _coerce_port_type(node.config.get("output_type"), PortType.PARTS)
    if str(node.config.get("input_type", input_type.value)) not in _PORT_TYPES:
        _validation_error(
            errors,
            node_id=node.id,
            path="config.input_type",
            message="llm input_type must be parts, string, or json",
        )
    if str(node.config.get("output_type", output_type.value)) not in _PORT_TYPES:
        _validation_error(
            errors,
            node_id=node.id,
            path="config.output_type",
            message="llm output_type must be parts, string, or json",
        )
    response_format = node.config.get("response_format", {"kind": "text"})
    response_format_kind = _parse_response_format_kind(response_format)
    if response_format_kind not in _LLM_RESPONSE_FORMAT_KINDS:
        _validation_error(
            errors,
            node_id=node.id,
            path="config.response_format",
            message="llm response_format must be text or json_schema",
        )
    if response_format_kind == "json_schema":
        schema = _response_format_schema(response_format)
        if not isinstance(schema, dict) or not _is_json_serializable(schema):
            _validation_error(
                errors,
                node_id=node.id,
                path="config.response_format.schema",
                message="json_schema response_format requires a JSON schema object",
            )
        if output_type != PortType.JSON:
            _validation_error(
                errors,
                node_id=node.id,
                path="config.output_type",
                message="json_schema response_format requires json output_type",
            )
    elif output_type == PortType.JSON:
        _validation_error(
            errors,
            node_id=node.id,
            path="config.output_type",
            message="text response_format requires parts or string output_type",
        )
    provider_id, model_id = _resolve_llm_model(node)
    settings = settings_module.get_settings()
    provider = find_provider(settings, provider_id)
    if provider is None:
        _validation_error(
            errors,
            node_id=node.id,
            path="config.model",
            message="llm model provider was not found",
        )
        return
    if not model_id:
        _validation_error(
            errors,
            node_id=node.id,
            path="config.model",
            message="llm model must not be empty",
        )
        return
    if provider.models and all(entry.model != model_id for entry in provider.models):
        _validation_error(
            errors,
            node_id=node.id,
            path="config.model",
            message="llm model is not in the provider model catalog",
        )
        return
    model_info = resolve_model_info(provider=provider, model_id=model_id)
    if (
        response_format_kind == "json_schema"
        and not model_info.capabilities.structured_output
    ):
        _validation_error(
            errors,
            node_id=node.id,
            path="config.model",
            message="llm model does not support structured_output",
        )


def _validate_if_node(
    node: WorkflowNodeDefinition,
    errors: list[dict[str, str]],
) -> None:
    expression = node.config.get("expression")
    if not isinstance(expression, dict):
        _validation_error(
            errors,
            node_id=node.id,
            path="config.expression",
            message="if expression must be an object",
        )
        return
    field = expression.get("field")
    operator = expression.get("operator")
    if not isinstance(field, str) or not field.strip().startswith("{{input."):
        _validation_error(
            errors,
            node_id=node.id,
            path="config.expression.field",
            message="if expression field must reference an input path",
        )
    if not isinstance(operator, str) or operator not in _IF_OPERATORS:
        _validation_error(
            errors,
            node_id=node.id,
            path="config.expression.operator",
            message="if expression operator is not supported",
        )
    if (
        operator in {"eq", "neq", "contains", "not_contains", "gt", "lt", "gte", "lte"}
        and "value" not in expression
    ):
        _validation_error(
            errors,
            node_id=node.id,
            path="config.expression.value",
            message="if expression operator requires a value",
        )
    input_type = _coerce_port_type(node.config.get("input_type"), PortType.PARTS)
    if any(port.type != input_type for port in node.inputs + node.outputs):
        _validation_error(
            errors,
            node_id=node.id,
            path="ports",
            message="if node input and output port types must match",
        )


def _validate_merge_node(
    node: WorkflowNodeDefinition,
    errors: list[dict[str, str]],
) -> None:
    strategy = _get_string_config(node.config, "strategy") or "collect"
    if strategy not in _MERGE_STRATEGIES:
        _validation_error(
            errors,
            node_id=node.id,
            path="config.strategy",
            message="merge strategy must be collect, named_object, or first_completed",
        )
    if strategy == "named_object" and not isinstance(
        node.config.get("named_inputs"),
        dict,
    ):
        _validation_error(
            errors,
            node_id=node.id,
            path="config.named_inputs",
            message="named_object merge requires named_inputs",
        )
    if not node.inputs or not node.inputs[0].multiple:
        _validation_error(
            errors,
            node_id=node.id,
            path="inputs",
            message="merge input port must allow multiple upstream values",
        )


def _validate_code_node(
    node: WorkflowNodeDefinition,
    errors: list[dict[str, str]],
) -> None:
    runtime = _get_string_config(node.config, "runtime")
    source = node.config.get("source")
    if runtime not in _CODE_RUNTIMES:
        _validation_error(
            errors,
            node_id=node.id,
            path="config.runtime",
            message="code runtime must be javascript or python",
        )
    if not isinstance(source, str) or not source.strip():
        _validation_error(
            errors,
            node_id=node.id,
            path="config.source",
            message="code source must not be empty",
        )
        return
    if runtime == "python":
        try:
            ast.parse(source)
        except SyntaxError as exc:
            _validation_error(
                errors,
                node_id=node.id,
                path="config.source",
                message=f"python source is not parseable: {exc.msg}",
            )
    elif runtime == "javascript" and shutil.which("node"):
        completed = subprocess.run(
            ["node", "--check"],
            input=source,
            text=True,
            capture_output=True,
            timeout=5,
            check=False,
        )
        if completed.returncode != 0:
            _validation_error(
                errors,
                node_id=node.id,
                path="config.source",
                message="javascript source is not parseable",
            )


def _validate_node_config(
    node: WorkflowNodeDefinition,
    errors: list[dict[str, str]],
) -> None:
    if node.type == WorkflowNodeKind.TRIGGER:
        _validate_trigger_node(node, errors)
    elif node.type == WorkflowNodeKind.LLM:
        _validate_llm_node(node, errors)
    elif node.type == WorkflowNodeKind.IF:
        _validate_if_node(node, errors)
    elif node.type == WorkflowNodeKind.MERGE:
        _validate_merge_node(node, errors)
    elif node.type == WorkflowNodeKind.CODE:
        _validate_code_node(node, errors)


def _is_legacy_required_agent_input(
    node: WorkflowNodeDefinition,
    port: WorkflowPort,
) -> bool:
    return (
        node.type == WorkflowNodeKind.AGENT
        and port.key == "in"
        and port.direction == PortDirection.INPUT
        and port.type == PortType.PARTS
        and not port.multiple
    )


def validate_workflow_activation(tab: Tab) -> list[dict[str, str]]:
    errors: list[dict[str, str]] = []
    if not tab.definition.nodes:
        _validation_error(
            errors,
            message="Add at least one node before activating this workflow",
            path="definition.nodes",
        )
    node_ids = [node.id for node in tab.definition.nodes]
    if len(node_ids) != len(set(node_ids)):
        _validation_error(
            errors,
            message="workflow definition contains duplicate node ids",
            path="definition.nodes",
        )
    edge_ids = [edge.id for edge in tab.definition.edges]
    if len(edge_ids) != len(set(edge_ids)):
        _validation_error(
            errors,
            message="workflow definition contains duplicate edge ids",
            path="definition.edges",
        )
    incoming_edges_by_port: dict[tuple[str, str], list[GraphEdge]] = {}
    seen_edge_endpoints: set[tuple[str, str, str, str]] = set()
    for edge in tab.definition.edges:
        edge_endpoint = (
            edge.from_node_id,
            edge.from_port_key,
            edge.to_node_id,
            edge.to_port_key,
        )
        if edge_endpoint in seen_edge_endpoints:
            _validation_error(
                errors,
                edge_id=edge.id,
                message="duplicate edges are not allowed",
            )
        seen_edge_endpoints.add(edge_endpoint)
        source_node = tab.definition.get_node(edge.from_node_id)
        target_node = tab.definition.get_node(edge.to_node_id)
        if source_node is None:
            _validation_error(
                errors,
                edge_id=edge.id,
                message=f"edge source node '{edge.from_node_id}' does not exist",
            )
            continue
        if target_node is None:
            _validation_error(
                errors,
                edge_id=edge.id,
                message=f"edge target node '{edge.to_node_id}' does not exist",
            )
            continue
        source_port = _port_matches(
            source_node.outputs,
            port_key=edge.from_port_key,
            direction=PortDirection.OUTPUT,
        )
        target_port = _port_matches(
            target_node.inputs,
            port_key=edge.to_port_key,
            direction=PortDirection.INPUT,
        )
        if source_port is None:
            _validation_error(
                errors,
                edge_id=edge.id,
                path="from_port_key",
                message=f"output port '{edge.from_port_key}' is invalid",
            )
            continue
        if target_port is None:
            _validation_error(
                errors,
                edge_id=edge.id,
                path="to_port_key",
                message=f"input port '{edge.to_port_key}' is invalid",
            )
            continue
        if source_port.type != target_port.type:
            _validation_error(
                errors,
                edge_id=edge.id,
                message=(
                    f"port type mismatch: '{source_node.id}.{source_port.key}' is {source_port.type.value} "
                    f"but '{target_node.id}.{target_port.key}' is {target_port.type.value}"
                ),
            )
        incoming_edges_by_port.setdefault(
            (edge.to_node_id, edge.to_port_key), []
        ).append(edge)
    for node in tab.definition.nodes:
        for port in node.inputs:
            edges = incoming_edges_by_port.get((node.id, port.key), [])
            if (
                port.required
                and not edges
                and not _is_legacy_required_agent_input(node, port)
            ):
                _validation_error(
                    errors,
                    node_id=node.id,
                    path=f"inputs.{port.key}",
                    message=f"required input port '{port.key}' has no upstream edge",
                )
            if len(edges) > 1 and not port.multiple:
                _validation_error(
                    errors,
                    node_id=node.id,
                    path=f"inputs.{port.key}",
                    message=f"input port '{port.key}' accepts only one upstream edge",
                )
        _validate_node_config(node, errors)
    return errors


def activate_tab(
    *,
    tab_id: str,
    actor_id: str = "assistant",
) -> tuple[Tab | None, list[dict[str, str]] | None, str | None]:
    tab = workspace_store.get_tab(tab_id)
    if tab is None:
        return None, None, f"Tab '{tab_id}' not found"
    errors = validate_workflow_activation(tab)
    if errors:
        return None, errors, None
    if tab.activation_state != WorkflowActivationState.ACTIVE:
        tab.activation_state = WorkflowActivationState.ACTIVE
        _persist_tab(tab, actor_id=actor_id)
    return tab, None, None


def deactivate_tab(
    *,
    tab_id: str,
    actor_id: str = "assistant",
    timeout: float = SYSTEM_NODE_TIMEOUT,
) -> tuple[Tab | None, str | None]:
    tab = workspace_store.get_tab(tab_id)
    if tab is None:
        return None, f"Tab '{tab_id}' not found"

    lingering_node_ids: list[str] = []
    ordinary_node_ids = {
        node.id
        for node in tab.definition.nodes
        if node.type == WorkflowNodeKind.AGENT
        and not is_tab_leader(node_id=node.id, tab_id=tab_id)
    }
    for node_id in ordinary_node_ids:
        live_node = registry.get(node_id)
        if live_node is not None:
            if live_node.state in {AgentState.RUNNING, AgentState.SLEEPING}:
                live_node.request_interrupt()
                if not live_node.wait_until_idle(timeout=timeout):
                    lingering_node_ids.append(live_node.uuid)
            continue
        record = workspace_store.get_node_record(node_id)
        if record is None:
            continue
        if record.state in {AgentState.RUNNING, AgentState.SLEEPING}:
            record.state = AgentState.IDLE
            workspace_store.upsert_node_record(record)

    if lingering_node_ids:
        return (
            None,
            "Failed to deactivate workflow because some nodes did not stop: "
            + ", ".join(node_id[:8] for node_id in lingering_node_ids),
        )

    if tab.activation_state != WorkflowActivationState.INACTIVE:
        tab.activation_state = WorkflowActivationState.INACTIVE
        _persist_tab(tab, actor_id=actor_id)
    return tab, None


def create_edge(
    *,
    tab_id: str | None = None,
    from_node_id: str,
    to_node_id: str,
    from_port_key: str = "out",
    to_port_key: str = "in",
    kind: EdgeKind | str = EdgeKind.CONTROL,
) -> tuple[GraphEdge | None, str | None]:
    del kind
    resolved_tab_id = tab_id
    if resolved_tab_id is None:
        source_record = workspace_store.get_node_record(from_node_id)
        target_record = workspace_store.get_node_record(to_node_id)
        if source_record is not None and source_record.config.tab_id:
            resolved_tab_id = source_record.config.tab_id
        elif target_record is not None and target_record.config.tab_id:
            resolved_tab_id = target_record.config.tab_id
    if resolved_tab_id is None:
        return None, "tab_id is required"
    tab = workspace_store.get_tab(resolved_tab_id)
    if tab is None:
        return None, f"Tab '{resolved_tab_id}' not found"
    if _is_active(tab):
        return None, _active_edit_error("edges")
    if is_tab_leader(node_id=from_node_id, tab_id=resolved_tab_id) or is_tab_leader(
        node_id=to_node_id,
        tab_id=resolved_tab_id,
    ):
        return None, "Workflow Leader does not participate in Workflow Graph edges"
    if from_node_id == to_node_id:
        return None, "Self-loop edges are not allowed"
    source_node = tab.definition.get_node(from_node_id)
    target_node = tab.definition.get_node(to_node_id)
    if source_node is None:
        return None, f"Node '{from_node_id}' not found"
    if target_node is None:
        return None, f"Node '{to_node_id}' not found"
    source_port = _port_matches(
        source_node.outputs,
        port_key=from_port_key,
        direction=PortDirection.OUTPUT,
    )
    if source_port is None:
        return None, f"Output port '{from_port_key}' is invalid"
    target_port = _port_matches(
        target_node.inputs,
        port_key=to_port_key,
        direction=PortDirection.INPUT,
    )
    if target_port is None:
        return None, f"Input port '{to_port_key}' is invalid"
    if source_port.type != target_port.type:
        return (
            None,
            f"Port type mismatch: '{source_node.id}.{source_port.key}' is {source_port.type.value} "
            f"but '{target_node.id}.{target_port.key}' is {target_port.type.value}",
        )
    if any(
        edge.from_node_id == from_node_id
        and edge.from_port_key == from_port_key
        and edge.to_node_id == to_node_id
        and edge.to_port_key == to_port_key
        for edge in tab.definition.edges
    ):
        return None, "Duplicate edges are not allowed"
    if not target_port.multiple and any(
        edge.to_node_id == to_node_id and edge.to_port_key == to_port_key
        for edge in tab.definition.edges
    ):
        return None, f"Input port '{to_port_key}' already has an incoming edge"

    edge = GraphEdge(
        id=str(uuid.uuid4()),
        tab_id=resolved_tab_id,
        from_node_id=from_node_id,
        from_port_key=from_port_key,
        to_node_id=to_node_id,
        to_port_key=to_port_key,
    )
    tab.definition.edges.append(edge)
    _persist_tab(tab, actor_id=from_node_id)
    return edge, None


def delete_edge(
    *,
    tab_id: str,
    edge_id: str | None = None,
    from_node_id: str | None = None,
    to_node_id: str | None = None,
    from_port_key: str | None = None,
    to_port_key: str | None = None,
) -> tuple[dict[str, object] | None, str | None]:
    tab = workspace_store.get_tab(tab_id)
    if tab is None:
        return None, f"Tab '{tab_id}' not found"
    if _is_active(tab):
        return None, _active_edit_error("edges")

    matched_edge: GraphEdge | None = None
    for edge in tab.definition.edges:
        if edge_id is not None and edge.id == edge_id:
            matched_edge = edge
            break
        if (
            from_node_id is not None
            and to_node_id is not None
            and edge.from_node_id == from_node_id
            and edge.to_node_id == to_node_id
            and (from_port_key is None or edge.from_port_key == from_port_key)
            and (to_port_key is None or edge.to_port_key == to_port_key)
        ):
            matched_edge = edge
            break
    if matched_edge is None:
        return None, "Edge not found"

    tab.definition.edges = [
        edge for edge in tab.definition.edges if edge.id != matched_edge.id
    ]
    _persist_tab(tab, actor_id=matched_edge.from_node_id)
    return matched_edge.serialize(), None


def delete_agent_node(
    *,
    tab_id: str,
    node_id: str,
    timeout: float = SYSTEM_NODE_TIMEOUT,
) -> tuple[dict[str, object] | None, str | None]:
    tab = workspace_store.get_tab(tab_id)
    if tab is None:
        return None, f"Tab '{tab_id}' not found"
    if _is_active(tab):
        return None, _active_edit_error("nodes")

    node_definition = tab.definition.get_node(node_id)
    if node_definition is None:
        return None, f"Node '{node_id}' not found"
    if is_tab_leader(node_id=node_id, tab_id=tab_id):
        return None, "Workflow Leader cannot be deleted from the graph"

    related_edges = [
        edge
        for edge in tab.definition.edges
        if edge.from_node_id == node_id or edge.to_node_id == node_id
    ]
    live_node = registry.get(node_id)
    record = workspace_store.get_node_record(node_id)

    if live_node is not None:
        live_node.request_termination("graph_deleted")
        if not live_node.wait_for_termination(timeout=timeout):
            return (
                None,
                f"Failed to delete node '{node_id}' because it did not terminate",
            )

    if record is not None:
        workspace_store.delete_node_record(node_id)

    tab.definition.nodes = [node for node in tab.definition.nodes if node.id != node_id]
    tab.definition.edges = [
        edge
        for edge in tab.definition.edges
        if edge.id not in {item.id for item in related_edges}
    ]
    tab.definition.view.positions.pop(node_id, None)
    workspace_store.upsert_tab(tab)
    payload: dict[str, object] = {
        "id": node_id,
        "tab_id": tab_id,
        "removed_edge_ids": [edge.id for edge in related_edges],
    }
    event_bus.emit(
        Event(
            type=EventType.NODE_DELETED,
            agent_id=node_id,
            data=payload,
        )
    )
    _emit_tab_updated(
        tab_id=tab_id,
        agent_id=node_id,
    )
    return payload, None


def dispatch_node_message(
    *,
    node_id: str,
    content: str,
    parts: list | None = None,
    from_id: str = "human",
) -> tuple[str | None, str | None]:
    target = registry.get(node_id)
    if target is None:
        return f"Node '{node_id}' is not active", None
    message_id = str(uuid.uuid4())
    normalized_parts = list(parts or [])
    target._append_history(
        ReceivedMessage(
            from_id=from_id,
            parts=normalized_parts,
            content=content,
            message_id=message_id,
        )
    )
    target.enqueue_message(
        Message(
            from_id=from_id,
            to_id=node_id,
            parts=normalized_parts,
            content=content,
            message_id=message_id,
            history_recorded=True,
        )
    )
    return None, message_id


def list_tab_nodes(tab_id: str) -> list[GraphNodeRecord]:
    return sorted(
        workspace_store.list_node_records(tab_id),
        key=lambda record: (record.created_at, record.id),
    )


def list_tab_edges(tab_id: str) -> list[GraphEdge]:
    tab = workspace_store.get_tab(tab_id)
    if tab is None:
        return []
    return sorted(
        [
            GraphEdge(
                id=edge.id,
                tab_id=tab_id,
                from_node_id=edge.from_node_id,
                from_port_key=edge.from_port_key,
                to_node_id=edge.to_node_id,
                to_port_key=edge.to_port_key,
                kind=edge.kind,
                created_at=edge.created_at,
            )
            for edge in tab.definition.edges
        ],
        key=lambda edge: (edge.created_at, edge.id),
    )


def list_node_connection_ids(*, tab_id: str, node_id: str) -> list[str]:
    if is_tab_leader(node_id=node_id, tab_id=tab_id):
        return []

    connection_ids: list[str] = []
    seen_node_ids: set[str] = set()
    for edge in list_tab_edges(tab_id):
        other_node_id: str | None = None
        if edge.from_node_id == node_id:
            other_node_id = edge.to_node_id
        elif edge.to_node_id == node_id:
            other_node_id = edge.from_node_id
        if other_node_id is None or other_node_id in seen_node_ids:
            continue
        seen_node_ids.add(other_node_id)
        connection_ids.append(other_node_id)
    return connection_ids
