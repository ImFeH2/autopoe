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


async def start_response_from_message(
    client: httpx.AsyncClient,
    content: str,
    *,
    message_id: str = "message-user",
) -> httpx.Response:
    await client.put(
        "/api/workspace/messages",
        json={
            "messages": [
                {
                    "author": "user",
                    "content": content,
                    "id": message_id,
                }
            ]
        },
    )
    response = await client.post(
        f"/api/workspace/messages/{message_id}/edit",
        json={"action": "resend", "content": content},
    )
    assert response.status_code == 200
    assert response.json()["is_responding"] is True
    return response


@pytest.mark.anyio
async def test_workspace_rejects_second_response_while_response_is_running(
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
        first_response = await start_response_from_message(
            client,
            "Keep working.",
        )
        await asyncio.wait_for(first_chunk_sent.wait(), timeout=2)

        second_response = await client.post(
            "/api/workspace/respond",
            json={"content": "Start another reply."},
        )
        state = (await client.get("/api/state")).json()
        finish_response.set()
        stream_response = await client.get("/api/workspace/stream")

    assert first_response.status_code == 200
    assert second_response.status_code == 409
    assert second_response.json()["detail"] == "Response in progress"
    assert state["is_responding"] is True
    assert [message["content"] for message in state["messages"]].count(
        "Start another reply."
    ) == 0
    assert stream_response.status_code == 200


@pytest.mark.anyio
async def test_workspace_response_stream_includes_server_event_indexes(
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
        response = await start_response_from_message(
            client,
            "Number the events.",
        )
        stream_response = await client.get("/api/workspace/stream")

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
async def test_workspace_clear_cancels_running_response_before_it_writes_again(
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
        await start_response_from_message(
            client,
            "Keep working.",
        )
        await asyncio.wait_for(first_chunk_sent.wait(), timeout=2)
        clear_response = await client.post("/api/workspace/clear")
        finish_response.set()
        await asyncio.sleep(0)
        state = (await client.get("/api/state")).json()

    assert clear_response.status_code == 200
    assert state["messages"] == []
    assert state["is_responding"] is False


@pytest.mark.anyio
async def test_workspace_response_stream_snapshots_tool_and_text_progress(
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
        response = await start_response_from_message(
            client,
            "Read notes.",
        )
        stream_response = await client.get("/api/workspace/stream")

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
async def test_workspace_response_reconnect_sends_current_snapshot_before_later_events(
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
        response = await start_response_from_message(
            client,
            "Continue if I reconnect.",
        )
        await asyncio.wait_for(first_chunk_sent.wait(), timeout=2)
        state = (await client.get("/api/state")).json()
        event_index = state["response_event_index"]
        finish_response.set()
        stream_response = await client.get(f"/api/workspace/stream?after={event_index}")

    assert response.status_code == 200
    events = stream_events(stream_response.text)
    assert events[0]["event"] == "snapshot"
    assert events[0]["data"]["message"]["content"] == "Partial "
    assert events[1]["event"] == "delta"
    assert events[1]["data"]["content"] == "answer."


@pytest.mark.anyio
async def test_workspace_response_stream_does_not_snapshot_every_text_delta(
    tmp_path, monkeypatch
) -> None:
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.setattr(
        "flowent.workspace.runtime.WORKSPACE_PROGRESS_FLUSH_INTERVAL_SECONDS", 60
    )
    chunks = [f"chunk-{index} " for index in range(8)]

    async def fake_completion(**request: object) -> object:
        async def stream_chunks() -> object:
            for chunk in chunks:
                yield {"choices": [{"delta": {"content": chunk}}]}

        return stream_chunks()

    app = create_app(serve_frontend=False, chat_completion=fake_completion)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://testserver"
    ) as client:
        await configure_provider(client)
        response = await start_response_from_message(
            client,
            "Stream efficiently.",
        )
        stream_response = await client.get("/api/workspace/stream")

    assert response.status_code == 200
    events = stream_events(stream_response.text)
    deltas = [event for event in events if event["event"] == "delta"]
    snapshots = [event for event in events if event["event"] == "snapshot"]
    assert [event["data"]["content"] for event in deltas] == chunks
    assert len(snapshots) <= 3
    assert snapshots[-1]["data"]["message"]["content"] == "".join(chunks)


@pytest.mark.anyio
async def test_workspace_response_persists_text_progress_with_throttle(
    tmp_path, monkeypatch
) -> None:
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.setattr(
        "flowent.workspace.runtime.WORKSPACE_PROGRESS_FLUSH_INTERVAL_SECONDS", 60
    )
    from flowent.storage import StateStore

    chunks = [f"part-{index} " for index in range(12)]
    persisted_assistant_messages: list[dict[str, object]] = []
    original_upsert_message = StateStore.upsert_message

    def track_upsert_message(self, message):
        if message.author == "assistant":
            persisted_assistant_messages.append(
                {**message.model_dump(), "status": message.status}
            )
        return original_upsert_message(self, message)

    monkeypatch.setattr(StateStore, "upsert_message", track_upsert_message)

    async def fake_completion(**request: object) -> object:
        async def stream_chunks() -> object:
            for chunk in chunks:
                yield {"choices": [{"delta": {"content": chunk}}]}

        return stream_chunks()

    app = create_app(serve_frontend=False, chat_completion=fake_completion)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://testserver"
    ) as client:
        await configure_provider(client)
        response = await start_response_from_message(
            client,
            "Save progress efficiently.",
        )
        stream_response = await client.get("/api/workspace/stream")

    running_text_persists = [
        message
        for message in persisted_assistant_messages
        if message.get("status") == "running" and message.get("content")
    ]
    assert response.status_code == 200
    assert stream_response.status_code == 200
    assert len(running_text_persists) <= 1
    assert persisted_assistant_messages[-1]["status"] == "completed"
    assert persisted_assistant_messages[-1]["content"] == "".join(chunks)


@pytest.mark.anyio
async def test_workspace_response_reconnect_snapshot_includes_unsaved_text_deltas(
    tmp_path, monkeypatch
) -> None:
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.setattr(
        "flowent.workspace.runtime.WORKSPACE_PROGRESS_FLUSH_INTERVAL_SECONDS", 60
    )
    first_two_chunks_sent = asyncio.Event()
    finish_response = asyncio.Event()

    async def fake_completion(**request: object) -> object:
        async def chunks() -> object:
            yield {"choices": [{"delta": {"content": "First "}}]}
            yield {"choices": [{"delta": {"content": "second "}}]}
            first_two_chunks_sent.set()
            await asyncio.wait_for(finish_response.wait(), timeout=2)
            yield {"choices": [{"delta": {"content": "third."}}]}

        return chunks()

    app = create_app(serve_frontend=False, chat_completion=fake_completion)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://testserver"
    ) as client:
        await configure_provider(client)
        response = await start_response_from_message(
            client,
            "Reconnect to current content.",
        )
        await asyncio.wait_for(first_two_chunks_sent.wait(), timeout=2)
        state = (await client.get("/api/state")).json()
        finish_response.set()
        stream_response = await client.get(
            f"/api/workspace/stream?after={state['response_event_index']}"
        )

    assert response.status_code == 200
    events = stream_events(stream_response.text)
    assert events[0]["event"] == "snapshot"
    assert events[0]["data"]["message"]["content"] == "First second "
    assert events[1]["event"] == "delta"
    assert events[1]["data"]["content"] == "third."


@pytest.mark.anyio
async def test_workspace_response_stream_marks_each_model_output_done_before_tools(
    tmp_path, monkeypatch
) -> None:
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path / "data"))
    (tmp_path / "notes.txt").write_text("Launch notes")

    async def fake_completion(**request: object) -> object:
        async def chunks() -> object:
            if request["messages"][-1]["role"] == "user":
                yield {"choices": [{"delta": {"content": "I will read notes."}}]}
                yield tool_call_chunk("read_file", '{"path": "notes.txt"}')
                return
            yield {"choices": [{"delta": {"content": "I read the notes."}}]}

        return chunks()

    app = create_app(serve_frontend=False, chat_completion=fake_completion)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://testserver"
    ) as client:
        await configure_provider(client)
        response = await start_response_from_message(
            client,
            "Read notes.",
        )
        stream_response = await client.get("/api/workspace/stream")

    assert response.status_code == 200
    events = stream_events(stream_response.text)
    event_names = [event["event"] for event in events]
    assert event_names == [
        "start",
        "snapshot",
        "output_start",
        "snapshot",
        "delta",
        "output_done",
        "tool_start",
        "snapshot",
        "tool_done",
        "snapshot",
        "output_start",
        "snapshot",
        "delta",
        "output_done",
        "snapshot",
        "done",
    ]
    assert event_names.index("output_done") < event_names.index("tool_start")
    assert event_names.index("tool_done") < event_names.index("output_start", 8)
    assert (
        events[-2]["data"]["message"]["content"]
        == "I will read notes.I read the notes."
    )
