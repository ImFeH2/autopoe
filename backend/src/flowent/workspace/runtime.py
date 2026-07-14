import asyncio
import logging
import time
from collections.abc import AsyncIterator, Mapping, Sequence
from contextlib import suppress
from dataclasses import dataclass
from pathlib import Path
from typing import Literal
from uuid import uuid4

from flowent.agent import AgentContextUpdate
from flowent.agent_runtime import FlowentAgentRuntime
from flowent.application_errors import (
    ApplicationError,
    InvalidRequestError,
    OperationConflictError,
    ResourceNotFoundError,
)
from flowent.compact import CompactInput, CompactProvider
from flowent.context import runtime_context_messages
from flowent.llm import ChatMessage, CompletionCallable, ProviderConnection
from flowent.logging import TRACE_LEVEL
from flowent.mcp import McpManager
from flowent.provider_connections import selected_connection
from flowent.skills import explicit_skill_messages
from flowent.storage import (
    StateStore,
    StoredCompactionCheckpoint,
    StoredMessage,
    StoredState,
    StoredToolItem,
    WorkflowRepository,
)
from flowent.tool_protocol import text_tool_result
from flowent.usage import (
    TokenUsage,
    TokenUsageInfo,
    append_token_usage,
    full_context_usage,
    is_context_window_error,
    recompute_context_usage,
)
from flowent.workflow_service import WorkflowService
from flowent.workspace.context import (
    COMPACTED_CONTEXT_MARKER,
    OPTIMIZED_CONTEXT_MARKER,
    compact_prompt_chat_messages,
    context_window_for_settings,
    model_request_messages_data,
    model_visible_assistant_output_messages,
    should_auto_compact,
    update_context_usage_for_response,
    usage_event_data,
    workspace_chat_messages,
)
from flowent.workspace.events import (
    WorkspaceResponse,
    append_or_replace_message,
    stream_event,
    stream_message_data,
)
from flowent.workspace.output import (
    EMPTY_MODEL_RESPONSE_DETAIL,
    AssistantOutputBuilder,
    approval_transcript,
    assistant_retry_output_start_index,
    run_error_event_data,
    run_error_output_item,
    trim_assistant_message_at_error,
)
from flowent.workspace.response_session import WorkspaceTurnCoordinator

logger = logging.getLogger("flowent.workspace.runtime")

AUTO_COMPACT_RETAINED_MESSAGE_TOKEN_BUDGET = 20_000
WORKSPACE_PROGRESS_FLUSH_INTERVAL_SECONDS = 0.5
USER_VISIBLE_MANUAL_COMPACT_ERROR_MESSAGE = "Context could not be compacted."


@dataclass
class WorkspaceCompactTask:
    task: asyncio.Task[tuple[StoredMessage, TokenUsageInfo]]


class WorkspaceRuntime:
    def __init__(
        self,
        *,
        chat_completion: CompletionCallable | None,
        compact_provider: CompactProvider,
        cwd: Path,
        mcp_manager: McpManager,
        store: StateStore,
        workflow_repository: WorkflowRepository,
        workflow_service: WorkflowService,
    ) -> None:
        self.chat_completion = chat_completion
        self.compact_provider = compact_provider
        self.cwd = cwd
        self.store = store
        self.workflow_service = workflow_service
        self.agent_runtime = FlowentAgentRuntime(
            chat_completion=chat_completion,
            cwd=cwd,
            mcp_manager=mcp_manager,
            store=store,
            workflow_repository=workflow_repository,
            workflow_service=workflow_service,
        )
        self.active_compact_task: WorkspaceCompactTask | None = None
        self.turns = WorkspaceTurnCoordinator()

    @property
    def response_reserved(self) -> bool:
        return self.turns.response_reserved

    def extra_tool_specs(self) -> list[Mapping[str, object]]:
        return self.agent_runtime.extra_tool_specs()

    def model_tool_specs(self) -> list[Mapping[str, object]]:
        return self.agent_runtime.model_tool_specs()

    def extra_tool_title(self, name: str) -> str | None:
        return self.agent_runtime.extra_tool_title(name)

    def request_messages_for_content(
        self,
        state: StoredState,
        messages: list[StoredMessage],
        content: str,
    ) -> list[dict[str, object]]:
        compacted_context = self.store.read_compacted_context()
        checkpoint = self.store.read_active_compaction_checkpoint()
        chat_messages = workspace_chat_messages(
            messages,
            compacted_context,
            checkpoint,
        )
        return model_request_messages_data(
            [
                *runtime_context_messages(self.cwd, state.settings.agent_prompt),
                *explicit_skill_messages(self.cwd, self.store, content),
                *chat_messages,
            ]
        )

    async def save_context_checkpoint(
        self,
        *,
        connection: ProviderConnection,
        context_window_limit: int,
        messages: list[StoredMessage],
        model_history: Sequence[ChatMessage | Mapping[str, object]],
        marker_content: str,
        source_message_id: str | None = None,
        trigger: Literal["manual", "auto"],
    ) -> tuple[StoredMessage, list[dict[str, object]], TokenUsageInfo]:
        compact_model_history = compact_prompt_chat_messages(model_history)
        compact_result = await self.compact_provider.compact(
            connection,
            CompactInput(
                messages=messages,
                model_history=compact_model_history,
                retained_message_token_budget=AUTO_COMPACT_RETAINED_MESSAGE_TOKEN_BUDGET,
                trigger=trigger,
            ),
            completion=self.chat_completion,
        )
        usage_info = self.store.read_usage_info()
        if compact_result.summary_usage is not None:
            usage_info = append_token_usage(
                usage_info,
                compact_result.summary_usage,
                model_context_window=context_window_limit,
            )
        usage_info = recompute_context_usage(
            usage_info,
            compact_result.token_after,
            model_context_window=context_window_limit,
        )
        self.store.save_usage_info(usage_info)
        marker = StoredMessage(
            author="system",
            content=marker_content,
            id=str(uuid4()),
            summary=compact_result.summary,
            usage_info=usage_info,
        )
        self.store.save_compaction_checkpoint(
            StoredCompactionCheckpoint(
                id=str(uuid4()),
                method=compact_result.method,
                replacement_history=compact_result.replacement_history,
                source_message_id=source_message_id or marker.id,
                summary=compact_result.summary,
                token_after=compact_result.token_after,
                token_before=compact_result.token_before,
                trigger=trigger,
            )
        )
        logger.info(
            "Workspace compact checkpoint saved trigger=%s method=%s summary_length=%s token_before=%s token_after=%s",
            trigger,
            compact_result.method,
            len(compact_result.summary),
            compact_result.token_before,
            compact_result.token_after,
        )
        logger.log(TRACE_LEVEL, "Workspace compact summary=%r", compact_result.summary)
        return (
            marker,
            [message.model_dump() for message in compact_result.replacement_history],
            usage_info,
        )

    async def auto_compact_messages(
        self,
        *,
        connection: ProviderConnection,
        context_window_limit: int,
        budget_messages: Sequence[ChatMessage | Mapping[str, object]] | None = None,
        messages: list[StoredMessage],
        model_history: Sequence[ChatMessage | Mapping[str, object]],
        source_message_id: str | None = None,
        tools: Sequence[Mapping[str, object]] = (),
    ) -> tuple[StoredMessage, list[dict[str, object]], TokenUsageInfo] | None:
        if not should_auto_compact(
            budget_messages or model_history,
            context_window=context_window_limit,
            tools=tools,
        ):
            return None
        logger.info("Workspace auto compact requested")
        try:
            return await self.save_context_checkpoint(
                connection=connection,
                context_window_limit=context_window_limit,
                marker_content=OPTIMIZED_CONTEXT_MARKER,
                messages=messages,
                model_history=model_history,
                source_message_id=source_message_id,
                trigger="auto",
            )
        except Exception as error:
            logger.exception("Workspace auto compact failed")
            raise RuntimeError("Context could not be optimized.") from error

    async def run_turn(self, content: str) -> StoredMessage:
        async with self.turns.serialized_turn():
            return await self._run_turn(content)

    async def _run_turn(self, content: str) -> StoredMessage:
        state = self.store.read_state()
        connection = selected_connection(state)
        context_window_limit = context_window_for_settings(state.settings)
        user_message = StoredMessage(
            author="user",
            content=content,
            id=str(uuid4()),
        )
        next_messages = [*state.messages, user_message]
        self.store.save_messages(next_messages)
        model_tool_specs = self.model_tool_specs()
        model_history: list[ChatMessage | Mapping[str, object]] = [
            *runtime_context_messages(self.cwd, state.settings.agent_prompt),
            *workspace_chat_messages(
                state.messages,
                self.store.read_compacted_context(),
                self.store.read_active_compaction_checkpoint(),
            ),
        ]
        auto_compaction = await self.auto_compact_messages(
            connection=connection,
            context_window_limit=context_window_limit,
            budget_messages=self.request_messages_for_content(
                state, next_messages, content
            ),
            messages=state.messages,
            model_history=model_history,
            source_message_id=None,
            tools=model_tool_specs,
        )
        if auto_compaction is not None:
            marker, _, _ = auto_compaction
            next_messages = [*state.messages, marker, user_message]
            self.store.save_messages(next_messages)
        request_messages = self.request_messages_for_content(
            state, next_messages, content
        )
        assistant_id = str(uuid4())
        assistant_output = AssistantOutputBuilder(assistant_id)
        turn_usage_info: TokenUsageInfo | None = None
        current_output_index = 0
        latest_usage_output_index: int | None = None

        async for event in self.agent_runtime.stream(
            approval_transcript=approval_transcript(next_messages),
            connection=connection,
            messages=request_messages,
            user_request=content,
        ):
            if event.event == "start":
                event_id = event.data.get("id")
                if isinstance(event_id, str):
                    assistant_id = event_id
                    assistant_output.set_assistant_id(event_id)
            if event.event == "output_start":
                index = event.data.get("index")
                if isinstance(index, int):
                    current_output_index = index
                    assistant_output.start_group(index)
            if event.event == "delta":
                assistant_output.append_text(str(event.data.get("content") or ""))
            if event.event == "thinking_delta":
                assistant_output.append_thinking(str(event.data.get("content") or ""))
            if event.event == "usage":
                usage_data = event.data.get("usage")
                if isinstance(usage_data, dict):
                    usage_info = append_token_usage(
                        self.store.read_usage_info(),
                        TokenUsage.model_validate(usage_data),
                        model_context_window=context_window_limit,
                    )
                    self.store.save_usage_info(usage_info)
                    turn_usage_info = usage_info
                    latest_usage_output_index = current_output_index
            if event.event == "tool_start":
                tool = event.data.get("tool")
                if isinstance(tool, dict) and isinstance(tool.get("id"), str):
                    assistant_output.start_tool(StoredToolItem.model_validate(tool))
            if event.event in {"tool_done", "tool_error"}:
                tool_id = event.data.get("id")
                if isinstance(tool_id, str):
                    assistant_output.update_tool(tool_id, event.data)
            if event.event == "done":
                message = event.data.get("message")
                if isinstance(message, dict):
                    assistant_id = str(message.get("id") or assistant_id)
                    assistant_output.set_assistant_id(assistant_id)
                    assistant_output.apply_done_message(message)

        final_usage_info = turn_usage_info
        if (
            final_usage_info is None
            or latest_usage_output_index != current_output_index
        ):
            final_usage_info = update_context_usage_for_response(
                final_usage_info or self.store.read_usage_info(),
                messages=request_messages,
                output_content=assistant_output.content,
                output_tools=[
                    tool.model_dump(exclude_none=True)
                    for tool in assistant_output.tools.values()
                ],
                request_tools=model_tool_specs,
                model_context_window=context_window_limit,
            )
        self.store.save_usage_info(final_usage_info)

        assistant_message = StoredMessage(
            author="assistant",
            content=assistant_output.content,
            groups=assistant_output.groups,
            id=assistant_id,
            status="completed",
            thinking=assistant_output.thinking,
            tools=list(assistant_output.tools.values()),
            usage_info=final_usage_info,
        )
        self.store.save_messages([*next_messages, assistant_message])
        return assistant_message

    async def reply_text(self, content: str) -> str:
        return (await self.run_turn(content)).content

    async def stop_compact_for_shutdown(self) -> None:
        if self.active_compact_task is None:
            self.store.save_is_compacting(False)
            return
        task = self.active_compact_task.task
        self.active_compact_task = None
        if not task.done():
            task.cancel()
        await self.turns.gather_tasks("Workspace compact", [task])
        self.store.save_is_compacting(False)

    async def stop_for_shutdown(self) -> None:
        await self.turns.stop_response_for_shutdown()
        await self.stop_compact_for_shutdown()
        await self.turns.stop_background_tasks_for_shutdown()

    def current_response(self) -> WorkspaceResponse | None:
        return self.turns.current_response()

    def has_active_response(self) -> bool:
        return self.turns.has_active_response()

    async def clear(self) -> list[StoredMessage]:
        self.turns.cancel_for_clear()
        async with self.turns.serialized_turn():
            return self.store.save_messages([])

    async def replace_messages(
        self, messages: list[StoredMessage]
    ) -> list[StoredMessage]:
        if not self.turns.can_replace_messages():
            raise OperationConflictError("Response in progress")
        async with self.turns.serialized_turn():
            return self.store.save_messages(messages)

    async def notify_cleared_response(self) -> None:
        await self.turns.notify_cleared_response()

    async def start_response(
        self, content: str, *, message_id: str | None = None
    ) -> WorkspaceResponse:
        pending_response = self.turns.reserve_response()
        lock_acquired = False
        response_started = False
        try:
            if self.store.read_is_compacting():
                raise OperationConflictError(
                    "Context refining in progress. Please wait a moment."
                )
            await self.turns.acquire_response_turn(pending_response)
            lock_acquired = True
            if self.store.read_is_compacting():
                raise OperationConflictError(
                    "Context refining in progress. Please wait a moment."
                )
            state = self.store.read_state()
            user_message_id = message_id or str(uuid4())
            if any(message.id == user_message_id for message in state.messages):
                raise OperationConflictError("Message already exists.")
            user_message = StoredMessage(
                author="user",
                content=content,
                id=user_message_id,
            )
            next_messages = [*state.messages, user_message]
            self.store.save_messages(next_messages)
            response = self._start_response_from_messages(
                content=content,
                next_messages=next_messages,
                state=state,
                user_message=user_message,
            )
            self.turns.activate_response(pending_response)
            response_started = True
            return response
        finally:
            if not response_started:
                if lock_acquired:
                    self.turns.release_turn()
                self.turns.release_response(pending_response)

    async def edit_message(
        self,
        message_id: str,
        *,
        action: Literal["resend", "save"],
        content: str,
    ) -> tuple[list[StoredMessage], WorkspaceResponse | None]:
        pending_response = self.turns.reserve_response() if action == "resend" else None
        if pending_response is None and (
            self.turns.response_reserved or self.has_active_response()
        ):
            raise OperationConflictError("Response in progress")
        lock_acquired = False
        try:
            if self.store.read_is_compacting():
                raise OperationConflictError(
                    "Context refining in progress. Please wait a moment."
                )
            if pending_response is None:
                await self.turns.acquire_turn()
            else:
                await self.turns.acquire_response_turn(pending_response)
            lock_acquired = True
            result = self._edit_message_locked(
                message_id,
                action=action,
                content=content,
            )
            if result[1] is None:
                self.turns.release_turn()
                lock_acquired = False
            elif pending_response is not None:
                self.turns.activate_response(pending_response)
            return result
        except BaseException:
            if lock_acquired:
                self.turns.release_turn()
            if pending_response is not None:
                self.turns.release_response(pending_response)
            raise

    def _edit_message_locked(
        self,
        message_id: str,
        *,
        action: Literal["resend", "save"],
        content: str,
    ) -> tuple[list[StoredMessage], WorkspaceResponse | None]:
        if self.has_active_response():
            raise OperationConflictError("Response in progress")
        if self.store.read_is_compacting():
            raise OperationConflictError(
                "Context refining in progress. Please wait a moment."
            )
        state = self.store.read_state()
        message_index = next(
            (
                index
                for index, message in enumerate(state.messages)
                if message.id == message_id
            ),
            -1,
        )
        if message_index < 0:
            raise ResourceNotFoundError("Message not found.")
        message = state.messages[message_index]
        if message.author != "user":
            raise InvalidRequestError("Only user messages can be edited.")

        updated_message = message.model_copy(update={"content": content})
        if action == "save":
            next_messages = [
                *state.messages[:message_index],
                updated_message,
                *state.messages[message_index + 1 :],
            ]
            return self.store.save_messages(next_messages), None

        previous_messages = state.messages[:message_index]
        next_messages = [*previous_messages, updated_message]
        self.store.save_messages(next_messages)
        response = self._start_response_from_messages(
            content=content,
            next_messages=next_messages,
            state=state.model_copy(update={"messages": previous_messages}),
            user_message=updated_message,
        )
        return next_messages, response

    async def retry_error(
        self,
        message_id: str,
        *,
        error_id: str,
    ) -> tuple[list[StoredMessage], WorkspaceResponse]:
        pending_response = self.turns.reserve_response()
        lock_acquired = False
        try:
            if self.store.read_is_compacting():
                raise OperationConflictError(
                    "Context refining in progress. Please wait a moment."
                )
            await self.turns.acquire_response_turn(pending_response)
            lock_acquired = True
            result = self._retry_error_locked(message_id, error_id=error_id)
            self.turns.activate_response(pending_response)
            return result
        except BaseException:
            if lock_acquired:
                self.turns.release_turn()
            self.turns.release_response(pending_response)
            raise

    def _retry_error_locked(
        self,
        message_id: str,
        *,
        error_id: str,
    ) -> tuple[list[StoredMessage], WorkspaceResponse]:
        if self.has_active_response():
            raise OperationConflictError("Response in progress")
        if self.store.read_is_compacting():
            raise OperationConflictError(
                "Context refining in progress. Please wait a moment."
            )
        state = self.store.read_state()
        message_index = next(
            (
                index
                for index, message in enumerate(state.messages)
                if message.id == message_id
            ),
            -1,
        )
        if message_index < 0:
            raise ResourceNotFoundError("Message not found.")
        message = state.messages[message_index]
        if message.author != "assistant":
            raise InvalidRequestError("Only assistant errors can be retried.")
        previous_user_message = next(
            (
                current_message
                for current_message in reversed(state.messages[:message_index])
                if current_message.author == "user"
            ),
            None,
        )
        if previous_user_message is None:
            raise InvalidRequestError("Message history is invalid.")
        trimmed_message = trim_assistant_message_at_error(
            message,
            error_id,
            status="running",
        )
        if trimmed_message is None:
            raise ResourceNotFoundError("Error block not found.")

        previous_messages = state.messages[:message_index]
        next_messages = [*previous_messages, trimmed_message]
        self.store.save_messages(next_messages)
        state_before_assistant = state.model_copy(
            update={"messages": previous_messages}
        )
        base_request_messages = self.request_messages_for_content(
            state_before_assistant,
            previous_messages,
            previous_user_message.content,
        )
        request_messages = [
            *base_request_messages,
            *model_visible_assistant_output_messages(trimmed_message),
        ]
        try:
            response = self._start_response_from_messages(
                content=previous_user_message.content,
                initial_assistant_message=trimmed_message,
                next_messages=next_messages,
                output_start_index=assistant_retry_output_start_index(trimmed_message),
                request_messages=request_messages,
                state=state_before_assistant,
                usage_request_messages=base_request_messages,
                user_message=previous_user_message,
            )
        except ApplicationError as error:
            error_detail = str(error)
            assistant_output = AssistantOutputBuilder.from_message(trimmed_message)
            assistant_output.append_error(
                run_error_output_item(trimmed_message.id, error_detail).model_copy(
                    update={"id": error_id}
                )
            )
            failed_message = StoredMessage(
                author="assistant",
                content=assistant_output.content,
                groups=assistant_output.groups,
                id=trimmed_message.id,
                status="failed",
                thinking=assistant_output.thinking,
                tools=list(assistant_output.tools.values()),
                usage_info=self.store.read_usage_info(),
            )
            self.store.save_messages([*previous_messages, failed_message])
            raise
        return next_messages, response

    def _start_response_from_messages(
        self,
        *,
        content: str,
        initial_assistant_message: StoredMessage | None = None,
        next_messages: list[StoredMessage],
        output_start_index: int = 1,
        request_messages: list[dict[str, object]] | None = None,
        state: StoredState,
        usage_request_messages: list[dict[str, object]] | None = None,
        user_message: StoredMessage,
    ) -> WorkspaceResponse:
        connection = selected_connection(state)
        context_window_limit = context_window_for_settings(state.settings)
        response_session = self.turns.start_response_session()
        response = response_session.response

        async def response_task() -> None:
            nonlocal next_messages
            assistant_message = (
                initial_assistant_message
                if initial_assistant_message is not None
                else StoredMessage(
                    author="assistant",
                    content="",
                    id=str(uuid4()),
                    status="running",
                )
            )
            assistant_output = (
                AssistantOutputBuilder.from_message(assistant_message)
                if initial_assistant_message is not None
                else AssistantOutputBuilder(assistant_message.id)
            )
            initial_assistant_content = assistant_output.content
            initial_assistant_thinking = assistant_output.thinking
            last_progress_flush_at = 0.0

            def is_current_generation() -> bool:
                return response_session.is_current_generation()

            def update_assistant_message(
                status: str = "running", *, persist: bool
            ) -> StoredMessage | None:
                nonlocal next_messages, assistant_message
                if not is_current_generation() or response.discard_on_cancel:
                    return None
                assistant_message = StoredMessage(
                    author="assistant",
                    content=assistant_output.content,
                    groups=assistant_output.groups,
                    id=assistant_message.id,
                    status=status,
                    thinking=assistant_output.thinking,
                    tools=list(assistant_output.tools.values()),
                    usage_info=self.store.read_usage_info(),
                )
                next_messages = append_or_replace_message(
                    next_messages, assistant_message
                )
                if persist:
                    self.store.upsert_message(assistant_message)
                return assistant_message

            def persist_assistant(status: str = "running") -> StoredMessage | None:
                nonlocal last_progress_flush_at
                message = update_assistant_message(status, persist=True)
                if status == "running" and message is not None:
                    last_progress_flush_at = time.monotonic()
                return message

            def refresh_assistant(status: str = "running") -> StoredMessage | None:
                return update_assistant_message(status, persist=False)

            def persist_assistant_progress(
                *, force: bool = False
            ) -> StoredMessage | None:
                nonlocal last_progress_flush_at
                now = time.monotonic()
                if (
                    not force
                    and last_progress_flush_at > 0
                    and now - last_progress_flush_at
                    < WORKSPACE_PROGRESS_FLUSH_INTERVAL_SECONDS
                ):
                    refresh_assistant()
                    return None
                last_progress_flush_at = now
                return update_assistant_message("running", persist=True)

            def has_tool_result(tool_id: str) -> bool:
                tool = assistant_output.tools.get(tool_id)
                return tool is not None and bool(tool.result)

            try:
                current_tool_id: str | None = None
                turn_usage_info: TokenUsageInfo | None = None
                current_output_index = 0
                latest_usage_output_index: int | None = None
                model_tool_specs = self.model_tool_specs()
                if request_messages is None:
                    current_request_messages = self.request_messages_for_content(
                        state,
                        next_messages,
                        content,
                    )
                    pre_turn_request_messages = self.request_messages_for_content(
                        state,
                        state.messages,
                        content,
                    )
                    auto_compaction = await self.auto_compact_messages(
                        connection=connection,
                        context_window_limit=context_window_limit,
                        budget_messages=current_request_messages,
                        messages=state.messages,
                        model_history=pre_turn_request_messages,
                        source_message_id=None,
                        tools=model_tool_specs,
                    )
                    if auto_compaction is not None:
                        marker, _, usage_info = auto_compaction
                        next_messages = [*state.messages, marker, user_message]
                        self.store.save_messages(next_messages)
                        await response_session.append_event(
                            "context_optimized",
                            {
                                "message": marker.model_dump(),
                                **usage_event_data(usage_info),
                            },
                        )
                        current_request_messages = self.request_messages_for_content(
                            state,
                            next_messages,
                            content,
                        )
                else:
                    current_request_messages = request_messages
                    auto_compaction = await self.auto_compact_messages(
                        connection=connection,
                        context_window_limit=context_window_limit,
                        messages=next_messages,
                        model_history=compact_prompt_chat_messages(
                            current_request_messages
                        ),
                        source_message_id=assistant_message.id,
                        tools=model_tool_specs,
                    )
                    if auto_compaction is not None:
                        marker, replacement_history, usage_info = auto_compaction
                        assistant_message = assistant_message.model_copy(
                            update={"usage_info": usage_info}
                        )
                        next_messages = append_or_replace_message(
                            [*next_messages, marker], assistant_message
                        )
                        self.store.save_messages(next_messages)
                        await response_session.append_event(
                            "context_optimized",
                            {
                                "message": marker.model_dump(),
                                **usage_event_data(usage_info),
                            },
                        )
                        current_request_messages = model_request_messages_data(
                            [
                                *runtime_context_messages(
                                    self.cwd, state.settings.agent_prompt
                                ),
                                *explicit_skill_messages(self.cwd, self.store, content),
                                *replacement_history,
                            ]
                        )
                context_usage_messages = (
                    usage_request_messages
                    if usage_request_messages is not None
                    else current_request_messages
                )

                async def context_compactor(
                    conversation: Sequence[Mapping[str, object]],
                ) -> AgentContextUpdate | None:
                    nonlocal next_messages
                    if not is_current_generation() or response.discard_on_cancel:
                        return None
                    assistant_snapshot = StoredMessage(
                        author="assistant",
                        content=assistant_output.content,
                        groups=assistant_output.groups,
                        id=assistant_message.id,
                        status="running",
                        thinking=assistant_output.thinking,
                        tools=list(assistant_output.tools.values()),
                        usage_info=self.store.read_usage_info(),
                    )
                    auto_result = await self.auto_compact_messages(
                        connection=connection,
                        context_window_limit=context_window_limit,
                        messages=next_messages,
                        model_history=compact_prompt_chat_messages(conversation),
                        source_message_id=assistant_snapshot.id,
                        tools=model_tool_specs,
                    )
                    if auto_result is None:
                        return None
                    marker, replacement_history, usage_info = auto_result
                    assistant_snapshot = assistant_snapshot.model_copy(
                        update={"usage_info": usage_info}
                    )
                    next_messages = append_or_replace_message(
                        [*next_messages, marker], assistant_snapshot
                    )
                    self.store.save_messages(next_messages)
                    compacted_conversation = [
                        dict(conversation[0]),
                        *replacement_history,
                    ]
                    return AgentContextUpdate(
                        conversation=compacted_conversation,
                        message={
                            **marker.model_dump(),
                            "usage_info": usage_info.model_dump(),
                        },
                    )

                async for event in self.agent_runtime.stream(
                    approval_transcript=approval_transcript(next_messages),
                    connection=connection,
                    context_compactor=context_compactor,
                    messages=current_request_messages,
                    user_request=content,
                ):
                    if not is_current_generation() or response.discard_on_cancel:
                        raise asyncio.CancelledError
                    run_event_data = event.data
                    should_append_run_event = event.event != "usage"
                    snapshot_after_event: StoredMessage | None = None
                    if event.event == "start":
                        event_id = event.data.get("id")
                        if initial_assistant_message is not None:
                            assistant_output.set_assistant_id(assistant_message.id)
                            run_event_data = {"id": assistant_message.id}
                            snapshot_after_event = persist_assistant()
                        elif isinstance(event_id, str):
                            assistant_message = assistant_message.model_copy(
                                update={"id": event_id}
                            )
                            assistant_output.set_assistant_id(event_id)
                            snapshot_after_event = persist_assistant()
                    if event.event == "output_start":
                        index = event.data.get("index")
                        if isinstance(index, int):
                            output_index = index + output_start_index - 1
                            current_output_index = output_index
                            run_event_data = {**event.data, "index": output_index}
                            response.active_output = None
                            assistant_output.start_group(output_index)
                            snapshot_after_event = persist_assistant()
                    if event.event == "output_done":
                        index = event.data.get("index")
                        if isinstance(index, int):
                            run_event_data = {
                                **event.data,
                                "index": index + output_start_index - 1,
                            }
                        response.active_output = None
                    if event.event == "tool_start":
                        tool = event.data.get("tool")
                        if isinstance(tool, dict) and isinstance(tool.get("id"), str):
                            response.active_output = None
                            current_tool_id = tool["id"]
                            assistant_output.start_tool(
                                StoredToolItem.model_validate(tool)
                            )
                            snapshot_after_event = persist_assistant()
                    if event.event == "tool_update":
                        tool_id = event.data.get("id")
                        if (
                            isinstance(tool_id, str)
                            and tool_id in assistant_output.tools
                        ):
                            had_result = has_tool_result(tool_id)
                            assistant_output.update_tool(tool_id, event.data)
                            snapshot_after_event = persist_assistant_progress(
                                force=not had_result
                            )
                    if event.event in {"tool_done", "tool_error"}:
                        tool_id = event.data.get("id")
                        if (
                            isinstance(tool_id, str)
                            and tool_id in assistant_output.tools
                        ):
                            current_tool_id = (
                                None if current_tool_id == tool_id else current_tool_id
                            )
                            assistant_output.update_tool(tool_id, event.data)
                            snapshot_after_event = persist_assistant()
                    if event.event == "delta":
                        response.active_output = "text"
                        assistant_output.append_text(
                            str(event.data.get("content") or "")
                        )
                        snapshot_after_event = persist_assistant_progress()
                    if event.event == "thinking_delta":
                        response.active_output = "thinking"
                        assistant_output.append_thinking(
                            str(event.data.get("content") or "")
                        )
                        snapshot_after_event = persist_assistant_progress()
                    if event.event == "usage":
                        usage_data = event.data.get("usage")
                        if isinstance(usage_data, dict):
                            usage_info = append_token_usage(
                                self.store.read_usage_info(),
                                TokenUsage.model_validate(usage_data),
                                model_context_window=context_window_limit,
                            )
                            self.store.save_usage_info(usage_info)
                            turn_usage_info = usage_info
                            latest_usage_output_index = current_output_index
                            run_event_data = usage_event_data(usage_info)
                            should_append_run_event = True
                            snapshot_after_event = persist_assistant()
                    logger.log(
                        TRACE_LEVEL,
                        "Workspace stream event=%s data=%r",
                        event.event,
                        event.data,
                    )
                    if event.event == "done":
                        message = event.data.get("message")
                        if isinstance(message, dict):
                            response.active_output = None
                            assistant_output.apply_done_message(
                                message,
                                content_prefix=initial_assistant_content,
                                thinking_prefix=initial_assistant_thinking,
                            )
                            response_usage_info = self.store.read_usage_info()
                            final_usage_info = turn_usage_info
                            if (
                                final_usage_info is None
                                or latest_usage_output_index != current_output_index
                            ):
                                final_usage_info = update_context_usage_for_response(
                                    final_usage_info or response_usage_info,
                                    messages=context_usage_messages,
                                    output_content=assistant_output.content,
                                    output_tools=[
                                        tool.model_dump(exclude_none=True)
                                        for tool in assistant_output.tools.values()
                                    ],
                                    request_tools=model_tool_specs,
                                    model_context_window=context_window_limit,
                                )
                            self.store.save_usage_info(final_usage_info)
                            snapshot_after_event = persist_assistant("completed")
                            if snapshot_after_event is not None:
                                run_event_data = {
                                    "message": stream_message_data(snapshot_after_event)
                                }
                    if event.event == "done" and snapshot_after_event is not None:
                        await response_session.append_snapshot(snapshot_after_event)
                        await response_session.append_event(event.event, run_event_data)
                    else:
                        if should_append_run_event:
                            await response_session.append_event(
                                event.event, run_event_data
                            )
                        if snapshot_after_event is not None:
                            await response_session.append_snapshot(snapshot_after_event)
            except asyncio.CancelledError:
                logger.info("Workspace response stopped")
                if not response.discard_on_cancel:
                    interrupted_snapshot = persist_assistant("interrupted")
                    if interrupted_snapshot is not None:
                        await response_session.append_snapshot(interrupted_snapshot)
                    await response_session.append_event(
                        "error",
                        {"message": "Response stopped."},
                    )
                raise
            except Exception as error:
                logger.exception("Workspace response failed")
                if is_context_window_error(error):
                    usage_info = full_context_usage(
                        self.store.read_usage_info(),
                        model_context_window=context_window_limit,
                    )
                    self.store.save_usage_info(usage_info)
                if (
                    current_tool_id is not None
                    and current_tool_id in assistant_output.tools
                    and assistant_output.tools[current_tool_id].status == "running"
                ):
                    assistant_output.update_tool(
                        current_tool_id,
                        {
                            "result": text_tool_result(str(error) or "Tool failed."),
                            "status": "failed",
                        },
                    )
                error_item = assistant_output.append_error(
                    run_error_output_item(
                        assistant_message.id,
                        str(error) or EMPTY_MODEL_RESPONSE_DETAIL,
                    )
                )
                failed_snapshot = persist_assistant("failed")
                if failed_snapshot is not None:
                    await response_session.append_snapshot(failed_snapshot)
                await response_session.append_event(
                    "error", run_error_event_data(error_item)
                )
            finally:
                await response_session.finish()

        response_task_handle = asyncio.create_task(response_task())
        return response_session.attach_task(response_task_handle)

    async def response_stream(
        self,
        response: WorkspaceResponse,
        after: int = 0,
        include_snapshots: bool = True,
    ) -> AsyncIterator[str]:
        async for event in self.turns.response_stream(
            response,
            after=after,
            include_snapshots=include_snapshots,
        ):
            yield event

    def stream_current_response(self) -> WorkspaceResponse:
        return self.turns.stream_current_response()

    def stop_response(self) -> None:
        self.turns.stop_response()

    def compact_stream(self) -> AsyncIterator[str]:
        async def run_manual_compact() -> tuple[StoredMessage, TokenUsageInfo]:
            try:
                async with self.turns.serialized_turn():
                    state = self.store.read_state()
                    connection = selected_connection(state)
                    context_window_limit = context_window_for_settings(state.settings)
                    checkpoint = self.store.read_active_compaction_checkpoint()
                    logger.info("Workspace compact requested")
                    model_history: list[ChatMessage | Mapping[str, object]] = [
                        *runtime_context_messages(
                            self.cwd, state.settings.agent_prompt
                        ),
                        *workspace_chat_messages(
                            state.messages,
                            self.store.read_compacted_context(),
                            checkpoint,
                        ),
                    ]

                    marker, _, usage_info = await self.save_context_checkpoint(
                        connection=connection,
                        context_window_limit=context_window_limit,
                        marker_content=COMPACTED_CONTEXT_MARKER,
                        messages=state.messages,
                        model_history=model_history,
                        source_message_id=None,
                        trigger="manual",
                    )
                    self.store.save_messages([*state.messages, marker])
                    logger.info("Workspace compact completed")
                    return marker, usage_info
            except Exception:
                logger.exception("Workspace compact failed")
                raise
            finally:
                self.store.save_is_compacting(False)

        def clear_active_compact_task(
            task: asyncio.Task[tuple[StoredMessage, TokenUsageInfo]],
        ) -> None:
            if (
                self.active_compact_task is not None
                and self.active_compact_task.task is task
            ):
                self.active_compact_task = None
            with suppress(asyncio.CancelledError):
                task.exception()

        compact_task: asyncio.Task[tuple[StoredMessage, TokenUsageInfo]]
        if self.active_compact_task is not None:
            if not self.active_compact_task.task.done():
                compact_task = self.active_compact_task.task
            else:
                self.active_compact_task = None

        if self.active_compact_task is None:
            if self.response_reserved or self.current_response() is not None:
                raise OperationConflictError(
                    "Compact is unavailable while Flowent is responding."
                )
            self.store.save_is_compacting(True)
            compact_task = asyncio.create_task(run_manual_compact())
            compact_task.add_done_callback(clear_active_compact_task)
            self.active_compact_task = WorkspaceCompactTask(task=compact_task)

        async def compact_events() -> AsyncIterator[str]:
            try:
                marker, usage_info = await asyncio.shield(compact_task)
            except Exception as error:
                assistant_id = str(uuid4())
                assistant_output = AssistantOutputBuilder(assistant_id)
                error_item = run_error_output_item(assistant_id, str(error)).model_copy(
                    update={"message": USER_VISIBLE_MANUAL_COMPACT_ERROR_MESSAGE}
                )
                assistant_output.append_error(error_item)
                failed_message = StoredMessage(
                    author="assistant",
                    content="",
                    groups=assistant_output.groups,
                    id=assistant_id,
                    status="failed",
                )
                self.store.save_messages(
                    [*self.store.read_state().messages, failed_message]
                )
                failed_message_data = stream_message_data(failed_message)
                yield stream_event("snapshot", {"message": failed_message_data})
                yield stream_event(
                    "error",
                    {
                        "error": error_item.model_dump(exclude_none=True),
                        "message": USER_VISIBLE_MANUAL_COMPACT_ERROR_MESSAGE,
                    },
                )
                return

            marker_data = marker.model_dump()
            yield stream_event("usage", usage_event_data(usage_info))
            yield stream_event(
                "context_optimized",
                {"message": marker_data, **usage_event_data(usage_info)},
            )
            yield stream_event("done", {"message": marker_data})

        return compact_events()
