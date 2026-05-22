from __future__ import annotations

import asyncio
import json
import logging
import urllib.error
import urllib.request
from collections.abc import Awaitable, Callable
from contextlib import suppress
from dataclasses import dataclass
from enum import StrEnum
from typing import Any, Protocol

from flowent.storage import StateStore, StoredChannel

logger = logging.getLogger("flowent.channels")

TELEGRAM_MESSAGE_LIMIT = 4096


class ChannelStatus(StrEnum):
    DISABLED = "disabled"
    ERROR = "error"
    RUNNING = "running"
    STARTING = "starting"


class TelegramTransport(Protocol):
    async def get_updates(
        self,
        *,
        offset: int | None,
        timeout: int,
        token: str,
    ) -> list[dict[str, Any]]: ...

    async def send_message(
        self,
        *,
        chat_id: str,
        text: str,
        token: str,
    ) -> None: ...


class TelegramBotTransport:
    async def get_updates(
        self,
        *,
        offset: int | None,
        timeout: int,
        token: str,
    ) -> list[dict[str, Any]]:
        payload: dict[str, object] = {
            "allowed_updates": ["message"],
            "timeout": timeout,
        }
        if offset is not None:
            payload["offset"] = offset
        response = await asyncio.to_thread(
            self._post,
            token,
            "getUpdates",
            payload,
        )
        result = response.get("result")
        if not isinstance(result, list):
            raise RuntimeError("Updates could not be fetched.")
        return [update for update in result if isinstance(update, dict)]

    async def send_message(
        self,
        *,
        chat_id: str,
        text: str,
        token: str,
    ) -> None:
        await asyncio.to_thread(
            self._post,
            token,
            "sendMessage",
            {"chat_id": chat_id, "text": text},
        )

    def _post(
        self,
        token: str,
        method: str,
        payload: dict[str, object],
    ) -> dict[str, Any]:
        request = urllib.request.Request(
            f"https://api.telegram.org/bot{token}/{method}",
            data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=40) as response:
                raw_body = response.read().decode("utf-8")
        except urllib.error.HTTPError as error:
            raw_body = error.read().decode("utf-8")
            try:
                body = json.loads(raw_body)
            except json.JSONDecodeError as decode_error:
                raise RuntimeError("Telegram request failed.") from decode_error
            description = body.get("description")
            raise RuntimeError(
                str(description) if description else "Telegram request failed."
            ) from error
        except urllib.error.URLError as error:
            raise RuntimeError(str(error.reason)) from error

        body = json.loads(raw_body)
        if not body.get("ok"):
            description = body.get("description")
            raise RuntimeError(
                str(description) if description else "Telegram request failed."
            )
        return body


@dataclass
class ChannelRuntime:
    error: str = ""
    offset: int | None = None
    status: ChannelStatus = ChannelStatus.DISABLED
    task: asyncio.Task[None] | None = None


class ChannelManager:
    def __init__(
        self,
        *,
        message_handler: Callable[[str], Awaitable[str]],
        store: StateStore,
        telegram_transport: TelegramTransport | None = None,
    ) -> None:
        self.message_handler = message_handler
        self.store = store
        self.telegram_transport = telegram_transport or TelegramBotTransport()
        self.runtimes: dict[str, ChannelRuntime] = {}

    def channel_with_status(self, channel: StoredChannel) -> StoredChannel:
        runtime = self.runtimes.get(channel.id)
        if not channel.enabled:
            return channel.model_copy(
                update={"status": ChannelStatus.DISABLED, "error": ""}
            )
        if runtime is None:
            return channel.model_copy(
                update={"status": ChannelStatus.STARTING, "error": ""}
            )
        return channel.model_copy(
            update={"status": runtime.status, "error": runtime.error}
        )

    def channels_with_status(
        self, channels: list[StoredChannel]
    ) -> list[StoredChannel]:
        return [self.channel_with_status(channel) for channel in channels]

    async def start_enabled(self) -> None:
        for channel in self.store.read_channels():
            await self.sync_channel(channel)

    async def stop_all(self) -> None:
        for runtime in self.runtimes.values():
            if runtime.task is not None:
                runtime.task.cancel()
        for runtime in self.runtimes.values():
            if runtime.task is not None:
                with suppress(asyncio.CancelledError):
                    await runtime.task
        self.runtimes.clear()

    async def sync_channel(self, channel: StoredChannel) -> None:
        runtime = self.runtimes.setdefault(channel.id, ChannelRuntime())
        if not channel.enabled:
            if runtime.task is not None:
                runtime.task.cancel()
            runtime.status = ChannelStatus.DISABLED
            runtime.error = ""
            return
        if runtime.task is not None and not runtime.task.done():
            return
        runtime.status = ChannelStatus.STARTING
        runtime.error = ""
        runtime.task = asyncio.create_task(self._run_channel(channel))

    async def poll_once(self, channel: StoredChannel) -> None:
        runtime = self.runtimes.setdefault(channel.id, ChannelRuntime())
        if not channel.enabled:
            runtime.status = ChannelStatus.DISABLED
            runtime.error = ""
            return

        runtime.status = ChannelStatus.STARTING
        runtime.error = ""
        try:
            updates = await self.telegram_transport.get_updates(
                offset=runtime.offset,
                timeout=30,
                token=channel.bot_token,
            )
            runtime.status = ChannelStatus.RUNNING
            for update in updates:
                update_id = update.get("update_id")
                if isinstance(update_id, int):
                    runtime.offset = max(runtime.offset or 0, update_id + 1)
                await self._handle_telegram_update(channel, update)
        except Exception as error:
            runtime.status = ChannelStatus.ERROR
            runtime.error = str(error) or "Connection failed."
            logger.exception("Channel polling failed channel_id=%s", channel.id)

    async def _run_channel(self, channel: StoredChannel) -> None:
        while True:
            await self.poll_once(channel)
            runtime = self.runtimes.setdefault(channel.id, ChannelRuntime())
            if runtime.status == ChannelStatus.ERROR:
                await asyncio.sleep(5)

    async def _handle_telegram_update(
        self,
        channel: StoredChannel,
        update: dict[str, Any],
    ) -> None:
        message = update.get("message")
        if not isinstance(message, dict):
            return
        text = message.get("text")
        if not isinstance(text, str) or text == "":
            return
        chat = message.get("chat")
        sender = message.get("from")
        chat_id = str(chat.get("id")) if isinstance(chat, dict) else ""
        user_id = str(sender.get("id")) if isinstance(sender, dict) else ""
        if not chat_id:
            return

        if self._is_pairing_message(channel, text):
            paired_channel = self._pair_channel(channel, chat_id, user_id)
            self.store.save_channel(paired_channel)
            await self._send_telegram_reply(paired_channel, chat_id, "Connected.")
            return

        if not self._is_authorized(channel, chat_id, user_id):
            logger.info(
                "Channel message rejected channel_id=%s chat_id=%s user_id=%s",
                channel.id,
                chat_id,
                user_id,
            )
            return

        reply = await self.message_handler(text)
        await self._send_telegram_reply(channel, chat_id, reply)

    def _is_authorized(
        self,
        channel: StoredChannel,
        chat_id: str,
        user_id: str,
    ) -> bool:
        if not channel.allowed_chat_ids and not channel.allowed_user_ids:
            return False
        return (
            chat_id in channel.allowed_chat_ids or user_id in channel.allowed_user_ids
        )

    def _is_pairing_message(self, channel: StoredChannel, text: str) -> bool:
        return (
            bool(channel.pairing_code)
            and text.strip() == f"/pair {channel.pairing_code}"
        )

    def _pair_channel(
        self,
        channel: StoredChannel,
        chat_id: str,
        user_id: str,
    ) -> StoredChannel:
        allowed_chat_ids = [*channel.allowed_chat_ids]
        allowed_user_ids = [*channel.allowed_user_ids]
        if chat_id not in allowed_chat_ids:
            allowed_chat_ids.append(chat_id)
        if user_id and user_id not in allowed_user_ids:
            allowed_user_ids.append(user_id)
        return channel.model_copy(
            update={
                "allowed_chat_ids": allowed_chat_ids,
                "allowed_user_ids": allowed_user_ids,
            }
        )

    async def _send_telegram_reply(
        self,
        channel: StoredChannel,
        chat_id: str,
        content: str,
    ) -> None:
        for part in split_telegram_message(content):
            await self.telegram_transport.send_message(
                chat_id=chat_id,
                text=part,
                token=channel.bot_token,
            )


def split_telegram_message(content: str) -> list[str]:
    if content == "":
        return [""]
    return [
        content[index : index + TELEGRAM_MESSAGE_LIMIT]
        for index in range(0, len(content), TELEGRAM_MESSAGE_LIMIT)
    ]
