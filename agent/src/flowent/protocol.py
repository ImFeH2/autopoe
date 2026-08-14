from __future__ import annotations

import json
import sqlite3
import sys
from collections.abc import Callable
from typing import Any, TextIO

from flowent.domain import DomainError, OrganizationState
from flowent.model_runner import ModelRuntime


class ProtocolError(Exception):
    pass


class Dispatcher:
    def __init__(
        self,
        state: OrganizationState,
        on_shutdown: Callable[[], None] | None = None,
        model_runtime: ModelRuntime | None = None,
    ) -> None:
        self._state = state
        self._on_shutdown = on_shutdown
        self._model_runtime = model_runtime or ModelRuntime()
        self.shutdown_requested = False
        self._handlers: dict[str, Callable[[dict[str, Any]], dict[str, Any]]] = {
            "organization.get": lambda _params: self._state.snapshot(),
            "organization.create_agent": self._create_agent,
            "organization.retry_agent": self._retry_agent,
            "discussion.create": self._create_discussion,
            "discussion.send": self._send_message,
            "settings.get_model": self._get_model_settings,
            "settings.update_model": self._update_model_settings,
            "settings.get_observability": self._get_observability_settings,
            "settings.update_observability": self._update_observability_settings,
            "system.shutdown": self._shutdown,
        }

    def dispatch(self, request: Any) -> dict[str, Any]:
        request_id: Any = request.get("id") if isinstance(request, dict) else None
        try:
            if not isinstance(request, dict):
                raise ProtocolError("Request must be an object")
            if type(request_id) is not int or request_id < 1:
                raise ProtocolError("Request id must be a positive integer")

            method = request.get("method")
            if not isinstance(method, str):
                raise ProtocolError("Request method must be a string")

            params = request.get("params", {})
            if not isinstance(params, dict):
                raise ProtocolError("Request params must be an object")

            handler = self._handlers.get(method)
            if handler is None:
                raise DomainError("method_not_found", f"Unknown method: {method}")

            return {"id": request_id, "result": handler(params)}
        except DomainError as error:
            return {
                "id": request_id,
                "error": {"code": error.code, "message": error.message},
            }
        except (KeyError, TypeError, ValueError, ProtocolError) as error:
            return {
                "id": request_id,
                "error": {"code": "invalid_request", "message": str(error)},
            }
        except (OSError, RuntimeError, sqlite3.Error) as error:
            print(
                f"[Protocol] Request failed: {type(error).__name__}",
                file=sys.stderr,
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
            provider=require_string(params, "provider"),
            base_url=require_string(params, "base_url"),
            api_key=require_string(params, "api_key"),
            model=require_string(params, "model"),
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

    def _retry_agent(self, params: dict[str, Any]) -> dict[str, Any]:
        return self._state.retry_agent(agent_id=require_integer(params, "agent_id"))

    def _create_discussion(self, params: dict[str, Any]) -> dict[str, Any]:
        return self._state.create_discussion(
            topic=require_string(params, "topic"),
            creator_id=require_integer(params, "creator_id"),
            member_ids=require_integer_list(params, "member_ids"),
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
) -> None:
    dispatcher = Dispatcher(state, on_shutdown, model_runtime)
    for line in input_stream:
        try:
            request = json.loads(line)
        except json.JSONDecodeError as error:
            response = {
                "id": None,
                "error": {"code": "invalid_json", "message": str(error)},
            }
        else:
            response = dispatcher.dispatch(request)

        output_stream.write(json.dumps(response, separators=(",", ":")) + "\n")
        output_stream.flush()
        if dispatcher.shutdown_requested:
            return
