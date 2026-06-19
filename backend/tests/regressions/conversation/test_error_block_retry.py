import httpx
import pytest

from flowent.main import create_app


@pytest.mark.anyio
async def test_workspace_error_retry_without_provider_keeps_error_retryable(
    tmp_path, monkeypatch
) -> None:
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path / "data"))

    async def fake_completion(**request: object) -> object:
        raise AssertionError("A provider validation failure must not call the model.")

    app = create_app(serve_frontend=False, chat_completion=fake_completion)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://testserver"
    ) as client:
        await client.put(
            "/api/workspace/messages",
            json={
                "messages": [
                    {
                        "author": "user",
                        "content": "Read the notes.",
                        "id": "message-user",
                    },
                    {
                        "author": "assistant",
                        "content": "I read the notes.",
                        "groups": [
                            {
                                "id": "message-assistant-group-1",
                                "items": [
                                    {
                                        "content": "I read the notes.",
                                        "id": "message-assistant-text-1",
                                        "type": "text",
                                    }
                                ],
                            },
                            {
                                "id": "message-assistant-errors",
                                "items": [
                                    {
                                        "detail": "provider dropped",
                                        "id": "message-assistant-error-1",
                                        "message": "Check the model connection settings and try again.",
                                        "title": "Request failed",
                                        "type": "error",
                                    }
                                ],
                            },
                            {
                                "id": "message-assistant-group-2",
                                "items": [
                                    {
                                        "content": "Stale tail.",
                                        "id": "message-assistant-text-2",
                                        "type": "text",
                                    }
                                ],
                            },
                        ],
                        "id": "message-assistant",
                        "status": "failed",
                    },
                ]
            },
        )

        first_response = await client.post(
            "/api/workspace/messages/message-assistant/errors/message-assistant-error-1/retry"
        )
        first_state = (await client.get("/api/state")).json()
        second_response = await client.post(
            "/api/workspace/messages/message-assistant/errors/message-assistant-error-1/retry"
        )
        second_state = (await client.get("/api/state")).json()

    assert first_response.status_code == 400
    assert (
        first_response.json()["detail"] == "Choose a provider and model before sending."
    )
    assert second_response.status_code == 400
    assert (
        second_response.json()["detail"]
        == "Choose a provider and model before sending."
    )
    assert first_state == second_state
    assert len(second_state["messages"]) == 2
    assistant = second_state["messages"][-1]
    assert assistant["id"] == "message-assistant"
    assert assistant["content"] == "I read the notes."
    assert assistant["status"] == "failed"
    assert "Stale tail." not in str(assistant["groups"])
    error_items = [
        item
        for group in assistant["groups"]
        for item in group["items"]
        if item["type"] == "error"
    ]
    assert error_items == [
        {
            "detail": "Choose a provider and model before sending.",
            "id": "message-assistant-error-1",
            "message": "Check the model connection settings and try again.",
            "title": "Request failed",
            "type": "error",
        }
    ]
