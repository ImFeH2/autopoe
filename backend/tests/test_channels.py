from __future__ import annotations

import asyncio
from typing import Any

import pytest
from fastapi.testclient import TestClient

from flowent.channels import ChannelManager, split_telegram_message
from flowent.main import create_app
from flowent.storage import StateStore, StoredChannel


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


def stored_channel(
    *,
    allowed_chat_ids: list[str] | None = None,
    allowed_user_ids: list[str] | None = None,
    bot_token: str = "telegram-secret",
    enabled: bool = True,
    pairing_code: str = "",
) -> StoredChannel:
    return StoredChannel(
        allowed_chat_ids=allowed_chat_ids or [],
        allowed_user_ids=allowed_user_ids or [],
        bot_token=bot_token,
        enabled=enabled,
        id="channel-telegram",
        name="Telegram",
        pairing_code=pairing_code,
        type="telegram_bot",
    )


def telegram_update(
    *,
    chat_id: int = 2001,
    text: str = "Hello Flowent",
    update_id: int = 1,
    user_id: int = 1001,
) -> dict[str, Any]:
    return {
        "message": {
            "chat": {"id": chat_id},
            "from": {"id": user_id},
            "text": text,
        },
        "update_id": update_id,
    }


async def static_reply(_: str) -> str:
    return "Reply"


@pytest.mark.anyio
async def test_disabled_channel_does_not_start_polling(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path))
    transport = FakeTelegramTransport()
    manager = ChannelManager(
        message_handler=static_reply,
        store=StateStore(tmp_path),
        telegram_transport=transport,
    )

    await manager.poll_once(stored_channel(enabled=False))

    assert transport.get_updates_calls == 0
    assert (
        manager.channel_with_status(stored_channel(enabled=False)).status == "disabled"
    )


@pytest.mark.anyio
async def test_enabled_channel_polls_and_reports_running_status(
    tmp_path, monkeypatch
) -> None:
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path))
    transport = FakeTelegramTransport()
    manager = ChannelManager(
        message_handler=static_reply,
        store=StateStore(tmp_path),
        telegram_transport=transport,
    )

    await manager.poll_once(stored_channel(allowed_chat_ids=["2001"]))

    assert transport.get_updates_calls == 1
    assert manager.channel_with_status(stored_channel()).status == "running"


@pytest.mark.anyio
async def test_unauthorized_telegram_message_does_not_enter_workspace(
    tmp_path, monkeypatch
) -> None:
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path))
    handled_messages: list[str] = []
    transport = FakeTelegramTransport()
    transport.updates = [telegram_update()]

    async def handle_message(content: str) -> str:
        handled_messages.append(content)
        return "Reply"

    manager = ChannelManager(
        message_handler=handle_message,
        store=StateStore(tmp_path),
        telegram_transport=transport,
    )

    await manager.poll_once(stored_channel())

    assert handled_messages == []
    assert transport.sent_messages == []


@pytest.mark.anyio
async def test_authorized_telegram_message_enters_workspace_and_replies(
    tmp_path, monkeypatch
) -> None:
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path))
    handled_messages: list[str] = []
    transport = FakeTelegramTransport()
    transport.updates = [telegram_update()]

    async def handle_message(content: str) -> str:
        handled_messages.append(content)
        return "Reply"

    manager = ChannelManager(
        message_handler=handle_message,
        store=StateStore(tmp_path),
        telegram_transport=transport,
    )

    await manager.poll_once(stored_channel(allowed_user_ids=["1001"]))

    assert handled_messages == ["Hello Flowent"]
    assert transport.sent_messages == [
        {
            "chat_id": "2001",
            "text": "Reply",
            "token": "telegram-secret",
        }
    ]


def test_authorized_telegram_message_is_persisted_in_workspace(
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
        asyncio.run(
            app.state.channel_manager.poll_once(
                stored_channel(allowed_user_ids=["1001"])
            )
        )

        state = client.get("/api/state").json()
    assert [message["content"] for message in state["messages"]] == [
        "Draft from Telegram",
        "Telegram reply",
    ]


@pytest.mark.anyio
async def test_telegram_reply_is_split_when_it_is_too_long(
    tmp_path, monkeypatch
) -> None:
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path))
    transport = FakeTelegramTransport()
    transport.updates = [telegram_update()]
    long_reply = "x" * 4100

    async def handle_message(_: str) -> str:
        return long_reply

    manager = ChannelManager(
        message_handler=handle_message,
        store=StateStore(tmp_path),
        telegram_transport=transport,
    )

    await manager.poll_once(stored_channel(allowed_user_ids=["1001"]))

    assert [len(message["text"]) for message in transport.sent_messages] == [4096, 4]


@pytest.mark.anyio
async def test_telegram_connection_failure_reports_error_status(
    tmp_path, monkeypatch
) -> None:
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path))
    transport = FakeTelegramTransport()
    transport.error = RuntimeError("Token is invalid")
    manager = ChannelManager(
        message_handler=static_reply,
        store=StateStore(tmp_path),
        telegram_transport=transport,
    )

    await manager.poll_once(stored_channel())
    channel = manager.channel_with_status(stored_channel())

    assert channel.status == "error"
    assert channel.error == "Token is invalid"


def test_split_telegram_message_keeps_empty_reply_sendable() -> None:
    assert split_telegram_message("") == [""]
