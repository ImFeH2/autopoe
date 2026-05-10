from flowent.agent import Agent
from flowent.models import NodeConfig, NodeType
from flowent.tools import build_tool_registry


def test_empty_tools_list_grants_minimum_tools():
    agent = Agent(NodeConfig(node_type=NodeType.AGENT, tools=[]))

    tools = build_tool_registry().get_tools_for_agent(agent)

    assert [tool.name for tool in tools] == [
        "idle",
        "sleep",
        "todo",
        "contacts",
        "send",
    ]


def test_tool_registry_merges_explicit_allow_list_with_minimum_tools():
    agent = Agent(NodeConfig(node_type=NodeType.AGENT, tools=["idle", "todo"]))

    tools = build_tool_registry().get_tools_for_agent(agent)

    assert [tool.name for tool in tools] == [
        "idle",
        "sleep",
        "todo",
        "contacts",
        "send",
    ]


def test_tool_registry_registers_management_and_workflow_tools():
    tool_names = [tool.name for tool in build_tool_registry().list_tools()]

    assert "create_workflow" in tool_names
    assert "delete_workflow" in tool_names
    assert "set_permissions" in tool_names
    assert "create_agent" in tool_names
    assert "connect" in tool_names
    assert "send" in tool_names
    assert "list_workflows" in tool_names
    assert "manage_providers" in tool_names
    assert "manage_roles" in tool_names
    assert "manage_settings" in tool_names
    assert "manage_prompts" in tool_names


def test_tool_registry_grants_workflow_graph_tools_when_explicitly_allowed():
    agent = Agent(
        NodeConfig(
            node_type=NodeType.ASSISTANT,
            tools=[
                "create_workflow",
                "delete_workflow",
                "create_agent",
                "connect",
                "list_workflows",
            ],
        )
    )

    tools = build_tool_registry().get_tools_for_agent(agent)

    assert [tool.name for tool in tools] == [
        "idle",
        "sleep",
        "todo",
        "contacts",
        "send",
        "create_workflow",
        "delete_workflow",
        "create_agent",
        "connect",
        "list_workflows",
    ]


def test_tool_registry_filters_assistant_only_tools_for_workflow_nodes():
    agent = Agent(
        NodeConfig(
            node_type=NodeType.AGENT,
            role_name="Conductor",
            tools=[
                "create_workflow",
                "delete_workflow",
                "set_permissions",
                "create_agent",
                "connect",
                "list_workflows",
                "manage_settings",
            ],
        )
    )

    tools = build_tool_registry().get_tools_for_agent(agent)

    assert [tool.name for tool in tools] == [
        "idle",
        "sleep",
        "todo",
        "contacts",
        "send",
        "set_permissions",
        "create_agent",
        "connect",
    ]


def test_tool_registry_ignores_mcp_prefixed_tools_for_workflow_nodes():
    agent = Agent(
        NodeConfig(
            node_type=NodeType.AGENT,
            role_name="Worker",
            tools=[
                "mcp__flowent__list_workflows",
                "mcp__flowent__search_notes",
            ],
        )
    )

    tools = build_tool_registry().get_tools_for_agent(agent)

    assert "mcp__flowent__list_workflows" not in {tool.name for tool in tools}
    assert "mcp__flowent__search_notes" not in {tool.name for tool in tools}


def test_tool_registry_ignores_mcp_prefixed_tools_for_assistant():
    agent = Agent(
        NodeConfig(
            node_type=NodeType.ASSISTANT,
            tools=[
                "mcp__flowent__clone_workflow",
                "mcp__flowent__search_notes",
            ],
        )
    )

    tools = build_tool_registry().get_tools_for_agent(agent)

    assert "mcp__flowent__clone_workflow" not in {tool.name for tool in tools}
    assert "mcp__flowent__search_notes" not in {tool.name for tool in tools}


def test_build_tools_for_role_filters_mcp_prefixed_tools(monkeypatch):
    from flowent.graph_service import build_tools_for_role
    from flowent.settings import RoleConfig, Settings

    monkeypatch.setattr(
        "flowent.settings.get_settings",
        lambda: Settings(
            roles=[
                RoleConfig(
                    name="Worker",
                    system_prompt="Do work.",
                    included_tools=["mcp__flowent__list_workflows", "read"],
                )
            ]
        ),
    )

    tools = build_tools_for_role(
        "Worker",
        requested_tools=[
            "mcp__flowent__delete_workflow",
            "mcp__flowent__copy_workflow",
            "mcp__flowent__clone_workflow",
            "mcp__flowent__search_notes",
        ],
    )

    assert "mcp__flowent__list_workflows" not in tools
    assert "mcp__flowent__delete_workflow" not in tools
    assert "mcp__flowent__copy_workflow" not in tools
    assert "mcp__flowent__clone_workflow" not in tools
    assert "mcp__flowent__search_notes" not in tools


def test_list_agent_visible_tool_descriptors_excludes_external_tools():
    from flowent.tools import list_agent_visible_tool_descriptors

    tool_names = {
        descriptor["name"] for descriptor in list_agent_visible_tool_descriptors()
    }

    assert all(not tool_name.startswith("mcp__") for tool_name in tool_names)


def test_tool_registry_shows_management_tools_in_agent_visible_list():
    visible_tool_names = {
        tool.name for tool in build_tool_registry().list_tools(agent_visible_only=True)
    }

    assert "manage_providers" in visible_tool_names
    assert "manage_roles" in visible_tool_names
    assert "manage_settings" in visible_tool_names
    assert "manage_prompts" in visible_tool_names
    assert "set_permissions" in visible_tool_names
    assert "send" in visible_tool_names
