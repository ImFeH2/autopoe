import asyncio
import json

import httpx
import pytest

from flowent.main import create_app


def tool_call_chunk(
    name: str,
    arguments: str,
    *,
    call_id: str = "call-1",
) -> dict[str, object]:
    return {
        "choices": [
            {
                "delta": {
                    "tool_calls": [
                        {
                            "index": 0,
                            "id": call_id,
                            "type": "function",
                            "function": {
                                "arguments": arguments,
                                "name": name,
                            },
                        }
                    ]
                }
            }
        ]
    }


def stream_events(content: str) -> list[dict[str, object]]:
    events: list[dict[str, object]] = []
    for raw_event in content.strip().split("\n\n"):
        event_id = ""
        event_type = ""
        data = ""
        for line in raw_event.splitlines():
            if line.startswith("id: "):
                event_id = line.removeprefix("id: ")
            if line.startswith("event: "):
                event_type = line.removeprefix("event: ")
            if line.startswith("data: "):
                data = line.removeprefix("data: ")
        events.append(
            {
                "data": json.loads(data) if data else {},
                "event": event_type,
                "id": int(event_id) if event_id else None,
            }
        )
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
async def test_workspace_rejects_second_run_while_response_is_running(
    tmp_path, monkeypatch
) -> None:
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path / "data"))
    first_chunk_sent = asyncio.Event()
    finish_response = asyncio.Event()

    async def fake_completion(**request: object) -> object:
        async def chunks() -> object:
            yield {"choices": [{"delta": {"content": "Partial"}}]}
            first_chunk_sent.set()
            await asyncio.wait_for(finish_response.wait(), timeout=2)
            yield {"choices": [{"delta": {"content": " done."}}]}

        return chunks()

    app = create_app(serve_frontend=False, chat_completion=fake_completion)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://testserver"
    ) as client:
        await configure_provider(client)
        first_response = await client.post(
            "/api/workspace/runs",
            json={"content": "Keep working."},
        )
        run_id = first_response.json()["run_id"]
        await asyncio.wait_for(first_chunk_sent.wait(), timeout=2)

        second_response = await client.post(
            "/api/workspace/runs",
            json={"content": "Start another reply."},
        )
        state = (await client.get("/api/state")).json()
        finish_response.set()
        stream_response = await client.get(f"/api/workspace/runs/{run_id}/stream")

    assert first_response.status_code == 200
    assert second_response.status_code == 409
    assert second_response.json()["detail"] == "Response in progress"
    assert state["active_run_id"] == run_id
    assert [message["content"] for message in state["messages"]].count(
        "Start another reply."
    ) == 0
    assert stream_response.status_code == 200


@pytest.mark.anyio
async def test_workspace_run_stream_includes_server_event_indexes(
    tmp_path, monkeypatch
) -> None:
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path / "data"))

    async def fake_completion(**request: object) -> object:
        async def chunks() -> object:
            yield {"choices": [{"delta": {"content": "Indexed reply."}}]}

        return chunks()

    app = create_app(serve_frontend=False, chat_completion=fake_completion)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://testserver"
    ) as client:
        await configure_provider(client)
        response = await client.post(
            "/api/workspace/runs",
            json={"content": "Number the events."},
        )
        run_id = response.json()["run_id"]
        stream_response = await client.get(f"/api/workspace/runs/{run_id}/stream")

    assert response.status_code == 200
    assert stream_response.status_code == 200
    raw_events = stream_response.text.strip().split("\n\n")
    event_ids = [
        int(line.removeprefix("id: "))
        for raw_event in raw_events
        for line in raw_event.splitlines()
        if line.startswith("id: ")
    ]
    assert event_ids == list(range(1, len(event_ids) + 1))
    assert len(event_ids) >= 2
    events = stream_events(stream_response.text)
    snapshots = [event for event in events if event["event"] == "snapshot"]
    assert snapshots
    assert snapshots[-1]["data"]["message"]["author"] == "assistant"
    assert snapshots[-1]["data"]["message"]["content"] == "Indexed reply."


@pytest.mark.anyio
async def test_workspace_clear_cancels_running_run_before_it_writes_again(
    tmp_path, monkeypatch
) -> None:
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path / "data"))
    first_chunk_sent = asyncio.Event()
    finish_response = asyncio.Event()

    async def fake_completion(**request: object) -> object:
        async def chunks() -> object:
            yield {"choices": [{"delta": {"content": "Partial"}}]}
            first_chunk_sent.set()
            await finish_response.wait()
            yield {"choices": [{"delta": {"content": " stale."}}]}

        return chunks()

    app = create_app(serve_frontend=False, chat_completion=fake_completion)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://testserver"
    ) as client:
        await configure_provider(client)
        response = await client.post(
            "/api/workspace/runs",
            json={"content": "Keep working."},
        )
        assert response.status_code == 200
        await asyncio.wait_for(first_chunk_sent.wait(), timeout=2)
        clear_response = await client.post("/api/workspace/clear")
        finish_response.set()
        await asyncio.sleep(0)
        state = (await client.get("/api/state")).json()

    assert clear_response.status_code == 200
    assert state["messages"] == []
    assert state["active_run_id"] is None


@pytest.mark.anyio
async def test_workspace_run_stream_snapshots_tool_and_text_progress(
    tmp_path, monkeypatch
) -> None:
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path / "data"))
    (tmp_path / "notes.txt").write_text("Launch notes")

    async def fake_completion(**request: object) -> object:
        async def chunks() -> object:
            if request["messages"][-1]["role"] == "user":
                yield tool_call_chunk("read_file", '{"path": "notes.txt"}')
                return
            yield {"choices": [{"delta": {"content": "Done."}}]}

        return chunks()

    app = create_app(serve_frontend=False, chat_completion=fake_completion)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://testserver"
    ) as client:
        await configure_provider(client)
        response = await client.post(
            "/api/workspace/runs",
            json={"content": "Read notes."},
        )
        run_id = response.json()["run_id"]
        stream_response = await client.get(f"/api/workspace/runs/{run_id}/stream")

    assert response.status_code == 200
    snapshots = [
        event["data"]["message"]
        for event in stream_events(stream_response.text)
        if event["event"] == "snapshot"
    ]
    running_tool_snapshot = next(
        snapshot
        for snapshot in snapshots
        if snapshot.get("tools") and snapshot["tools"][0]["status"] == "running"
    )
    completed_tool_snapshot = next(
        snapshot
        for snapshot in snapshots
        if snapshot.get("tools") and snapshot["tools"][0]["status"] == "success"
    )
    final_text_snapshot = snapshots[-1]
    assert running_tool_snapshot["groups"][0]["items"][0]["tool"]["status"] == (
        "running"
    )
    assert completed_tool_snapshot["groups"][0]["items"][0]["tool"]["content"] == (
        "Launch notes"
    )
    assert final_text_snapshot["content"] == "Done."
    assert final_text_snapshot["status"] == "completed"


@pytest.mark.anyio
async def test_workspace_run_reconnect_sends_current_snapshot_before_later_events(
    tmp_path, monkeypatch
) -> None:
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path / "data"))
    first_chunk_sent = asyncio.Event()
    finish_response = asyncio.Event()

    async def fake_completion(**request: object) -> object:
        async def chunks() -> object:
            yield {"choices": [{"delta": {"content": "Partial "}}]}
            first_chunk_sent.set()
            await asyncio.wait_for(finish_response.wait(), timeout=2)
            yield {"choices": [{"delta": {"content": "answer."}}]}

        return chunks()

    app = create_app(serve_frontend=False, chat_completion=fake_completion)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://testserver"
    ) as client:
        await configure_provider(client)
        response = await client.post(
            "/api/workspace/runs",
            json={"content": "Continue if I reconnect."},
        )
        run_id = response.json()["run_id"]
        await asyncio.wait_for(first_chunk_sent.wait(), timeout=2)
        state = (await client.get("/api/state")).json()
        event_index = state["active_run_event_index"]
        finish_response.set()
        stream_response = await client.get(
            f"/api/workspace/runs/{run_id}/stream?after={event_index}"
        )

    assert response.status_code == 200
    events = stream_events(stream_response.text)
    assert events[0]["event"] == "snapshot"
    assert events[0]["data"]["message"]["content"] == "Partial "
    assert events[1]["event"] == "delta"
    assert events[1]["data"]["content"] == "answer."
