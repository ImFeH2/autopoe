from fastapi.testclient import TestClient


def test_tools_api_shows_agent_visible_management_tools(client: TestClient):
    response = client.get("/api/tools")

    assert response.status_code == 200
    tool_names = {tool["name"] for tool in response.json()["tools"]}
    assert "manage_providers" in tool_names
    assert "manage_roles" in tool_names
    assert "manage_settings" in tool_names
    assert "manage_prompts" in tool_names
    assert "set_permissions" in tool_names
    assert "sleep" in tool_names
    assert "delete_workflow" in tool_names
    assert "create_agent" in tool_names
    assert "connect" in tool_names


def test_settings_bootstrap_returns_settings_related_resources(client: TestClient):
    response = client.get("/api/settings/bootstrap")

    assert response.status_code == 200
    payload = response.json()
    assert payload["version"]
    assert "settings" in payload
    assert "providers" in payload
    assert "roles" in payload
    role_names = {role["name"] for role in payload["roles"]}
    assert "Steward" in role_names
    assert "Worker" in role_names
    assert "Designer" in role_names
