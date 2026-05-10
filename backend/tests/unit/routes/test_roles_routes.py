import asyncio

import pytest
from fastapi import HTTPException

from flowent.routes.roles import (
    CreateRoleRequest,
    RoleModelRequest,
    UpdateRoleRequest,
    create_role,
    delete_role,
    list_roles,
    update_role,
)
from flowent.settings import (
    CONDUCTOR_ROLE_NAME,
    DESIGNER_ROLE_NAME,
    STEWARD_ROLE_INCLUDED_TOOLS,
    STEWARD_ROLE_NAME,
    AssistantSettings,
    ProviderConfig,
    ProviderModelCatalogEntry,
    RoleConfig,
    RoleModelConfig,
    Settings,
)


def test_list_roles_returns_is_builtin_flags(monkeypatch):
    settings = Settings(
        roles=[
            RoleConfig(
                name="Worker",
                description="General execution role",
                system_prompt="Do work.",
                included_tools=["read", "exec"],
            ),
            RoleConfig(
                name=CONDUCTOR_ROLE_NAME,
                description="Leader role",
                system_prompt="Coordinate tasks.",
                included_tools=[
                    "create_agent",
                    "connect",
                    "list_roles",
                    "list_tools",
                ],
            ),
            RoleConfig(
                name=DESIGNER_ROLE_NAME,
                description="Frontend design role",
                system_prompt="Design interfaces.",
                included_tools=["read", "edit", "exec"],
            ),
            RoleConfig(
                name="Reviewer",
                description="Review code carefully",
                system_prompt="Review code carefully",
                included_tools=["read"],
                excluded_tools=["fetch"],
            ),
        ]
    )

    monkeypatch.setattr("flowent.routes.roles.get_settings", lambda: settings)

    result = asyncio.run(list_roles())

    assert result == {
        "roles": [
            {
                "name": "Worker",
                "description": "General execution role",
                "system_prompt": "Do work.",
                "model": None,
                "model_params": None,
                "included_tools": ["read", "exec"],
                "excluded_tools": [],
                "is_builtin": True,
            },
            {
                "name": CONDUCTOR_ROLE_NAME,
                "description": "Leader role",
                "system_prompt": "Coordinate tasks.",
                "model": None,
                "model_params": None,
                "included_tools": [
                    "create_agent",
                    "connect",
                    "list_roles",
                    "list_tools",
                ],
                "excluded_tools": [],
                "is_builtin": True,
            },
            {
                "name": DESIGNER_ROLE_NAME,
                "description": "Frontend design role",
                "system_prompt": "Design interfaces.",
                "model": None,
                "model_params": None,
                "included_tools": ["read", "edit", "exec"],
                "excluded_tools": [],
                "is_builtin": True,
            },
            {
                "name": "Reviewer",
                "description": "Review code carefully",
                "system_prompt": "Review code carefully",
                "model": None,
                "model_params": None,
                "included_tools": ["read"],
                "excluded_tools": ["fetch"],
                "is_builtin": False,
            },
        ]
    }


def test_create_role_uses_name_as_identifier(monkeypatch):
    settings = Settings()
    saved: list[list[str]] = []

    monkeypatch.setattr("flowent.routes.roles.get_settings", lambda: settings)
    monkeypatch.setattr(
        "flowent.routes.roles.save_settings",
        lambda current: saved.append([role.name for role in current.roles]),
    )

    result = asyncio.run(
        create_role(
            CreateRoleRequest(
                name="Reviewer",
                description="Review code carefully",
                system_prompt="Review code carefully",
                included_tools=["read"],
            )
        )
    )

    assert result == {
        "name": "Reviewer",
        "description": "Review code carefully",
        "system_prompt": "Review code carefully",
        "model": None,
        "model_params": None,
        "included_tools": ["read"],
        "excluded_tools": [],
        "is_builtin": False,
    }
    assert settings.roles == [
        RoleConfig(
            name="Reviewer",
            description="Review code carefully",
            system_prompt="Review code carefully",
            included_tools=["read"],
        )
    ]
    assert saved == [["Reviewer"]]


def test_create_role_filters_assistant_only_tools(monkeypatch):
    settings = Settings()
    monkeypatch.setattr("flowent.routes.roles.get_settings", lambda: settings)
    monkeypatch.setattr("flowent.routes.roles.save_settings", lambda current: None)

    result = asyncio.run(
        create_role(
            CreateRoleRequest(
                name="Reviewer",
                description="Review code carefully",
                system_prompt="Review code carefully",
                included_tools=[
                    "read",
                    "create_workflow",
                    "delete_workflow",
                    "list_workflows",
                    "manage_settings",
                ],
                excluded_tools=["fetch"],
            )
        )
    )

    assert result["included_tools"] == ["read"]
    assert result["excluded_tools"] == ["fetch"]
    assert settings.roles[0].included_tools == ["read"]
    assert settings.roles[0].excluded_tools == ["fetch"]


def test_create_role_rejects_duplicate_name(monkeypatch):
    settings = Settings(
        roles=[RoleConfig(name="Reviewer", system_prompt="Review code carefully")]
    )

    monkeypatch.setattr("flowent.routes.roles.get_settings", lambda: settings)

    with pytest.raises(HTTPException) as excinfo:
        asyncio.run(
            create_role(
                CreateRoleRequest(
                    name="Reviewer",
                    description="Different description",
                    system_prompt="Different prompt",
                )
            )
        )

    assert excinfo.value.status_code == 409
    assert excinfo.value.detail == "Role 'Reviewer' already exists"


def test_update_role_uses_name_path_parameter(monkeypatch):
    settings = Settings(
        roles=[
            RoleConfig(
                name="Reviewer",
                description="Review code carefully",
                system_prompt="Review code carefully",
                included_tools=["read"],
            )
        ]
    )
    saved: list[list[str]] = []

    monkeypatch.setattr("flowent.routes.roles.get_settings", lambda: settings)
    monkeypatch.setattr(
        "flowent.routes.roles.save_settings",
        lambda current: saved.append([role.name for role in current.roles]),
    )

    result = asyncio.run(
        update_role(
            "Reviewer",
            UpdateRoleRequest(
                name="Architect",
                description="Design systems role",
                system_prompt="Design systems",
                excluded_tools=["fetch"],
            ),
        )
    )

    assert result == {
        "name": "Architect",
        "description": "Design systems role",
        "system_prompt": "Design systems",
        "model": None,
        "model_params": None,
        "included_tools": ["read"],
        "excluded_tools": ["fetch"],
        "is_builtin": False,
    }
    assert settings.roles == [
        RoleConfig(
            name="Architect",
            description="Design systems role",
            system_prompt="Design systems",
            included_tools=["read"],
            excluded_tools=["fetch"],
        )
    ]
    assert saved == [["Architect"]]


def test_update_role_filters_assistant_only_tools(monkeypatch):
    settings = Settings(
        roles=[
            RoleConfig(
                name="Reviewer",
                description="Review code carefully",
                system_prompt="Review code carefully",
                included_tools=["read"],
            )
        ]
    )
    monkeypatch.setattr("flowent.routes.roles.get_settings", lambda: settings)
    monkeypatch.setattr("flowent.routes.roles.save_settings", lambda current: None)

    result = asyncio.run(
        update_role(
            "Reviewer",
            UpdateRoleRequest(
                included_tools=[
                    "read",
                    "create_workflow",
                    "delete_workflow",
                    "list_workflows",
                    "manage_roles",
                ],
                excluded_tools=["fetch"],
            ),
        )
    )

    assert result["included_tools"] == ["read"]
    assert result["excluded_tools"] == ["fetch"]
    assert settings.roles[0].included_tools == ["read"]
    assert settings.roles[0].excluded_tools == ["fetch"]


def test_update_role_rejects_duplicate_name(monkeypatch):
    settings = Settings(
        roles=[
            RoleConfig(name="Reviewer", system_prompt="Review code carefully"),
            RoleConfig(name="Architect", system_prompt="Design systems"),
        ]
    )

    monkeypatch.setattr("flowent.routes.roles.get_settings", lambda: settings)

    with pytest.raises(HTTPException) as excinfo:
        asyncio.run(update_role("Reviewer", UpdateRoleRequest(name="Architect")))

    assert excinfo.value.status_code == 409
    assert excinfo.value.detail == "Role 'Architect' already exists"


@pytest.mark.parametrize(
    "builtin_role_name",
    ["Worker", CONDUCTOR_ROLE_NAME, DESIGNER_ROLE_NAME],
)
def test_update_role_rejects_renaming_builtin_role(monkeypatch, builtin_role_name):
    settings = Settings(
        roles=[RoleConfig(name=builtin_role_name, system_prompt="Do work.")]
    )

    monkeypatch.setattr("flowent.routes.roles.get_settings", lambda: settings)

    with pytest.raises(HTTPException) as excinfo:
        asyncio.run(update_role(builtin_role_name, UpdateRoleRequest(name="Helper")))

    assert excinfo.value.status_code == 400
    assert excinfo.value.detail == f"Cannot rename built-in role '{builtin_role_name}'"


def test_update_role_rejects_builtin_prompt_change(monkeypatch):
    settings = Settings(
        roles=[
            RoleConfig(name="Worker", system_prompt="Do work.", included_tools=["read"])
        ]
    )

    monkeypatch.setattr("flowent.routes.roles.get_settings", lambda: settings)

    with pytest.raises(HTTPException) as excinfo:
        asyncio.run(
            update_role(
                "Worker",
                UpdateRoleRequest(system_prompt="Different prompt"),
            )
        )

    assert excinfo.value.status_code == 400
    assert (
        excinfo.value.detail
        == "Cannot modify built-in role 'Worker' fields other than model or model_params"
    )


def test_update_builtin_steward_role_model_preserves_management_tools(monkeypatch):
    settings = Settings(
        providers=[
            ProviderConfig(
                id="provider-1",
                name="OpenAI",
                type="openai",
                base_url="https://api.openai.com/v1",
                api_key="sk-test",
                models=[
                    ProviderModelCatalogEntry(
                        model="gpt-4.1-mini",
                    )
                ],
            )
        ],
        roles=[
            RoleConfig(
                name=STEWARD_ROLE_NAME,
                description="Assistant role",
                system_prompt="Help coordinate work.",
                included_tools=list(STEWARD_ROLE_INCLUDED_TOOLS),
            )
        ],
    )

    monkeypatch.setattr("flowent.routes.roles.get_settings", lambda: settings)
    monkeypatch.setattr("flowent.routes.roles.save_settings", lambda current: None)

    result = asyncio.run(
        update_role(
            STEWARD_ROLE_NAME,
            UpdateRoleRequest(
                model=RoleModelRequest(
                    provider_id="provider-1",
                    model="gpt-4.1-mini",
                )
            ),
        )
    )

    assert result["included_tools"] == list(STEWARD_ROLE_INCLUDED_TOOLS)
    assert settings.roles[0].included_tools == list(STEWARD_ROLE_INCLUDED_TOOLS)


def test_delete_role_uses_name_path_parameter(monkeypatch):
    settings = Settings(
        roles=[
            RoleConfig(name="Reviewer", system_prompt="Review code carefully"),
            RoleConfig(name="Architect", system_prompt="Design systems"),
        ]
    )
    saved: list[list[str]] = []

    monkeypatch.setattr("flowent.routes.roles.get_settings", lambda: settings)
    monkeypatch.setattr(
        "flowent.routes.roles.save_settings",
        lambda current: saved.append([role.name for role in current.roles]),
    )

    result = asyncio.run(delete_role("Reviewer"))

    assert result == {"status": "deleted"}
    assert settings.roles == [
        RoleConfig(name="Architect", system_prompt="Design systems")
    ]
    assert saved == [["Architect"]]


@pytest.mark.parametrize(
    "builtin_role_name",
    ["Worker", CONDUCTOR_ROLE_NAME, DESIGNER_ROLE_NAME],
)
def test_delete_role_rejects_builtin_role(monkeypatch, builtin_role_name):
    settings = Settings(
        roles=[RoleConfig(name=builtin_role_name, system_prompt="Do work.")]
    )

    monkeypatch.setattr("flowent.routes.roles.get_settings", lambda: settings)

    with pytest.raises(HTTPException) as excinfo:
        asyncio.run(delete_role(builtin_role_name))

    assert excinfo.value.status_code == 400
    assert excinfo.value.detail == f"Cannot delete built-in role '{builtin_role_name}'"


def test_create_role_rejects_overlapping_included_and_excluded_tools(monkeypatch):
    monkeypatch.setattr("flowent.routes.roles.get_settings", lambda: Settings())

    with pytest.raises(HTTPException) as excinfo:
        asyncio.run(
            create_role(
                CreateRoleRequest(
                    name="Reviewer",
                    description="Review code carefully",
                    system_prompt="Review code carefully",
                    included_tools=["read"],
                    excluded_tools=["read"],
                )
            )
        )

    assert excinfo.value.status_code == 400
    assert (
        excinfo.value.detail == "included_tools and excluded_tools cannot overlap: read"
    )


def test_update_role_persists_model(monkeypatch):
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
        roles=[RoleConfig(name="Reviewer", system_prompt="Review carefully")],
    )

    monkeypatch.setattr("flowent.routes.roles.get_settings", lambda: settings)
    monkeypatch.setattr("flowent.routes.roles.save_settings", lambda current: None)

    result = asyncio.run(
        update_role(
            "Reviewer",
            UpdateRoleRequest(
                model=RoleModelRequest(
                    provider_id="provider-1",
                    model="gpt-4.1-mini",
                )
            ),
        )
    )

    assert result["model"] == {
        "provider_id": "provider-1",
        "model": "gpt-4.1-mini",
    }
    assert settings.roles[0].model == RoleModelConfig(
        provider_id="provider-1",
        model="gpt-4.1-mini",
    )


def test_update_role_renames_selected_assistant_role(monkeypatch):
    settings = Settings(
        assistant=AssistantSettings(role_name="Reviewer"),
        roles=[RoleConfig(name="Reviewer", system_prompt="Review carefully")],
    )

    monkeypatch.setattr("flowent.routes.roles.get_settings", lambda: settings)
    monkeypatch.setattr("flowent.routes.roles.save_settings", lambda current: None)

    asyncio.run(
        update_role(
            "Reviewer",
            UpdateRoleRequest(name="Architect"),
        )
    )

    assert settings.assistant.role_name == "Architect"


def test_delete_role_resets_selected_assistant_role_to_steward(monkeypatch):
    settings = Settings(
        assistant=AssistantSettings(role_name="Reviewer"),
        roles=[RoleConfig(name="Reviewer", system_prompt="Review carefully")],
    )

    monkeypatch.setattr("flowent.routes.roles.get_settings", lambda: settings)
    monkeypatch.setattr("flowent.routes.roles.save_settings", lambda current: None)

    asyncio.run(delete_role("Reviewer"))

    assert settings.assistant.role_name == "Steward"
