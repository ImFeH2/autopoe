import json

import pytest

from flowent.agent import Agent
from flowent.graph_service import create_tab
from flowent.models import NodeConfig, NodeType
from flowent.registry import registry
from flowent.settings import CONDUCTOR_ROLE_NAME, RoleConfig, Settings
from flowent.tools.create_agent import CreateAgentTool
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


def test_leader_create_agent_defaults_to_current_tab_without_network_edge(
    monkeypatch,
):
    monkeypatch.setattr(
        "flowent.settings.get_settings",
        lambda: Settings(
            roles=[
                RoleConfig(
                    name="Worker",
                    system_prompt="Do work.",
                    included_tools=["read"],
                )
            ]
        ),
    )
    tab = create_tab(title="Task")

    owner = Agent(
        NodeConfig(
            node_type=NodeType.AGENT,
            role_name="Conductor",
            tab_id=tab.id,
            tools=["create_agent"],
            write_dirs=["/tmp/workspace"],
            allow_network=False,
        ),
        uuid=tab.leader_id,
    )
    registry.register(owner)

    result = json.loads(
        CreateAgentTool().execute(
            owner,
            {
                "role_name": "Worker",
                "name": "Peer Worker",
            },
        )
    )

    assert result["config"]["tab_id"] == tab.id
    assert result["config"]["name"] == "Peer Worker"
    assert owner.get_connections_snapshot() == []
    assert workspace_store.list_edges(tab.id) == []


def test_create_agent_places_new_agent_after_anchor(monkeypatch):
    monkeypatch.setattr(
        "flowent.settings.get_settings",
        lambda: Settings(
            roles=[
                RoleConfig(
                    name="Worker",
                    system_prompt="Do work.",
                    included_tools=["read"],
                )
            ]
        ),
    )
    tab = create_tab(title="Task")

    owner = Agent(
        NodeConfig(
            node_type=NodeType.AGENT,
            role_name="Conductor",
            tab_id=tab.id,
            tools=["create_agent"],
            write_dirs=["/tmp/workspace"],
            allow_network=False,
        ),
        uuid=tab.leader_id,
    )
    registry.register(owner)

    anchor = json.loads(
        CreateAgentTool().execute(
            owner,
            {
                "role_name": "Worker",
                "name": "Anchor Worker",
            },
        )
    )
    result = json.loads(
        CreateAgentTool().execute(
            owner,
            {
                "role_name": "Worker",
                "name": "Placed Worker",
                "placement": "after",
                "after_node_id": anchor["id"],
            },
        )
    )

    assert result["config"]["tab_id"] == tab.id
    assert owner.get_connections_snapshot() == []
    assert [
        (edge.from_node_id, edge.to_node_id)
        for edge in workspace_store.list_edges(tab.id)
    ] == [(anchor["id"], result["id"])]


def test_create_agent_rejects_assistant_for_ordinary_nodes(monkeypatch):
    monkeypatch.setattr(
        "flowent.settings.get_settings",
        lambda: Settings(
            roles=[RoleConfig(name="Worker", system_prompt="Do work.")],
        ),
    )
    create_tab(title="Task")

    assistant = Agent(
        NodeConfig(
            node_type=NodeType.ASSISTANT,
            role_name="Steward",
            tools=["create_agent"],
        ),
        uuid="assistant",
    )

    result = json.loads(
        CreateAgentTool().execute(
            assistant,
            {
                "role_name": "Worker",
            },
        )
    )

    assert result == {"error": "Assistant may not create ordinary task nodes directly"}


def test_create_agent_allows_explicitly_granted_task_node(monkeypatch):
    monkeypatch.setattr(
        "flowent.settings.get_settings",
        lambda: Settings(
            roles=[
                RoleConfig(
                    name="Worker",
                    system_prompt="Do work.",
                    included_tools=["create_agent"],
                )
            ],
        ),
    )
    tab = create_tab(title="Task")

    leader = Agent(
        NodeConfig(
            node_type=NodeType.AGENT,
            role_name="Conductor",
            tab_id=tab.id,
            tools=["create_agent"],
            write_dirs=["/tmp/workspace"],
            allow_network=True,
        ),
        uuid=tab.leader_id,
    )
    registry.register(leader)
    creator = json.loads(
        CreateAgentTool().execute(
            leader,
            {
                "role_name": "Worker",
                "name": "Creator Worker",
            },
        )
    )
    creator_node = registry.get(creator["id"])
    assert creator_node is not None

    result = json.loads(
        CreateAgentTool().execute(
            creator_node,
            {
                "role_name": "Worker",
                "name": "Nested Worker",
            },
        )
    )

    assert result["config"]["tab_id"] == tab.id
    assert result["config"]["name"] == "Nested Worker"
    assert creator_node.get_connections_snapshot() == []
    assert workspace_store.list_edges(tab.id) == []


def test_create_agent_rejects_task_node_without_tool(monkeypatch):
    monkeypatch.setattr(
        "flowent.settings.get_settings",
        lambda: Settings(roles=[RoleConfig(name="Worker", system_prompt="Do work.")]),
    )
    tab = create_tab(title="Task")

    worker = Agent(
        NodeConfig(
            node_type=NodeType.AGENT,
            role_name="Worker",
            tab_id=tab.id,
            tools=[],
        ),
        uuid="worker",
    )

    result = json.loads(
        CreateAgentTool().execute(
            worker,
            {
                "role_name": "Worker",
            },
        )
    )

    assert result == {"error": "create_agent is not enabled for this node"}


def test_create_agent_rejects_workflow_id_parameter(monkeypatch):
    monkeypatch.setattr(
        "flowent.settings.get_settings",
        lambda: Settings(roles=[RoleConfig(name="Worker", system_prompt="Do work.")]),
    )
    tab = create_tab(title="Task")

    owner = Agent(
        NodeConfig(
            node_type=NodeType.AGENT,
            role_name="Conductor",
            tab_id=tab.id,
            tools=["create_agent"],
        ),
        uuid=tab.leader_id,
    )

    result = json.loads(
        CreateAgentTool().execute(
            owner,
            {
                "tab_id": tab.id,
                "role_name": "Worker",
            },
        )
    )

    assert result == {"error": "create_agent does not accept workflow_id"}


def test_create_agent_rejects_reserved_conductor_role(monkeypatch):
    monkeypatch.setattr(
        "flowent.settings.get_settings",
        lambda: Settings(
            roles=[RoleConfig(name=CONDUCTOR_ROLE_NAME, system_prompt="Orchestrate.")],
        ),
    )
    tab = create_tab(title="Task")

    leader = Agent(
        NodeConfig(
            node_type=NodeType.AGENT,
            role_name="Conductor",
            tab_id=tab.id,
            tools=["create_agent"],
        ),
        uuid=tab.leader_id,
    )
    registry.register(leader)

    result = json.loads(
        CreateAgentTool().execute(
            leader,
            {
                "role_name": f" {CONDUCTOR_ROLE_NAME} ",
                "name": "Task Conductor",
            },
        )
    )

    assert result == {
        "error": f"Role '{CONDUCTOR_ROLE_NAME}' is reserved for a workflow Leader"
    }


def test_create_agent_rejects_node_level_permissions(monkeypatch, tmp_path):
    monkeypatch.setattr(
        "flowent.settings.get_settings",
        lambda: Settings(roles=[RoleConfig(name="Worker", system_prompt="Do work.")]),
    )

    disallowed_dir = tmp_path / "disallowed"
    disallowed_dir.mkdir()
    tab = create_tab(title="Task")

    owner = Agent(
        NodeConfig(
            node_type=NodeType.AGENT,
            role_name="Conductor",
            tab_id=tab.id,
            tools=["create_agent"],
        ),
        uuid=tab.leader_id,
    )

    write_dir_result = json.loads(
        CreateAgentTool().execute(
            owner,
            {
                "role_name": "Worker",
                "write_dirs": [str(disallowed_dir)],
            },
        )
    )
    network_result = json.loads(
        CreateAgentTool().execute(
            owner,
            {
                "role_name": "Worker",
                "allow_network": True,
            },
        )
    )

    assert write_dir_result == {
        "error": (
            "create_agent uses the current workflow permissions; update the "
            "workflow permissions instead"
        )
    }
    assert network_result == {
        "error": (
            "create_agent uses the current workflow permissions; update the "
            "workflow permissions instead"
        )
    }


def test_create_agent_rejects_removed_connect_to_creator_parameter(monkeypatch):
    monkeypatch.setattr(
        "flowent.settings.get_settings",
        lambda: Settings(roles=[RoleConfig(name="Worker", system_prompt="Do work.")]),
    )
    tab = create_tab(title="Task")

    owner = Agent(
        NodeConfig(
            node_type=NodeType.AGENT,
            role_name="Conductor",
            tab_id=tab.id,
            tools=["create_agent"],
        ),
        uuid=tab.leader_id,
    )

    result = json.loads(
        CreateAgentTool().execute(
            owner,
            {
                "role_name": "Worker",
                "connect_to_creator": "yes",
            },
        )
    )

    assert result == {
        "error": "create_agent no longer supports connect_to_creator; use placement"
    }


def test_create_agent_tool_schema_exposes_workflow_placement_options():
    assert CreateAgentTool.parameters == {
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
