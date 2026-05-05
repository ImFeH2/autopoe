import json

import pytest

from flowent.agent import Agent
from flowent.graph_service import build_workflow_node_definition, create_tab
from flowent.models import (
    AgentState,
    GraphNodeRecord,
    NodeConfig,
    NodeType,
    WorkflowNodeKind,
)
from flowent.registry import registry
from flowent.tools.connect import ConnectTool
from flowent.workspace_store import workspace_store


@pytest.fixture(autouse=True)
def reset_runtime_state(monkeypatch, tmp_path):
    import flowent.settings as settings_module

    settings_file = tmp_path / "settings.json"
    settings_file.write_text("{}", encoding="utf-8")
    monkeypatch.setattr(settings_module, "_SETTINGS_FILE", settings_file)
    monkeypatch.setattr(settings_module, "_cached_settings", None)
    registry.reset()
    workspace_store.reset_cache()
    yield
    registry.reset()
    workspace_store.reset_cache()
    monkeypatch.setattr(settings_module, "_cached_settings", None)


def register_tab_agent(
    *,
    node_id: str,
    tab_id: str,
    name: str,
    role_name: str = "Worker",
    tools: list[str] | None = None,
) -> Agent:
    agent = Agent(
        NodeConfig(
            node_type=NodeType.AGENT,
            role_name=role_name,
            tab_id=tab_id,
            name=name,
            tools=list(tools or []),
        ),
        uuid=node_id,
    )
    registry.register(agent)
    workspace_store.upsert_node_record(
        GraphNodeRecord(
            id=node_id,
            config=agent.config,
            state=AgentState.INITIALIZING,
        )
    )
    tab = workspace_store.get_tab(tab_id)
    assert tab is not None
    tab.definition.nodes.append(
        build_workflow_node_definition(
            node_id=node_id,
            node_kind=WorkflowNodeKind.AGENT,
            config={"role_name": role_name, "name": name},
        )
    )
    workspace_store.upsert_tab(tab)
    return agent


def register_graph_node(
    *,
    node_id: str,
    tab_id: str,
    node_type: WorkflowNodeKind,
    name: str,
) -> None:
    tab = workspace_store.get_tab(tab_id)
    assert tab is not None
    tab.definition.nodes.append(
        build_workflow_node_definition(
            node_id=node_id,
            node_kind=node_type,
            config={"name": name},
        )
    )
    workspace_store.upsert_tab(tab)


def test_connect_tool_creates_directed_workflow_edge():
    tab = create_tab(title="Task")
    leader = Agent(
        NodeConfig(
            node_type=NodeType.AGENT,
            role_name="Conductor",
            tab_id=tab.id,
            name="Leader",
            tools=["connect"],
        ),
        uuid=tab.leader_id,
    )
    registry.register(leader)
    left = register_tab_agent(
        node_id="worker-a",
        tab_id=tab.id,
        name="Worker A",
    )
    right = register_tab_agent(
        node_id="worker-b",
        tab_id=tab.id,
        name="Worker B",
    )

    result = json.loads(
        ConnectTool().execute(
            leader,
            {
                "from": left.uuid,
                "to": right.uuid,
                "from_port_key": "out",
                "to_port_key": "in",
            },
        )
    )

    assert result["tab_id"] == tab.id
    assert result["from_node_id"] == "worker-a"
    assert result["from_port_key"] == "out"
    assert result["to_node_id"] == "worker-b"
    assert result["to_port_key"] == "in"
    assert "kind" not in result
    assert left.get_connections_snapshot() == []
    assert right.get_connections_snapshot() == []
    stored_edges = workspace_store.list_edges(tab.id)
    assert len(stored_edges) == 1
    assert stored_edges[0].from_node_id == "worker-a"
    assert stored_edges[0].to_node_id == "worker-b"
    assert stored_edges[0].from_port_key == "out"
    assert stored_edges[0].to_port_key == "in"

    duplicate_result = json.loads(
        ConnectTool().execute(
            leader,
            {
                "from": left.uuid,
                "to": right.uuid,
            },
        )
    )
    assert duplicate_result == {"error": "Duplicate edges are not allowed"}


def test_connect_tool_resolves_non_agent_workflow_nodes_by_name():
    tab = create_tab(title="Task")
    leader = Agent(
        NodeConfig(
            node_type=NodeType.AGENT,
            role_name="Conductor",
            tab_id=tab.id,
            name="Leader",
            tools=["connect"],
        ),
        uuid=tab.leader_id,
    )
    registry.register(leader)
    register_tab_agent(
        node_id="worker-a",
        tab_id=tab.id,
        name="Worker A",
    )
    register_graph_node(
        node_id="code-a",
        tab_id=tab.id,
        node_type=WorkflowNodeKind.CODE,
        name="Formatter",
    )

    result = json.loads(
        ConnectTool().execute(
            leader,
            {
                "from": "Worker A",
                "to": "Formatter",
            },
        )
    )

    assert result["from_node_id"] == "worker-a"
    assert result["to_node_id"] == "code-a"
    assert "kind" not in result


def test_connect_tool_rejects_leader_endpoints():
    tab = create_tab(title="Task")
    leader = Agent(
        NodeConfig(
            node_type=NodeType.AGENT,
            role_name="Conductor",
            tab_id=tab.id,
            name="Leader",
            tools=["connect"],
        ),
        uuid=tab.leader_id,
    )
    registry.register(leader)
    register_tab_agent(
        node_id="worker-a",
        tab_id=tab.id,
        name="Worker A",
    )

    result = json.loads(
        ConnectTool().execute(
            leader,
            {
                "from": leader.uuid,
                "to": "worker-a",
            },
        )
    )

    assert result == {
        "error": "Workflow Leader does not participate in Workflow Graph edges"
    }
    assert workspace_store.list_edges(tab.id) == []
