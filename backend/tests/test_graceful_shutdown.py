from __future__ import annotations

import asyncio
from contextlib import suppress

import httpx
import pytest

from flowent.channels import TelegramBotManager
from flowent.main import create_app
from flowent.mcp import McpManager
from flowent.storage import StateStore


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
            "reasoning_effort": "default",
            "selected_model": "gpt-5.1",
            "selected_provider_id": "provider-openai",
        },
    )


@pytest.mark.anyio
async def test_shutdown_interrupts_running_workspace_response(
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

        return chunks()

    app = create_app(serve_frontend=False, chat_completion=fake_completion)
    async with (
        app.router.lifespan_context(app),
        httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://testserver"
        ) as client,
    ):
        await configure_provider(client)
        response = await client.post(
            "/api/workspace/runs",
            json={"content": "Keep working."},
        )
        assert response.status_code == 200
        await asyncio.wait_for(first_chunk_sent.wait(), timeout=2)

    state = StateStore(tmp_path / "data").read_state()
    finish_response.set()
    assert state.messages[-1].author == "assistant"
    assert state.messages[-1].content == "Partial"
    assert state.messages[-1].status == "interrupted"


@pytest.mark.anyio
async def test_shutdown_cancels_manual_compact_and_clears_progress(
    tmp_path, monkeypatch
) -> None:
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path / "data"))
    compact_started = asyncio.Event()
    compact_can_finish = asyncio.Event()

    async def fake_completion(**request: object) -> dict[str, object]:
        compact_started.set()
        await compact_can_finish.wait()
        return {
            "choices": [
                {
                    "message": {
                        "content": "Keep the launch checklist.",
                        "role": "assistant",
                    }
                }
            ]
        }

    app = create_app(serve_frontend=False, chat_completion=fake_completion)
    compact_response_task: asyncio.Task[httpx.Response] | None = None
    async with (
        app.router.lifespan_context(app),
        httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://testserver"
        ) as client,
    ):
        await configure_provider(client)
        await client.put(
            "/api/workspace/messages",
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
        compact_response_task = asyncio.create_task(
            client.post("/api/workspace/compact")
        )
        await asyncio.wait_for(compact_started.wait(), timeout=2)
        active_state = StateStore(tmp_path / "data").read_state()

    if compact_response_task is not None:
        with suppress(asyncio.CancelledError, AssertionError, TimeoutError):
            await asyncio.wait_for(compact_response_task, timeout=2)
    finished_state = StateStore(tmp_path / "data").read_state()
    compact_can_finish.set()

    assert active_state.is_compacting is True
    assert finished_state.is_compacting is False
    assert [message.content for message in finished_state.messages] == [
        "Draft a launch checklist."
    ]


@pytest.mark.anyio
async def test_shutdown_stops_mcp_and_telegram_managers(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path / "data"))
    stopped: list[str] = []

    async def stop_mcp(self: McpManager) -> None:
        stopped.append("mcp")

    async def stop_telegram(self: TelegramBotManager) -> None:
        stopped.append("telegram")

    monkeypatch.setattr(McpManager, "stop_all", stop_mcp)
    monkeypatch.setattr(TelegramBotManager, "stop_all", stop_telegram)

    app = create_app(serve_frontend=False)
    async with app.router.lifespan_context(app):
        pass

    assert stopped == ["telegram", "mcp"]


@pytest.mark.anyio
async def test_shutdown_continues_cleanup_after_failure(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path / "data"))
    stopped: list[str] = []

    async def stop_telegram(self: TelegramBotManager) -> None:
        stopped.append("telegram")
        raise RuntimeError("telegram did not stop")

    async def stop_mcp(self: McpManager) -> None:
        stopped.append("mcp")

    monkeypatch.setattr(TelegramBotManager, "stop_all", stop_telegram)
    monkeypatch.setattr(McpManager, "stop_all", stop_mcp)

    app = create_app(serve_frontend=False)
    async with app.router.lifespan_context(app):
        pass

    assert stopped == ["telegram", "mcp"]
