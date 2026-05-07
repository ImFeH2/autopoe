from __future__ import annotations

import asyncio
import threading
import time
from contextlib import suppress
from typing import Any

from loguru import logger

from flowent.assistant_commands import (
    ConversationCommandError,
    execute_conversation_command_input,
)
from flowent.events import event_bus
from flowent.models import Event, EventType, Message
from flowent.network import create_async_http_session, is_success_status
from flowent.providers.errors import LLMProviderError
from flowent.registry import registry
from flowent.settings import (
    TelegramPendingChat,
    get_settings,
    save_settings,
)

TELEGRAM_API_BASE_URL = "https://api.telegram.org"
TELEGRAM_LONG_POLL_TIMEOUT_SECONDS = 30
TELEGRAM_REQUEST_TIMEOUT_SECONDS = 35
TELEGRAM_EDIT_INTERVAL_SECONDS = 1.0
TELEGRAM_EDIT_THRESHOLD_CHARS = 100
TELEGRAM_TYPING_INTERVAL_SECONDS = 4.0
TELEGRAM_MAX_TEXT_LENGTH = 4000
PRIVATE_ONLY_MESSAGE = "🔒 Telegram channel currently supports private chats only."
IMAGE_INPUT_UNSUPPORTED_MESSAGE = "Telegram currently does not support image input yet."
IMAGE_OUTPUT_UNSUPPORTED_MESSAGE = (
    "Telegram currently does not support image output yet."
)


class TelegramChannel:
    def __init__(self) -> None:
        settings = get_settings()
        self._bot_token = settings.telegram.bot_token.strip()
        self._app_loop = event_bus.get_loop()
        self._stop_event = threading.Event()
        self._thread: threading.Thread | None = None
        self._thread_loop: asyncio.AbstractEventLoop | None = None
        self._polling_task: asyncio.Task[None] | None = None
        self._offset: int | None = None
        self._event_lock: asyncio.Lock | None = None
        self._stream_buffer = ""
        self._stream_message_ids: dict[int, int] = {}
        self._typing_task: asyncio.Task[None] | None = None
        self._assistant_running = False
        self._last_edit_at = 0.0
        self._last_sent_length = 0

    def start(self) -> None:
        if not self._bot_token:
            logger.info("Telegram channel not started: bot token is empty")
            return
        if self._thread is not None and self._thread.is_alive():
            return

        self._app_loop = event_bus.get_loop()
        if self._app_loop is None or self._app_loop.is_closed():
            raise RuntimeError("Event loop is not available for Telegram channel")

        self._stop_event.clear()
        self._offset = None
        self._event_lock = None
        self._stream_buffer = ""
        self._stream_message_ids = {}
        self._typing_task = None
        self._assistant_running = False
        self._last_edit_at = 0.0
        self._last_sent_length = 0

        event_bus.subscribe(self._on_event)
        self._thread = threading.Thread(
            target=self._run_polling_thread,
            name="telegram-channel",
            daemon=True,
        )
        self._thread.start()
        logger.info("Telegram channel started")

    def stop(self) -> None:
        event_bus.unsubscribe(self._on_event)
        self._stop_event.set()

        polling_loop = self._thread_loop
        task = self._polling_task
        if polling_loop is not None and task is not None:
            polling_loop.call_soon_threadsafe(task.cancel)
        typing_task = self._typing_task
        app_loop = self._app_loop
        if (
            app_loop is not None
            and not app_loop.is_closed()
            and typing_task is not None
        ):
            app_loop.call_soon_threadsafe(typing_task.cancel)

        if self._thread is not None and self._thread.is_alive():
            self._thread.join(timeout=5.0)

        self._thread = None
        self._thread_loop = None
        self._polling_task = None
        self._typing_task = None
        self._assistant_running = False
        self._reset_stream_state()
        logger.info("Telegram channel stopped")

    def _run_polling_thread(self) -> None:
        loop = asyncio.new_event_loop()
        self._thread_loop = loop
        asyncio.set_event_loop(loop)
        self._polling_task = loop.create_task(self._poll_updates_loop())
        try:
            loop.run_until_complete(self._polling_task)
        except asyncio.CancelledError:
            pass
        finally:
            pending = asyncio.all_tasks(loop)
            for task in pending:
                task.cancel()
            if pending:
                loop.run_until_complete(
                    asyncio.gather(*pending, return_exceptions=True)
                )
            loop.run_until_complete(loop.shutdown_asyncgens())
            loop.close()

    async def _poll_updates_loop(self) -> None:
        while not self._stop_event.is_set():
            try:
                result = await self._call_api(
                    "getUpdates",
                    {
                        "offset": self._offset,
                        "timeout": TELEGRAM_LONG_POLL_TIMEOUT_SECONDS,
                    },
                    parse_mode=None,
                )
                if not isinstance(result, list):
                    continue
                for update in result:
                    if not isinstance(update, dict):
                        continue
                    update_id = update.get("update_id")
                    if isinstance(update_id, int):
                        self._offset = update_id + 1
                    await self._process_update(update)
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception("Telegram polling loop failed")
                await asyncio.sleep(1.0)

    async def _process_update(self, update: dict[str, Any]) -> None:
        message = update.get("message")
        if not isinstance(message, dict):
            return

        from_data = message.get("from")
        chat_data = message.get("chat")
        chat_id = chat_data.get("id") if isinstance(chat_data, dict) else None
        chat_type = chat_data.get("type") if isinstance(chat_data, dict) else None
        text = message.get("text")
        caption = message.get("caption")
        photo = message.get("photo")
        document = message.get("document")
        username = from_data.get("username") if isinstance(from_data, dict) else None
        first_name = (
            from_data.get("first_name") if isinstance(from_data, dict) else None
        )
        last_name = from_data.get("last_name") if isinstance(from_data, dict) else None

        if not isinstance(chat_id, int):
            return
        if chat_type != "private":
            await self._send_message(chat_id, PRIVATE_ONLY_MESSAGE, markdown=False)
            return

        display_name = self._build_display_name(first_name, last_name, username)

        settings = get_settings()
        if any(chat.chat_id == chat_id for chat in settings.telegram.approved_chats):
            document_is_image = isinstance(document, dict) and str(
                document.get("mime_type", "")
            ).startswith("image/")
            has_image_input = (
                isinstance(photo, list) and len(photo) > 0
            ) or document_is_image
            if has_image_input:
                await self._send_message(
                    chat_id,
                    IMAGE_INPUT_UNSUPPORTED_MESSAGE,
                    markdown=False,
                )
                return

            incoming_text = text if isinstance(text, str) else caption
            if not isinstance(incoming_text, str) or not incoming_text.strip():
                return

            if not isinstance(text, str) or not text.strip():
                text = incoming_text

            assistant = registry.get_assistant()
            if assistant is None:
                logger.warning("Telegram message dropped: assistant not available")
                return

            try:
                executed_command = execute_conversation_command_input(assistant, text)
            except ConversationCommandError as exc:
                await self._send_message(chat_id, str(exc), markdown=False)
                return
            except (RuntimeError, TimeoutError, LLMProviderError) as exc:
                await self._send_message(chat_id, str(exc), markdown=False)
                return

            if executed_command is not None:
                await self._send_message(
                    chat_id, executed_command.feedback, markdown=False
                )
                return

            assistant.enqueue_message(
                Message(from_id="human", to_id=assistant.uuid, content=text)
            )
            return

        if self._upsert_pending_chat(settings, chat_id, username, display_name):
            save_settings(settings)
        await self._send_message(
            chat_id,
            (f"⏳ This chat is pending approval in Flowent.\nChat ID: `{chat_id}`"),
            markdown=True,
        )

    def _on_event(self, event: Event) -> None:
        if event.type not in {
            EventType.ASSISTANT_CONTENT,
            EventType.HISTORY_ENTRY_ADDED,
            EventType.NODE_STATE_CHANGED,
        }:
            return

        loop = self._app_loop
        if loop is None or loop.is_closed():
            return

        future = asyncio.run_coroutine_threadsafe(self._process_event(event), loop)
        future.add_done_callback(self._log_event_error)

    @staticmethod
    def _log_event_error(future: Any) -> None:
        try:
            future.result()
        except asyncio.CancelledError:
            return
        except Exception:
            logger.exception("Telegram event handling failed")

    async def _process_event(self, event: Event) -> None:
        if self._event_lock is None:
            self._event_lock = asyncio.Lock()

        async with self._event_lock:
            assistant = registry.get_assistant()
            if assistant is None or event.agent_id != assistant.uuid:
                return

            if event.type == EventType.ASSISTANT_CONTENT:
                content = event.data.get("content")
                if isinstance(content, str) and content:
                    await self._handle_assistant_content(content)
                return

            if event.type == EventType.HISTORY_ENTRY_ADDED:
                entry_type = event.data.get("type")
                if entry_type != "AssistantText":
                    return
                parts = event.data.get("parts")
                if not isinstance(parts, list):
                    return
                if not any(
                    isinstance(part, dict) and part.get("type") == "image"
                    for part in parts
                ):
                    return
                for chat_id in self._get_approved_chat_ids():
                    await self._send_message(
                        chat_id,
                        IMAGE_OUTPUT_UNSUPPORTED_MESSAGE,
                        markdown=False,
                    )
                return

            if event.type != EventType.NODE_STATE_CHANGED:
                return

            new_state = event.data.get("new_state")
            if new_state == "running":
                await self._begin_running_feedback()
                return

            await self._end_running_feedback()

    @staticmethod
    def _get_approved_chat_ids() -> list[int]:
        settings = get_settings()
        return [chat.chat_id for chat in settings.telegram.approved_chats]

    async def _handle_assistant_content(self, chunk: str) -> None:
        self._stream_buffer += chunk
        await self._ensure_stream_messages()
        now = time.monotonic()
        if (
            len(self._stream_buffer) - self._last_sent_length
            >= TELEGRAM_EDIT_THRESHOLD_CHARS
            or now - self._last_edit_at >= TELEGRAM_EDIT_INTERVAL_SECONDS
        ):
            await self._flush_stream()

    async def _finalize_stream(self) -> None:
        if not self._stream_buffer and not self._stream_message_ids:
            self._reset_stream_state()
            return
        await self._flush_stream(force=True)
        self._reset_stream_state()

    async def _begin_running_feedback(self) -> None:
        if self._assistant_running:
            return
        await self._stop_typing_task()
        self._assistant_running = True
        self._reset_stream_state()
        self._typing_task = asyncio.create_task(self._typing_loop())

    async def _end_running_feedback(self) -> None:
        self._assistant_running = False
        await self._stop_typing_task()
        await self._finalize_stream()

    async def _stop_typing_task(self) -> None:
        task = self._typing_task
        if task is None:
            return
        self._typing_task = None
        task.cancel()
        with suppress(asyncio.CancelledError):
            await task

    async def _typing_loop(self) -> None:
        while self._assistant_running and not self._stop_event.is_set():
            try:
                await self._send_typing_feedback_once()
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception("Telegram typing loop failed")
            await asyncio.sleep(TELEGRAM_TYPING_INTERVAL_SECONDS)

    async def _send_typing_feedback_once(self) -> None:
        settings = get_settings()
        approved_chat_ids = {chat.chat_id for chat in settings.telegram.approved_chats}
        for chat_id in list(self._stream_message_ids):
            if chat_id not in approved_chat_ids:
                self._stream_message_ids.pop(chat_id, None)
        for approved_chat in settings.telegram.approved_chats:
            if approved_chat.chat_id in self._stream_message_ids:
                continue
            await self._send_chat_action(approved_chat.chat_id, action="typing")

    async def _ensure_stream_messages(self) -> None:
        if not self._stream_buffer:
            return
        settings = get_settings()
        had_stream_messages = bool(self._stream_message_ids)
        for approved_chat in settings.telegram.approved_chats:
            if approved_chat.chat_id in self._stream_message_ids:
                continue
            message_id = await self._send_message(
                approved_chat.chat_id,
                self._stream_buffer,
                markdown=False,
            )
            if message_id is not None:
                self._stream_message_ids[approved_chat.chat_id] = message_id
        if not had_stream_messages and self._stream_message_ids:
            self._last_edit_at = time.monotonic()
            self._last_sent_length = len(self._stream_buffer)

    async def _flush_stream(self, *, force: bool = False) -> None:
        if not self._stream_buffer and not force:
            return
        await self._ensure_stream_messages()
        if not self._stream_message_ids or not self._stream_buffer:
            return

        current_chat_ids = {
            chat.chat_id for chat in get_settings().telegram.approved_chats
        }
        text = self._format_text(self._stream_buffer)
        for chat_id, message_id in list(self._stream_message_ids.items()):
            if chat_id not in current_chat_ids:
                self._stream_message_ids.pop(chat_id, None)
                continue
            updated = await self._edit_message(chat_id, message_id, text)
            if not updated:
                self._stream_message_ids.pop(chat_id, None)

        self._last_edit_at = time.monotonic()
        self._last_sent_length = len(self._stream_buffer)

    async def _send_message(
        self,
        chat_id: int,
        text: str,
        *,
        markdown: bool,
    ) -> int | None:
        payload: dict[str, Any] = {
            "chat_id": chat_id,
            "text": self._format_text(text),
        }
        result = await self._call_api(
            "sendMessage",
            payload,
            parse_mode="Markdown" if markdown else None,
        )
        if not isinstance(result, dict):
            return None
        message_id = result.get("message_id")
        return message_id if isinstance(message_id, int) else None

    async def _send_chat_action(self, chat_id: int, *, action: str) -> None:
        await self._call_api(
            "sendChatAction",
            {
                "chat_id": chat_id,
                "action": action,
            },
            parse_mode=None,
        )

    async def _edit_message(
        self,
        chat_id: int,
        message_id: int,
        text: str,
    ) -> bool:
        payload = {
            "chat_id": chat_id,
            "message_id": message_id,
            "text": self._format_text(text),
        }
        result = await self._call_api(
            "editMessageText",
            payload,
            parse_mode="Markdown",
        )
        return result is not None

    def _format_text(self, text: str) -> str:
        if len(text) <= TELEGRAM_MAX_TEXT_LENGTH:
            return text
        return text[: TELEGRAM_MAX_TEXT_LENGTH - 1] + "…"

    def _reset_stream_state(self) -> None:
        self._stream_buffer = ""
        self._stream_message_ids = {}
        self._last_edit_at = 0.0
        self._last_sent_length = 0

    @staticmethod
    def _build_display_name(
        first_name: object,
        last_name: object,
        username: object,
    ) -> str:
        parts = []
        if isinstance(first_name, str) and first_name.strip():
            parts.append(first_name.strip())
        if isinstance(last_name, str) and last_name.strip():
            parts.append(last_name.strip())
        if parts:
            return " ".join(parts)
        if isinstance(username, str) and username.strip():
            return username.strip()
        return ""

    @staticmethod
    def _upsert_pending_chat(
        settings: Any,
        chat_id: int,
        username: object,
        display_name: str,
    ) -> bool:
        username_value = (
            username.strip() if isinstance(username, str) and username.strip() else None
        )
        now = time.time()
        for pending_chat in settings.telegram.pending_chats:
            if pending_chat.chat_id != chat_id:
                continue

            changed = False
            if pending_chat.username != username_value:
                pending_chat.username = username_value
                changed = True
            if pending_chat.display_name != display_name:
                pending_chat.display_name = display_name
                changed = True
            if pending_chat.last_seen_at != now:
                pending_chat.last_seen_at = now
                changed = True
            return changed

        settings.telegram.pending_chats.append(
            TelegramPendingChat(
                chat_id=chat_id,
                username=username_value,
                display_name=display_name,
                first_seen_at=now,
                last_seen_at=now,
            )
        )
        return True

    async def _call_api(
        self,
        method: str,
        payload: dict[str, Any],
        *,
        parse_mode: str | None,
    ) -> Any:
        if not self._bot_token:
            return None

        request_payload = {
            key: value for key, value in payload.items() if value is not None
        }
        if parse_mode is not None:
            request_payload["parse_mode"] = parse_mode

        while not self._stop_event.is_set():
            try:
                async with create_async_http_session(
                    timeout=TELEGRAM_REQUEST_TIMEOUT_SECONDS
                ) as client:
                    response = await client.post(
                        f"{TELEGRAM_API_BASE_URL}/bot{self._bot_token}/{method}",
                        data=request_payload,
                    )
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                logger.warning("Telegram API request failed ({}): {}", method, exc)
                return None

            response_data: dict[str, Any] | None = None
            try:
                response_data = response.json()
            except ValueError:
                response_data = None

            if response.status_code == 429:
                retry_after = self._extract_retry_after(response_data)
                await asyncio.sleep(retry_after)
                continue

            if is_success_status(response.status_code) and isinstance(
                response_data, dict
            ):
                if response_data.get("ok") is True:
                    return response_data.get("result")
                logger.warning(
                    "Telegram API returned error for {}: {}",
                    method,
                    response_data.get("description", "unknown error"),
                )
            elif parse_mode is not None and method in {
                "sendMessage",
                "editMessageText",
            }:
                request_payload.pop("parse_mode", None)
                parse_mode = None
                continue
            else:
                logger.warning(
                    "Telegram API request failed for {} with status {}",
                    method,
                    response.status_code,
                )
            return None

        return None

    @staticmethod
    def _extract_retry_after(response_data: dict[str, Any] | None) -> float:
        if not isinstance(response_data, dict):
            return 1.0
        parameters = response_data.get("parameters")
        if not isinstance(parameters, dict):
            return 1.0
        retry_after = parameters.get("retry_after")
        if isinstance(retry_after, (int, float)) and retry_after > 0:
            return float(retry_after)
        return 1.0
