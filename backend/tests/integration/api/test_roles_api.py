from fastapi.testclient import TestClient

from flowent.settings import (
    CONDUCTOR_ROLE_NAME,
    ProviderConfig,
    RoleConfig,
    RoleModelConfig,
    Settings,
)


def test_roles_api_lists_worker_conductor_and_designer_as_builtin(client: TestClient):
    response = client.get("/api/roles")

    assert response.status_code == 200
    roles = {role["name"]: role for role in response.json()["roles"]}
    assert roles["Worker"]["is_builtin"] is True
    assert roles[CONDUCTOR_ROLE_NAME]["is_builtin"] is True
    assert roles["Designer"]["is_builtin"] is True


def test_roles_bootstrap_includes_tools_and_providers(client: TestClient, monkeypatch):
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
                name="Steward",
                description="Default assistant role.",
                system_prompt="Default assistant role.",
            ),
            RoleConfig(
                name="Reviewer",
                description="Review carefully.",
                system_prompt="Review carefully.",
            ),
        ],
    )

    monkeypatch.setattr("flowent.routes.roles.get_settings", lambda: settings)

    response = client.get("/api/roles/bootstrap")

    assert response.status_code == 200
    payload = response.json()
    assert payload["providers"] == [
        {
            "id": "provider-1",
            "name": "Primary",
            "type": "openai_compatible",
            "base_url": "https://api.example.com/v1",
            "api_key": "secret",
            "headers": {},
            "retry_429_delay_seconds": 0,
            "models": [],
        }
    ]
    assert {role["name"] for role in payload["roles"]} == {"Steward", "Reviewer"}
    tool_names = {tool["name"] for tool in payload["tools"]}
    assert "delete_workflow" not in tool_names
    assert "list_workflows" not in tool_names
    assert "create_agent" in tool_names
    assert "manage_roles" not in tool_names


def test_create_role_rejects_duplicate_name(client: TestClient, monkeypatch):
    settings = Settings(roles=[RoleConfig(name="Writer", system_prompt="draft")])
    saved: list[Settings] = []

    monkeypatch.setattr("flowent.routes.roles.get_settings", lambda: settings)
    monkeypatch.setattr(
        "flowent.routes.roles.save_settings",
        lambda updated: saved.append(updated),
    )

    response = client.post(
        "/api/roles",
        json={
            "name": "Writer",
            "description": "Write drafts",
            "system_prompt": "another prompt",
        },
    )

    assert response.status_code == 409
    assert response.json() == {"detail": "Role 'Writer' already exists"}
    assert saved == []


def test_update_and_delete_role_use_name_path(client: TestClient, monkeypatch):
    settings = Settings(
        roles=[
            RoleConfig(name="Writer", system_prompt="draft"),
            RoleConfig(
                name="Reviewer",
                system_prompt="review",
                excluded_tools=["fetch"],
            ),
        ]
    )
    saved: list[list[tuple[str, str]]] = []

    monkeypatch.setattr("flowent.routes.roles.get_settings", lambda: settings)
    monkeypatch.setattr(
        "flowent.routes.roles.save_settings",
        lambda updated: saved.append(
            [(role.name, role.system_prompt) for role in updated.roles]
        ),
    )

    duplicate = client.put("/api/roles/Writer", json={"name": "Reviewer"})

    assert duplicate.status_code == 409
    assert duplicate.json() == {"detail": "Role 'Reviewer' already exists"}

    update = client.put(
        "/api/roles/Writer",
        json={
            "name": "Researcher",
            "description": "Investigate systems",
            "system_prompt": "investigate",
        },
    )

    assert update.status_code == 200
    assert update.json() == {
        "name": "Researcher",
        "description": "Investigate systems",
        "system_prompt": "investigate",
        "model": None,
        "model_params": None,
        "included_tools": [],
        "excluded_tools": [],
        "is_builtin": False,
    }

    delete = client.delete("/api/roles/Researcher")

    assert delete.status_code == 200
    assert delete.json() == {"status": "deleted"}
    assert [(role.name, role.system_prompt) for role in settings.roles] == [
        ("Reviewer", "review")
    ]
    assert saved == [
        [("Researcher", "investigate"), ("Reviewer", "review")],
        [("Reviewer", "review")],
    ]


def test_delete_builtin_role_returns_error(client: TestClient, monkeypatch):
    settings = Settings(roles=[RoleConfig(name="Worker", system_prompt="Do work.")])

    monkeypatch.setattr("flowent.routes.roles.get_settings", lambda: settings)

    response = client.delete("/api/roles/Worker")

    assert response.status_code == 400
    assert response.json() == {"detail": "Cannot delete built-in role 'Worker'"}


def test_create_role_rejects_overlapping_included_and_excluded_tools(
    client: TestClient,
    monkeypatch,
):
    monkeypatch.setattr("flowent.routes.roles.get_settings", lambda: Settings())

    response = client.post(
        "/api/roles",
        json={
            "name": "Writer",
            "description": "Write drafts",
            "system_prompt": "another prompt",
            "included_tools": ["read"],
            "excluded_tools": ["read"],
        },
    )

    assert response.status_code == 400
    assert response.json() == {
        "detail": "included_tools and excluded_tools cannot overlap: read"
    }


def test_create_role_accepts_model_override(client: TestClient, monkeypatch):
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

    monkeypatch.setattr("flowent.routes.roles.get_settings", lambda: settings)
    monkeypatch.setattr("flowent.routes.roles.save_settings", lambda updated: None)

    response = client.post(
        "/api/roles",
        json={
            "name": "Reviewer",
            "description": "Review work carefully",
            "system_prompt": "Review work",
            "model": {
                "provider_id": "provider-1",
                "model": "gpt-4.1-mini",
            },
        },
    )

    assert response.status_code == 200
    assert response.json()["model"] == {
        "provider_id": "provider-1",
        "model": "gpt-4.1-mini",
    }
    assert settings.roles[0].model == RoleModelConfig(
        provider_id="provider-1",
        model="gpt-4.1-mini",
    )
