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

from flowent.storage import StateStore, StoredTelegramBot, StoredTelegramSession

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
    bot_token: str = ""
    error: str = ""
    offset: int | None = None
    status: ChannelStatus = ChannelStatus.DISABLED
    task: asyncio.Task[None] | None = None


class TelegramBotManager:
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
        self.runtime = ChannelRuntime()
        self._sync_lock = asyncio.Lock()

    def bot_with_status(self, bot: StoredTelegramBot) -> StoredTelegramBot:
        if not bot.enabled:
            return bot.model_copy(
                update={"status": ChannelStatus.DISABLED, "error": ""}
            )
        if self.runtime.status == ChannelStatus.DISABLED:
            return bot.model_copy(
                update={"status": ChannelStatus.STARTING, "error": ""}
            )
        return bot.model_copy(
            update={"status": self.runtime.status, "error": self.runtime.error}
        )

    async def start_enabled(self) -> None:
        await self.sync_bot(self.store.read_telegram_bot())

    async def stop_all(self) -> None:
        async with self._sync_lock:
            await self._stop_runtime_task()
            self.runtime = ChannelRuntime()

    async def sync_bot(self, bot: StoredTelegramBot) -> None:
        async with self._sync_lock:
            await self._sync_bot(bot)

    async def _sync_bot(self, bot: StoredTelegramBot) -> None:
        if not bot.enabled:
            await self._stop_runtime_task()
            self.runtime = ChannelRuntime()
            return
        if (
            self.runtime.task is not None
            and not self.runtime.task.done()
            and self.runtime.bot_token == bot.bot_token
        ):
            return
        await self._stop_runtime_task()
        self.runtime = ChannelRuntime(
            bot_token=bot.bot_token,
            status=ChannelStatus.STARTING,
        )
        self.runtime.task = asyncio.create_task(self._run_bot(bot))

    async def _stop_runtime_task(self) -> None:
        if self.runtime.task is None:
            return
        self.runtime.task.cancel()
        with suppress(asyncio.CancelledError):
            await self.runtime.task

    async def poll_once(self, bot: StoredTelegramBot) -> None:
        if not bot.enabled:
            self.runtime.status = ChannelStatus.DISABLED
            self.runtime.error = ""
            return

        self.runtime.status = ChannelStatus.STARTING
        self.runtime.error = ""
        try:
            updates = await self.telegram_transport.get_updates(
                offset=self.runtime.offset,
                timeout=30,
                token=bot.bot_token,
            )
            self.runtime.status = ChannelStatus.RUNNING
            for update in updates:
                update_id = update.get("update_id")
                if isinstance(update_id, int):
                    self.runtime.offset = max(self.runtime.offset or 0, update_id + 1)
                await self._handle_telegram_update(bot, update)
        except Exception as error:
            self.runtime.status = ChannelStatus.ERROR
            self.runtime.error = str(error) or "Connection failed."
            logger.exception("Telegram polling failed")

    async def _run_bot(self, bot: StoredTelegramBot) -> None:
        while True:
            await self.poll_once(bot)
            if self.runtime.status == ChannelStatus.ERROR:
                await asyncio.sleep(5)

    async def _handle_telegram_update(
        self,
        bot: StoredTelegramBot,
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
        if not chat_id:
            return

        session = self._telegram_session(
            chat=chat if isinstance(chat, dict) else {},
            message=text,
            sender=sender if isinstance(sender, dict) else {},
        )
        if not self._is_approved(session.chat_id):
            self.store.save_telegram_session(session)
            await self._send_telegram_reply(
                bot,
                chat_id,
                "Request received. Approve this conversation in Flowent.",
            )
            return

        self.store.save_telegram_session(
            session.model_copy(update={"status": "approved"})
        )

        reply = await self.message_handler(text)
        await self._send_telegram_reply(bot, chat_id, reply)

    def _is_approved(self, chat_id: str) -> bool:
        return any(
            session.chat_id == chat_id and session.status == "approved"
            for session in self.store.read_telegram_bot().sessions
        )

    def _telegram_session(
        self,
        *,
        chat: dict[str, Any],
        message: str,
        sender: dict[str, Any],
    ) -> StoredTelegramSession:
        first_name = str(sender.get("first_name") or "")
        last_name = str(sender.get("last_name") or "")
        title = str(chat.get("title") or "")
        display_name = title or " ".join(
            part for part in [first_name, last_name] if part
        )
        return StoredTelegramSession(
            chat_id=str(chat.get("id") or ""),
            display_name=display_name,
            recent_message=message,
            status="pending",
            user_id=str(sender.get("id") or ""),
            username=str(sender.get("username") or ""),
        )

    async def _send_telegram_reply(
        self,
        bot: StoredTelegramBot,
        chat_id: str,
        content: str,
    ) -> None:
        for part in split_telegram_message(content):
            await self.telegram_transport.send_message(
                chat_id=chat_id,
                text=part,
                token=bot.bot_token,
            )


def split_telegram_message(content: str) -> list[str]:
    if content == "":
        return [""]
    return [
        content[index : index + TELEGRAM_MESSAGE_LIMIT]
        for index in range(0, len(content), TELEGRAM_MESSAGE_LIMIT)
    ]
