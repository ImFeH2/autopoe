from __future__ import annotations

import json
from collections.abc import Callable
from typing import Any, TextIO

from flowent.domain import DomainError, OrganizationState


class ProtocolError(Exception):
    pass


class Dispatcher:
    def __init__(
        self,
        state: OrganizationState,
        on_shutdown: Callable[[], None] | None = None,
    ) -> None:
        self._state = state
        self._on_shutdown = on_shutdown
        self.shutdown_requested = False
        self._handlers: dict[str, Callable[[dict[str, Any]], dict[str, Any]]] = {
            "organization.get": lambda _params: self._state.snapshot(),
            "organization.create_agent": self._create_agent,
            "discussion.create": self._create_discussion,
            "discussion.send": self._send_message,
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

    def _shutdown(self, params: dict[str, Any]) -> dict[str, Any]:
        if params:
            raise ProtocolError("system.shutdown does not accept params")
        self.shutdown_requested = True
        if self._on_shutdown is not None:
            self._on_shutdown()
        return {"stopped": True}

    def _create_agent(self, params: dict[str, Any]) -> dict[str, Any]:
        return self._state.create_agent(name=require_string(params, "name"))

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
) -> None:
    dispatcher = Dispatcher(state, on_shutdown)
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
