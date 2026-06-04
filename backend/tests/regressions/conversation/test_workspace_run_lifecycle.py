import asyncio

import httpx
import pytest

from flowent.main import create_app


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
