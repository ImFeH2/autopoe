from __future__ import annotations

import json
import threading
import time as _time
import traceback
import uuid as _uuid
from collections.abc import Callable
from dataclasses import dataclass, field
from functools import lru_cache, partial
from queue import Empty, Queue
from typing import Any
from urllib.parse import urlparse

from loguru import logger

from flowent.assistant_commands import build_conversation_help_text
from flowent.events import event_bus
from flowent.image_assets import create_image_asset, require_image_asset
from flowent.models import (
    AgentState,
    AssistantText,
    AssistantThinking,
    CommandResultEntry,
    ContentDelta,
    ErrorEntry,
    Event,
    EventType,
    HistoryEntry,
    ImagePart,
    LLMOutputImagePart,
    LLMOutputTextPart,
    LLMResponse,
    LLMUsage,
    Message,
    ModelInfo,
    NodeConfig,
    NodeType,
    ReceivedMessage,
    SentMessage,
    StateEntry,
    SystemEntry,
    TextPart,
    ThinkingDelta,
    TodoItem,
    ToolCall,
    ToolResultDelta,
    WorkflowActivationState,
    content_parts_to_text,
    deserialize_content_parts,
    has_image_parts,
    parse_content_parts_payload,
)
from flowent.prompts import get_system_prompt
from flowent.providers.errors import LLMProviderError
from flowent.providers.gateway import gateway
from flowent.providers.thinking import ThinkTagParser, split_thinking_content
from flowent.security import authorize
from flowent.settings import get_settings


@lru_cache(maxsize=1)
def _get_tool_registry() -> Any:
    from flowent.tools import build_tool_registry

    return build_tool_registry()


@dataclass
class WakeSignal:
    reason: str
    payload: dict[str, Any]
    resume_reason: str = ""


@dataclass
class StreamingContentState:
    content_buffer: str = ""
    thinking_buffer: str = ""
    saw_content_chunks: bool = False
    think_parser: ThinkTagParser = field(default_factory=ThinkTagParser)
    emitted_human_content: bool = False


@dataclass(frozen=True)
class ContextPreflight:
    estimated_total_tokens: int
    context_window_tokens: int | None = None
    auto_compact_token_limit: int | None = None
    safe_input_tokens: int | None = None


class InterruptRequestedError(Exception):
    def __init__(self, stream_state: StreamingContentState | None = None) -> None:
        super().__init__("interrupt requested")
        self.stream_state = stream_state


class ContextPreflightError(RuntimeError):
    pass


DEFAULT_CONTEXT_OUTPUT_BUDGET_TOKENS = 1024
DEFAULT_CONTEXT_PROVIDER_HEADROOM_TOKENS = 1024


@dataclass(frozen=True)
class PreparedLLMContext:
    messages: list[dict[str, Any]]
    system_messages: list[dict[str, Any]]
    execution_context_messages: list[dict[str, Any]]
    runtime_tail_messages: list[dict[str, Any]]


@dataclass(frozen=True)
class ContextTokenUsageBaseline:
    usage: LLMUsage
    system_messages: list[dict[str, Any]]
    execution_context_messages: list[dict[str, Any]]
    runtime_tail_messages: list[dict[str, Any]]


@dataclass(frozen=True)
class ResolvedModelSource:
    provider_id: str | None
    provider_name: str | None
    provider_type: str | None
    provider_base_url: str | None
    model: str | None
    model_info: ModelInfo | None


def build_error_context(content: str) -> str:
    return f"<system>Previous runtime error:\n{content}</system>"


class Agent:
    def __init__(
        self,
        config: NodeConfig,
        uuid: str | None = None,
    ) -> None:
        self.uuid = uuid or str(_uuid.uuid4())
        self.config = config
        self.node_type = config.node_type
        self.role_name = config.role_name
        self.state = AgentState.INITIALIZING
        self.todos: list[TodoItem] = []
        self.connections: list[str] = []
        self.history: list[HistoryEntry] = []
        self.history.append(StateEntry(state=self.state.value, reason="created"))
        self._terminate = threading.Event()
        self._interrupt_requested = threading.Event()
        self._interrupt_callback_lock = threading.Lock()
        self._interrupt_callback: Callable[[], None] | None = None
        self._command_interrupt_lock = threading.Lock()
        self._pause_after_interrupt_requested = threading.Event()
        self._paused_for_command = threading.Event()
        self._resume_after_command = threading.Event()
        self._idle_state_event = threading.Event()
        self._idle_started_at: float | None = None
        self._idle_started_by_tool_call_id: str | None = None
        self._wake_queue: Queue[WakeSignal] = Queue()
        self._thread: threading.Thread | None = None
        self._termination_reason: str = ""
        self._preserve_workspace_state_on_exit = False
        self._connections_lock = threading.Lock()
        self._history_lock = threading.Lock()
        self._todos_lock = threading.Lock()
        self._runtime_notice_lock = threading.Lock()
        self._execution_context_lock = threading.Lock()
        self._execution_context_summary: str = ""
        self._execution_context_history_cutoff: int = 0
        self._context_token_usage_baseline: ContextTokenUsageBaseline | None = None
        self._pending_runtime_notices: list[str] = []
        self._pending_input_turn = False
        self._turn_started_with_pending_input = False
        self._turn_made_progress = False
        self._log = logger.bind(
            agent_id=self.uuid[:8], node_type=self.config.node_type.value
        )

    def _persist_workspace_node(self) -> None:
        if self.node_type != NodeType.ASSISTANT and not self.config.tab_id:
            return
        from flowent.models import GraphNodeRecord
        from flowent.workspace_store import workspace_store

        existing = workspace_store.get_node_record(self.uuid)
        record = GraphNodeRecord(
            id=self.uuid,
            config=self.config,
            state=self.state,
            todos=self.get_todos_snapshot(),
            history=self.get_history_snapshot(),
            execution_context_summary=self.get_execution_context_summary(),
            execution_context_history_cutoff=self.get_execution_context_history_cutoff(),
            position=existing.position if existing is not None else None,
            created_at=existing.created_at if existing is not None else _time.time(),
            updated_at=_time.time(),
        )
        workspace_store.upsert_node_record(record)

    def add_connection(self, other_uuid: str) -> None:
        with self._connections_lock:
            if other_uuid not in self.connections:
                self.connections.append(other_uuid)

    def remove_connection(self, other_uuid: str) -> None:
        with self._connections_lock:
            if other_uuid in self.connections:
                self.connections.remove(other_uuid)

    def is_connected_to(self, uuid: str) -> bool:
        with self._connections_lock:
            return uuid in self.connections

    def get_connections_snapshot(self) -> list[str]:
        with self._connections_lock:
            return list(self.connections)

    def get_history_snapshot(self) -> list[HistoryEntry]:
        with self._history_lock:
            return list(self.history)

    def get_todos_snapshot(self) -> list[TodoItem]:
        with self._todos_lock:
            return [TodoItem(text=t.text) for t in self.todos]

    def get_execution_context_summary(self) -> str:
        with self._execution_context_lock:
            return self._execution_context_summary

    def get_execution_context_history_cutoff(self) -> int:
        with self._execution_context_lock:
            return self._execution_context_history_cutoff

    def _set_execution_context(
        self,
        *,
        summary: str,
        history_cutoff: int,
    ) -> None:
        with self._execution_context_lock:
            self._execution_context_summary = summary
            self._execution_context_history_cutoff = max(history_cutoff, 0)
            self._context_token_usage_baseline = None

    def _reset_execution_context(self) -> None:
        self._set_execution_context(summary="", history_cutoff=0)

    def prime_runtime_state(self, state: AgentState) -> None:
        self.state = state
        if state == AgentState.IDLE:
            self._idle_started_at = _time.perf_counter()
            self._idle_state_event.set()
        else:
            self._idle_started_at = None
            self._idle_started_by_tool_call_id = None
            self._idle_state_event.clear()

    def set_todos(self, todos: list[TodoItem]) -> None:
        with self._todos_lock:
            self.todos = [TodoItem(text=t.text) for t in todos]
        self._persist_workspace_node()

    def request_idle(self, *, tool_call_id: str | None = None) -> str:
        if self._has_pending_runtime_notices():
            self._log.debug("Skipping idle because runtime notice is pending")
            return ""
        if (
            self.node_type == NodeType.ASSISTANT
            and self._turn_started_with_pending_input
            and not self._turn_made_progress
        ):
            self._queue_runtime_notice(self._build_idle_without_progress_notice())
            self._log.debug("Skipping idle because fresh input is still unhandled")
            return ""
        actionable_todo = self._get_first_actionable_todo()
        if actionable_todo is not None:
            self._queue_runtime_notice(
                self._build_actionable_todo_notice(actionable_todo)
            )
            self._log.debug("Skipping idle because TODO is still actionable")
            return ""
        self._idle_started_by_tool_call_id = tool_call_id
        self.set_state(AgentState.IDLE)
        signal = self._wait_for_wakeup()
        elapsed = self._get_idle_elapsed_seconds(tool_call_id=tool_call_id)
        self._resume_from_wakeup(signal)
        return f"idle {elapsed:.2f}s"

    def request_sleep(self, *, seconds: float) -> str:
        duration = max(0.0, seconds)
        started_at = _time.perf_counter()
        if duration <= 0:
            self._queue_runtime_notice(self._build_sleep_deadline_notice())
            return "slept 0.00s"

        self.set_state(AgentState.SLEEPING, f"sleeping for {duration:.2f}s")
        while not self._terminate.is_set():
            self._raise_if_interrupt_requested()
            remaining = duration - (_time.perf_counter() - started_at)
            if remaining <= 0:
                self._queue_runtime_notice(self._build_sleep_deadline_notice())
                self.set_state(AgentState.RUNNING, "sleep deadline reached")
                break
            try:
                signal = self._wake_queue.get(timeout=min(remaining, 0.1))
            except Empty:
                continue
            if signal.reason == "termination":
                self._terminate.set()
                break
            if signal.reason == "message":
                self._resume_from_wakeup(signal)
                self._drain_messages()
                elapsed = max(0.0, _time.perf_counter() - started_at)
                return f"woken by message after {elapsed:.2f}s"
        elapsed = min(duration, max(0.0, _time.perf_counter() - started_at))
        return f"slept {elapsed:.2f}s"

    def _get_idle_elapsed_seconds(self, *, tool_call_id: str | None) -> float:
        started_at = self._idle_started_at
        if started_at is None:
            return 0.0
        if tool_call_id is not None and self._idle_started_by_tool_call_id not in {
            None,
            tool_call_id,
        }:
            return 0.0
        return max(0.0, _time.perf_counter() - started_at)

    def get_contact_ids_snapshot(self) -> list[str]:
        from flowent.graph_service import get_tab_leader_id
        from flowent.registry import registry
        from flowent.workspace_store import workspace_store

        if self.node_type == NodeType.ASSISTANT:
            return [
                leader_id
                for leader_id in (
                    get_tab_leader_id(tab.id) for tab in workspace_store.list_tabs()
                )
                if leader_id and registry.get(leader_id) is not None
            ]

        seen_ids: set[str] = set()
        contact_ids: list[str] = []

        def append_contact(node_id: str) -> None:
            if node_id == self.uuid or node_id in seen_ids:
                return
            if registry.get(node_id) is None:
                return
            seen_ids.add(node_id)
            contact_ids.append(node_id)

        if self.config.tab_id is None:
            return contact_ids

        leader_id = get_tab_leader_id(self.config.tab_id)
        is_leader = leader_id == self.uuid
        assistant = registry.get_assistant()
        if is_leader and assistant is not None:
            append_contact(assistant.uuid)
        if not is_leader and leader_id is not None:
            append_contact(leader_id)

        if is_leader:
            for node in registry.get_all():
                if node.uuid == self.uuid or node.node_type != NodeType.AGENT:
                    continue
                if node.config.tab_id != self.config.tab_id:
                    continue
                if node.uuid == leader_id:
                    continue
                append_contact(node.uuid)
            return contact_ids

        return contact_ids

    def get_contacts_info(self) -> list[dict[str, Any]]:
        from flowent.graph_service import is_tab_leader
        from flowent.registry import registry

        result: list[dict[str, Any]] = []
        for contact_id in self.get_contact_ids_snapshot():
            node = registry.get(contact_id)
            if node is None:
                continue
            result.append(
                {
                    "id": node.uuid,
                    "node_type": node.config.node_type.value,
                    "role_name": node.config.role_name,
                    "name": node.config.name,
                    "state": node.state.value,
                    "is_leader": (
                        node.config.tab_id is not None
                        and is_tab_leader(node_id=node.uuid, tab_id=node.config.tab_id)
                    ),
                }
            )
        return result

    def can_contact(self, node_id: str) -> bool:
        return node_id in set(self.get_contact_ids_snapshot())

    def wait_until_idle(self, timeout: float | None = None) -> bool:
        if self.state == AgentState.IDLE:
            return True
        return self._idle_state_event.wait(timeout=timeout)

    def start(self) -> None:
        from flowent.graph_service import is_tab_leader

        self._thread = threading.Thread(
            target=self._run,
            name=f"agent-{self.uuid[:8]}",
            daemon=True,
        )
        self._thread.start()
        event_bus.emit(
            Event(
                type=EventType.NODE_CREATED,
                agent_id=self.uuid,
                data={
                    "node_type": self.config.node_type.value,
                    "role_name": self.config.role_name,
                    "name": self.config.name,
                    "tab_id": self.config.tab_id,
                    "is_leader": is_tab_leader(
                        node_id=self.uuid,
                        tab_id=self.config.tab_id,
                    ),
                },
            ),
        )
        self._persist_workspace_node()

    def _append_history(self, entry: HistoryEntry) -> None:
        with self._history_lock:
            self.history.append(entry)
            if isinstance(entry, ReceivedMessage):
                self._pending_input_turn = True
        data = entry.serialize()
        self._log.debug(
            "History append: type={}, content_len={}",
            data.get("type"),
            len(getattr(entry, "content", None) or "")
            if hasattr(entry, "content")
            else 0,
        )
        event_bus.emit(
            Event(
                type=EventType.HISTORY_ENTRY_ADDED,
                agent_id=self.uuid,
                data=data,
            ),
        )
        self._persist_workspace_node()

    def _clear_pending_message_wakeups(self) -> None:
        preserved_signals: list[WakeSignal] = []

        while True:
            try:
                signal = self._wake_queue.get_nowait()
            except Empty:
                break

            if signal.reason != "message":
                preserved_signals.append(signal)

        for signal in preserved_signals:
            self._wake_queue.put(signal)

    def _extract_pending_message_wakeups(self) -> list[WakeSignal]:
        extracted_signals: list[WakeSignal] = []
        preserved_signals: list[WakeSignal] = []

        while True:
            try:
                signal = self._wake_queue.get_nowait()
            except Empty:
                break

            if signal.reason == "message":
                extracted_signals.append(signal)
                continue
            preserved_signals.append(signal)

        for signal in preserved_signals:
            self._wake_queue.put(signal)

        return extracted_signals

    def _restore_pending_message_wakeups(
        self,
        signals: list[WakeSignal],
    ) -> None:
        for signal in signals:
            self._wake_queue.put(signal)

    def _pause_for_command_execution(self, *, timeout: float) -> bool:
        if self.state not in {AgentState.RUNNING, AgentState.SLEEPING}:
            return False
        if not self._command_interrupt_lock.acquire(timeout=timeout):
            raise TimeoutError("Current chat did not pause for the command in time")

        self._pause_after_interrupt_requested.set()
        self._paused_for_command.clear()
        self._resume_after_command.clear()

        try:
            if not self.request_interrupt():
                self._pause_after_interrupt_requested.clear()
                self._resume_after_command.set()
                self._command_interrupt_lock.release()
                return False
            if not self._paused_for_command.wait(timeout=timeout):
                raise TimeoutError("Current chat did not pause after interrupt")
            return True
        except Exception:
            self._pause_after_interrupt_requested.clear()
            self._resume_after_command.set()
            self._command_interrupt_lock.release()
            raise

    def _resume_after_command_execution(self) -> None:
        self._pause_after_interrupt_requested.clear()
        self._resume_after_command.set()
        self._command_interrupt_lock.release()

    def clear_chat_history(self, *, interrupt_timeout: float = 5.0) -> None:
        if self.node_type != NodeType.ASSISTANT:
            from flowent.graph_service import is_tab_leader

            if not is_tab_leader(node_id=self.uuid, tab_id=self.config.tab_id):
                raise RuntimeError("Only Assistant or workflow chats can be cleared")

        paused_for_command = self._pause_for_command_execution(
            timeout=interrupt_timeout
        )
        try:
            self._clear_pending_message_wakeups()
            with self._runtime_notice_lock:
                self._pending_runtime_notices.clear()
            with self._history_lock:
                self.history = [
                    entry
                    for entry in self.history
                    if isinstance(entry, (SystemEntry, StateEntry))
                ]
                self._pending_input_turn = False
                self._turn_started_with_pending_input = False
                self._turn_made_progress = False
            self._reset_execution_context()

            event_bus.emit(
                Event(
                    type=EventType.HISTORY_CLEARED,
                    agent_id=self.uuid,
                    data={
                        "scope": "assistant_chat"
                        if self.node_type == NodeType.ASSISTANT
                        else "workflow_chat"
                    },
                )
            )
            self._persist_workspace_node()
        finally:
            if paused_for_command:
                self._resume_after_command_execution()

    def retry_human_message(
        self,
        *,
        message_id: str,
        interrupt_timeout: float = 5.0,
    ) -> str:
        if self.node_type != NodeType.ASSISTANT:
            raise RuntimeError("Only assistant chat history can be retried")

        normalized_message_id = message_id.strip()
        if not normalized_message_id:
            raise ValueError("Assistant retry message_id cannot be empty")

        paused_for_command = self._pause_for_command_execution(
            timeout=interrupt_timeout
        )
        extracted_message_signals: list[WakeSignal] = []
        previous_runtime_notices: list[str] = []
        previous_history: list[HistoryEntry] = []
        previous_pending_input_turn = False
        previous_turn_started_with_pending_input = False
        previous_turn_made_progress = False
        previous_execution_summary = ""
        previous_execution_cutoff = 0
        previous_context_token_usage_baseline: ContextTokenUsageBaseline | None = None
        try:
            with self._history_lock:
                anchor_index = -1
                anchor_parts: list[TextPart | ImagePart] = []
                current_history = list(self.history)
                for index, entry in enumerate(current_history):
                    if (
                        isinstance(entry, ReceivedMessage)
                        and entry.from_id == "human"
                        and entry.message_id == normalized_message_id
                    ):
                        anchor_index = index
                        anchor_parts = list(entry.parts)
                        break

            if anchor_index < 0:
                raise LookupError(
                    f"Assistant human message `{normalized_message_id}` was not found."
                )

            if has_image_parts(anchor_parts) and not self.supports_input_image():
                raise RuntimeError(
                    "Assistant current model does not support `input_image`."
                )

            for part in anchor_parts:
                asset_id = getattr(part, "asset_id", None)
                if isinstance(asset_id, str):
                    require_image_asset(asset_id)

            extracted_message_signals = self._extract_pending_message_wakeups()
            with self._runtime_notice_lock:
                previous_runtime_notices = list(self._pending_runtime_notices)
                self._pending_runtime_notices.clear()

            with self._history_lock:
                previous_history = list(self.history)
                previous_pending_input_turn = self._pending_input_turn
                previous_turn_started_with_pending_input = (
                    self._turn_started_with_pending_input
                )
                previous_turn_made_progress = self._turn_made_progress
                self.history = [
                    entry
                    for index, entry in enumerate(previous_history)
                    if index < anchor_index
                    or isinstance(entry, (SystemEntry, StateEntry))
                ]
                retried_message_id = str(_uuid.uuid4())
                self.history.append(
                    ReceivedMessage(
                        from_id="human",
                        parts=anchor_parts,
                        message_id=retried_message_id,
                    )
                )
                self._pending_input_turn = True
                self._turn_started_with_pending_input = False
                self._turn_made_progress = False

            with self._execution_context_lock:
                previous_execution_summary = self._execution_context_summary
                previous_execution_cutoff = self._execution_context_history_cutoff
                previous_context_token_usage_baseline = (
                    self._context_token_usage_baseline
                )
            self._set_execution_context(summary="", history_cutoff=0)
            self._persist_workspace_node()
            self.enqueue_message(
                Message(
                    from_id="human",
                    to_id=self.uuid,
                    parts=anchor_parts,
                    message_id=retried_message_id,
                    history_recorded=True,
                )
            )
            history_snapshot = self.get_history_snapshot()
            event_bus.emit(
                Event(
                    type=EventType.HISTORY_REPLACED,
                    agent_id=self.uuid,
                    data={
                        "scope": "assistant_retry",
                        "replaced_message_id": normalized_message_id,
                        "message_id": retried_message_id,
                        "history": [entry.serialize() for entry in history_snapshot],
                    },
                )
            )
            return retried_message_id
        except Exception:
            if previous_history:
                with self._history_lock:
                    self.history = previous_history
                    self._pending_input_turn = previous_pending_input_turn
                    self._turn_started_with_pending_input = (
                        previous_turn_started_with_pending_input
                    )
                    self._turn_made_progress = previous_turn_made_progress
                with self._runtime_notice_lock:
                    self._pending_runtime_notices = previous_runtime_notices
                with self._execution_context_lock:
                    self._execution_context_summary = previous_execution_summary
                    self._execution_context_history_cutoff = previous_execution_cutoff
                    self._context_token_usage_baseline = (
                        previous_context_token_usage_baseline
                    )
                if extracted_message_signals:
                    self._restore_pending_message_wakeups(extracted_message_signals)
                self._persist_workspace_node()
            raise
        finally:
            if paused_for_command:
                self._resume_after_command_execution()

    def retry_received_message(
        self,
        *,
        message_id: str,
        interrupt_timeout: float = 5.0,
    ) -> str:
        normalized_message_id = message_id.strip()
        if not normalized_message_id:
            raise ValueError("Retry message_id cannot be empty")

        leader_human_only = False
        if self.node_type != NodeType.ASSISTANT and self.config.tab_id:
            from flowent.graph_service import is_tab_leader

            leader_human_only = is_tab_leader(
                node_id=self.uuid,
                tab_id=self.config.tab_id,
            )

        paused_for_command = self._pause_for_command_execution(
            timeout=interrupt_timeout
        )
        extracted_message_signals: list[WakeSignal] = []
        previous_runtime_notices: list[str] = []
        previous_history: list[HistoryEntry] = []
        previous_pending_input_turn = False
        previous_turn_started_with_pending_input = False
        previous_turn_made_progress = False
        previous_execution_summary = ""
        previous_execution_cutoff = 0
        previous_context_token_usage_baseline: ContextTokenUsageBaseline | None = None
        try:
            with self._history_lock:
                anchor_index = -1
                anchor_parts: list[TextPart | ImagePart] = []
                anchor_from_id = "human"
                current_history = list(self.history)
                for index, entry in enumerate(current_history):
                    if (
                        isinstance(entry, ReceivedMessage)
                        and entry.message_id == normalized_message_id
                        and (not leader_human_only or entry.from_id == "human")
                    ):
                        anchor_index = index
                        anchor_parts = list(entry.parts)
                        anchor_from_id = entry.from_id
                        break

            if anchor_index < 0:
                if leader_human_only:
                    raise LookupError(
                        f"Leader human message `{normalized_message_id}` was not found."
                    )
                raise LookupError(
                    f"Received message `{normalized_message_id}` was not found."
                )

            if has_image_parts(anchor_parts) and not self.supports_input_image():
                raise RuntimeError("Current model does not support `input_image`.")

            for part in anchor_parts:
                asset_id = getattr(part, "asset_id", None)
                if isinstance(asset_id, str):
                    require_image_asset(asset_id)

            extracted_message_signals = self._extract_pending_message_wakeups()
            with self._runtime_notice_lock:
                previous_runtime_notices = list(self._pending_runtime_notices)
                self._pending_runtime_notices.clear()

            with self._history_lock:
                previous_history = list(self.history)
                previous_pending_input_turn = self._pending_input_turn
                previous_turn_started_with_pending_input = (
                    self._turn_started_with_pending_input
                )
                previous_turn_made_progress = self._turn_made_progress
                self.history = [
                    entry
                    for index, entry in enumerate(previous_history)
                    if index < anchor_index
                    or isinstance(entry, (SystemEntry, StateEntry))
                ]
                retried_message_id = str(_uuid.uuid4())
                self.history.append(
                    ReceivedMessage(
                        from_id=anchor_from_id,
                        parts=anchor_parts,
                        message_id=retried_message_id,
                    )
                )
                self._pending_input_turn = True
                self._turn_started_with_pending_input = False
                self._turn_made_progress = False

            with self._execution_context_lock:
                previous_execution_summary = self._execution_context_summary
                previous_execution_cutoff = self._execution_context_history_cutoff
                previous_context_token_usage_baseline = (
                    self._context_token_usage_baseline
                )
            self._set_execution_context(summary="", history_cutoff=0)
            self._persist_workspace_node()
            self.enqueue_message(
                Message(
                    from_id=anchor_from_id,
                    to_id=self.uuid,
                    parts=anchor_parts,
                    message_id=retried_message_id,
                    history_recorded=True,
                )
            )
            history_snapshot = self.get_history_snapshot()
            event_bus.emit(
                Event(
                    type=EventType.HISTORY_REPLACED,
                    agent_id=self.uuid,
                    data={
                        "scope": "node_retry",
                        "replaced_message_id": normalized_message_id,
                        "message_id": retried_message_id,
                        "history": [entry.serialize() for entry in history_snapshot],
                    },
                )
            )
            return retried_message_id
        except Exception:
            if previous_history:
                with self._history_lock:
                    self.history = previous_history
                    self._pending_input_turn = previous_pending_input_turn
                    self._turn_started_with_pending_input = (
                        previous_turn_started_with_pending_input
                    )
                    self._turn_made_progress = previous_turn_made_progress
                with self._runtime_notice_lock:
                    self._pending_runtime_notices = previous_runtime_notices
                self._restore_pending_message_wakeups(extracted_message_signals)
                with self._execution_context_lock:
                    self._execution_context_summary = previous_execution_summary
                    self._execution_context_history_cutoff = previous_execution_cutoff
                    self._context_token_usage_baseline = (
                        previous_context_token_usage_baseline
                    )
                self._persist_workspace_node()
            raise
        finally:
            if paused_for_command:
                self._resume_after_command_execution()

    def compact_chat_history(
        self,
        *,
        focus: str | None = None,
        interrupt_timeout: float = 5.0,
    ) -> CommandResultEntry:
        if self.node_type != NodeType.ASSISTANT:
            from flowent.graph_service import is_tab_leader

            if not is_tab_leader(node_id=self.uuid, tab_id=self.config.tab_id):
                raise RuntimeError("Only Assistant or workflow chats can be compacted")

        paused_for_command = self._pause_for_command_execution(
            timeout=interrupt_timeout
        )
        try:
            self._run_compact_with_observability(
                trigger_type="manual",
                focus=focus,
            )
            content = "Compacted this chat for future replies."
            if focus and focus.strip():
                content += f"\n\nFocus: {focus.strip()}"

            with self._runtime_notice_lock:
                self._pending_runtime_notices.clear()

            return CommandResultEntry(
                command_name="/compact",
                content=content,
                include_in_context=False,
            )
        finally:
            if paused_for_command:
                self._resume_after_command_execution()

    def execute_conversation_command(
        self,
        *,
        command_name: str,
        argument: str = "",
        interrupt_timeout: float = 5.0,
    ) -> CommandResultEntry:
        append_to_history = True
        if command_name == "/clear":
            self.clear_chat_history(interrupt_timeout=interrupt_timeout)
            entry = CommandResultEntry(
                command_name=command_name,
                content="Cleared the current chat.",
                include_in_context=False,
            )
            append_to_history = False
        elif command_name == "/compact":
            entry = self.compact_chat_history(
                focus=argument or None,
                interrupt_timeout=interrupt_timeout,
            )
        elif command_name == "/help":
            entry = CommandResultEntry(
                command_name=command_name,
                content=build_conversation_help_text(),
            )
        else:
            raise RuntimeError(f"Unsupported conversation command: {command_name}")

        if append_to_history:
            self._append_history(entry)
        return entry

    def execute_assistant_command(
        self,
        *,
        command_name: str,
        argument: str = "",
        interrupt_timeout: float = 5.0,
    ) -> CommandResultEntry:
        return self.execute_conversation_command(
            command_name=command_name,
            argument=argument,
            interrupt_timeout=interrupt_timeout,
        )

    def _run(self) -> None:
        with logger.contextualize(
            agent_id=self.uuid[:8],
            node_type=self.config.node_type.value,
        ):
            with self._history_lock:
                has_system_entry = any(
                    isinstance(entry, SystemEntry) for entry in self.history
                )
            if has_system_entry:
                self._sync_system_prompt_entry()
            else:
                self._append_history(
                    SystemEntry(content=get_system_prompt(self.config))
                )

            if self.state == AgentState.INITIALIZING:
                self.set_state(AgentState.IDLE, "initialized, awaiting first message")
                self._log.info("Agent started, waiting for first message")
            else:
                self._log.info(
                    "Agent restored in state {}, waiting for input",
                    self.state.value,
                )
            self._wait_for_input()

            if self._terminate.is_set():
                if self._should_preserve_workspace_state_on_exit():
                    self._log.info(
                        "Agent stopped for process exit with state {}",
                        self.state.value,
                    )
                    return
                self._finalize_termination("terminated before first message")
                return

            while not self._terminate.is_set():
                try:
                    self._sync_system_prompt_entry()
                    self._drain_messages()
                    self._turn_started_with_pending_input = self._pending_input_turn
                    self._turn_made_progress = False

                    tools_schema = _get_tool_registry().get_tools_schema(self)
                    prepared_context = self._prepare_messages_for_llm()
                    messages = prepared_context.messages

                    self._log.debug(
                        "LLM request: messages={}, tools={}, history_len={}",
                        len(messages),
                        len(tools_schema) if tools_schema else 0,
                        len(self.history),
                    )
                    stream_state: StreamingContentState | None = None
                    try:
                        response, stream_state = self._chat_with_retries(
                            prepared_context=prepared_context,
                            tools_schema=tools_schema,
                        )
                        self._flush_streaming_think_parser(stream_state)

                        self._log.debug(
                            "LLM response: content_len={}, parts_len={}, thinking_len={}, tool_calls={}",
                            len(response.content) if response.content else 0,
                            len(response.parts) if response.parts else 0,
                            len(response.thinking) if response.thinking else 0,
                            [tc.name for tc in response.tool_calls]
                            if response.tool_calls
                            else None,
                        )

                        final_thinking = (
                            response.thinking or stream_state.thinking_buffer
                        )
                        final_content = (
                            stream_state.content_buffer
                            if stream_state.saw_content_chunks
                            else response.content
                        )
                        final_parts = response.parts
                        if final_content and final_thinking:
                            final_content, _ = split_thinking_content(final_content)

                        if final_thinking:
                            self._append_history(
                                AssistantThinking(content=final_thinking),
                            )
                            stream_state.thinking_buffer = ""

                        if response.tool_calls:
                            self._log.debug(
                                "Processing {} tool call(s)",
                                len(response.tool_calls),
                            )
                            if final_parts:
                                self._record_content_parts_output(
                                    self._normalize_llm_output_parts(final_parts),
                                    emitted_human_content=stream_state.emitted_human_content,
                                )
                                stream_state.content_buffer = ""
                            elif final_content:
                                self._record_text_output(
                                    final_content,
                                    emitted_human_content=stream_state.emitted_human_content,
                                )
                                stream_state.content_buffer = ""
                            self._raise_if_interrupt_requested()
                            stop_future_send_calls = False
                            for tc in response.tool_calls:
                                if stop_future_send_calls and tc.name == "send":
                                    continue
                                tool_result = self._handle_tool_call(
                                    tc.name,
                                    tc.arguments,
                                    tc.id,
                                )
                                if tc.name == "send" and self._tool_result_has_error(
                                    tool_result
                                ):
                                    stop_future_send_calls = True
                                self._raise_if_interrupt_requested()
                                if self._terminate.is_set():
                                    break
                        elif final_parts:
                            self._record_content_parts_output(
                                self._normalize_llm_output_parts(final_parts),
                                emitted_human_content=stream_state.emitted_human_content,
                            )
                            stream_state.content_buffer = ""
                            self._log.debug(
                                "No tool calls, continuing execution after structured response"
                            )
                        elif final_content:
                            self._record_text_output(
                                final_content,
                                emitted_human_content=stream_state.emitted_human_content,
                            )
                            stream_state.content_buffer = ""
                            self._log.debug(
                                "No tool calls, continuing execution after text response"
                            )
                        else:
                            self._log.warning(
                                "LLM returned empty response (no content, no tool_calls)",
                            )
                    except InterruptRequestedError as exc:
                        self._handle_interrupt(exc.stream_state or stream_state)
                        if self._terminate.is_set():
                            break
                        continue

                except LLMProviderError as exc:
                    self._interrupt_requested.clear()
                    self.set_interrupt_callback(None)
                    self._log.warning("Agent LLM provider error: {}", exc)
                    error_summary = str(exc)
                    self._append_history(ErrorEntry(content=error_summary))
                    self.set_state(AgentState.ERROR, error_summary)
                    self._wait_for_input()
                    if self._terminate.is_set():
                        break

                except ContextPreflightError as exc:
                    self._interrupt_requested.clear()
                    self.set_interrupt_callback(None)
                    self._log.warning("Agent context preflight failed: {}", exc)
                    error_summary = str(exc)
                    self._append_history(ErrorEntry(content=error_summary))
                    self.set_state(AgentState.ERROR, error_summary)
                    self._wait_for_input()
                    if self._terminate.is_set():
                        break

                except Exception as exc:
                    self._interrupt_requested.clear()
                    self.set_interrupt_callback(None)
                    self._log.exception("Agent error")
                    tb_str = traceback.format_exc()
                    self._append_history(
                        ErrorEntry(content=f"{type(exc).__name__}: {exc}\n\n{tb_str}"),
                    )
                    self.set_state(AgentState.ERROR, f"{type(exc).__name__}: {exc}")
                    self._wait_for_input()
                    if self._terminate.is_set():
                        break

            if self._should_preserve_workspace_state_on_exit():
                self._log.info(
                    "Agent stopped for process exit with state {}",
                    self.state.value,
                )
                return

            self._finalize_termination(self._termination_reason or "finished")

    def _sync_system_prompt_entry(self) -> None:
        system_prompt = get_system_prompt(self.config)
        with self._history_lock:
            for entry in self.history:
                if isinstance(entry, SystemEntry):
                    entry.content = system_prompt
                    break
            else:
                self.history.insert(0, SystemEntry(content=system_prompt))

    @staticmethod
    def _build_runtime_system_message(content: str) -> dict[str, str]:
        return {"role": "user", "content": f"<system>{content}</system>"}

    def _build_runtime_tail_messages(self) -> list[dict[str, str]]:
        with self._todos_lock:
            todos = [TodoItem(text=t.text) for t in self.todos]
        with self._history_lock:
            history_snapshot = list(self.history)
        runtime_notices = self._consume_runtime_notices()
        custom_post_prompt = get_settings().custom_post_prompt.strip()
        messages: list[dict[str, str]] = []
        todo_message = self._build_runtime_todo_message(todos)
        if todo_message is not None:
            messages.append(todo_message)
        messages.append(
            self._build_runtime_post_prompt_message(
                has_todos=bool(todos),
                pending_agent_dispatches=self._get_pending_agent_dispatches(
                    history_snapshot
                ),
            )
        )
        for notice in runtime_notices:
            messages.append(self._build_runtime_system_message(notice))
        if custom_post_prompt:
            messages.append(self._build_runtime_system_message(custom_post_prompt))
        return messages

    def _build_runtime_todo_message(
        self,
        todos: list[TodoItem],
    ) -> dict[str, str] | None:
        if not todos:
            return None
        lines = []
        for todo in todos:
            lines.append(f"  - {todo.text}")
        todo_text = "Current TODO list:\n" + "\n".join(lines)
        return self._build_runtime_system_message(todo_text)

    @staticmethod
    def _get_created_agent_label(payload: dict[str, Any]) -> str | None:
        agent_id = payload.get("agent_id")
        if not isinstance(agent_id, str) or not agent_id:
            agent_id = payload.get("id")
        if not isinstance(agent_id, str) or not agent_id:
            return None
        name = payload.get("name")
        if (not isinstance(name, str) or not name.strip()) and isinstance(
            payload.get("config"), dict
        ):
            config = payload["config"]
            config_name = config.get("name")
            config_role_name = config.get("role_name")
            if isinstance(config_name, str) and config_name.strip():
                name = config_name
            elif isinstance(config_role_name, str) and config_role_name.strip():
                name = config_role_name
        short_id = agent_id[:8]
        if isinstance(name, str) and name.strip():
            return f"{name.strip()} (`{short_id}`)"
        return f"`{short_id}`"

    @classmethod
    def _iter_dispatched_agent_payloads(
        cls,
        tool_name: str,
        payload: dict[str, Any],
    ) -> list[tuple[str, str]]:
        if tool_name == "create_agent":
            label = cls._get_created_agent_label(payload)
            agent_id = payload.get("id")
            if isinstance(agent_id, str) and label is not None:
                return [(agent_id, label)]
            return []
        return []

    def _get_pending_agent_dispatches(
        self,
        history_snapshot: list[HistoryEntry],
    ) -> list[str]:
        pending: dict[str, str] = {}

        for entry in history_snapshot:
            if isinstance(entry, ToolCall):
                if entry.tool_name != "create_agent":
                    continue
                if entry.result is None:
                    continue
                try:
                    payload = json.loads(entry.result)
                except json.JSONDecodeError:
                    continue
                if not isinstance(payload, dict) or payload.get("error") is not None:
                    continue
                for agent_id, label in self._iter_dispatched_agent_payloads(
                    entry.tool_name,
                    payload,
                ):
                    pending[agent_id] = label
                continue

            if isinstance(entry, SentMessage):
                pending.pop(entry.to_id, None)

        return list(pending.values())

    def _build_runtime_post_prompt_message(
        self,
        *,
        has_todos: bool,
        pending_agent_dispatches: list[str],
    ) -> dict[str, str]:
        lines = [
            "Runtime post prompt:",
            "- Plain content is never delivered to other agents.",
            "- To send a formal message to another node, use `send` with a single `target` and ordered `parts`.",
            "- Use `contacts` to inspect the node ids and names you can currently message directly.",
            "- `@target:` or any other `@name:` text inside normal content is just text. It does not send anything.",
        ]
        if pending_agent_dispatches:
            targets = ", ".join(pending_agent_dispatches)
            lines.append(
                f"- Newly created agents still waiting for their first task: {targets}."
            )
            lines.append(
                "- `create_agent` only adds a new agent node to the current workflow. It does not start work by itself."
            )
            lines.append(
                "- Before calling `idle`, dispatch each waiting agent a concrete first task with `send`."
            )
        elif has_todos:
            lines.append(
                "- If the TODO list is not complete yet, use `todo` to replace it with the latest remaining items."
            )
        else:
            lines.append(
                "- If there is no unfinished TODO and the task is finished with no immediate next action, call `idle`."
            )
        return self._build_runtime_system_message("\n".join(lines))

    @staticmethod
    def _build_idle_without_progress_notice() -> str:
        return (
            "Idle reminder: you received a new message this turn, but this "
            "response did not send a reply, call `send`, or use any "
            "non-idle tool. Do not call `idle` yet. First reply to the Human, "
            "dispatch/delegate work, or take another concrete step."
        )

    @staticmethod
    def _build_actionable_todo_notice(todo_text: str) -> str:
        return (
            "Idle reminder: your first remaining TODO still looks actionable "
            f"(`{todo_text}`). Do that next, or update the TODO list so the "
            "first remaining item is the actual waiting step, before calling "
            "`idle`."
        )

    @staticmethod
    def _build_sleep_deadline_notice() -> str:
        return (
            "Sleep deadline reached: the timed wait has expired. Continue from "
            "that deadline wake-up and decide whether to retry, follow up, or "
            "escalate."
        )

    def _queue_runtime_notice(self, content: str) -> None:
        with self._runtime_notice_lock:
            if content not in self._pending_runtime_notices:
                self._pending_runtime_notices.append(content)

    def _has_pending_runtime_notices(self) -> bool:
        with self._runtime_notice_lock:
            return bool(self._pending_runtime_notices)

    def _consume_runtime_notices(self) -> list[str]:
        with self._runtime_notice_lock:
            notices = list(self._pending_runtime_notices)
            self._pending_runtime_notices.clear()
        return notices

    def _handle_llm_chunk(
        self,
        state: StreamingContentState,
        chunk_type: str,
        text: str,
    ) -> None:
        self._raise_if_interrupt_requested()
        if chunk_type == "content":
            state.saw_content_chunks = True
            for normalized_type, normalized_text in state.think_parser.feed(text):
                if normalized_type == "thinking":
                    self._handle_streaming_thinking_chunk(state, normalized_text)
                else:
                    self._handle_streaming_content_chunk(state, normalized_text)
            return
        if chunk_type != "thinking":
            return
        self._handle_streaming_thinking_chunk(state, text)

    def _handle_streaming_content_chunk(
        self,
        state: StreamingContentState,
        text: str,
    ) -> None:
        if not text:
            return
        state.content_buffer += text
        delta = ContentDelta(text=text)
        event_bus.emit(
            Event(
                type=EventType.HISTORY_ENTRY_DELTA,
                agent_id=self.uuid,
                data=delta.serialize(),
            ),
        )
        if self.node_type == NodeType.ASSISTANT:
            state.emitted_human_content = True
            event_bus.emit(
                Event(
                    type=EventType.ASSISTANT_CONTENT,
                    agent_id=self.uuid,
                    data={"content": text},
                ),
            )

    def _handle_streaming_thinking_chunk(
        self,
        state: StreamingContentState,
        text: str,
    ) -> None:
        if not text:
            return
        state.thinking_buffer += text
        delta = ThinkingDelta(text=text)
        event_bus.emit(
            Event(
                type=EventType.HISTORY_ENTRY_DELTA,
                agent_id=self.uuid,
                data=delta.serialize(),
            ),
        )

    def _flush_streaming_think_parser(self, state: StreamingContentState) -> None:
        for normalized_type, normalized_text in state.think_parser.flush():
            if normalized_type == "thinking":
                self._handle_streaming_thinking_chunk(state, normalized_text)
            else:
                self._handle_streaming_content_chunk(state, normalized_text)

    def _deliver_message(
        self,
        target: Agent,
        parts: list[TextPart | ImagePart],
        message_id: str,
    ) -> None:
        content_preview = content_parts_to_text(parts)
        target._append_history(
            ReceivedMessage(
                from_id=self.uuid,
                parts=parts,
                message_id=message_id,
            )
        )
        target.enqueue_message(
            Message(
                from_id=self.uuid,
                to_id=target.uuid,
                parts=parts,
                message_id=message_id,
                history_recorded=True,
            )
        )
        self._log.debug(
            "Message sent: {} -> {} ({} chars)",
            self.uuid[:8],
            target.uuid[:8],
            len(content_preview),
        )
        event_bus.emit(
            Event(
                type=EventType.NODE_MESSAGE,
                agent_id=self.uuid,
                data={
                    "to_id": target.uuid,
                    "content": content_preview,
                    "message_id": message_id,
                },
            ),
        )

    def _record_text_output(
        self,
        content: str,
        *,
        emitted_human_content: bool,
    ) -> None:
        normalized_content, normalized_thinking = split_thinking_content(content)

        if normalized_thinking.strip():
            self._mark_turn_progress()
            self._append_history(AssistantThinking(content=normalized_thinking))

        plain_content = normalized_content
        if not plain_content.strip():
            return

        self._record_content_parts_output(
            [TextPart(text=plain_content)],
            emitted_human_content=emitted_human_content,
        )

    def _record_content_output(
        self,
        content: str,
        *,
        emitted_human_content: bool,
    ) -> None:
        self._record_text_output(
            content,
            emitted_human_content=emitted_human_content,
        )

    def _normalize_llm_output_parts(
        self,
        parts: list[LLMOutputTextPart | LLMOutputImagePart],
    ) -> list[TextPart | ImagePart]:
        normalized: list[TextPart | ImagePart] = []
        for part in parts:
            if isinstance(part, LLMOutputTextPart):
                normalized_content, normalized_thinking = split_thinking_content(
                    part.text
                )
                if normalized_thinking.strip():
                    self._append_history(AssistantThinking(content=normalized_thinking))
                if normalized_content:
                    normalized.append(TextPart(text=normalized_content))
                continue
            if not self.supports_output_image():
                raise ContextPreflightError(
                    "Current model does not support `output_image`."
                )
            asset = create_image_asset(part.data, mime_type=part.mime_type)
            normalized.append(
                ImagePart(
                    asset_id=asset.id,
                    mime_type=asset.mime_type,
                    width=part.width or asset.width,
                    height=part.height or asset.height,
                )
            )
        return normalized

    def _record_content_parts_output(
        self,
        parts: list[TextPart | ImagePart],
        *,
        emitted_human_content: bool,
    ) -> None:
        normalized_parts = [
            part for part in parts if not isinstance(part, TextPart) or part.text
        ]
        if not normalized_parts:
            return

        visible_text = "".join(
            part.text for part in normalized_parts if isinstance(part, TextPart)
        )
        content_preview = content_parts_to_text(normalized_parts)
        self._mark_turn_progress()

        if (
            self.node_type == NodeType.ASSISTANT
            and not emitted_human_content
            and visible_text.strip()
        ):
            event_bus.emit(
                Event(
                    type=EventType.ASSISTANT_CONTENT,
                    agent_id=self.uuid,
                    data={"content": visible_text},
                ),
            )

        self._append_history(
            AssistantText(
                parts=normalized_parts,
                content=content_preview,
            )
        )

    def _resolve_contact_target(self, target_ref: str) -> Agent:
        from flowent.graph_runtime import resolve_node_ref

        target = resolve_node_ref(target_ref)
        if target is None:
            raise ValueError(f"Send failed: target `{target_ref}` was not found.")
        if not self.can_contact(target.uuid):
            raise ValueError(f"Send failed: target `{target_ref}` is not in contacts.")
        return target

    def _ensure_can_dispatch_to_contact(self, target: Agent) -> None:
        if self.config.tab_id is None:
            return

        from flowent.graph_service import is_tab_leader
        from flowent.workspace_store import workspace_store

        if not is_tab_leader(node_id=self.uuid, tab_id=self.config.tab_id):
            return
        if target.node_type != NodeType.AGENT:
            return
        if is_tab_leader(node_id=target.uuid, tab_id=target.config.tab_id):
            return

        tab = workspace_store.get_tab(self.config.tab_id)
        if tab is not None and tab.activation_state != WorkflowActivationState.ACTIVE:
            raise ValueError(
                "Activate this workflow before sending work to agent nodes."
            )

    def supports_input_image(self) -> bool:
        _, model_info = self._get_effective_model_info()
        if model_info is None:
            return False
        return model_info.capabilities.input_image

    def supports_output_image(self) -> bool:
        _, model_info = self._get_effective_model_info()
        if model_info is None:
            return False
        return model_info.capabilities.output_image

    def send_message(
        self,
        *,
        target_ref: str,
        raw_parts: Any,
    ) -> str:
        parts = parse_content_parts_payload(raw_parts)
        target = self._resolve_contact_target(target_ref)
        self._ensure_can_dispatch_to_contact(target)
        if has_image_parts(parts) and not target.supports_input_image():
            raise ValueError(
                f"Send failed: target `{target_ref}` does not support `input_image`."
            )
        for part in parts:
            asset_id = getattr(part, "asset_id", None)
            if isinstance(asset_id, str):
                require_image_asset(asset_id)
        message_id = str(_uuid.uuid4())
        self._deliver_message(target, parts, message_id)
        self._mark_turn_progress()
        self._append_history(
            SentMessage(
                to_id=target.uuid,
                parts=parts,
                message_id=message_id,
            )
        )
        return json.dumps({"status": "sent", "target_id": target.uuid})

    def _mark_turn_progress(self) -> None:
        self._turn_made_progress = True
        self._pending_input_turn = False

    def _get_first_actionable_todo(self) -> str | None:
        with self._todos_lock:
            if not self.todos:
                return None
            first_todo = self.todos[0].text.strip()
        if not first_todo:
            return None
        normalized = first_todo.lower()
        waiting_prefixes = (
            "wait",
            "await",
            "waiting",
            "awaiting",
            "monitor",
            "listen",
            "idle",
            "sleep",
        )
        if normalized.startswith(waiting_prefixes) or first_todo.startswith(
            ("等待", "等候", "监听", "休眠", "空闲")
        ):
            return None
        return first_todo

    def _raise_if_interrupt_requested(self) -> None:
        if self._interrupt_requested.is_set():
            raise InterruptRequestedError()

    def _get_llm_retry_policy(self) -> str:
        return get_settings().model.retry_policy

    def _get_llm_max_retries(self) -> int:
        settings = get_settings()
        if settings.model.retry_policy != "limited":
            return 0
        return settings.model.max_retries

    def _get_llm_retry_delay(self, retry_number: int) -> float:
        settings = get_settings()
        capped_retry_number = min(
            max(retry_number - 1, 0),
            settings.model.retry_backoff_cap_retries - 1,
        )
        return min(
            settings.model.retry_max_delay_seconds,
            settings.model.retry_initial_delay_seconds * (2**capped_retry_number),
        )

    def _get_llm_retry_429_delay(self, status_code: int | None) -> float:
        if status_code != 429:
            return 0.0
        from flowent.settings import find_provider, find_role

        settings = get_settings()
        provider_id = settings.model.active_provider_id
        role_cfg = (
            find_role(settings, self.config.role_name)
            if self.config.role_name
            else None
        )
        if (
            role_cfg is not None
            and role_cfg.model is not None
            and role_cfg.model.provider_id
            and role_cfg.model.model
        ):
            provider_id = role_cfg.model.provider_id
        if not provider_id:
            return 0.0
        provider = find_provider(settings, provider_id)
        if provider is None:
            return 0.0
        return float(provider.retry_429_delay_seconds)

    def _wait_for_llm_retry_delay(self, delay_seconds: float) -> None:
        self.set_interrupt_callback(self._interrupt_requested.set)
        try:
            if self._interrupt_requested.wait(max(delay_seconds, 0.0)):
                raise InterruptRequestedError()
        finally:
            self.set_interrupt_callback(None)

    def _chat_with_retries(
        self,
        *,
        prepared_context: PreparedLLMContext,
        tools_schema: list[dict[str, Any]] | None,
    ) -> tuple[LLMResponse, StreamingContentState]:
        retry_policy = self._get_llm_retry_policy()
        retry_limit = self._get_llm_max_retries()
        retry_count = 0
        started_at = _time.time()
        self._raise_if_llm_network_disallowed()

        while True:
            stream_state = StreamingContentState()
            try:
                try:
                    messages = prepared_context.messages
                    response = gateway.chat(
                        messages=messages,
                        tools=tools_schema or None,
                        on_chunk=partial(self._handle_llm_chunk, stream_state),
                        register_interrupt=self.set_interrupt_callback,
                        role_name=self.config.role_name,
                    )
                except Exception:
                    if self._interrupt_requested.is_set():
                        raise InterruptRequestedError(stream_state) from None
                    raise
                finally:
                    self.set_interrupt_callback(None)
                self._raise_if_interrupt_requested()
                self._record_request_observability(
                    started_at=started_at,
                    ended_at=_time.time(),
                    retry_count=retry_count,
                    result="success",
                    usage=response.usage,
                    raw_usage=response.raw_usage,
                )
                self._record_context_token_usage_baseline(
                    prepared_context=prepared_context,
                    usage=response.usage,
                )
                return response, stream_state
            except InterruptRequestedError:
                raise
            except LLMProviderError as exc:
                should_retry = False
                if exc.transient:
                    if retry_policy == "limited":
                        should_retry = retry_count < retry_limit
                    elif retry_policy == "unlimited":
                        should_retry = True
                if not should_retry:
                    self._record_request_observability(
                        started_at=started_at,
                        ended_at=_time.time(),
                        retry_count=retry_count,
                        result="error",
                        error_summary=str(exc),
                    )
                    raise
                retry_count += 1
                delay_seconds = self._get_llm_retry_delay(
                    retry_count
                ) + self._get_llm_retry_429_delay(exc.status_code)
                self._log.warning(
                    "Transient LLM error, retry {} ({}) in {:.2f}s: {}",
                    retry_count,
                    retry_policy,
                    delay_seconds,
                    exc,
                )
                self._wait_for_llm_retry_delay(delay_seconds)
            except Exception as exc:
                self._record_request_observability(
                    started_at=started_at,
                    ended_at=_time.time(),
                    retry_count=retry_count,
                    result="error",
                    error_summary=str(exc),
                )
                raise

    def _handle_interrupt(self, stream_state: StreamingContentState | None) -> None:
        if stream_state is not None:
            self._flush_streaming_think_parser(stream_state)
            if stream_state.thinking_buffer:
                self._append_history(
                    AssistantThinking(content=stream_state.thinking_buffer),
                )
            if stream_state.content_buffer:
                self._record_text_output(
                    stream_state.content_buffer,
                    emitted_human_content=stream_state.emitted_human_content,
                )
        self._interrupt_requested.clear()
        self.set_interrupt_callback(None)
        self._pending_input_turn = False
        self.set_state(AgentState.IDLE, "interrupted by human")
        if self._pause_after_interrupt_requested.is_set():
            self._paused_for_command.set()
            self._resume_after_command.wait()
            self._paused_for_command.clear()
            self._resume_after_command.clear()
        self._wait_for_input()

    def _generate_compacted_history_summary(
        self,
        *,
        focus: str | None = None,
        context_messages: list[dict[str, Any]],
    ) -> str:
        if not context_messages:
            return "- No prior execution context was available to compact."

        self._raise_if_llm_network_disallowed()

        focus_text = focus.strip() if focus else ""
        request_lines = [
            "Compact this agent execution context into a durable markdown summary.",
            "Preserve only confirmed information.",
            "Keep the summary concise and directly reusable as future context.",
            "Use these sections in order:",
            "## Current Goal",
            "## Active Task Boundary",
            "## Key Constraints",
            "## Confirmed Decisions",
            "## Open Questions",
            "## Next Actions",
        ]
        if focus_text:
            request_lines.append(f"Prioritize this focus: {focus_text}")
        request_lines.append("Return only the markdown summary.")

        response = gateway.chat(
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You compress Assistant conversations into durable "
                        "task summaries. Do not address the human. Do not "
                        "invent facts. Keep the result tightly scoped to what "
                        "future turns need."
                    ),
                },
                *context_messages,
                {"role": "user", "content": "\n".join(request_lines)},
            ],
            tools=None,
            role_name=self.config.role_name,
        )
        summary = (response.content or response.thinking or "").strip()
        if not summary:
            raise RuntimeError("Assistant compact did not produce a summary")
        return summary

    def _build_prepared_llm_context(self) -> PreparedLLMContext:
        system_messages = [
            {"role": "system", "content": get_system_prompt(self.config)}
        ]
        with self._history_lock:
            history_snapshot = list(self.history)
        execution_context_messages = self._build_execution_context_messages(
            history_snapshot
        )
        runtime_tail_messages = self._build_runtime_tail_messages()
        return PreparedLLMContext(
            messages=[
                *system_messages,
                *execution_context_messages,
                *runtime_tail_messages,
            ],
            system_messages=system_messages,
            execution_context_messages=execution_context_messages,
            runtime_tail_messages=runtime_tail_messages,
        )

    def _build_messages(self) -> list[dict[str, Any]]:
        return self._build_prepared_llm_context().messages

    def _build_execution_context_messages(
        self,
        history_snapshot: list[HistoryEntry],
    ) -> list[dict[str, Any]]:
        with self._execution_context_lock:
            summary = self._execution_context_summary.strip()
            history_cutoff = min(
                self._execution_context_history_cutoff,
                len(history_snapshot),
            )

        messages: list[dict[str, Any]] = []
        if summary:
            messages.append(
                self._build_runtime_system_message(
                    f"Compacted execution context:\n{summary}"
                )
            )
        messages.extend(self._build_history_messages(history_snapshot[history_cutoff:]))
        return messages

    @staticmethod
    def _serialize_context_parts(
        parts: list[TextPart | ImagePart],
    ) -> str | list[dict[str, Any]]:
        if all(isinstance(part, TextPart) for part in parts):
            text_parts = [part for part in parts if isinstance(part, TextPart)]
            return "".join(part.text for part in text_parts)
        return [part.serialize() for part in parts]

    @classmethod
    def _wrap_context_parts(
        cls,
        parts: list[TextPart | ImagePart],
        *,
        prefix: str,
        suffix: str = "",
    ) -> str | list[dict[str, Any]]:
        if all(isinstance(part, TextPart) for part in parts):
            text_parts = [part for part in parts if isinstance(part, TextPart)]
            return prefix + "".join(part.text for part in text_parts) + suffix
        wrapped: list[TextPart | ImagePart] = [TextPart(text=prefix), *parts]
        if suffix:
            wrapped.append(TextPart(text=suffix))
        return cls._serialize_context_parts(wrapped)

    def _build_history_messages(
        self,
        history_snapshot: list[HistoryEntry],
    ) -> list[dict[str, Any]]:
        messages: list[dict[str, Any]] = []
        pending_tool_calls: list[dict[str, Any]] = []

        for entry in history_snapshot:
            if isinstance(entry, SystemEntry):
                continue

            elif isinstance(entry, ReceivedMessage):
                self._flush_tool_calls(messages, pending_tool_calls)
                messages.append(
                    {
                        "role": "user",
                        "content": self._wrap_context_parts(
                            entry.parts,
                            prefix=f'<message from="{entry.from_id}">',
                            suffix="</message>",
                        ),
                    }
                )

            elif isinstance(entry, AssistantText):
                self._flush_tool_calls(messages, pending_tool_calls)
                messages.append(
                    {
                        "role": "assistant",
                        "content": self._serialize_context_parts(entry.parts),
                    }
                )

            elif isinstance(entry, SentMessage):
                self._flush_tool_calls(messages, pending_tool_calls)
                messages.append(
                    {
                        "role": "assistant",
                        "content": self._wrap_context_parts(
                            entry.parts,
                            prefix=f'<message to="{entry.to_id}">',
                            suffix="</message>",
                        ),
                    }
                )

            elif isinstance(entry, AssistantThinking):
                pass

            elif isinstance(entry, ToolCall):
                if entry.streaming:
                    continue

                pending_tool_calls.append(
                    {
                        "id": entry.tool_call_id,
                        "type": "function",
                        "function": {
                            "name": entry.tool_name,
                            "arguments": json.dumps(entry.arguments)
                            if entry.arguments
                            else "{}",
                        },
                    }
                )

                if entry.result is not None:
                    self._flush_tool_calls(messages, pending_tool_calls)
                    messages.append(
                        {
                            "role": "tool",
                            "tool_call_id": entry.tool_call_id,
                            "content": entry.result,
                        }
                    )

            elif isinstance(entry, ErrorEntry):
                self._flush_tool_calls(messages, pending_tool_calls)
                messages.append(
                    {
                        "role": "user",
                        "content": build_error_context(entry.content),
                    }
                )

            elif isinstance(entry, CommandResultEntry):
                if not entry.include_in_context or entry.command_name == "/compact":
                    continue
                self._flush_tool_calls(messages, pending_tool_calls)
                messages.append(self._build_runtime_system_message(entry.content))

        self._flush_tool_calls(messages, pending_tool_calls)
        return messages

    @staticmethod
    def _estimate_text_tokens(text: str) -> int:
        stripped = text.strip()
        if not stripped:
            return 0
        return max(1, (len(stripped) + 3) // 4)

    @classmethod
    def _estimate_message_tokens(cls, message: dict[str, Any]) -> int:
        total = cls._estimate_text_tokens(str(message.get("role", "")))
        content = message.get("content")
        if isinstance(content, str):
            total += cls._estimate_text_tokens(content)
        elif content is not None:
            total += cls._estimate_text_tokens(json.dumps(content, ensure_ascii=False))
        tool_calls = message.get("tool_calls")
        if isinstance(tool_calls, list):
            for tool_call in tool_calls:
                if not isinstance(tool_call, dict):
                    continue
                function = tool_call.get("function")
                if not isinstance(function, dict):
                    continue
                total += cls._estimate_text_tokens(str(function.get("name", "")))
                total += cls._estimate_text_tokens(str(function.get("arguments", "")))
        return total

    @classmethod
    def _estimate_input_tokens(cls, messages: list[dict[str, Any]]) -> int:
        return sum(cls._estimate_message_tokens(message) for message in messages)

    def _estimate_tokens_from_usage_baseline(
        self,
        prepared_context: PreparedLLMContext,
    ) -> int | None:
        with self._execution_context_lock:
            baseline = self._context_token_usage_baseline

        if baseline is None:
            return None
        if baseline.system_messages != prepared_context.system_messages:
            return None
        if baseline.runtime_tail_messages != prepared_context.runtime_tail_messages:
            return None

        baseline_execution_messages = baseline.execution_context_messages
        current_execution_messages = prepared_context.execution_context_messages
        if len(current_execution_messages) < len(baseline_execution_messages):
            return None
        if (
            current_execution_messages[: len(baseline_execution_messages)]
            != baseline_execution_messages
        ):
            return None

        tail_messages = current_execution_messages[len(baseline_execution_messages) :]
        return baseline.usage.total_tokens + self._estimate_input_tokens(tail_messages)

    def _record_context_token_usage_baseline(
        self,
        *,
        prepared_context: PreparedLLMContext,
        usage: LLMUsage | None,
    ) -> None:
        if usage is None:
            return

        with self._execution_context_lock:
            self._context_token_usage_baseline = ContextTokenUsageBaseline(
                usage=usage,
                system_messages=list(prepared_context.system_messages),
                execution_context_messages=list(
                    prepared_context.execution_context_messages
                ),
                runtime_tail_messages=list(prepared_context.runtime_tail_messages),
            )

    def _get_observability_node_label(self) -> str:
        if self.config.name:
            return self.config.name
        if self.config.role_name:
            return self.config.role_name
        if self.node_type == NodeType.ASSISTANT:
            return "Assistant"
        from flowent.graph_service import is_tab_leader

        if is_tab_leader(node_id=self.uuid, tab_id=self.config.tab_id):
            return "Leader"
        return "Agent"

    def _get_observability_tab_title(self) -> str | None:
        if not self.config.tab_id:
            return None
        from flowent.workspace_store import workspace_store

        tab = workspace_store.get_tab(self.config.tab_id)
        if tab is None:
            return None
        return tab.title

    def _get_effective_model_source(self) -> ResolvedModelSource:
        from flowent.settings import find_provider, find_role, resolve_model_info

        settings = get_settings()
        provider_id = settings.model.active_provider_id
        model_id = settings.model.active_model
        use_system_model_overrides = True
        role_cfg = (
            find_role(settings, self.config.role_name)
            if self.config.role_name
            else None
        )
        if (
            role_cfg is not None
            and role_cfg.model is not None
            and role_cfg.model.provider_id
            and role_cfg.model.model
        ):
            provider_id = role_cfg.model.provider_id
            model_id = role_cfg.model.model
            use_system_model_overrides = False
        if not provider_id or not model_id:
            return ResolvedModelSource(
                provider_id=None,
                provider_name=None,
                provider_type=None,
                provider_base_url=None,
                model=None,
                model_info=None,
            )
        provider = find_provider(settings, provider_id)
        if provider is None:
            return ResolvedModelSource(
                provider_id=None,
                provider_name=None,
                provider_type=None,
                provider_base_url=None,
                model=None,
                model_info=None,
            )
        return ResolvedModelSource(
            provider_id=provider.id,
            provider_name=provider.name,
            provider_type=provider.type,
            provider_base_url=provider.base_url,
            model=model_id,
            model_info=resolve_model_info(
                provider=provider,
                model_id=model_id,
                input_image=(
                    settings.model.input_image if use_system_model_overrides else None
                ),
                output_image=(
                    settings.model.output_image if use_system_model_overrides else None
                ),
                context_window_tokens=(
                    settings.model.context_window_tokens
                    if use_system_model_overrides
                    else None
                ),
            ),
        )

    def _raise_if_llm_network_disallowed(self) -> None:
        from flowent.graph_service import resolve_effective_permissions_for_agent

        allow_network, _ = resolve_effective_permissions_for_agent(self)
        if allow_network:
            return
        source = self._get_effective_model_source()
        if not self._model_source_requires_network(source):
            return
        raise LLMProviderError(
            "Network access is disabled for this workflow",
            transient=False,
        )

    @staticmethod
    def _model_source_requires_network(source: ResolvedModelSource) -> bool:
        base_url = source.provider_base_url
        if not base_url:
            return False
        parsed = urlparse(base_url)
        host = (parsed.hostname or "").lower()
        return host not in {"localhost", "127.0.0.1", "::1"}

    def _get_effective_model_info(self) -> tuple[str | None, ModelInfo | None]:
        resolved_source = self._get_effective_model_source()
        return resolved_source.provider_type, resolved_source.model_info

    def _record_request_observability(
        self,
        *,
        started_at: float,
        ended_at: float,
        retry_count: int,
        result: str,
        usage: LLMUsage | None = None,
        raw_usage: dict[str, Any] | None = None,
        error_summary: str | None = None,
    ) -> None:
        from flowent.observability_service import (
            RequestRecordInput,
            observability_store,
        )

        resolved_source = self._get_effective_model_source()
        observability_store.record_request(
            RequestRecordInput(
                node_id=self.uuid,
                node_label=self._get_observability_node_label(),
                role_name=self.config.role_name,
                tab_id=self.config.tab_id,
                tab_title=self._get_observability_tab_title(),
                provider_id=resolved_source.provider_id,
                provider_name=resolved_source.provider_name,
                provider_type=resolved_source.provider_type,
                model=resolved_source.model,
                started_at=started_at,
                ended_at=ended_at,
                retry_count=retry_count,
                result="success" if result == "success" else "error",
                normalized_usage=usage,
                raw_usage=raw_usage,
                error_summary=error_summary,
            )
        )

    def _run_compact_with_observability(
        self,
        *,
        trigger_type: str,
        focus: str | None = None,
    ) -> str:
        from flowent.observability_service import (
            CompactRecordInput,
            observability_store,
        )

        started_at = _time.time()
        resolved_source = self._get_effective_model_source()
        try:
            result = self._compact_execution_context(focus=focus)
        except Exception as exc:
            observability_store.record_compact(
                CompactRecordInput(
                    node_id=self.uuid,
                    node_label=self._get_observability_node_label(),
                    role_name=self.config.role_name,
                    tab_id=self.config.tab_id,
                    tab_title=self._get_observability_tab_title(),
                    provider_id=resolved_source.provider_id,
                    provider_name=resolved_source.provider_name,
                    provider_type=resolved_source.provider_type,
                    model=resolved_source.model,
                    trigger_type="manual" if trigger_type == "manual" else "auto",
                    started_at=started_at,
                    ended_at=_time.time(),
                    result="error",
                    error_summary=str(exc),
                )
            )
            raise
        observability_store.record_compact(
            CompactRecordInput(
                node_id=self.uuid,
                node_label=self._get_observability_node_label(),
                role_name=self.config.role_name,
                tab_id=self.config.tab_id,
                tab_title=self._get_observability_tab_title(),
                provider_id=resolved_source.provider_id,
                provider_name=resolved_source.provider_name,
                provider_type=resolved_source.provider_type,
                model=resolved_source.model,
                trigger_type="manual" if trigger_type == "manual" else "auto",
                started_at=started_at,
                ended_at=_time.time(),
                result="success",
            )
        )
        return result

    def _get_effective_output_budget_tokens(self) -> int:
        from flowent.settings import find_role, merge_model_params

        settings = get_settings()
        role_cfg = (
            find_role(settings, self.config.role_name)
            if self.config.role_name
            else None
        )
        model_params = merge_model_params(
            settings.model.params,
            role_cfg.model_params if role_cfg is not None else None,
        )
        if model_params is not None and model_params.max_output_tokens is not None:
            return max(1, model_params.max_output_tokens)
        return DEFAULT_CONTEXT_OUTPUT_BUDGET_TOKENS

    def _compute_context_preflight(
        self,
        prepared_context: PreparedLLMContext,
    ) -> ContextPreflight:
        settings = get_settings()
        _, model_info = self._get_effective_model_info()
        estimated_total_tokens = self._estimate_tokens_from_usage_baseline(
            prepared_context
        )
        if estimated_total_tokens is None:
            estimated_total_tokens = self._estimate_input_tokens(
                prepared_context.messages
            )

        auto_compact_token_limit = settings.model.auto_compact_token_limit
        if model_info is None or model_info.context_window_tokens is None:
            return ContextPreflight(
                estimated_total_tokens=estimated_total_tokens,
                auto_compact_token_limit=auto_compact_token_limit,
            )

        output_budget_tokens = self._get_effective_output_budget_tokens()
        safe_input_tokens = max(
            1,
            model_info.context_window_tokens
            - output_budget_tokens
            - DEFAULT_CONTEXT_PROVIDER_HEADROOM_TOKENS,
        )
        return ContextPreflight(
            estimated_total_tokens=estimated_total_tokens,
            context_window_tokens=model_info.context_window_tokens,
            auto_compact_token_limit=auto_compact_token_limit,
            safe_input_tokens=safe_input_tokens,
        )

    def _compact_execution_context(self, *, focus: str | None = None) -> str:
        with self._history_lock:
            history_snapshot = list(self.history)
        context_messages = self._build_execution_context_messages(history_snapshot)
        if not context_messages:
            self._set_execution_context(
                summary="",
                history_cutoff=len(history_snapshot),
            )
            self._persist_workspace_node()
            return ""
        summary = self._generate_compacted_history_summary(
            focus=focus,
            context_messages=context_messages,
        )
        self._set_execution_context(
            summary=summary,
            history_cutoff=len(history_snapshot),
        )
        self._persist_workspace_node()
        return summary

    def _prepare_messages_for_llm(self) -> PreparedLLMContext:
        prepared_context = self._build_prepared_llm_context()
        preflight = self._compute_context_preflight(prepared_context)
        if (
            preflight.auto_compact_token_limit is None
            or preflight.estimated_total_tokens < preflight.auto_compact_token_limit
        ):
            return prepared_context

        self._log.debug(
            "Automatic compact preflight: estimated_total={}, token_limit={}, safe={}, context_window={}",
            preflight.estimated_total_tokens,
            preflight.auto_compact_token_limit,
            preflight.safe_input_tokens,
            preflight.context_window_tokens,
        )
        try:
            self._run_compact_with_observability(trigger_type="auto")
        except Exception as exc:
            if (
                preflight.safe_input_tokens is not None
                and preflight.estimated_total_tokens > preflight.safe_input_tokens
            ):
                raise ContextPreflightError(
                    "Automatic compact failed and the current execution context exceeds the safe model window."
                ) from exc
            self._log.warning("Automatic compact failed below safe window: {}", exc)
            return prepared_context

        prepared_context = self._build_prepared_llm_context()
        post_compact = self._compute_context_preflight(prepared_context)
        if (
            post_compact.safe_input_tokens is not None
            and post_compact.estimated_total_tokens > post_compact.safe_input_tokens
        ):
            raise ContextPreflightError(
                "Automatic compact completed but the current execution context still exceeds the safe model window."
            )
        return prepared_context

    @staticmethod
    def _flush_tool_calls(
        messages: list[dict[str, Any]],
        pending: list[dict[str, Any]],
    ) -> None:
        if not pending:
            return
        last = messages[-1] if messages else None
        if last and last["role"] == "assistant":
            last.setdefault("tool_calls", []).extend(pending)
        else:
            messages.append({"role": "assistant", "tool_calls": list(pending)})
        pending.clear()

    @staticmethod
    def _tool_result_has_error(result: str | None) -> bool:
        if not isinstance(result, str):
            return False
        try:
            payload = json.loads(result)
        except json.JSONDecodeError:
            return False
        return isinstance(payload, dict) and isinstance(payload.get("error"), str)

    def _drain_messages(self) -> None:
        drained: list[WakeSignal] = []
        while True:
            try:
                signal = self._wake_queue.get_nowait()
            except Empty:
                break
            if signal.reason == "message":
                drained.append(signal)
                continue
            if signal.reason == "termination":
                self._terminate.set()
                break

        if drained:
            self._log.debug("Drained {} message(s) from queue", len(drained))

        for signal in drained:
            message = signal.payload.get("message", {})
            content = message.get("content", "")
            parts = deserialize_content_parts(
                message.get("parts"),
                fallback_text=content if isinstance(content, str) else None,
            )
            from_id = message.get("from", "")
            message_id = message.get("message_id")
            history_recorded = bool(message.get("history_recorded", False))
            if (
                not isinstance(content, str)
                or not isinstance(from_id, str)
                or (message_id is not None and not isinstance(message_id, str))
            ):
                continue
            self._log.debug(
                "Message from {}: {}",
                from_id,
                (content[:100] + "...") if len(content) > 100 else content,
            )
            if not history_recorded:
                self._append_history(
                    ReceivedMessage(
                        from_id=from_id,
                        parts=parts,
                        content=content,
                        message_id=message_id,
                    ),
                )

    def _wait_for_input(self) -> None:
        signal = self._wait_for_wakeup()
        self._resume_from_wakeup(signal)

    def _resume_from_wakeup(self, signal: WakeSignal) -> None:
        if signal.reason == "message":
            message = signal.payload.get("message")
            if isinstance(message, dict):
                content = message.get("content")
                parts = deserialize_content_parts(
                    message.get("parts"),
                    fallback_text=content if isinstance(content, str) else None,
                )
                from_id = message.get("from")
                message_id = message.get("message_id")
                history_recorded = bool(message.get("history_recorded", False))
                if (
                    isinstance(content, str)
                    and isinstance(from_id, str)
                    and (message_id is None or isinstance(message_id, str))
                    and not history_recorded
                ):
                    self._append_history(
                        ReceivedMessage(
                            from_id=from_id,
                            parts=parts,
                            content=content,
                            message_id=message_id,
                        )
                    )

        if signal.reason != "termination":
            self.set_state(
                AgentState.RUNNING,
                signal.resume_reason or f"woke due to {signal.reason}",
            )

    def _wait_for_wakeup(self) -> WakeSignal:
        while not self._terminate.is_set():
            try:
                return self._wake_queue.get(timeout=2.0)
            except Empty:
                continue

        return WakeSignal(
            reason="termination",
            payload={},
            resume_reason="termination requested",
        )

    def _handle_tool_call(
        self,
        name: str,
        arguments: dict[str, Any],
        call_id: str,
    ) -> str | None:
        self._log.debug(
            "Tool call: name={}, call_id={}, args={}",
            name,
            call_id[:8],
            json.dumps(arguments, ensure_ascii=False)[:200],
        )

        tool = _get_tool_registry().get(name)
        if tool is None:
            self._log.warning("Unknown tool: {}", name)
            error_msg = json.dumps({"error": f"Unknown tool: {name}"})
            self._append_history(
                ToolCall(
                    tool_name=name,
                    tool_call_id=call_id,
                    arguments=arguments,
                    result=error_msg,
                    streaming=False,
                ),
            )
            return error_msg

        registry = _get_tool_registry()
        if hasattr(registry, "get_tools_for_agent"):
            allowed_tool_names = {
                allowed_tool.name for allowed_tool in registry.get_tools_for_agent(self)
            }
        else:
            allowed_tool_names = set(self.config.tools)
        if name not in allowed_tool_names:
            self._log.warning("Tool not granted in current boundary: {}", name)
            error_msg = json.dumps({"error": f"Tool not granted: {name}"})
            self._append_history(
                ToolCall(
                    tool_name=name,
                    tool_call_id=call_id,
                    arguments=arguments,
                    result=error_msg,
                    streaming=False,
                ),
            )
            return error_msg

        authorization_error = authorize(name, self, arguments)
        if authorization_error is not None:
            self._log.warning(
                "Tool denied by security policy: {} ({})",
                name,
                authorization_error,
            )
            error_msg = json.dumps({"error": authorization_error})
            self._append_history(
                ToolCall(
                    tool_name=name,
                    tool_call_id=call_id,
                    arguments=arguments,
                    result=error_msg,
                    streaming=False,
                ),
            )
            return error_msg

        event_bus.emit(
            Event(
                type=EventType.TOOL_CALLED,
                agent_id=self.uuid,
                data={"tool": name, "arguments": arguments},
            ),
        )

        if name == "send":
            t0 = _time.perf_counter()
            try:
                self._raise_if_interrupt_requested()
                result = tool.execute(
                    self,
                    arguments,
                    on_output=None,
                    tool_call_id=call_id,
                )
                self._raise_if_interrupt_requested()
                elapsed = _time.perf_counter() - t0
                self._log.debug(
                    "Tool {} completed in {:.2f}s, result_len={}",
                    name,
                    elapsed,
                    len(result) if result else 0,
                )
                return result
            except InterruptRequestedError:
                raise
            except Exception as exc:
                elapsed = _time.perf_counter() - t0
                self._log.warning(
                    "Tool {} failed after {:.2f}s: {}", name, elapsed, exc
                )
                error_text = str(exc)
                self._append_history(ErrorEntry(content=error_text))
                return json.dumps({"error": error_text})

        streaming_entry = ToolCall(
            tool_name=name,
            tool_call_id=call_id,
            arguments=arguments,
            streaming=True,
        )
        self._append_history(streaming_entry)
        streamed_result_parts: list[str] = []

        def _on_tool_output(text: str) -> None:
            self._raise_if_interrupt_requested()
            streamed_result_parts.append(text)
            delta = ToolResultDelta(tool_call_id=call_id, text=text)
            event_bus.emit(
                Event(
                    type=EventType.HISTORY_ENTRY_DELTA,
                    agent_id=self.uuid,
                    data=delta.serialize(),
                ),
            )
            self._raise_if_interrupt_requested()

        t0 = _time.perf_counter()
        try:
            self._raise_if_interrupt_requested()
            result = tool.execute(
                self,
                arguments,
                on_output=_on_tool_output,
                tool_call_id=call_id,
            )
            self._raise_if_interrupt_requested()
            elapsed = _time.perf_counter() - t0
            self._log.debug(
                "Tool {} completed in {:.2f}s, result_len={}",
                name,
                elapsed,
                len(result) if result else 0,
            )

            self._finalize_tool_call(call_id, name, arguments, result)
            return result
        except InterruptRequestedError:
            partial_result = "".join(streamed_result_parts) or None
            self._finalize_tool_call(call_id, name, arguments, partial_result)
            raise
        except Exception as e:
            elapsed = _time.perf_counter() - t0
            self._log.exception("Tool {} failed after {:.2f}s", name, elapsed)
            error_msg = json.dumps({"error": str(e)})
            self._finalize_tool_call(call_id, name, arguments, error_msg)
            return error_msg

    def _finalize_tool_call(
        self,
        call_id: str,
        name: str,
        arguments: dict[str, Any],
        result: str | None,
    ) -> None:
        final: ToolCall | None = None
        with self._history_lock:
            for i in range(len(self.history) - 1, -1, -1):
                entry = self.history[i]
                if (
                    isinstance(entry, ToolCall)
                    and entry.tool_call_id == call_id
                    and entry.streaming
                ):
                    final = ToolCall(
                        tool_name=name,
                        tool_call_id=call_id,
                        arguments=arguments,
                        result=result,
                        streaming=False,
                    )
                    self.history[i] = final
                    break

        if final is not None:
            event_bus.emit(
                Event(
                    type=EventType.HISTORY_ENTRY_ADDED,
                    agent_id=self.uuid,
                    data=final.serialize(),
                ),
            )

    def enqueue_message(self, msg: Message) -> None:
        payload = {
            "from": msg.from_id,
            "content": msg.content,
            "parts": [part.serialize() for part in msg.parts],
            "history_recorded": msg.history_recorded,
        }
        if msg.message_id is not None:
            payload["message_id"] = msg.message_id
        self._wake_queue.put(
            WakeSignal(
                reason="message",
                payload={"message": payload},
                resume_reason=f"received message from {msg.from_id}",
            )
        )

    def set_state(
        self,
        state: AgentState,
        reason: str = "",
        *,
        force_emit: bool = False,
    ) -> None:
        from flowent.graph_service import is_tab_leader

        old = self.state
        self.state = state
        if state == AgentState.IDLE:
            if old != AgentState.IDLE:
                self._idle_started_at = _time.perf_counter()
            self._idle_state_event.set()
        else:
            if old == AgentState.IDLE:
                self._idle_started_at = None
                self._idle_started_by_tool_call_id = None
            self._idle_state_event.clear()
        if old != state or force_emit:
            if old != state:
                self._append_history(
                    StateEntry(state=state.value, reason=reason),
                )
            self._log.debug(
                "State: {} -> {}{}",
                old.value,
                state.value,
                f" ({reason})" if reason else "",
            )
            event_bus.emit(
                Event(
                    type=EventType.NODE_STATE_CHANGED,
                    agent_id=self.uuid,
                    data={
                        "old_state": old.value,
                        "new_state": state.value,
                        "tab_id": self.config.tab_id,
                        "role_name": self.config.role_name,
                        "name": self.config.name,
                        "is_leader": is_tab_leader(
                            node_id=self.uuid,
                            tab_id=self.config.tab_id,
                        ),
                        "todos": [t.serialize() for t in self.get_todos_snapshot()],
                    },
                ),
            )
        self._persist_workspace_node()

    def request_termination(self, reason: str = "") -> None:
        self._preserve_workspace_state_on_exit = False
        self._termination_reason = reason
        self._terminate.set()
        self._wake_queue.put(
            WakeSignal(
                reason="termination",
                payload={},
                resume_reason="termination requested",
            )
        )

    def request_process_exit(self) -> None:
        self._preserve_workspace_state_on_exit = (
            self.node_type == NodeType.ASSISTANT or bool(self.config.tab_id)
        )
        self._termination_reason = "process_exit"
        self._terminate.set()
        self._wake_queue.put(
            WakeSignal(
                reason="termination",
                payload={},
                resume_reason="process exit requested",
            )
        )

    def request_interrupt(self) -> bool:
        if self.state not in {AgentState.RUNNING, AgentState.SLEEPING}:
            return False
        self._interrupt_requested.set()
        self._invoke_interrupt_callback()
        return True

    def is_interrupt_requested(self) -> bool:
        return self._interrupt_requested.is_set()

    def set_interrupt_callback(self, callback: Callable[[], None] | None) -> None:
        with self._interrupt_callback_lock:
            self._interrupt_callback = callback
        if callback is not None and self._interrupt_requested.is_set():
            self._invoke_interrupt_callback()

    def _invoke_interrupt_callback(self) -> None:
        with self._interrupt_callback_lock:
            callback = self._interrupt_callback
        if callback is None:
            return
        try:
            callback()
        except Exception:
            self._log.debug("Interrupt callback raised")

    def terminate_and_wait(self, timeout: float = 10.0) -> None:
        self.request_termination("shutdown")
        self.wait_for_termination(timeout=timeout)

    def wait_for_termination(self, timeout: float = 10.0) -> bool:
        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=timeout)
        return not (self._thread and self._thread.is_alive())

    def _should_preserve_workspace_state_on_exit(self) -> bool:
        return self._preserve_workspace_state_on_exit and (
            self.node_type == NodeType.ASSISTANT or bool(self.config.tab_id)
        )

    def _finalize_termination(self, reason: str) -> None:
        from flowent.registry import registry

        self.set_state(AgentState.TERMINATED, reason)
        self._log.info("Agent terminated (reason: {})", reason)
        event_bus.emit(
            Event(
                type=EventType.NODE_TERMINATED,
                agent_id=self.uuid,
                data={"reason": reason},
            ),
        )
        registry.unregister(self.uuid)

        peer_ids = self.get_connections_snapshot()
        for peer_id in peer_ids:
            peer = registry.get(peer_id)
            if peer is not None:
                peer.remove_connection(self.uuid)
            self.remove_connection(peer_id)

        self._persist_workspace_node()
