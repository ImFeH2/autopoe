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
            "base_url": "https://api.example.test/v1",
            "has_api_key": True,
            "id": "provider-openai",
            "models": ["gpt-5.1", "gpt-5.1-mini"],
            "name": "OpenAI",
            "type": "openai",
        }
    ]


def test_delete_provider_selects_nearest_active_selection(
    tmp_path, monkeypatch
) -> None:
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path))
    client = TestClient(create_app(serve_frontend=False))
    client.post(
        "/api/providers",
        json={
            "api_key": "sk-local",
            "base_url": "https://api.example.test/v1",
            "id": "provider-openai",
            "models": ["gpt-5.1"],
            "name": "OpenAI",
            "type": "openai",
        },
    )
    client.post(
        "/api/providers",
        json={
            "api_key": "sk-anthropic",
            "base_url": "",
            "id": "provider-anthropic",
            "models": ["claude-sonnet-4-5", "claude-haiku-4-5"],
            "name": "Anthropic",
            "type": "anthropic",
        },
    )
    client.put(
        "/api/settings",
        json={
            "agent_prompt": "Respond with careful implementation plans.",
            "context_window_limit": 96_000,
            "reasoning_effort": "xhigh",
            "selected_model": "gpt-5.1",
            "selected_provider_id": "provider-openai",
        },
    )

    response = client.delete("/api/providers/provider-openai")

    assert response.status_code == 200
    assert response.json() == {"ok": True}
    restarted_client = TestClient(create_app(serve_frontend=False))
    state_response = restarted_client.get("/api/state")

    assert state_response.status_code == 200
    state = state_response.json()
    assert [provider["id"] for provider in state["providers"]] == ["provider-anthropic"]
    assert state["settings"] == {
        "agent_prompt": "Respond with careful implementation plans.",
        "context_window_limit": 96_000,
        "reasoning_effort": "xhigh",
        "selected_model": "claude-sonnet-4-5",
        "selected_provider_id": "provider-anthropic",
    }


def test_delete_provider_selects_previous_active_selection_when_removed_provider_is_last(
    tmp_path, monkeypatch
) -> None:
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path))
    client = TestClient(create_app(serve_frontend=False))
    client.post(
        "/api/providers",
        json={
            "api_key": "sk-openai",
            "base_url": "https://api.example.test/v1",
            "id": "provider-openai",
            "models": ["gpt-5.1"],
            "name": "OpenAI",
            "type": "openai",
        },
    )
    client.post(
        "/api/providers",
        json={
            "api_key": "sk-anthropic",
            "base_url": "",
            "id": "provider-anthropic",
            "models": ["claude-sonnet-4-5"],
            "name": "Anthropic",
            "type": "anthropic",
        },
    )
    client.put(
        "/api/settings",
        json={
            "agent_prompt": "Respond with careful implementation plans.",
            "context_window_limit": 96_000,
            "reasoning_effort": "xhigh",
            "selected_model": "claude-sonnet-4-5",
            "selected_provider_id": "provider-anthropic",
        },
    )

    response = client.delete("/api/providers/provider-anthropic")

    assert response.status_code == 200
    state = client.get("/api/state").json()
    assert [provider["id"] for provider in state["providers"]] == ["provider-openai"]
    assert state["settings"] == {
        "agent_prompt": "Respond with careful implementation plans.",
        "context_window_limit": 96_000,
        "reasoning_effort": "xhigh",
        "selected_model": "gpt-5.1",
        "selected_provider_id": "provider-openai",
    }


def test_delete_provider_clears_active_selection_when_no_providers_remain(
    tmp_path, monkeypatch
) -> None:
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path))
    client = TestClient(create_app(serve_frontend=False))
    client.post(
        "/api/providers",
        json={
            "api_key": "sk-local",
            "base_url": "https://api.example.test/v1",
            "id": "provider-openai",
            "models": ["gpt-5.1"],
            "name": "OpenAI",
            "type": "openai",
        },
    )
    client.put(
        "/api/settings",
        json={
            "agent_prompt": "Respond with careful implementation plans.",
            "context_window_limit": 96_000,
            "reasoning_effort": "xhigh",
            "selected_model": "gpt-5.1",
            "selected_provider_id": "provider-openai",
        },
    )

    response = client.delete("/api/providers/provider-openai")

    assert response.status_code == 200
    state = client.get("/api/state").json()
    assert state["providers"] == []
    assert state["settings"] == {
        "agent_prompt": "Respond with careful implementation plans.",
        "context_window_limit": 96_000,
        "reasoning_effort": "xhigh",
        "selected_model": "",
        "selected_provider_id": "",
    }


def test_delete_provider_selects_nearest_active_provider_without_model(
    tmp_path, monkeypatch
) -> None:
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path))
    client = TestClient(create_app(serve_frontend=False))
    client.post(
        "/api/providers",
        json={
            "api_key": "sk-local",
            "base_url": "https://api.example.test/v1",
            "id": "provider-openai",
            "models": ["gpt-5.1"],
            "name": "OpenAI",
            "type": "openai",
        },
    )
    client.post(
        "/api/providers",
        json={
            "api_key": "sk-anthropic",
            "base_url": "",
            "id": "provider-anthropic",
            "models": [],
            "name": "Anthropic",
            "type": "anthropic",
        },
    )
    client.put(
        "/api/settings",
        json={
            "agent_prompt": "",
            "context_window_limit": None,
            "reasoning_effort": "default",
            "selected_model": "gpt-5.1",
            "selected_provider_id": "provider-openai",
        },
    )

    response = client.delete("/api/providers/provider-openai")

    assert response.status_code == 200
    state = client.get("/api/state").json()
    assert [provider["id"] for provider in state["providers"]] == ["provider-anthropic"]
    assert state["settings"]["selected_provider_id"] == "provider-anthropic"
    assert state["settings"]["selected_model"] == ""


def test_delete_provider_keeps_other_active_selection(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path))
    client = TestClient(create_app(serve_frontend=False))
    client.post(
        "/api/providers",
        json={
            "api_key": "sk-local",
            "base_url": "https://api.example.test/v1",
            "id": "provider-openai",
            "models": ["gpt-5.1"],
            "name": "OpenAI",
            "type": "openai",
        },
    )
    client.post(
        "/api/providers",
        json={
            "api_key": "sk-anthropic",
            "base_url": "",
            "id": "provider-anthropic",
            "models": ["claude-sonnet-4-5"],
            "name": "Anthropic",
            "type": "anthropic",
        },
    )
    client.put(
        "/api/settings",
        json={
            "agent_prompt": "",
            "context_window_limit": None,
            "reasoning_effort": "default",
            "selected_model": "claude-sonnet-4-5",
            "selected_provider_id": "provider-anthropic",
        },
    )

    response = client.delete("/api/providers/provider-openai")

    assert response.status_code == 200
    state = client.get("/api/state").json()
    assert [provider["id"] for provider in state["providers"]] == ["provider-anthropic"]
    assert state["settings"]["selected_provider_id"] == "provider-anthropic"
    assert state["settings"]["selected_model"] == "claude-sonnet-4-5"


def test_app_state_persists_telegram_bot_across_app_instances(
    tmp_path, monkeypatch
) -> None:
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path))
    client = TestClient(create_app(serve_frontend=False))

    response = client.put(
        "/api/telegram-bot",
        json={
            "bot_token": "telegram-secret",
            "enabled": False,
        },
    )

    assert response.status_code == 200

    restarted_client = TestClient(create_app(serve_frontend=False))
    state_response = restarted_client.get("/api/state")

    assert state_response.status_code == 200
    assert state_response.json()["telegram_bot"] == {
        "enabled": False,
        "error": "",
        "has_bot_token": True,
        "sessions": [],
        "status": "disabled",
    }


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
            "agent_prompt": "Respond with careful implementation plans.",
            "context_window_limit": 96_000,
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
        "agent_prompt": "Respond with careful implementation plans.",
        "context_window_limit": 96_000,
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
                    "id": "tool-1",
                    "name": "read_file",
                    "result": None,
                    "status": "success",
                    "title": "Read notes.txt",
                }
            ],
        }
    ]


def test_app_state_persists_workspace_error_blocks_across_app_instances(
    tmp_path, monkeypatch
) -> None:
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path))
    client = TestClient(create_app(serve_frontend=False))

    messages_response = client.put(
        "/api/workspace/messages",
        json={
            "messages": [
                {
                    "author": "assistant",
                    "content": "",
                    "groups": [
                        {
                            "id": "message-1-errors",
                            "items": [
                                {
                                    "detail": "HTML response returned.",
                                    "id": "message-1-error-1",
                                    "message": "Check the model connection settings and try again.",
                                    "title": "Request failed",
                                    "type": "error",
                                }
                            ],
                        }
                    ],
                    "id": "message-1",
                    "status": "failed",
                }
            ]
        },
    )

    assert messages_response.status_code == 200

    restarted_client = TestClient(create_app(serve_frontend=False))
    state = restarted_client.get("/api/state").json()

    assert state["messages"] == [
        {
            "author": "assistant",
            "content": "",
            "groups": [
                {
                    "id": "message-1-errors",
                    "items": [
                        {
                            "detail": "HTML response returned.",
                            "id": "message-1-error-1",
                            "message": "Check the model connection settings and try again.",
                            "title": "Request failed",
                            "type": "error",
                        }
                    ],
                }
            ],
            "id": "message-1",
            "status": "failed",
            "tools": [],
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


def test_app_state_defaults_agent_prompt_for_existing_settings(
    tmp_path, monkeypatch
) -> None:
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path))
    client = TestClient(create_app(serve_frontend=False))

    response = client.get("/api/state")

    assert response.status_code == 200
    assert response.json()["settings"].get("agent_prompt", "") == ""


def test_app_state_defaults_context_window_limit_for_existing_settings(
    tmp_path, monkeypatch
) -> None:
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path))
    client = TestClient(create_app(serve_frontend=False))

    response = client.get("/api/state")

    assert response.status_code == 200
    assert response.json()["settings"]["context_window_limit"] is None
