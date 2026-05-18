from fastapi.testclient import TestClient

from flowent.main import create_app


def test_workspace_response_uses_selected_provider_model_and_history(
    tmp_path, monkeypatch
) -> None:
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path))
    captured_request: dict[str, object] = {}

    async def fake_completion(**request: object) -> dict[str, object]:
        captured_request.update(request)
        return {
            "choices": [
                {
                    "message": {
                        "content": "Here is the launch checklist.",
                        "role": "assistant",
                    },
                }
            ]
        }

    client = TestClient(
        create_app(serve_frontend=False, chat_completion=fake_completion)
    )
    client.post(
        "/api/providers",
        json={
            "api_key": "sk-local",
            "base_url": "https://api.example.test/v1",
            "id": "provider-anthropic",
            "models": ["claude-sonnet-4-5"],
            "name": "Anthropic",
            "type": "anthropic",
        },
    )
    client.put(
        "/api/settings",
        json={
            "selected_model": "claude-sonnet-4-5",
            "selected_provider_id": "provider-anthropic",
        },
    )

    response = client.post(
        "/api/workspace/respond",
        json={
            "messages": [
                {
                    "author": "user",
                    "content": "Draft a launch checklist.",
                    "id": "message-1",
                }
            ]
        },
    )

    assert response.status_code == 200
    assert response.json()["message"]["author"] == "assistant"
    assert response.json()["message"]["content"] == "Here is the launch checklist."
    assert captured_request == {
        "api_base": "https://api.example.test/v1",
        "api_key": "sk-local",
        "messages": [
            {"role": "user", "content": "Draft a launch checklist."},
        ],
        "model": "anthropic/claude-sonnet-4-5",
    }


def test_workspace_response_requires_selected_provider_and_model(
    tmp_path, monkeypatch
) -> None:
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path))
    client = TestClient(create_app(serve_frontend=False))

    response = client.post(
        "/api/workspace/respond",
        json={
            "messages": [
                {
                    "author": "user",
                    "content": "Draft a launch checklist.",
                    "id": "message-1",
                }
            ]
        },
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "Choose a provider and model before sending."
