from flowent.models import NodeConfig, NodeType
from flowent.prompts import get_system_prompt
from flowent.prompts.common import (
    ASSISTANT_ONLY_PROMPT,
    COMMUNICATION_USAGE_GUIDANCE,
    CONNECT_TOOL_GUIDANCE,
    CREATE_AGENT_TOOL_GUIDANCE,
    CREATE_WORKFLOW_TOOL_GUIDANCE,
    DEFAULT_AGENT_ROLE_PROMPT,
    DELEGATION_GENERAL_GUIDANCE,
    DELETE_WORKFLOW_TOOL_GUIDANCE,
    FILE_PATH_GUIDANCE,
    IDLE_TOOL_GUIDANCE,
    LIST_ROLES_TOOL_GUIDANCE,
    LIST_TOOLS_TOOL_GUIDANCE,
    LIST_WORKFLOWS_TOOL_GUIDANCE,
    MANAGE_TOOLS_GUIDANCE,
    SEND_TOOL_GUIDANCE,
    SET_PERMISSIONS_TOOL_GUIDANCE,
    SLEEP_TOOL_GUIDANCE,
    compose_system_prompt,
)
from flowent.prompts.steward import STEWARD_ROLE_SYSTEM_PROMPT
from flowent.settings import (
    CONDUCTOR_ROLE_INCLUDED_TOOLS,
    CONDUCTOR_ROLE_SYSTEM_PROMPT,
    DESIGNER_ROLE_INCLUDED_TOOLS,
    DESIGNER_ROLE_SYSTEM_PROMPT,
    STEWARD_ROLE_INCLUDED_TOOLS,
    STEWARD_ROLE_NAME,
    WORKER_ROLE_INCLUDED_TOOLS,
    WORKER_ROLE_SYSTEM_PROMPT,
    RoleConfig,
    Settings,
    build_conductor_role,
    build_designer_role,
)
from flowent.tools import MINIMUM_TOOLS


def _join(*parts: str) -> str:
    return "\n\n".join(part.strip() for part in parts if part.strip())


def _with_minimum_tools(*tools: str) -> list[str]:
    return list(dict.fromkeys([*tools, *MINIMUM_TOOLS]))


def test_compose_system_prompt_inserts_custom_prompt_between_tool_guidance_and_role():
    result = compose_system_prompt(
        "Role-specific instructions.",
        custom_prompt="Global custom instructions.",
        tools=["idle", "create_agent"],
    )

    assert result == _join(
        COMMUNICATION_USAGE_GUIDANCE,
        FILE_PATH_GUIDANCE,
        IDLE_TOOL_GUIDANCE,
        CREATE_AGENT_TOOL_GUIDANCE,
        DELEGATION_GENERAL_GUIDANCE,
        "Global custom instructions.",
        "Role-specific instructions.",
    )


def test_compose_system_prompt_inserts_assistant_layer_before_custom_prompt():
    result = compose_system_prompt(
        "Role-specific instructions.",
        custom_prompt="Global custom instructions.",
        is_assistant=True,
        tools=["idle"],
    )

    assert result == _join(
        COMMUNICATION_USAGE_GUIDANCE,
        FILE_PATH_GUIDANCE,
        IDLE_TOOL_GUIDANCE,
        ASSISTANT_ONLY_PROMPT,
        "Global custom instructions.",
        "Role-specific instructions.",
    )


def test_compose_system_prompt_ignores_empty_custom_prompt():
    result = compose_system_prompt(
        "Role-specific instructions.",
        custom_prompt="  ",
        tools=["idle"],
    )

    assert result == _join(
        COMMUNICATION_USAGE_GUIDANCE,
        FILE_PATH_GUIDANCE,
        IDLE_TOOL_GUIDANCE,
        "Role-specific instructions.",
    )


def test_compose_system_prompt_injects_create_agent_guidance_when_tool_present():
    result = compose_system_prompt(
        "Role-specific instructions.",
        tools=["create_agent"],
    )

    assert DELEGATION_GENERAL_GUIDANCE in result
    assert CREATE_AGENT_TOOL_GUIDANCE in result
    assert (
        "If you also have `connect`, wire workflow edges as needed."
        in CREATE_AGENT_TOOL_GUIDANCE
    )
    assert (
        "place the new node as a standalone node, after another node, or between two nodes"
        in CREATE_AGENT_TOOL_GUIDANCE
    )
    assert (
        "It does not take `workflow_id` or any other cross-workflow target parameter."
        in CREATE_AGENT_TOOL_GUIDANCE
    )
    assert (
        "Ordinary task nodes may use `create_agent` only when that tool was explicitly granted to them."
        in CREATE_AGENT_TOOL_GUIDANCE
    )
    assert "dispatch tasks to all of them before calling `idle`" in result
    assert "explicitly dispatch its first task with `send`" in result
    assert "Do not insert unrelated tool calls or Human-facing text" in result
    assert "title case with spaces" in CREATE_AGENT_TOOL_GUIDANCE


def test_compose_system_prompt_omits_delegation_guidance_when_create_agent_is_absent():
    result = compose_system_prompt("Role-specific instructions.", tools=["read"])

    assert DELEGATION_GENERAL_GUIDANCE not in result
    assert CREATE_AGENT_TOOL_GUIDANCE not in result


def test_compose_system_prompt_injects_connect_guidance_when_tool_present():
    result = compose_system_prompt(
        "Role-specific instructions.",
        tools=["connect"],
    )

    assert CONNECT_TOOL_GUIDANCE in result
    assert "directed workflow edge between node ports" in CONNECT_TOOL_GUIDANCE


def test_compose_system_prompt_injects_management_guidance_when_manage_tool_present():
    result = compose_system_prompt(
        "Role-specific instructions.",
        tools=["manage_providers"],
    )

    assert MANAGE_TOOLS_GUIDANCE in result
    assert "`manage_providers`" in result
    assert "`manage_roles`" in result
    assert "`manage_settings`" in result
    assert "`manage_prompts`" in result


def test_compose_system_prompt_injects_workflow_graph_guidance_when_tools_present():
    result = compose_system_prompt(
        "Role-specific instructions.",
        tools=["create_workflow", "delete_workflow", "create_agent", "list_workflows"],
    )

    assert CREATE_WORKFLOW_TOOL_GUIDANCE in result
    assert DELETE_WORKFLOW_TOOL_GUIDANCE in result
    assert CREATE_AGENT_TOOL_GUIDANCE in result
    assert LIST_WORKFLOWS_TOOL_GUIDANCE in result
    assert "create_workflow" in CREATE_WORKFLOW_TOOL_GUIDANCE
    assert "current workflow" in CREATE_AGENT_TOOL_GUIDANCE


def test_compose_system_prompt_injects_set_permissions_guidance_when_tool_present():
    result = compose_system_prompt(
        "Role-specific instructions.",
        tools=["set_permissions"],
    )

    assert SET_PERMISSIONS_TOOL_GUIDANCE in result
    assert "target workflow's own `allow_network` and `write_dirs`" in result


def test_common_communication_guidance_requires_explicit_target_routing():
    assert (
        "Use plain content only for your own direct output."
        in COMMUNICATION_USAGE_GUIDANCE
    )
    assert (
        "Use `send` for every formal node-to-node message."
        in COMMUNICATION_USAGE_GUIDANCE
    )
    assert "`send` takes one target at a time." in COMMUNICATION_USAGE_GUIDANCE
    assert (
        "Use `contacts` to discover current contact names and ids before sending."
        in COMMUNICATION_USAGE_GUIDANCE
    )
    assert "use `send` to deliver the result" in COMMUNICATION_USAGE_GUIDANCE
    assert (
        "`@target:` and similar `@name:` text inside normal content are just text."
        in COMMUNICATION_USAGE_GUIDANCE
    )
    assert "automatically delivered to your parent" not in COMMUNICATION_USAGE_GUIDANCE


def test_file_path_guidance_requires_relative_paths():
    assert "relative paths" in FILE_PATH_GUIDANCE
    assert "Do not guess absolute paths like /workspace or /home." in FILE_PATH_GUIDANCE
    assert "run `pwd` first" in FILE_PATH_GUIDANCE


def test_compose_system_prompt_always_includes_file_path_guidance():
    result = compose_system_prompt("Role-specific instructions.", tools=["read"])

    assert FILE_PATH_GUIDANCE in result
    assert result.index(COMMUNICATION_USAGE_GUIDANCE) < result.index(FILE_PATH_GUIDANCE)


def test_assistant_only_prompt_keeps_frontend_semantics_without_repeating_block_rule():
    assert "frontend chat panel" in ASSISTANT_ONLY_PROMPT
    assert "Plain content is your reply to the Human." in ASSISTANT_ONLY_PROMPT
    assert "use `send`" in ASSISTANT_ONLY_PROMPT
    assert "A single content block is either" not in ASSISTANT_ONLY_PROMPT


def test_compose_system_prompt_injects_send_guidance_when_tool_present():
    result = compose_system_prompt(
        "Role-specific instructions.",
        tools=["send"],
    )

    assert SEND_TOOL_GUIDANCE in result
    assert "formal node-to-node message" in SEND_TOOL_GUIDANCE


def test_get_system_prompt_reads_global_custom_prompt(monkeypatch):
    monkeypatch.setattr(
        "flowent.settings.get_settings",
        lambda: Settings(
            custom_prompt="Global custom instructions.",
            custom_post_prompt="Runtime-only reminder.",
            roles=[
                RoleConfig(
                    name="Reviewer",
                    system_prompt="Review code carefully.",
                )
            ],
        ),
    )

    prompt = get_system_prompt(
        NodeConfig(node_type=NodeType.AGENT, role_name="Reviewer", tools=["read"])
    )

    assert prompt == compose_system_prompt(
        "Review code carefully.",
        custom_prompt="Global custom instructions.",
        tools=_with_minimum_tools("read"),
    )
    assert "Runtime-only reminder." not in prompt


def test_get_system_prompt_merges_minimum_tools_for_guidance(monkeypatch):
    monkeypatch.setattr(
        "flowent.settings.get_settings",
        lambda: Settings(
            roles=[
                RoleConfig(
                    name="Reviewer",
                    system_prompt="Review code carefully.",
                )
            ],
        ),
    )

    prompt = get_system_prompt(
        NodeConfig(node_type=NodeType.AGENT, role_name="Reviewer", tools=["read"])
    )

    assert IDLE_TOOL_GUIDANCE in prompt
    assert SLEEP_TOOL_GUIDANCE in prompt


def test_get_system_prompt_reads_assistant_role_prompt_when_custom_prompt_is_empty(
    monkeypatch,
):
    monkeypatch.setattr(
        "flowent.settings.get_settings",
        lambda: Settings(
            custom_prompt="",
            roles=[
                RoleConfig(
                    name=STEWARD_ROLE_NAME,
                    system_prompt=STEWARD_ROLE_SYSTEM_PROMPT,
                )
            ],
        ),
    )

    prompt = get_system_prompt(
        NodeConfig(
            node_type=NodeType.ASSISTANT,
            role_name=STEWARD_ROLE_NAME,
            tools=list(STEWARD_ROLE_INCLUDED_TOOLS),
        )
    )

    assert prompt == compose_system_prompt(
        STEWARD_ROLE_SYSTEM_PROMPT,
        custom_prompt="",
        is_assistant=True,
        tools=_with_minimum_tools(*STEWARD_ROLE_INCLUDED_TOOLS),
    )
    assert ASSISTANT_ONLY_PROMPT in prompt
    assert LIST_ROLES_TOOL_GUIDANCE in prompt
    assert LIST_WORKFLOWS_TOOL_GUIDANCE in prompt
    assert LIST_TOOLS_TOOL_GUIDANCE in prompt
    assert MANAGE_TOOLS_GUIDANCE in prompt
    assert CONNECT_TOOL_GUIDANCE not in prompt
    assert "## Tools Available" not in prompt
    assert "create_workflow" in STEWARD_ROLE_SYSTEM_PROMPT
    assert "delete_workflow" in STEWARD_ROLE_SYSTEM_PROMPT
    assert (
        "Creating a workflow also creates its bound Leader"
        in STEWARD_ROLE_SYSTEM_PROMPT
    )
    assert (
        "Do not directly assign execution work to a Worker or other ordinary task node as the default path."
        in STEWARD_ROLE_SYSTEM_PROMPT
    )
    assert (
        "task brief, not a raw copy of the Human's text" in STEWARD_ROLE_SYSTEM_PROMPT
    )
    assert (
        "hand the execution brief to that workflow's Leader"
        in STEWARD_ROLE_SYSTEM_PROMPT
    )
    assert "call `idle` in the same response" in prompt
    assert "Do not repeat or restate a Human-facing reply" in prompt


def test_get_system_prompt_keeps_steward_identity_for_non_steward_assistant_role(
    monkeypatch,
):
    monkeypatch.setattr(
        "flowent.settings.get_settings",
        lambda: Settings(
            roles=[
                RoleConfig(
                    name=STEWARD_ROLE_NAME,
                    system_prompt=STEWARD_ROLE_SYSTEM_PROMPT,
                ),
                RoleConfig(
                    name="Worker",
                    system_prompt=WORKER_ROLE_SYSTEM_PROMPT,
                ),
            ],
        ),
    )

    prompt = get_system_prompt(
        NodeConfig(
            node_type=NodeType.ASSISTANT,
            role_name="Worker",
            tools=[*STEWARD_ROLE_INCLUDED_TOOLS, *WORKER_ROLE_INCLUDED_TOOLS],
        )
    )

    assert ASSISTANT_ONLY_PROMPT in prompt
    assert STEWARD_ROLE_SYSTEM_PROMPT in prompt
    assert "## Selected Role Overlay" in prompt
    assert WORKER_ROLE_SYSTEM_PROMPT in prompt
    assert "Do not follow any selected-role instruction" in prompt
    assert CREATE_WORKFLOW_TOOL_GUIDANCE in prompt
    assert SET_PERMISSIONS_TOOL_GUIDANCE in prompt


def test_get_system_prompt_reads_conductor_prompt_via_role_system(monkeypatch):
    monkeypatch.setattr(
        "flowent.settings.get_settings",
        lambda: Settings(
            roles=[build_conductor_role()],
        ),
    )

    prompt = get_system_prompt(
        NodeConfig(
            node_type=NodeType.AGENT,
            role_name="Conductor",
            tools=list(CONDUCTOR_ROLE_INCLUDED_TOOLS),
        )
    )

    assert prompt == compose_system_prompt(
        CONDUCTOR_ROLE_SYSTEM_PROMPT,
        custom_prompt="",
        tools=_with_minimum_tools(*CONDUCTOR_ROLE_INCLUDED_TOOLS),
    )
    assert ASSISTANT_ONLY_PROMPT not in prompt
    assert CREATE_AGENT_TOOL_GUIDANCE in prompt
    assert LIST_WORKFLOWS_TOOL_GUIDANCE in prompt
    assert LIST_ROLES_TOOL_GUIDANCE in prompt
    assert LIST_TOOLS_TOOL_GUIDANCE in prompt
    assert "## Tools Available" not in CONDUCTOR_ROLE_SYSTEM_PROMPT
    assert (
        "This role is the default behavior template for a workflow's Leader"
        in CONDUCTOR_ROLE_SYSTEM_PROMPT
    )
    assert (
        "Do not default to creating a single Worker and handing it the entire task."
        in CONDUCTOR_ROLE_SYSTEM_PROMPT
    )
    assert (
        "Regular task-node results should usually come back to you first"
        in CONDUCTOR_ROLE_SYSTEM_PROMPT
    )
    assert (
        "Prefer adding peer nodes to the current workflow with `create_agent`"
        in CONDUCTOR_ROLE_SYSTEM_PROMPT
    )
    assert (
        "**Create the network structure** with `create_agent` and `connect`"
        in CONDUCTOR_ROLE_SYSTEM_PROMPT
    )
    assert "**Dispatch immediately** after creation" in CONDUCTOR_ROLE_SYSTEM_PROMPT


def test_get_system_prompt_for_worker_omits_graph_creation_guidance(monkeypatch):
    monkeypatch.setattr(
        "flowent.settings.get_settings",
        lambda: Settings(
            roles=[
                RoleConfig(
                    name="Worker",
                    system_prompt=WORKER_ROLE_SYSTEM_PROMPT,
                )
            ],
        ),
    )

    prompt = get_system_prompt(
        NodeConfig(
            node_type=NodeType.AGENT,
            role_name="Worker",
            tools=["read", "exec"],
        )
    )

    assert CREATE_AGENT_TOOL_GUIDANCE not in prompt
    assert CONNECT_TOOL_GUIDANCE not in prompt
    assert DELEGATION_GENERAL_GUIDANCE not in prompt


def test_get_system_prompt_reads_designer_prompt_via_role_system(monkeypatch):
    monkeypatch.setattr(
        "flowent.settings.get_settings",
        lambda: Settings(
            roles=[build_designer_role()],
        ),
    )

    prompt = get_system_prompt(
        NodeConfig(
            node_type=NodeType.AGENT,
            role_name="Designer",
            tools=list(DESIGNER_ROLE_INCLUDED_TOOLS),
        )
    )

    assert prompt == compose_system_prompt(
        DESIGNER_ROLE_SYSTEM_PROMPT,
        custom_prompt="",
        tools=_with_minimum_tools(*DESIGNER_ROLE_INCLUDED_TOOLS),
    )
    assert CREATE_AGENT_TOOL_GUIDANCE not in prompt
    assert CONNECT_TOOL_GUIDANCE not in prompt
    assert DELEGATION_GENERAL_GUIDANCE not in prompt
    assert (
        "frontend implementation and visual design node" in DESIGNER_ROLE_SYSTEM_PROMPT
    )
    assert (
        "pages, components, layouts, and interaction details"
        in DESIGNER_ROLE_SYSTEM_PROMPT
    )
    assert (
        "not the default executor for unrelated backend" in DESIGNER_ROLE_SYSTEM_PROMPT
    )


def test_worker_default_tools_do_not_include_create_agent():
    assert "create_agent" not in WORKER_ROLE_INCLUDED_TOOLS


def test_designer_default_tools_match_frontend_scope():
    assert DESIGNER_ROLE_INCLUDED_TOOLS == ["read", "edit", "exec"]
    assert "create_agent" not in DESIGNER_ROLE_INCLUDED_TOOLS
    assert "set_permissions" not in DESIGNER_ROLE_INCLUDED_TOOLS
    assert "fetch" not in DESIGNER_ROLE_INCLUDED_TOOLS


def test_get_system_prompt_falls_back_when_role_is_missing(monkeypatch):
    monkeypatch.setattr(
        "flowent.settings.get_settings",
        lambda: Settings(roles=[]),
    )

    prompt = get_system_prompt(
        NodeConfig(node_type=NodeType.AGENT, role_name="Ghost", tools=["read"])
    )

    assert prompt == compose_system_prompt(
        DEFAULT_AGENT_ROLE_PROMPT,
        custom_prompt="",
        tools=_with_minimum_tools("read"),
    )
    assert ASSISTANT_ONLY_PROMPT not in prompt
    assert "@target:" not in WORKER_ROLE_SYSTEM_PROMPT
    assert "your parent" not in WORKER_ROLE_SYSTEM_PROMPT


def test_get_system_prompt_falls_back_to_steward_role_for_assistant(monkeypatch):
    monkeypatch.setattr(
        "flowent.settings.get_settings",
        lambda: Settings(roles=[]),
    )

    prompt = get_system_prompt(
        NodeConfig(
            node_type=NodeType.ASSISTANT,
            role_name="Ghost",
            tools=list(STEWARD_ROLE_INCLUDED_TOOLS),
        )
    )

    assert prompt == compose_system_prompt(
        STEWARD_ROLE_SYSTEM_PROMPT,
        custom_prompt="",
        is_assistant=True,
        tools=_with_minimum_tools(*STEWARD_ROLE_INCLUDED_TOOLS),
    )
    assert ASSISTANT_ONLY_PROMPT in prompt


def test_steward_included_tools_contains_list_roles_and_list_tools():
    assert "delete_workflow" in STEWARD_ROLE_INCLUDED_TOOLS
    assert "set_permissions" in STEWARD_ROLE_INCLUDED_TOOLS
    assert "list_roles" in STEWARD_ROLE_INCLUDED_TOOLS
    assert "list_workflows" in STEWARD_ROLE_INCLUDED_TOOLS
    assert "list_tools" in STEWARD_ROLE_INCLUDED_TOOLS
    assert "connect" not in STEWARD_ROLE_INCLUDED_TOOLS
    assert "connect" in CONDUCTOR_ROLE_INCLUDED_TOOLS
    assert "set_permissions" not in CONDUCTOR_ROLE_INCLUDED_TOOLS
    assert "set_permissions" not in WORKER_ROLE_INCLUDED_TOOLS


def test_steward_prompt_requires_same_response_dispatch_and_no_rebroadcast():
    assert (
        "dispatch the first task brief to its Leader with `send`"
        in STEWARD_ROLE_SYSTEM_PROMPT
    )
    assert (
        "keep using `send` until every intended Leader has been dispatched"
        in STEWARD_ROLE_SYSTEM_PROMPT
    )
    assert "Do not re-send a task to a node" in STEWARD_ROLE_SYSTEM_PROMPT
    assert (
        "Do not insert tool calls such as `contacts` between dispatch responses"
        in STEWARD_ROLE_SYSTEM_PROMPT
    )
