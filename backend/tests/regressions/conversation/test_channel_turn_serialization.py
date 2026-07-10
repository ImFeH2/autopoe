from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from typing import Any

import httpx
import pytest

from flowent.main import create_app
from flowent.storage import StateStore, StoredTelegramBot, StoredTelegramSession


class RecordingTelegramTransport:
    def __init__(self) -> None:
        self.sent_messages: list[dict[str, str]] = []
        self.updates: list[dict[str, Any]] = []

    async def get_updates(
        self,
        *,
        offset: int | None,
        timeout: int,
        token: str,
    ) -> list[dict[str, Any]]:
        return self.updates

    async def send_message(
        self,
        *,
        chat_id: str,
        text: str,
        token: str,
    ) -> None:
        self.sent_messages.append(
            {
                "chat_id": chat_id,
                "text": text,
                "token": token,
            }
        )


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


def approved_bot() -> StoredTelegramBot:
    return StoredTelegramBot(
        bot_token="telegram-secret",
        enabled=True,
        sessions=[],
    )


def approved_session() -> StoredTelegramSession:
    return StoredTelegramSession(
        chat_id="2001",
        display_name="Alice Example",
        recent_message="",
        status="approved",
        user_id="1001",
        username="alice",
    )


def telegram_update(content: str) -> dict[str, object]:
    return {
        "message": {
            "chat": {"id": 2001},
            "from": {
                "first_name": "Alice",
                "id": 1001,
                "last_name": "Example",
                "username": "alice",
            },
            "text": content,
        },
        "update_id": 1,
    }


def last_user_content(request: dict[str, object]) -> str:
    messages = request.get("messages")
    assert isinstance(messages, list)
    return next(
        str(message.get("content") or "")
        for message in reversed(messages)
        if isinstance(message, dict) and message.get("role") == "user"
    )


@pytest.mark.anyio
async def test_telegram_message_waits_for_running_web_reply_and_keeps_full_history(
    tmp_path, monkeypatch
) -> None:
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path / "data"))
    web_model_started = asyncio.Event()
    finish_web_reply = asyncio.Event()
    telegram_handler_started = asyncio.Event()
    telegram_model_started = asyncio.Event()

    async def fake_completion(**request: object) -> object:
        content = last_user_content(request)

        async def chunks() -> object:
            if content == "Web request":
                web_model_started.set()
                yield {"choices": [{"delta": {"content": "Web reply"}}]}
                await asyncio.wait_for(finish_web_reply.wait(), timeout=2)
                return
            if content == "Telegram request":
                telegram_model_started.set()
                yield {"choices": [{"delta": {"content": "Telegram reply"}}]}
                return
            raise AssertionError(f"Unexpected request: {content}")

        return chunks()

    transport = RecordingTelegramTransport()
    transport.updates = [telegram_update("Telegram request")]
    app = create_app(
        serve_frontend=False,
        chat_completion=fake_completion,
        telegram_transport=transport,
    )
    store = StateStore(tmp_path / "data")
    store.save_telegram_session(approved_session())
    manager = app.state.telegram_bot_manager
    original_handler: Callable[[str], Awaitable[str]] = manager.message_handler

    async def tracked_handler(content: str) -> str:
        telegram_handler_started.set()
        return await original_handler(content)

    manager.message_handler = tracked_handler

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
                        "content": "Web request",
                        "id": "web-user-message",
                    }
                ]
            },
        )
        web_response = await client.post(
            "/api/workspace/messages/web-user-message/edit",
            json={"action": "resend", "content": "Web request"},
        )
        await asyncio.wait_for(web_model_started.wait(), timeout=2)

        telegram_task = asyncio.create_task(manager.poll_once(approved_bot()))
        await asyncio.wait_for(telegram_handler_started.wait(), timeout=2)

        assert not telegram_model_started.is_set()

        finish_web_reply.set()
        await client.get("/api/workspace/stream")
        await telegram_task
        state = (await client.get("/api/state")).json()

    assert web_response.status_code == 200
    assert [message["content"] for message in state["messages"]] == [
        "Web request",
        "Web reply",
        "Telegram request",
        "Telegram reply",
    ]
    assert transport.sent_messages == [
        {
            "chat_id": "2001",
            "text": "Telegram reply",
            "token": "telegram-secret",
        }
    ]


@pytest.mark.anyio
async def test_concurrent_channel_messages_are_processed_in_arrival_order(
    tmp_path, monkeypatch
) -> None:
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path / "data"))
    first_model_started = asyncio.Event()
    finish_first_reply = asyncio.Event()
    second_model_started = asyncio.Event()

    async def fake_completion(**request: object) -> object:
        content = last_user_content(request)

        async def chunks() -> object:
            if content == "First channel request":
                first_model_started.set()
                yield {"choices": [{"delta": {"content": "First reply"}}]}
                await asyncio.wait_for(finish_first_reply.wait(), timeout=2)
                return
            if content == "Second channel request":
                second_model_started.set()
                yield {"choices": [{"delta": {"content": "Second reply"}}]}
                return
            raise AssertionError(f"Unexpected request: {content}")

        return chunks()

    app = create_app(serve_frontend=False, chat_completion=fake_completion)
    manager = app.state.telegram_bot_manager

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://testserver"
    ) as client:
        await configure_provider(client)
        first_task = asyncio.create_task(
            manager.message_handler("First channel request")
        )
        await asyncio.wait_for(first_model_started.wait(), timeout=2)

        second_task = asyncio.create_task(
            manager.message_handler("Second channel request")
        )
        await asyncio.sleep(0)

        assert not second_model_started.is_set()

        finish_first_reply.set()
        replies = await asyncio.gather(first_task, second_task)
        state = (await client.get("/api/state")).json()

    assert replies == ["First reply", "Second reply"]
    assert [message["content"] for message in state["messages"]] == [
        "First channel request",
        "First reply",
        "Second channel request",
        "Second reply",
    ]


@pytest.mark.anyio
async def test_web_message_waits_for_running_telegram_reply_and_keeps_full_history(
    tmp_path, monkeypatch
) -> None:
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path / "data"))
    telegram_model_started = asyncio.Event()
    finish_telegram_reply = asyncio.Event()
    web_model_started = asyncio.Event()

    async def fake_completion(**request: object) -> object:
        content = last_user_content(request)

        async def chunks() -> object:
            if content == "Telegram first":
                telegram_model_started.set()
                yield {"choices": [{"delta": {"content": "Telegram reply"}}]}
                await asyncio.wait_for(finish_telegram_reply.wait(), timeout=2)
                return
            if content == "Web second":
                web_model_started.set()
                yield {"choices": [{"delta": {"content": "Web reply"}}]}
                return
            raise AssertionError(f"Unexpected request: {content}")

        return chunks()

    app = create_app(serve_frontend=False, chat_completion=fake_completion)
    manager = app.state.telegram_bot_manager

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://testserver"
    ) as client:
        await configure_provider(client)
        telegram_task = asyncio.create_task(manager.message_handler("Telegram first"))
        await asyncio.wait_for(telegram_model_started.wait(), timeout=2)

        web_task = asyncio.create_task(
            client.post(
                "/api/workspace/respond",
                json={"content": "Web second", "message_id": "web-second"},
            )
        )
        await asyncio.sleep(0)

        assert not web_model_started.is_set()

        finish_telegram_reply.set()
        _, web_response = await asyncio.gather(telegram_task, web_task)
        state = (await client.get("/api/state")).json()

    assert web_response.status_code == 200
    assert [message["content"] for message in state["messages"]] == [
        "Telegram first",
        "Telegram reply",
        "Web second",
        "Web reply",
    ]


@pytest.mark.anyio
async def test_stop_cancels_web_message_waiting_for_running_telegram_reply(
    tmp_path, monkeypatch
) -> None:
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path / "data"))
    telegram_model_started = asyncio.Event()
    finish_telegram_reply = asyncio.Event()
    web_model_started = asyncio.Event()

    async def fake_completion(**request: object) -> object:
        content = last_user_content(request)

        async def chunks() -> object:
            if content == "Telegram first":
                telegram_model_started.set()
                yield {"choices": [{"delta": {"content": "Telegram reply"}}]}
                await asyncio.wait_for(finish_telegram_reply.wait(), timeout=2)
                return
            if content == "Web stopped":
                web_model_started.set()
                yield {"choices": [{"delta": {"content": "Unexpected reply"}}]}
                return
            raise AssertionError(f"Unexpected request: {content}")

        return chunks()

    app = create_app(serve_frontend=False, chat_completion=fake_completion)
    manager = app.state.telegram_bot_manager
    runtime = manager.message_handler.__self__

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://testserver"
    ) as client:
        await configure_provider(client)
        telegram_task = asyncio.create_task(manager.message_handler("Telegram first"))
        await asyncio.wait_for(telegram_model_started.wait(), timeout=2)

        web_task = asyncio.create_task(
            client.post(
                "/api/workspace/respond",
                json={"content": "Web stopped", "message_id": "web-stopped"},
            )
        )
        pending_deadline = asyncio.get_running_loop().time() + 2
        while not runtime.response_reserved:
            if asyncio.get_running_loop().time() >= pending_deadline:
                raise AssertionError("Web response did not enter the pending queue.")
            await asyncio.sleep(0)

        stop_response = await client.post("/api/workspace/stop")
        finish_telegram_reply.set()
        _, web_response = await asyncio.gather(telegram_task, web_task)
        state = (await client.get("/api/state")).json()

    assert stop_response.status_code == 200
    assert web_response.status_code == 409
    assert not web_model_started.is_set()
    assert [message["content"] for message in state["messages"]] == [
        "Telegram first",
        "Telegram reply",
    ]
