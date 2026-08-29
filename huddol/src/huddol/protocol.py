from __future__ import annotations

import json
import logging
import sqlite3
import time
from collections.abc import Callable
from threading import Lock
from typing import Any, TextIO

from huddol.diagnostics import log_event, log_exception
from huddol.domain import DomainError, OrganizationState
from huddol.history import AgentHistory
from huddol.memory import AgentMemory
from huddol.model_runner import ModelRuntime
from huddol.operations import ActorContext, OrganizationOperations
from huddol.todos import AgentTodos
from huddol.wsl_host_tools import ExecutionSettings


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
        execution_settings: ExecutionSettings | None = None,
    ) -> None:
        self._state = state
        self._on_shutdown = on_shutdown
        self._model_runtime = model_runtime or ModelRuntime()
        self._history = history
        self._todos = todos
        self._memories = memories
        self._operations = operations
        self._actor = ActorContext.current_human(state)
        self._execution_settings = execution_settings or ExecutionSettings(
            "native", "native", None
        )
        self.shutdown_requested = False
        self._handlers: dict[str, Callable[[dict[str, Any]], dict[str, Any]]] = {
            "organization.get": lambda _params: self._state.summary(),
            "organization.permissions.get": self._get_permissions,
            "organization.management_metadata.get": self._get_management_metadata,
            "organization.audit.get": self._get_audit,
            "organization.create_agent": self._create_agent,
            "organization.grant_admin": self._grant_admin,
            "organization.revoke_admin": self._revoke_admin,
            "organization.rename_member": self._rename_member,
            "organization.delete_agent": self._delete_agent,
            "organization.pause_agent": self._pause_agent,
            "organization.resume_agent": self._resume_agent,
            "agent.history.get": self._get_agent_history,
            "agent.history.runs.page": self._get_agent_history_runs_page,
            "agent.history.run.get": self._get_agent_history_run,
            "agent.history.entry.get": self._get_agent_history_entry,
            "agent.memory.list": self._list_agent_memory,
            "agent.memory.read": self._read_agent_memory,
            "agent.todo.list": self._list_agent_todos,
            "agent.todo.read": self._read_agent_todo,
            "discussion.create": self._create_discussion,
            "discussion.members.update": self._update_discussion_members,
            "discussion.delete": self._delete_discussion,
            "discussion.send": self._send_message,
            "human.discussion.messages.page": self._get_human_discussion_messages_page,
            "human.discussion.see_messages": self._see_human_messages,
            "human.discussion.mark_all_read": self._mark_all_human_messages_read,
            "human.mention.read": self._read_human_mention,
            "human.mention.ack": self._ack_human_mention,
            "settings.get_execution": self._get_execution_settings,
            "settings.update_execution": self._update_execution_settings,
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
            if diagnostic_method
            in (
                "organization.get",
                "agent.history.get",
                "agent.memory.list",
                "agent.memory.read",
                "agent.todo.list",
                "agent.todo.read",
            )
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
            if diagnostic_method == "system.shutdown" and not params:
                log_event(
                    "protocol.shutdown.requested",
                    request_id=diagnostic_request_id,
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

    def _get_execution_settings(self, params: dict[str, Any]) -> dict[str, Any]:
        if params:
            raise ProtocolError("settings.get_execution does not accept params")
        return self._execution_settings.settings()

    def _update_execution_settings(self, params: dict[str, Any]) -> dict[str, Any]:
        return self._execution_settings.configure(
            require_string(params, "backend"),
            require_string_list(params, "write_directories"),
        )

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

    def _require_operations(self) -> OrganizationOperations:
        if self._operations is None:
            raise RuntimeError("Organization operations are unavailable")
        return self._operations

    @staticmethod
    def _reject_actor_fields(params: dict[str, Any], *fields: str) -> None:
        present = [field for field in fields if field in params]
        if present:
            raise ProtocolError(
                f"Trusted actor fields are not accepted: {', '.join(present)}"
            )

    def _get_permissions(self, params: dict[str, Any]) -> dict[str, Any]:
        self._reject_actor_fields(params, "actor_id", "actor_type", "human_id")
        if params:
            raise ProtocolError("organization.permissions.get does not accept params")
        return self._require_operations().permissions(self._actor)

    def _get_management_metadata(self, params: dict[str, Any]) -> dict[str, Any]:
        self._reject_actor_fields(params, "actor_id", "actor_type", "human_id")
        if params:
            raise ProtocolError(
                "organization.management_metadata.get does not accept params"
            )
        return self._require_operations().metadata(self._actor)

    def _get_audit(self, params: dict[str, Any]) -> dict[str, Any]:
        self._reject_actor_fields(params, "actor_id", "actor_type", "human_id")
        if params:
            raise ProtocolError("organization.audit.get does not accept params")
        return self._require_operations().audit(self._actor)

    def _create_agent(self, params: dict[str, Any]) -> dict[str, Any]:
        self._reject_actor_fields(params, "actor_id", "actor_type", "creator_id")
        return self._require_operations().create_agent(
            self._actor,
            require_integer(params, "expected_revision"),
            require_string(params, "name"),
        )

    def _rename_member(self, params: dict[str, Any]) -> dict[str, Any]:
        self._state.rename_member(
            member_id=require_integer(params, "member_id"),
            new_name=require_string(params, "name"),
        )
        return self._state.summary()

    def _delete_agent(self, params: dict[str, Any]) -> dict[str, Any]:
        self._reject_actor_fields(params, "actor_id", "actor_type")
        return self._require_operations().delete_agent(
            self._actor,
            require_integer(params, "expected_revision"),
            require_integer(params, "agent_id"),
        )

    def _pause_agent(self, params: dict[str, Any]) -> dict[str, Any]:
        self._reject_actor_fields(params, "actor_id", "actor_type")
        return self._require_operations().pause_agent(
            self._actor,
            require_integer(params, "expected_revision"),
            require_integer(params, "agent_id"),
        )

    def _resume_agent(self, params: dict[str, Any]) -> dict[str, Any]:
        self._reject_actor_fields(params, "actor_id", "actor_type")
        return self._require_operations().resume_agent(
            self._actor,
            require_integer(params, "expected_revision"),
            require_integer(params, "agent_id"),
        )

    def _grant_admin(self, params: dict[str, Any]) -> dict[str, Any]:
        self._reject_actor_fields(params, "actor_id", "actor_type")
        return self._require_operations().grant_admin(
            self._actor,
            require_integer(params, "expected_revision"),
            require_integer(params, "agent_id"),
        )

    def _revoke_admin(self, params: dict[str, Any]) -> dict[str, Any]:
        self._reject_actor_fields(params, "actor_id", "actor_type")
        return self._require_operations().revoke_admin(
            self._actor,
            require_integer(params, "expected_revision"),
            require_integer(params, "agent_id"),
        )

    def _get_agent_history(self, params: dict[str, Any]) -> dict[str, Any]:
        agent_id = require_integer(params, "agent_id")
        member = self._state.member(agent_id)
        if member["type"] != "agent":
            raise DomainError("not_an_agent", "Member is not an Agent")
        if self._history is None:
            raise RuntimeError("Agent history is unavailable")
        return self._history.snapshot(agent_id)

    def _get_agent_history_runs_page(self, params: dict[str, Any]) -> dict[str, Any]:
        agent_id = require_integer(params, "agent_id")
        self._require_agent(agent_id)
        if self._history is None:
            raise RuntimeError("Agent history is unavailable")
        return self._history.runs_page(
            agent_id,
            before_sequence=require_optional_integer(
                params, "before_sequence", minimum=1
            ),
            limit=require_optional_integer(params, "limit", minimum=1) or 30,
        )

    def _get_agent_history_run(self, params: dict[str, Any]) -> dict[str, Any]:
        agent_id = require_integer(params, "agent_id")
        self._require_agent(agent_id)
        if self._history is None:
            raise RuntimeError("Agent history is unavailable")
        return self._history.run_detail(agent_id, require_string(params, "run_id"))

    def _get_agent_history_entry(self, params: dict[str, Any]) -> dict[str, Any]:
        agent_id = require_integer(params, "agent_id")
        self._require_agent(agent_id)
        if self._history is None:
            raise RuntimeError("Agent history is unavailable")
        return self._history.entry_detail(
            agent_id,
            require_string(params, "run_id"),
            require_string(params, "entry_id"),
            offset=require_optional_integer(params, "offset", minimum=0) or 0,
            max_chars=require_optional_integer(params, "max_chars", minimum=1) or 8_000,
        )

    def _require_agent(self, agent_id: int) -> None:
        member = self._state.member(agent_id)
        if member["type"] != "agent":
            raise DomainError("not_an_agent", "Member is not an Agent")

    def _list_agent_memory(self, params: dict[str, Any]) -> dict[str, Any]:
        agent_id = require_integer(params, "agent_id")
        self._require_agent(agent_id)
        if self._memories is None:
            raise RuntimeError("Agent Memory is unavailable")
        return self._memories.list_page(
            agent_id,
            offset=require_optional_integer(params, "offset", minimum=0) or 0,
            limit=require_optional_integer(params, "limit", minimum=1) or 100,
        )

    def _read_agent_memory(self, params: dict[str, Any]) -> dict[str, Any]:
        agent_id = require_integer(params, "agent_id")
        self._require_agent(agent_id)
        if self._memories is None:
            raise RuntimeError("Agent Memory is unavailable")
        return self._memories.read_for_human(
            agent_id,
            path=require_string(params, "path"),
            offset=require_optional_integer(params, "offset", minimum=1) or 1,
            limit=require_optional_integer(params, "limit", minimum=1) or 200,
        )

    def _list_agent_todos(self, params: dict[str, Any]) -> dict[str, Any]:
        agent_id = require_integer(params, "agent_id")
        self._require_agent(agent_id)
        if self._todos is None:
            raise RuntimeError("Agent Todos are unavailable")
        status = require_string(params, "status")
        return self._todos.list_page(
            agent_id,
            status=status,  # type: ignore[arg-type]
            limit=require_optional_integer(params, "limit", minimum=1) or 50,
            cursor=require_optional_integer(params, "cursor", minimum=1),
        )

    def _read_agent_todo(self, params: dict[str, Any]) -> dict[str, Any]:
        agent_id = require_integer(params, "agent_id")
        self._require_agent(agent_id)
        if self._todos is None:
            raise RuntimeError("Agent Todos are unavailable")
        return self._todos.read(agent_id, require_integer(params, "todo_id"))

    def _create_discussion(self, params: dict[str, Any]) -> dict[str, Any]:
        self._reject_actor_fields(params, "actor_id", "actor_type", "creator_id")
        return self._require_operations().create_discussion(
            self._actor,
            require_integer(params, "expected_revision"),
            require_string(params, "topic"),
            require_integer_list(params, "member_ids"),
        )

    def _update_discussion_members(self, params: dict[str, Any]) -> dict[str, Any]:
        self._reject_actor_fields(params, "actor_id", "actor_type")
        return self._require_operations().update_discussion_members(
            self._actor,
            require_integer(params, "expected_revision"),
            require_integer(params, "discussion_id"),
            require_integer_list(params, "member_ids"),
        )

    def _delete_discussion(self, params: dict[str, Any]) -> dict[str, Any]:
        self._reject_actor_fields(params, "actor_id", "actor_type")
        return self._require_operations().delete_discussion(
            self._actor,
            require_integer(params, "expected_revision"),
            require_integer(params, "discussion_id"),
            require_string(params, "confirm_topic"),
        )

    def _send_message(self, params: dict[str, Any]) -> dict[str, Any]:
        self._reject_actor_fields(params, "actor_id", "actor_type", "sender_id")
        discussion_id = require_integer(params, "discussion_id")
        return self._require_operations().require_discussion_content(
            self._actor,
            discussion_id,
            lambda: (
                self._state.send_message(
                    discussion_id=discussion_id,
                    sender_id=self._actor.member_id,
                    body=require_string(params, "body"),
                ),
                self._state.summary(),
            )[1],
        )

    def _get_human_discussion_messages_page(
        self, params: dict[str, Any]
    ) -> dict[str, Any]:
        self._reject_actor_fields(params, "actor_id", "actor_type", "human_id")
        discussion_id = require_integer(params, "discussion_id")
        return self._require_operations().require_discussion_content(
            self._actor,
            discussion_id,
            lambda: self._state.human_discussion_messages_page(
                human_id=self._actor.member_id,
                discussion_id=discussion_id,
                limit=require_optional_integer(params, "limit", minimum=1) or 50,
                before_message_id=require_optional_integer(
                    params, "before_message_id", minimum=1
                ),
                after_message_id=require_optional_integer(
                    params, "after_message_id", minimum=1
                ),
                anchor_message_id=require_optional_integer(
                    params, "anchor_message_id", minimum=1
                ),
            ),
        )

    def _see_human_messages(self, params: dict[str, Any]) -> dict[str, Any]:
        self._reject_actor_fields(params, "actor_id", "actor_type", "human_id")
        discussion_id = require_integer(params, "discussion_id")
        return self._require_operations().require_discussion_content(
            self._actor,
            discussion_id,
            lambda: (
                self._state.see_human_messages(
                    human_id=self._actor.member_id,
                    discussion_id=discussion_id,
                    message_ids=require_integer_list(params, "message_ids"),
                ),
                self._state.summary(),
            )[1],
        )

    def _mark_all_human_messages_read(self, params: dict[str, Any]) -> dict[str, Any]:
        self._reject_actor_fields(params, "actor_id", "actor_type", "human_id")
        discussion_id = require_integer(params, "discussion_id")
        return self._require_operations().require_discussion_content(
            self._actor,
            discussion_id,
            lambda: self._state.mark_all_human_messages_read(
                human_id=self._actor.member_id,
                discussion_id=discussion_id,
                through_message_id=require_integer(params, "through_message_id"),
            ),
        )

    def _read_human_mention(self, params: dict[str, Any]) -> dict[str, Any]:
        self._reject_actor_fields(params, "actor_id", "actor_type", "member_id")
        discussion_id = require_integer(params, "discussion_id")
        return self._require_operations().require_discussion_content(
            self._actor,
            discussion_id,
            lambda: (
                self._state.read_human_mention(
                    member_id=self._actor.member_id,
                    discussion_id=discussion_id,
                    message_id=require_integer(params, "message_id"),
                ),
                self._state.summary(),
            )[1],
        )

    def _ack_human_mention(self, params: dict[str, Any]) -> dict[str, Any]:
        self._reject_actor_fields(params, "actor_id", "actor_type", "human_id")
        discussion_id = require_integer(params, "discussion_id")
        return self._require_operations().require_discussion_content(
            self._actor,
            discussion_id,
            lambda: self._state.ack_human_mention(
                human_id=self._actor.member_id,
                discussion_id=discussion_id,
                message_id=require_integer(params, "message_id"),
            ),
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


def require_optional_integer(
    params: dict[str, Any], key: str, *, minimum: int
) -> int | None:
    value = params.get(key)
    if value is None:
        return None
    if type(value) is not int or value < minimum:
        raise ProtocolError(f"{key} must be an integer of at least {minimum} or null")
    return value


def require_optional_positive_integer(params: dict[str, Any], key: str) -> int | None:
    value = params.get(key)
    if value is None:
        return None
    if type(value) is not int or value < 2:
        raise ProtocolError(f"{key} must be an integer of at least 2 or null")
    return value


def require_string_list(params: dict[str, Any], key: str) -> list[str]:
    value = params.get(key)
    if not isinstance(value, list) or any(not isinstance(item, str) for item in value):
        raise ProtocolError(f"{key} must be a list of strings")
    return value


def require_integer_list(params: dict[str, Any], key: str) -> list[int]:
    value = params.get(key)
    if not isinstance(value, list) or any(type(item) is not int for item in value):
        raise ProtocolError(f"{key} must be a list of integers")
    return value


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
    execution_settings: ExecutionSettings | None = None,
) -> str:
    dispatcher = Dispatcher(
        state,
        on_shutdown,
        model_runtime,
        history,
        todos,
        memories,
        operations,
        execution_settings,
    )
    protocol_writer = writer or JsonLineWriter(output_stream)
    input_line_count = 0
    parsed_request_count = 0
    invalid_json_count = 0
    for line in input_stream:
        input_line_count += 1
        try:
            request = json.loads(line)
        except json.JSONDecodeError as error:
            invalid_json_count += 1
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
            parsed_request_count += 1
            response = dispatcher.dispatch(request)

        protocol_writer.write(response)
        if dispatcher.shutdown_requested:
            log_event(
                "protocol.serve.stopped",
                reason="system_shutdown",
                input_line_count=input_line_count,
                parsed_request_count=parsed_request_count,
                invalid_json_count=invalid_json_count,
            )
            return "system_shutdown"
    log_event(
        "protocol.serve.stopped",
        level=logging.WARNING,
        reason="stdin_eof",
        input_line_count=input_line_count,
        parsed_request_count=parsed_request_count,
        invalid_json_count=invalid_json_count,
    )
    return "stdin_eof"
