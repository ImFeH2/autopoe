from __future__ import annotations

import asyncio
from typing import Any

import pytest
from fastapi.testclient import TestClient

from flowent.channels import TelegramBotManager, split_telegram_message
from flowent.main import create_app
from flowent.storage import StateStore, StoredTelegramBot, StoredTelegramSession


class FakeTelegramTransport:
    def __init__(self) -> None:
        self.sent_messages: list[dict[str, str]] = []
        self.updates: list[dict[str, Any]] = []
        self.error: Exception | None = None
        self.get_updates_calls = 0

    async def get_updates(
        self,
        *,
        offset: int | None,
        timeout: int,
        token: str,
    ) -> list[dict[str, Any]]:
        self.get_updates_calls += 1
        if self.error is not None:
            raise self.error
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


def stored_bot(
    *,
    bot_token: str = "telegram-secret",
    enabled: bool = True,
    sessions: list[StoredTelegramSession] | None = None,
) -> StoredTelegramBot:
    return StoredTelegramBot(
        bot_token=bot_token,
        enabled=enabled,
        sessions=sessions or [],
    )


def stored_session(
    *,
    chat_id: str = "2001",
    display_name: str = "Alice Example",
    recent_message: str = "Hello Flowent",
    status: str = "approved",
    user_id: str = "1001",
    username: str = "alice",
) -> StoredTelegramSession:
    return StoredTelegramSession(
        chat_id=chat_id,
        display_name=display_name,
        recent_message=recent_message,
        status=status,
        user_id=user_id,
        username=username,
    )


def telegram_update(
    *,
    chat_id: int = 2001,
    text: str = "Hello Flowent",
    update_id: int = 1,
    user_id: int = 1001,
    username: str = "alice",
) -> dict[str, Any]:
    return {
        "message": {
            "chat": {"id": chat_id},
            "from": {
                "first_name": "Alice",
                "id": user_id,
                "last_name": "Example",
                "username": username,
            },
            "text": text,
        },
        "update_id": update_id,
    }


async def static_reply(_: str) -> str:
    return "Reply"


@pytest.mark.anyio
async def test_disabled_telegram_bot_does_not_start_polling(
    tmp_path, monkeypatch
) -> None:
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path))
    transport = FakeTelegramTransport()
    manager = TelegramBotManager(
        message_handler=static_reply,
        store=StateStore(tmp_path),
        telegram_transport=transport,
    )

    await manager.poll_once(stored_bot(enabled=False))

    assert transport.get_updates_calls == 0
    assert manager.bot_with_status(stored_bot(enabled=False)).status == "disabled"


@pytest.mark.anyio
async def test_enabled_telegram_bot_polls_and_reports_running_status(
    tmp_path, monkeypatch
) -> None:
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path))
    transport = FakeTelegramTransport()
    manager = TelegramBotManager(
        message_handler=static_reply,
        store=StateStore(tmp_path),
        telegram_transport=transport,
    )

    await manager.poll_once(stored_bot())

    assert transport.get_updates_calls == 1
    assert manager.bot_with_status(stored_bot()).status == "running"


@pytest.mark.anyio
async def test_unapproved_telegram_message_creates_pending_request(
    tmp_path, monkeypatch
) -> None:
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path))
    handled_messages: list[str] = []
    transport = FakeTelegramTransport()
    transport.updates = [telegram_update(text="Pair this chat")]
    store = StateStore(tmp_path)

    async def handle_message(content: str) -> str:
        handled_messages.append(content)
        return "Reply"

    manager = TelegramBotManager(
        message_handler=handle_message,
        store=store,
        telegram_transport=transport,
    )

    await manager.poll_once(stored_bot())

    assert handled_messages == []
    assert store.read_telegram_bot().sessions == [
        StoredTelegramSession(
            chat_id="2001",
            display_name="Alice Example",
            recent_message="Pair this chat",
            status="pending",
            updated_at=store.read_telegram_bot().sessions[0].updated_at,
            user_id="1001",
            username="alice",
        )
    ]
    assert transport.sent_messages == [
        {
            "chat_id": "2001",
            "text": "Request received. Approve this conversation in Flowent.",
            "token": "telegram-secret",
        }
    ]


@pytest.mark.anyio
async def test_approved_telegram_message_enters_workspace_and_replies(
    tmp_path, monkeypatch
) -> None:
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path))
    handled_messages: list[str] = []
    transport = FakeTelegramTransport()
    transport.updates = [telegram_update()]
    store = StateStore(tmp_path)
    store.save_telegram_session(stored_session())

    async def handle_message(content: str) -> str:
        handled_messages.append(content)
        return "Reply"

    manager = TelegramBotManager(
        message_handler=handle_message,
        store=store,
        telegram_transport=transport,
    )

    await manager.poll_once(stored_bot())

    assert handled_messages == ["Hello Flowent"]
    assert transport.sent_messages == [
        {
            "chat_id": "2001",
            "text": "Reply",
            "token": "telegram-secret",
        }
    ]


def test_approved_telegram_message_is_persisted_in_workspace(
    tmp_path, monkeypatch
) -> None:
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path / "data"))
    transport = FakeTelegramTransport()
    transport.updates = [telegram_update(text="Draft from Telegram")]

    async def fake_completion(**request: object) -> object:
        async def chunks() -> object:
            yield {"choices": [{"delta": {"content": "Telegram reply"}}]}

        return chunks()

    app = create_app(
        serve_frontend=False,
        chat_completion=fake_completion,
        telegram_transport=transport,
    )
    client = TestClient(app)
    with client:
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
                "reasoning_effort": "default",
                "selected_model": "gpt-5.1",
                "selected_provider_id": "provider-openai",
            },
        )
        StateStore(tmp_path / "data").save_telegram_session(stored_session())
        asyncio.run(app.state.telegram_bot_manager.poll_once(stored_bot()))

        state = client.get("/api/state").json()

    assert [message["content"] for message in state["messages"]] == [
        "Draft from Telegram",
        "Telegram reply",
    ]


def test_telegram_bot_config_is_saved_and_reported_in_state(
    tmp_path, monkeypatch
) -> None:
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path))
    client = TestClient(create_app(serve_frontend=False))

    response = client.put(
        "/api/telegram-bot",
        json={
            "bot_token": "telegram-secret",
            "enabled": False,
            "sessions": [],
        },
    )
    state = client.get("/api/state").json()

    assert response.status_code == 200
    assert state["telegram_bot"] == {
        "bot_token": "telegram-secret",
        "enabled": False,
        "error": "",
        "sessions": [],
        "status": "disabled",
    }


def test_pending_telegram_request_can_be_approved(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path))
    store = StateStore(tmp_path)
    store.save_telegram_session(stored_session(status="pending"))
    client = TestClient(create_app(serve_frontend=False))

    response = client.post(
        "/api/telegram-bot/approve",
        json={"chat_id": "2001"},
    )
    state = client.get("/api/state").json()

    assert response.status_code == 200
    assert response.json()["status"] == "approved"
    assert state["telegram_bot"]["sessions"][0]["status"] == "approved"


@pytest.mark.anyio
async def test_telegram_reply_is_split_when_it_is_too_long(
    tmp_path, monkeypatch
) -> None:
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path))
    transport = FakeTelegramTransport()
    transport.updates = [telegram_update()]
    long_reply = "x" * 4100
    store = StateStore(tmp_path)
    store.save_telegram_session(stored_session())

    async def handle_message(_: str) -> str:
        return long_reply

    manager = TelegramBotManager(
        message_handler=handle_message,
        store=store,
        telegram_transport=transport,
    )

    await manager.poll_once(stored_bot())

    assert [len(message["text"]) for message in transport.sent_messages] == [4096, 4]


@pytest.mark.anyio
async def test_telegram_connection_failure_reports_error_status(
    tmp_path, monkeypatch
) -> None:
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path))
    transport = FakeTelegramTransport()
    transport.error = RuntimeError("Secret is invalid")
    manager = TelegramBotManager(
        message_handler=static_reply,
        store=StateStore(tmp_path),
        telegram_transport=transport,
    )

    await manager.poll_once(stored_bot())
    bot = manager.bot_with_status(stored_bot())

    assert bot.status == "error"
    assert bot.error == "Secret is invalid"


def test_split_telegram_message_keeps_empty_reply_sendable() -> None:
    assert split_telegram_message("") == [""]
