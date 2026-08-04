from __future__ import annotations

import asyncio
import json
import sys
from threading import Lock, Thread
from typing import Any, TextIO


class ProtocolError(RuntimeError):
    pass


class JsonlConnection:
    def __init__(
        self,
        reader: TextIO | None = None,
        writer: TextIO | None = None,
    ):
        self.reader = reader or sys.stdin
        self.writer = writer or sys.stdout
        self.incoming: asyncio.Queue[dict[str, Any] | None] = asyncio.Queue()
        self.pending: dict[str, asyncio.Future[Any]] = {}
        self.next_request_id = 1
        self.loop: asyncio.AbstractEventLoop | None = None
        self.started = False
        self.closed = False
        self.start_lock = Lock()

    def start(self) -> None:
        with self.start_lock:
            if self.started:
                return
            self.loop = asyncio.get_running_loop()
            self.started = True
            Thread(target=self._read, daemon=True).start()

    def send(self, message: dict[str, Any]) -> None:
        self.writer.write(f"{json.dumps(message, separators=(',', ':'))}\n")
        self.writer.flush()

    async def request(
        self,
        method: str,
        params: dict[str, Any] | None = None,
    ) -> Any:
        if self.closed:
            raise ProtocolError("desktop connection closed")
        request_id = f"desktop-{self.next_request_id}"
        self.next_request_id += 1
        future = asyncio.get_running_loop().create_future()
        self.pending[request_id] = future
        self.start()
        message: dict[str, Any] = {"id": request_id, "method": method}
        if params is not None:
            message["params"] = params
        try:
            self.send(message)
            return await future
        finally:
            self.pending.pop(request_id, None)

    async def receive(self) -> dict[str, Any] | None:
        self.start()
        return await self.incoming.get()

    def _read(self) -> None:
        try:
            for line in self.reader:
                try:
                    message = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if isinstance(message, dict) and self.loop:
                    self.loop.call_soon_threadsafe(self._accept, message)
        except (OSError, ValueError):
            if not self.reader.closed:
                raise
        finally:
            self._schedule_finish()

    def _schedule_finish(self) -> None:
        loop = self.loop
        if loop is None or loop.is_closed():
            return
        try:
            loop.call_soon_threadsafe(self._finish)
        except RuntimeError:
            if not loop.is_closed():
                raise

    def _accept(self, message: dict[str, Any]) -> None:
        request_id = message.get("id")
        future = self.pending.get(request_id) if isinstance(request_id, str) else None
        if future and not future.done():
            if "result" in message:
                future.set_result(message["result"])
                return
            error = message.get("error")
            if isinstance(error, dict) and isinstance(error.get("message"), str):
                future.set_exception(ProtocolError(error["message"]))
                return
            future.set_exception(ProtocolError("desktop returned an invalid response"))
            return
        self.incoming.put_nowait(message)

    def _finish(self) -> None:
        self.closed = True
        error = ProtocolError("desktop connection closed")
        for future in self.pending.values():
            if not future.done():
                future.set_exception(error)
        self.incoming.put_nowait(None)
