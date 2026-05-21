from fastapi.testclient import TestClient

from flowent.main import create_app


def test_app_state_persists_providers_across_app_instances(
    tmp_path, monkeypatch
) -> None:
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path))
    client = TestClient(create_app(serve_frontend=False))

    response = client.post(
        "/api/providers",
        json={
            "api_key": "sk-local",
            "base_url": "https://api.example.test/v1",
            "id": "provider-openai",
            "models": ["gpt-5.1", "gpt-5.1-mini"],
            "name": "OpenAI",
            "type": "openai",
        },
    )

    assert response.status_code == 200

    restarted_client = TestClient(create_app(serve_frontend=False))
    state_response = restarted_client.get("/api/state")

    assert state_response.status_code == 200
    assert state_response.json()["providers"] == [
        {
            "api_key": "sk-local",
            "base_url": "https://api.example.test/v1",
            "id": "provider-openai",
            "models": ["gpt-5.1", "gpt-5.1-mini"],
            "name": "OpenAI",
            "type": "openai",
        }
    ]


def test_app_state_persists_settings_and_workspace_messages(
    tmp_path, monkeypatch
) -> None:
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path))
    client = TestClient(create_app(serve_frontend=False))
    client.post(
        "/api/providers",
        json={
            "api_key": "",
            "base_url": "",
            "id": "provider-anthropic",
            "models": ["claude-sonnet-4-5"],
            "name": "Anthropic",
            "type": "anthropic",
        },
    )

    settings_response = client.put(
        "/api/settings",
        json={
            "reasoning_effort": "xhigh",
            "selected_model": "claude-sonnet-4-5",
            "selected_provider_id": "provider-anthropic",
        },
    )
    messages_response = client.put(
        "/api/workspace/messages",
        json={
            "messages": [
                {
                    "author": "assistant",
                    "content": "Draft a launch checklist",
                    "id": "message-1",
                    "thinking": "Read the request.",
                    "tools": [
                        {
                            "id": "tool-1",
                            "name": "read_file",
                            "status": "success",
                            "title": "Read notes.txt",
                        }
                    ],
                }
            ]
        },
    )

    assert settings_response.status_code == 200
    assert messages_response.status_code == 200

    restarted_client = TestClient(create_app(serve_frontend=False))
    state = restarted_client.get("/api/state").json()

    assert state["settings"] == {
        "reasoning_effort": "xhigh",
        "selected_model": "claude-sonnet-4-5",
        "selected_provider_id": "provider-anthropic",
    }
    assert state["messages"] == [
        {
            "author": "assistant",
            "content": "Draft a launch checklist",
            "id": "message-1",
            "thinking": "Read the request.",
            "tools": [
                {
                    "arguments": None,
                    "content": None,
                    "data": None,
                    "id": "tool-1",
                    "name": "read_file",
                    "status": "success",
                    "title": "Read notes.txt",
                }
            ],
        }
    ]


def test_data_directory_uses_flowent_data_dir(tmp_path, monkeypatch) -> None:
    data_dir = tmp_path / "custom-flowent"
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(data_dir))

    client = TestClient(create_app(serve_frontend=False))
    response = client.get("/api/state")

    assert response.status_code == 200
    assert (data_dir / "flowent.db").is_file()


def test_app_state_defaults_reasoning_effort_for_existing_settings(
    tmp_path, monkeypatch
) -> None:
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path))
    client = TestClient(create_app(serve_frontend=False))

    response = client.get("/api/state")

    assert response.status_code == 200
    assert response.json()["settings"]["reasoning_effort"] == "default"
