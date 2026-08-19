from __future__ import annotations

import json
import logging
import sqlite3
import time
from collections.abc import Callable
from threading import Lock
from typing import Any, TextIO

from flowent.diagnostics import log_event, log_exception
from flowent.domain import DomainError, OrganizationState
from flowent.history import AgentHistory
from flowent.memory import AgentMemory
from flowent.model_runner import ModelRuntime
from flowent.operations import OrganizationOperations
from flowent.todos import AgentTodos


class ProtocolError(Exception):
    pass


class JsonLineWriter:
    def __init__(self, output_stream: TextIO) -> None:
        self._output_stream = output_stream
        self._lock = Lock()

    def write(self, message: dict[str, Any]) -> None:
        encoded = json.dumps(message, separators=(",", ":")) + "\n"
        with self._lock:
            self._output_stream.write(encoded)
            self._output_stream.flush()

    def write_event(self, event: str, data: dict[str, Any]) -> None:
        self.write({"event": event, "data": data})


class Dispatcher:
    def __init__(
        self,
        state: OrganizationState,
        on_shutdown: Callable[[], None] | None = None,
        model_runtime: ModelRuntime | None = None,
        history: AgentHistory | None = None,
        todos: AgentTodos | None = None,
        memories: AgentMemory | None = None,
        operations: OrganizationOperations | None = None,
    ) -> None:
        self._state = state
        self._on_shutdown = on_shutdown
        self._model_runtime = model_runtime or ModelRuntime()
        self._history = history
        self._operations = operations or OrganizationOperations(
            state,
            history,
            todos,
            memories,
        )
        self.shutdown_requested = False
        self._handlers: dict[str, Callable[[dict[str, Any]], dict[str, Any]]] = {
            "organization.get": lambda _params: self._state.snapshot(),
            "organization.create_agent": self._create_agent,
            "organization.delete_agent": self._delete_agent,
            "organization.pause_agent": self._pause_agent,
            "organization.resume_agent": self._resume_agent,
            "agent.history.get": self._get_agent_history,
            "discussion.create": self._create_discussion,
            "discussion.delete": self._delete_discussion,
            "discussion.send": self._send_message,
            "settings.get_model": self._get_model_settings,
            "settings.update_model": self._update_model_settings,
            "settings.get_observability": self._get_observability_settings,
            "settings.update_observability": self._update_observability_settings,
            "system.shutdown": self._shutdown,
        }

    def dispatch(self, request: Any) -> dict[str, Any]:
        started = time.monotonic()
        request_id: Any = request.get("id") if isinstance(request, dict) else None
        method: Any = request.get("method") if isinstance(request, dict) else None
        diagnostic_request_id = (
            request_id if type(request_id) is int and request_id >= 1 else None
        )
        diagnostic_method = (
            method
            if isinstance(method, str) and method in self._handlers
            else "unknown"
        )
        request_log_level = (
            logging.DEBUG
            if diagnostic_method in ("organization.get", "agent.history.get")
            else logging.INFO
        )
        try:
            if not isinstance(request, dict):
                raise ProtocolError("Request must be an object")
            if type(request_id) is not int or request_id < 1:
                raise ProtocolError("Request id must be a positive integer")

            if not isinstance(method, str):
                raise ProtocolError("Request method must be a string")

            params = request.get("params", {})
            if not isinstance(params, dict):
                raise ProtocolError("Request params must be an object")

            handler = self._handlers.get(method)
            if handler is None:
                raise DomainError("method_not_found", f"Unknown method: {method}")

            log_event(
                "protocol.request.started",
                level=request_log_level,
                request_id=diagnostic_request_id,
                method=diagnostic_method,
            )
            result = handler(params)
            log_event(
                "protocol.request.completed",
                level=request_log_level,
                request_id=diagnostic_request_id,
                method=diagnostic_method,
                duration_ms=round((time.monotonic() - started) * 1000),
            )
            return {"id": request_id, "result": result}
        except DomainError as error:
            log_event(
                "protocol.request.rejected",
                level=logging.WARNING,
                request_id=diagnostic_request_id,
                method=diagnostic_method,
                error_code=error.code,
                duration_ms=round((time.monotonic() - started) * 1000),
            )
            return {
                "id": request_id,
                "error": {"code": error.code, "message": error.message},
            }
        except (KeyError, TypeError, ValueError, ProtocolError) as error:
            log_event(
                "protocol.request.rejected",
                level=logging.WARNING,
                request_id=diagnostic_request_id,
                method=diagnostic_method,
                error_code="invalid_request",
                error_type=type(error).__name__,
                duration_ms=round((time.monotonic() - started) * 1000),
            )
            return {
                "id": request_id,
                "error": {"code": "invalid_request", "message": str(error)},
            }
        except (OSError, RuntimeError, sqlite3.Error) as error:
            log_exception(
                "protocol.request.failed",
                error,
                request_id=diagnostic_request_id,
                method=diagnostic_method,
                duration_ms=round((time.monotonic() - started) * 1000),
            )
            return {
                "id": request_id,
                "error": {"code": "internal_error", "message": "Request failed"},
            }

    def _shutdown(self, params: dict[str, Any]) -> dict[str, Any]:
        if params:
            raise ProtocolError("system.shutdown does not accept params")
        self.shutdown_requested = True
        if self._on_shutdown is not None:
            self._on_shutdown()
        return {"stopped": True}

    def _get_model_settings(self, params: dict[str, Any]) -> dict[str, Any]:
        if params:
            raise ProtocolError("settings.get_model does not accept params")
        return self._model_runtime.settings()

    def _update_model_settings(self, params: dict[str, Any]) -> dict[str, Any]:
        return self._model_runtime.configure(
            api_type=require_string(params, "api_type"),
            base_url=require_string(params, "base_url"),
            api_key=require_string(params, "api_key"),
            model=require_string(params, "model"),
            context_window=require_optional_positive_integer(params, "context_window"),
        )

    def _get_observability_settings(
        self,
        params: dict[str, Any],
    ) -> dict[str, Any]:
        if params:
            raise ProtocolError("settings.get_observability does not accept params")
        return self._model_runtime.observability_settings()

    def _update_observability_settings(
        self,
        params: dict[str, Any],
    ) -> dict[str, Any]:
        return self._model_runtime.configure_observability(
            enabled=require_boolean(params, "enabled"),
            base_url=require_string(params, "base_url"),
            public_key=require_string(params, "public_key"),
            secret_key=require_string(params, "secret_key"),
            environment=require_string(params, "environment"),
            capture_content=require_boolean(params, "capture_content"),
        )

    def _create_agent(self, params: dict[str, Any]) -> dict[str, Any]:
        return self._state.create_agent(name=require_string(params, "name"))

    def _delete_agent(self, params: dict[str, Any]) -> dict[str, Any]:
        return self._operations.delete_agent(require_integer(params, "agent_id"))

    def _pause_agent(self, params: dict[str, Any]) -> dict[str, Any]:
        return self._operations.pause_agent(require_integer(params, "agent_id"))

    def _resume_agent(self, params: dict[str, Any]) -> dict[str, Any]:
        return self._operations.resume_agent(require_integer(params, "agent_id"))

    def _get_agent_history(self, params: dict[str, Any]) -> dict[str, Any]:
        agent_id = require_integer(params, "agent_id")
        member = self._state.member(agent_id)
        if member["type"] != "agent":
            raise DomainError("not_an_agent", "Member is not an Agent")
        if self._history is None:
            raise RuntimeError("Agent history is unavailable")
        return self._history.snapshot(agent_id)

    def _create_discussion(self, params: dict[str, Any]) -> dict[str, Any]:
        return self._state.create_discussion(
            topic=require_string(params, "topic"),
            creator_id=require_integer(params, "creator_id"),
            member_ids=require_integer_list(params, "member_ids"),
        )

    def _delete_discussion(self, params: dict[str, Any]) -> dict[str, Any]:
        return self._operations.delete_discussion(
            discussion_id=require_integer(params, "discussion_id")
        )

    def _send_message(self, params: dict[str, Any]) -> dict[str, Any]:
        return self._state.send_message(
            discussion_id=require_integer(params, "discussion_id"),
            sender_id=require_integer(params, "sender_id"),
            body=require_string(params, "body"),
            mention_ids=require_optional_integer_list(params, "mention_ids"),
        )


def require_string(params: dict[str, Any], key: str) -> str:
    value = params.get(key)
    if not isinstance(value, str):
        raise ProtocolError(f"{key} must be a string")
    return value


def require_boolean(params: dict[str, Any], key: str) -> bool:
    value = params.get(key)
    if type(value) is not bool:
        raise ProtocolError(f"{key} must be a boolean")
    return value


def require_integer(params: dict[str, Any], key: str) -> int:
    value = params.get(key)
    if type(value) is not int:
        raise ProtocolError(f"{key} must be an integer")
    return value


def require_optional_positive_integer(params: dict[str, Any], key: str) -> int | None:
    value = params.get(key)
    if value is None:
        return None
    if type(value) is not int or value < 2:
        raise ProtocolError(f"{key} must be an integer of at least 2 or null")
    return value


def require_integer_list(params: dict[str, Any], key: str) -> list[int]:
    value = params.get(key)
    if not isinstance(value, list) or any(type(item) is not int for item in value):
        raise ProtocolError(f"{key} must be a list of integers")
    return value


def require_optional_integer_list(params: dict[str, Any], key: str) -> list[int]:
    if key not in params:
        return []
    return require_integer_list(params, key)


def serve(
    input_stream: TextIO,
    output_stream: TextIO,
    state: OrganizationState,
    on_shutdown: Callable[[], None] | None = None,
    model_runtime: ModelRuntime | None = None,
    history: AgentHistory | None = None,
    writer: JsonLineWriter | None = None,
    todos: AgentTodos | None = None,
    memories: AgentMemory | None = None,
    operations: OrganizationOperations | None = None,
) -> None:
    dispatcher = Dispatcher(
        state,
        on_shutdown,
        model_runtime,
        history,
        todos,
        memories,
        operations,
    )
    protocol_writer = writer or JsonLineWriter(output_stream)
    for line in input_stream:
        try:
            request = json.loads(line)
        except json.JSONDecodeError as error:
            log_event(
                "protocol.input.invalid_json",
                level=logging.WARNING,
                line_length=len(line),
            )
            response = {
                "id": None,
                "error": {"code": "invalid_json", "message": str(error)},
            }
        else:
            response = dispatcher.dispatch(request)

        protocol_writer.write(response)
        if dispatcher.shutdown_requested:
            return
