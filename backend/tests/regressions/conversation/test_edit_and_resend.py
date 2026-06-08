import json

import httpx
import pytest

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
        events.append({"data": json.loads(data) if data else {}, "event": event_type})
    return events


async def configure_provider(client: httpx.AsyncClient) -> None:
    await client.post(
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
    await client.put(
        "/api/settings",
        json={
            "agent_prompt": "",
            "reasoning_effort": "default",
            "selected_model": "gpt-5.1",
            "selected_provider_id": "provider-openai",
        },
    )


@pytest.mark.anyio
async def test_workspace_edits_and_resends_user_message_from_server_state(
    tmp_path, monkeypatch
) -> None:
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path / "data"))
    captured_requests: list[dict[str, object]] = []

    async def fake_completion(**request: object) -> object:
        captured_requests.append(request)

        async def chunks() -> object:
            yield {"choices": [{"delta": {"content": "Fresh checklist."}}]}

        return chunks()

    app = create_app(serve_frontend=False, chat_completion=fake_completion)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://testserver"
    ) as client:
        await configure_provider(client)
        await client.put(
            "/api/workspace/messages",
            json={
                "messages": [
                    {
                        "author": "user",
                        "content": "Draft a launch checklist.",
                        "id": "message-user",
                    },
                    {
                        "author": "assistant",
                        "content": "Old checklist.",
                        "id": "message-assistant",
                    },
                    {
                        "author": "user",
                        "content": "Keep this later note.",
                        "id": "message-later-user",
                    },
                ]
            },
        )
        response = await client.post(
            "/api/workspace/messages/message-user/edit",
            json={"action": "resend", "content": "Update the launch checklist."},
        )
        run_id = response.json()["run_id"]
        stream_response = await client.get(f"/api/workspace/runs/{run_id}/stream")
        state = (await client.get("/api/state")).json()

    assert response.status_code == 200
    assert stream_response.status_code == 200
    assert [event["event"] for event in stream_events(stream_response.text)][-1] == (
        "done"
    )
    assert [message["content"] for message in state["messages"]] == [
        "Update the launch checklist.",
        "Fresh checklist.",
    ]
    assert captured_requests
    assert captured_requests[0]["messages"][-1] == {
        "role": "user",
        "content": "Update the launch checklist.",
    }


@pytest.mark.anyio
@pytest.mark.parametrize("author", ["assistant", "tool"])
async def test_workspace_rejects_editing_non_user_messages(
    tmp_path, monkeypatch, author: str
) -> None:
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path / "data"))

    async def fake_completion(**request: object) -> object:
        raise AssertionError("A rejected edit must not start a response.")

    app = create_app(serve_frontend=False, chat_completion=fake_completion)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://testserver"
    ) as client:
        await configure_provider(client)
        await client.put(
            "/api/workspace/messages",
            json={
                "messages": [
                    {
                        "author": author,
                        "content": "Existing output.",
                        "id": "message-output",
                    }
                ]
            },
        )
        response = await client.post(
            "/api/workspace/messages/message-output/edit",
            json={"action": "resend", "content": "Update output."},
        )
        state = (await client.get("/api/state")).json()

    assert response.status_code == 400
    assert response.json()["detail"] == "Only user messages can be edited."
    assert state["messages"] == [
        {
            "author": author,
            "content": "Existing output.",
            "id": "message-output",
            "tools": [],
        }
    ]


@pytest.mark.anyio
async def test_workspace_rejects_editing_missing_message(tmp_path, monkeypatch) -> None:
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path / "data"))

    async def fake_completion(**request: object) -> object:
        raise AssertionError("A missing edit must not start a response.")

    app = create_app(serve_frontend=False, chat_completion=fake_completion)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://testserver"
    ) as client:
        await configure_provider(client)
        response = await client.post(
            "/api/workspace/messages/missing-message/edit",
            json={"action": "resend", "content": "Update missing message."},
        )
        state = (await client.get("/api/state")).json()

    assert response.status_code == 404
    assert response.json()["detail"] == "Message not found."
    assert state["messages"] == []
