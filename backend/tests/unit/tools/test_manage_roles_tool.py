import json

from flowent.agent import Agent
from flowent.models import NodeConfig, NodeType
from flowent.settings import (
    AssistantSettings,
    ProviderConfig,
    RoleConfig,
    RoleModelConfig,
    Settings,
)
from flowent.tools.manage_roles import ManageRolesTool


def test_manage_roles_list_includes_builtin_flags(monkeypatch):
    agent = Agent(NodeConfig(node_type=NodeType.ASSISTANT, tools=["manage_roles"]))
    settings = Settings(
        roles=[
            RoleConfig(
                name="Worker",
                description="General execution role",
                system_prompt="Do work.",
            ),
            RoleConfig(
                name="Reviewer",
                description="Review work carefully",
                system_prompt="Review work.",
            ),
        ]
    )

    monkeypatch.setattr("flowent.settings.get_settings", lambda: settings)

    result = json.loads(ManageRolesTool().execute(agent, {"action": "list"}))

    assert result == [
        {
            "name": "Worker",
            "description": "General execution role",
            "system_prompt": "Do work.",
            "model": None,
            "model_params": None,
            "included_tools": [],
            "excluded_tools": [],
            "is_builtin": True,
        },
        {
            "name": "Reviewer",
            "description": "Review work carefully",
            "system_prompt": "Review work.",
            "model": None,
            "model_params": None,
            "included_tools": [],
            "excluded_tools": [],
            "is_builtin": False,
        },
    ]


def test_manage_roles_create_adds_custom_role(monkeypatch):
    agent = Agent(NodeConfig(node_type=NodeType.ASSISTANT, tools=["manage_roles"]))
    settings = Settings(
        providers=[
            ProviderConfig(
                id="provider-1",
                name="Primary",
                type="openai_compatible",
                base_url="https://api.example.com/v1",
                api_key="secret",
            )
        ]
    )
    saved: list[Settings] = []

    monkeypatch.setattr("flowent.settings.get_settings", lambda: settings)
    monkeypatch.setattr(
        "flowent.settings.save_settings", lambda current: saved.append(current)
    )

    result = json.loads(
        ManageRolesTool().execute(
            agent,
            {
                "action": "create",
                "name": "Reviewer",
                "description": "Review work carefully",
                "system_prompt": "Review carefully.",
                "model": {
                    "provider_id": "provider-1",
                    "model": "gpt-4.1-mini",
                },
                "included_tools": ["read", "read", "exec"],
                "excluded_tools": ["fetch"],
            },
        )
    )

    assert result == {
        "name": "Reviewer",
        "description": "Review work carefully",
        "system_prompt": "Review carefully.",
        "model": {
            "provider_id": "provider-1",
            "model": "gpt-4.1-mini",
        },
        "model_params": None,
        "included_tools": ["read", "exec"],
        "excluded_tools": ["fetch"],
        "is_builtin": False,
    }
    assert settings.roles == [
        RoleConfig(
            name="Reviewer",
            description="Review work carefully",
            system_prompt="Review carefully.",
            model=RoleModelConfig(
                provider_id="provider-1",
                model="gpt-4.1-mini",
            ),
            included_tools=["read", "exec"],
            excluded_tools=["fetch"],
        )
    ]
    assert saved == [settings]


def test_manage_roles_create_rejects_duplicate_name(monkeypatch):
    agent = Agent(NodeConfig(node_type=NodeType.ASSISTANT, tools=["manage_roles"]))
    settings = Settings(roles=[RoleConfig(name="Reviewer", system_prompt="Review.")])

    monkeypatch.setattr("flowent.settings.get_settings", lambda: settings)

    result = json.loads(
        ManageRolesTool().execute(
            agent,
            {
                "action": "create",
                "name": "Reviewer",
                "description": "Review work carefully",
                "system_prompt": "Another prompt.",
            },
        )
    )

    assert result == {"error": "Role 'Reviewer' already exists"}


def test_manage_roles_create_rejects_overlapping_tool_config(monkeypatch):
    agent = Agent(NodeConfig(node_type=NodeType.ASSISTANT, tools=["manage_roles"]))
    monkeypatch.setattr("flowent.settings.get_settings", lambda: Settings())

    result = json.loads(
        ManageRolesTool().execute(
            agent,
            {
                "action": "create",
                "name": "Reviewer",
                "description": "Review work carefully",
                "system_prompt": "Review carefully.",
                "included_tools": ["read"],
                "excluded_tools": ["read"],
            },
        )
    )

    assert result == {"error": "included_tools and excluded_tools cannot overlap: read"}


def test_manage_roles_update_renames_and_updates_role(monkeypatch):
    agent = Agent(NodeConfig(node_type=NodeType.ASSISTANT, tools=["manage_roles"]))
    settings = Settings(
        providers=[
            ProviderConfig(
                id="provider-1",
                name="Primary",
                type="openai_compatible",
                base_url="https://api.example.com/v1",
                api_key="secret",
            )
        ],
        roles=[
            RoleConfig(
                name="Reviewer",
                description="Review existing work",
                system_prompt="Review carefully.",
            )
        ],
    )
    saved: list[Settings] = []

    monkeypatch.setattr("flowent.settings.get_settings", lambda: settings)
    monkeypatch.setattr(
        "flowent.settings.save_settings", lambda current: saved.append(current)
    )

    result = json.loads(
        ManageRolesTool().execute(
            agent,
            {
                "action": "update",
                "name": "Reviewer",
                "new_name": "Researcher",
                "description": "Investigate code and system behavior",
                "system_prompt": "Investigate carefully.",
                "model": {
                    "provider_id": "provider-1",
                    "model": "gpt-4.1-mini",
                },
                "included_tools": ["read"],
                "excluded_tools": ["fetch"],
            },
        )
    )

    assert result == {
        "name": "Researcher",
        "description": "Investigate code and system behavior",
        "system_prompt": "Investigate carefully.",
        "model": {
            "provider_id": "provider-1",
            "model": "gpt-4.1-mini",
        },
        "model_params": None,
        "included_tools": ["read"],
        "excluded_tools": ["fetch"],
        "is_builtin": False,
    }
    assert settings.roles == [
        RoleConfig(
            name="Researcher",
            description="Investigate code and system behavior",
            system_prompt="Investigate carefully.",
            model=RoleModelConfig(
                provider_id="provider-1",
                model="gpt-4.1-mini",
            ),
            included_tools=["read"],
            excluded_tools=["fetch"],
        )
    ]
    assert saved == [settings]


def test_manage_roles_update_rejects_builtin_rename(monkeypatch):
    agent = Agent(NodeConfig(node_type=NodeType.ASSISTANT, tools=["manage_roles"]))
    settings = Settings(roles=[RoleConfig(name="Worker", system_prompt="Do work.")])

    monkeypatch.setattr("flowent.settings.get_settings", lambda: settings)

    result = json.loads(
        ManageRolesTool().execute(
            agent,
            {
                "action": "update",
                "name": "Worker",
                "new_name": "Builder",
            },
        )
    )

    assert result == {"error": "Cannot rename built-in role 'Worker'"}


def test_manage_roles_update_rejects_builtin_prompt_change(monkeypatch):
    agent = Agent(NodeConfig(node_type=NodeType.ASSISTANT, tools=["manage_roles"]))
    settings = Settings(roles=[RoleConfig(name="Worker", system_prompt="Do work.")])

    monkeypatch.setattr("flowent.settings.get_settings", lambda: settings)

    result = json.loads(
        ManageRolesTool().execute(
            agent,
            {
                "action": "update",
                "name": "Worker",
                "system_prompt": "Different prompt",
            },
        )
    )

    assert result == {
        "error": "Cannot modify built-in role 'Worker' fields other than model or model_params"
    }


def test_manage_roles_delete_removes_custom_role(monkeypatch):
    agent = Agent(NodeConfig(node_type=NodeType.ASSISTANT, tools=["manage_roles"]))
    settings = Settings(roles=[RoleConfig(name="Reviewer", system_prompt="Review.")])
    saved: list[Settings] = []

    monkeypatch.setattr("flowent.settings.get_settings", lambda: settings)
    monkeypatch.setattr(
        "flowent.settings.save_settings", lambda current: saved.append(current)
    )

    result = json.loads(
        ManageRolesTool().execute(
            agent,
            {"action": "delete", "name": "Reviewer"},
        )
    )

    assert result == {"status": "deleted"}
    assert settings.roles == []
    assert saved == [settings]


def test_manage_roles_delete_rejects_builtin_role(monkeypatch):
    agent = Agent(NodeConfig(node_type=NodeType.ASSISTANT, tools=["manage_roles"]))
    monkeypatch.setattr("flowent.settings.get_settings", lambda: Settings())

    result = json.loads(
        ManageRolesTool().execute(
            agent,
            {"action": "delete", "name": "Worker"},
        )
    )

    assert result == {"error": "Cannot delete built-in role 'Worker'"}


def test_manage_roles_update_rejects_designer_builtin_rename(monkeypatch):
    agent = Agent(NodeConfig(node_type=NodeType.ASSISTANT, tools=["manage_roles"]))
    settings = Settings(
        roles=[RoleConfig(name="Designer", system_prompt="Design interfaces.")]
    )

    monkeypatch.setattr("flowent.settings.get_settings", lambda: settings)

    result = json.loads(
        ManageRolesTool().execute(
            agent,
            {
                "action": "update",
                "name": "Designer",
                "new_name": "Builder",
            },
        )
    )

    assert result == {"error": "Cannot rename built-in role 'Designer'"}


def test_manage_roles_delete_rejects_designer_builtin_role(monkeypatch):
    agent = Agent(NodeConfig(node_type=NodeType.ASSISTANT, tools=["manage_roles"]))
    settings = Settings(
        roles=[RoleConfig(name="Designer", system_prompt="Design interfaces.")]
    )

    monkeypatch.setattr("flowent.settings.get_settings", lambda: settings)

    result = json.loads(
        ManageRolesTool().execute(
            agent,
            {"action": "delete", "name": "Designer"},
        )
    )

    assert result == {"error": "Cannot delete built-in role 'Designer'"}


def test_manage_roles_update_renames_selected_assistant_role(monkeypatch):
    agent = Agent(NodeConfig(node_type=NodeType.ASSISTANT, tools=["manage_roles"]))
    settings = Settings(
        assistant=AssistantSettings(role_name="Reviewer"),
        roles=[RoleConfig(name="Reviewer", system_prompt="Review carefully.")],
    )

    monkeypatch.setattr("flowent.settings.get_settings", lambda: settings)
    monkeypatch.setattr("flowent.settings.save_settings", lambda current: None)
    monkeypatch.setattr(
        "flowent.providers.gateway.gateway.invalidate_cache", lambda: None
    )

    result = json.loads(
        ManageRolesTool().execute(
            agent,
            {
                "action": "update",
                "name": "Reviewer",
                "new_name": "Architect",
            },
        )
    )

    assert result["name"] == "Architect"
    assert settings.assistant.role_name == "Architect"


def test_manage_roles_delete_resets_selected_assistant_role(monkeypatch):
    agent = Agent(NodeConfig(node_type=NodeType.ASSISTANT, tools=["manage_roles"]))
    settings = Settings(
        assistant=AssistantSettings(role_name="Reviewer"),
        roles=[RoleConfig(name="Reviewer", system_prompt="Review.")],
    )

    monkeypatch.setattr("flowent.settings.get_settings", lambda: settings)
    monkeypatch.setattr("flowent.settings.save_settings", lambda current: None)
    monkeypatch.setattr(
        "flowent.providers.gateway.gateway.invalidate_cache", lambda: None
    )

    result = json.loads(
        ManageRolesTool().execute(
            agent,
            {"action": "delete", "name": "Reviewer"},
        )
    )

    assert result == {"status": "deleted"}
    assert settings.assistant.role_name == "Steward"
