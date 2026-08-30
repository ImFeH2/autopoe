from __future__ import annotations

import json
import sys
import threading
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any, TextIO

from huddol.core.errors import DomainError

INTERNAL_PREFIX = "system."


@dataclass(frozen=True)
class Request:
    id: int | None
    method: str
    params: dict[str, Any]


class JsonLineWriter:
    def __init__(self, stream: TextIO) -> None:
        self._stream = stream
        self._lock = threading.Lock()

    def write(self, payload: dict[str, Any]) -> None:
        line = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
        with self._lock:
            self._stream.write(line + "\n")
            self._stream.flush()


def parse(line: str) -> Request | None:
    try:
        payload = json.loads(line)
    except json.JSONDecodeError:
        return None
    if not isinstance(payload, dict):
        return None
    method = payload.get("method")
    if not isinstance(method, str) or not method:
        return None
    identifier = payload.get("id")
    params = payload.get("params")
    return Request(
        id=identifier if isinstance(identifier, int) else None,
        method=method,
        params=params if isinstance(params, dict) else {},
    )


class Dispatcher:
    def __init__(self, writer: JsonLineWriter) -> None:
        self._writer = writer
        self._handlers: dict[str, Callable[[dict[str, Any]], Any]] = {}

    def register(self, method: str, handler: Callable[[dict[str, Any]], Any]) -> None:
        self._handlers[method] = handler

    def methods(self) -> tuple[str, ...]:
        return tuple(sorted(self._handlers))

    def emit(self, event_type: str, payload: dict[str, Any] | None = None) -> None:
        self._writer.write({"type": event_type, **(payload or {})})

    def handle(self, request: Request) -> None:
        handler = self._handlers.get(request.method)
        if handler is None:
            self._fail(request, "unknown_method", f"{request.method} is not a method")
            return
        try:
            result = handler(request.params)
        except DomainError as error:
            self._fail(request, error.code, str(error))
        except (TypeError, ValueError, KeyError) as error:
            self._fail(request, "invalid_params", f"{type(error).__name__}: {error}")
        except Exception as error:  # noqa: BLE001
            self._fail(request, "internal_error", f"{type(error).__name__}: {error}")
        else:
            if request.id is not None:
                self._writer.write(
                    {"type": "response", "id": request.id, "result": result}
                )

    def _fail(self, request: Request, code: str, message: str) -> None:
        if request.id is None:
            self.emit("error", {"code": code, "message": message})
            return
        self._writer.write(
            {
                "type": "response",
                "id": request.id,
                "error": {"code": code, "message": message},
            }
        )


def serve(
    dispatcher: Dispatcher,
    stream: TextIO | None = None,
    *,
    allow_internal: bool = False,
) -> str:
    source = stream if stream is not None else sys.stdin
    for line in source:
        text = line.strip()
        if not text:
            continue
        request = parse(text)
        if request is None:
            dispatcher.emit("error", {"code": "invalid_frame", "message": "bad JSON"})
            continue
        if request.method == "system.shutdown":
            return "shutdown"
        if request.method.startswith(INTERNAL_PREFIX) and not allow_internal:
            dispatcher._fail(request, "internal_method", "Internal Huddol method")
            continue
        dispatcher.handle(request)
    return "eof"
