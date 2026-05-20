from fastapi.testclient import TestClient

from flowent.agent import FLOWENT_AGENT_SYSTEM_PROMPT
from flowent.main import create_app


def stream_events(content: str) -> list[dict[str, object]]:
    events: list[dict[str, object]] = []
    for raw_event in content.strip().split("\n\n"):
        event_type = ""
        data = ""
        for line in raw_event.splitlines():
            if line.startswith("event: "):
                event_type = line.removeprefix("event: ")
            if line.startswith("data: "):
                data = line.removeprefix("data: ")
        events.append({"event": event_type, "data": data})
    return events


def test_workspace_response_streams_selected_provider_model_and_history(
    tmp_path, monkeypatch
) -> None:
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path))
    captured_request: dict[str, object] = {}

    async def fake_completion(**request: object) -> object:
        captured_request.update(request)

        async def chunks() -> object:
            yield {"choices": [{"delta": {"content": "Here is "}}]}
            yield {"choices": [{"delta": {"content": "the launch checklist."}}]}

        return chunks()

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
        json={"content": "Draft a launch checklist."},
    )

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/event-stream")
    events = stream_events(response.text)
    assert events[0]["event"] == "start"
    assert events[1] == {"event": "output_start", "data": '{"index": 1}'}
    assert events[2] == {"event": "delta", "data": '{"content": "Here is "}'}
    assert events[3] == {
        "event": "delta",
        "data": '{"content": "the launch checklist."}',
    }
    assert '"author": "assistant"' in str(events[4]["data"])
    assert '"content": "Here is the launch checklist."' in str(events[4]["data"])
    assert captured_request["api_base"] == "https://api.example.test/v1"
    assert captured_request["api_key"] == "sk-local"
    assert captured_request["messages"] == [
        {"role": "system", "content": FLOWENT_AGENT_SYSTEM_PROMPT},
        {"role": "user", "content": "Draft a launch checklist."},
    ]
    assert captured_request["model"] == "anthropic/claude-sonnet-4-5"
    assert captured_request["stream"] is True
    assert isinstance(captured_request["tools"], list)


def test_workspace_response_requires_selected_provider_and_model(
    tmp_path, monkeypatch
) -> None:
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path))
    client = TestClient(create_app(serve_frontend=False))

    response = client.post(
        "/api/workspace/respond",
        json={"content": "Draft a launch checklist."},
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "Choose a provider and model before sending."


def test_workspace_compact_persists_compacted_context(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path))
    captured_request: dict[str, object] = {}

    async def fake_completion(**request: object) -> dict[str, object]:
        captured_request.update(request)
        return {
            "choices": [
                {
                    "message": {
                        "content": "Keep the launch checklist and provider setup decisions.",
                        "role": "assistant",
                    }
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
            "base_url": "",
            "id": "provider-openai",
            "models": ["gpt-5.1"],
            "name": "OpenAI",
            "type": "openai",
        },
    )
    client.put(
        "/api/settings",
        json={
            "selected_model": "gpt-5.1",
            "selected_provider_id": "provider-openai",
        },
    )
    client.put(
        "/api/workspace/messages",
        json={
            "messages": [
                {
                    "author": "user",
                    "content": "Draft a launch checklist.",
                    "id": "message-1",
                },
                {
                    "author": "assistant",
                    "content": "Use provider setup first.",
                    "id": "message-2",
                },
            ]
        },
    )

    response = client.post("/api/workspace/compact")

    assert response.status_code == 200
    body = response.json()
    assert body == {
        "message": {
            "author": "system",
            "content": "Context compacted",
            "id": body["message"]["id"],
            "tools": [],
        }
    }
    assert captured_request["model"] == "openai/gpt-5.1"
    assert captured_request["messages"][0] == {
        "role": "system",
        "content": "You are compacting Flowent workspace context.",
    }
    assert captured_request["messages"][-1]["role"] == "user"
    assert "Draft a launch checklist." in captured_request["messages"][-1]["content"]
    assert "Use provider setup first." in captured_request["messages"][-1]["content"]

    state = client.get("/api/state").json()
    assert state["messages"][-1] == body["message"]


def test_workspace_response_uses_compacted_context_after_compact(
    tmp_path, monkeypatch
) -> None:
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path))
    captured_requests: list[dict[str, object]] = []

    async def fake_completion(**request: object) -> object:
        captured_requests.append(request)
        if len(captured_requests) == 1:
            return {
                "choices": [
                    {
                        "message": {
                            "content": "Keep the provider setup decision.",
                            "role": "assistant",
                        }
                    }
                ]
            }

        async def chunks() -> object:
            yield {"choices": [{"delta": {"content": "Continuing."}}]}

        return chunks()

    client = TestClient(
        create_app(serve_frontend=False, chat_completion=fake_completion)
    )
    client.post(
        "/api/providers",
        json={
            "api_key": "sk-local",
            "base_url": "",
            "id": "provider-openai",
            "models": ["gpt-5.1"],
            "name": "OpenAI",
            "type": "openai",
        },
    )
    client.put(
        "/api/settings",
        json={
            "selected_model": "gpt-5.1",
            "selected_provider_id": "provider-openai",
        },
    )
    client.put(
        "/api/workspace/messages",
        json={
            "messages": [
                {
                    "author": "user",
                    "content": "Original detailed request.",
                    "id": "message-1",
                },
                {
                    "author": "assistant",
                    "content": "Original detailed reply.",
                    "id": "message-2",
                },
            ]
        },
    )

    compact_response = client.post("/api/workspace/compact")
    response = client.post(
        "/api/workspace/respond",
        json={"content": "Continue from there."},
    )

    assert compact_response.status_code == 200
    assert response.status_code == 200
    response_messages = captured_requests[1]["messages"]
    assert response_messages == [
        {"role": "system", "content": FLOWENT_AGENT_SYSTEM_PROMPT},
        {"role": "user", "content": "Context compacted"},
        {"role": "assistant", "content": "Keep the provider setup decision."},
        {"role": "user", "content": "Continue from there."},
    ]
