import json

import pytest

from flowent.agent import Agent
from flowent.graph_service import create_agent_node, create_edge, create_tab
from flowent.models import NodeConfig, NodeType
from flowent.registry import registry
from flowent.settings import RoleConfig, Settings
from flowent.tools.create_tab import CreateTabTool
from flowent.tools.delete_tab import DeleteTabTool
from flowent.tools.list_tabs import ListTabsTool
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


def test_delete_tab_tool_deletes_tab_and_graph(monkeypatch):
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

    assistant = Agent(
        NodeConfig(node_type=NodeType.ASSISTANT, tools=["delete_workflow"]),
        uuid="assistant",
    )
    registry.register(assistant)

    tab = create_tab(title="Cleanup")
    left, error = create_agent_node(role_name="Worker", tab_id=tab.id, name="Left")
    assert error is None and left is not None
    right, error = create_agent_node(role_name="Worker", tab_id=tab.id, name="Right")
    assert error is None and right is not None
    edge, error = create_edge(from_node_id=left.id, to_node_id=right.id)
    assert error is None and edge is not None

    result = json.loads(DeleteTabTool().execute(assistant, {"workflow_id": tab.id}))

    assert result["id"] == tab.id
    assert set(result["removed_node_ids"]) == {tab.leader_id, left.id, right.id}
    assert result["removed_edge_ids"] == [edge.id]
    assert workspace_store.get_tab(tab.id) is None
    assert workspace_store.list_node_records(tab.id) == []
    assert workspace_store.list_edges(tab.id) == []
    assert registry.get(tab.leader_id) is None
    assert registry.get(left.id) is None
    assert registry.get(right.id) is None


def test_delete_tab_tool_rejects_non_assistant():
    agent = Agent(
        NodeConfig(
            node_type=NodeType.AGENT,
            role_name="Worker",
            tools=["delete_workflow"],
        ),
        uuid="worker",
    )

    result = json.loads(DeleteTabTool().execute(agent, {"workflow_id": "tab-1"}))

    assert result == {"error": "Only the Assistant may delete workflows"}


def test_create_tab_tool_rejects_non_assistant():
    agent = Agent(
        NodeConfig(
            node_type=NodeType.AGENT,
            role_name="Worker",
            tools=["create_workflow"],
        ),
        uuid="worker",
    )

    result = json.loads(CreateTabTool().execute(agent, {"title": "Draft"}))

    assert result == {"error": "Only the Assistant may create workflows"}
    assert workspace_store.list_tabs() == []


def test_list_tabs_tool_rejects_non_assistant():
    agent = Agent(
        NodeConfig(
            node_type=NodeType.AGENT,
            role_name="Worker",
            tools=["list_workflows"],
        ),
        uuid="worker",
    )

    result = json.loads(ListTabsTool().execute(agent, {}))

    assert result == {"error": "Only the Assistant may list workflows"}
