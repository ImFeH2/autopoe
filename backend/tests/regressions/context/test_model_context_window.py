from fastapi.testclient import TestClient

from flowent.main import create_app


def saved_usage_info(model_context_window: int) -> dict[str, object]:
    usage = {
        "cached_input_tokens": 0,
        "input_tokens": 24_000,
        "output_tokens": 6_000,
        "reasoning_output_tokens": 0,
        "total_tokens": 30_000,
    }
    return {
        "last_token_usage": usage,
        "model_context_window": model_context_window,
        "total_token_usage": usage,
    }


def save_provider_and_model(client: TestClient, model: str) -> None:
    client.post(
        "/api/providers",
        json={
            "api_key": "sk-local",
            "base_url": "",
            "id": "provider-openai",
            "models": ["gpt-5.1", "gpt-5.5"],
            "name": "OpenAI",
            "type": "openai",
        },
    )
    client.put(
        "/api/settings",
        json={
            "agent_prompt": "",
            "reasoning_effort": "default",
            "selected_model": model,
            "selected_provider_id": "provider-openai",
        },
    )


def test_app_state_refreshes_context_window_when_selected_model_changes(
    tmp_path,
    monkeypatch,
) -> None:
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path / "data"))
    client = TestClient(create_app(serve_frontend=False))
    stale_usage_info = saved_usage_info(272_000)

    save_provider_and_model(client, "gpt-5.1")
    client.put(
        "/api/workspace/messages",
        json={
            "messages": [
                {
                    "author": "assistant",
                    "content": "Saved reply.",
                    "id": "message-assistant",
                    "usage_info": stale_usage_info,
                }
            ]
        },
    )
    save_provider_and_model(client, "gpt-5.5")

    state = client.get("/api/state").json()

    assert state["settings"]["selected_model"] == "gpt-5.5"
    assert state["usage_info"] == {
        **stale_usage_info,
        "model_context_window": 1_050_000,
    }
    assert state["messages"][-1]["usage_info"] == state["usage_info"]
