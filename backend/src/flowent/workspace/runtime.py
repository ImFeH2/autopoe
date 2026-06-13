import asyncio
import logging
import time
from collections.abc import AsyncIterator, Mapping, Sequence
from contextlib import suppress
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal
from uuid import uuid4

from fastapi import HTTPException

from flowent.agent import AgentContextUpdate, run_agent_stream
from flowent.approval import ApprovalReviewRequest, review_approval_request
from flowent.compact import CompactInput, CompactProvider
from flowent.context import runtime_context_messages
from flowent.llm import ChatMessage, CompletionCallable, ProviderConnection
from flowent.logging import TRACE_LEVEL
from flowent.mcp import McpManager
from flowent.permissions import run_tool_with_path_permissions
from flowent.provider_connections import selected_connection
from flowent.skills import explicit_skill_messages
from flowent.storage import (
    StateStore,
    StoredCompactionCheckpoint,
    StoredMessage,
    StoredState,
    StoredToolItem,
)
from flowent.tools import ToolContext, tool_specs
from flowent.usage import (
    TokenUsage,
    TokenUsageInfo,
    append_token_usage,
    full_context_usage,
    is_context_window_error,
    recompute_context_usage,
)
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
    response_snapshot_data_at,
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
    ) -> None:
        self.chat_completion = chat_completion
        self.compact_provider = compact_provider
        self.cwd = cwd
        self.mcp_manager = mcp_manager
        self.store = store
        self.active_response: WorkspaceResponse | None = None
        self.generation = 0
        self.active_compact_task: WorkspaceCompactTask | None = None

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
        model_tool_specs = [
            *tool_specs(),
            *list(self.mcp_manager.tool_specs()),
        ]
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

        async def review_tool_approval(request: ApprovalReviewRequest):
            return await review_approval_request(
                connection,
                request.model_copy(
                    update={
                        "transcript": approval_transcript(next_messages),
                        "user_request": content,
                    }
                ),
                completion=self.chat_completion,
            )

        async def tool_runner(
            name: str,
            arguments: dict[str, object],
            context: ToolContext,
        ):
            return await run_tool_with_path_permissions(
                name,
                arguments,
                context,
                review_approval=review_tool_approval,
                writable_paths=[
                    Path(path.path) for path in self.store.read_writable_paths()
                ],
            )

        async for event in run_agent_stream(
            completion=self.chat_completion,
            connection=connection,
            cwd=self.cwd,
            extra_tool_runner=self.mcp_manager.run_tool,
            extra_tool_specs=self.mcp_manager.tool_specs(),
            extra_tool_title=self.mcp_manager.tool_title,
            messages=request_messages,
            tool_runner=tool_runner,
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

    async def gather_shutdown_tasks(
        self, label: str, tasks: Sequence[asyncio.Task[Any]]
    ) -> None:
        if not tasks:
            return
        results = await asyncio.gather(*tasks, return_exceptions=True)
        for result in results:
            if result is None or isinstance(result, asyncio.CancelledError):
                continue
            if isinstance(result, BaseException):
                logger.error(
                    "%s cleanup task failed",
                    label,
                    exc_info=(type(result), result, result.__traceback__),
                )

    async def stop_response_for_shutdown(self) -> None:
        tasks: list[asyncio.Task[None]] = []
        response = self.active_response
        if response is not None and response.task is not None:
            if not response.task.done():
                response.task.cancel()
            tasks.append(response.task)
        await self.gather_shutdown_tasks("Workspace response", tasks)

    async def stop_compact_for_shutdown(self) -> None:
        if self.active_compact_task is None:
            self.store.save_is_compacting(False)
            return
        task = self.active_compact_task.task
        self.active_compact_task = None
        if not task.done():
            task.cancel()
        await self.gather_shutdown_tasks("Workspace compact", [task])
        self.store.save_is_compacting(False)

    async def stop_for_shutdown(self) -> None:
        await self.stop_response_for_shutdown()
        await self.stop_compact_for_shutdown()

    def current_response(self) -> WorkspaceResponse | None:
        response = self.active_response
        if response is None or response.is_done:
            return None
        return response

    def has_active_response(self) -> bool:
        response = self.active_response
        return (
            response is not None
            and not response.is_done
            and response.task is not None
            and not response.task.done()
        )

    def clear(self) -> list[StoredMessage]:
        self.generation += 1
        response = self.active_response
        if response is not None:
            response.is_done = True
            if response.task is not None and not response.task.done():
                response.discard_on_cancel = True
                response.task.cancel()
        return self.store.save_messages([])

    async def notify_cleared_response(self) -> None:
        response = self.active_response
        if response is None:
            return
        async with response.condition:
            response.condition.notify_all()

    async def append_event(
        self, response: WorkspaceResponse, event: str, data: dict[str, object]
    ) -> None:
        async with response.condition:
            response.events.append((response.latest_event_index + 1, event, data))
            response.condition.notify_all()

    async def append_snapshot(
        self, response: WorkspaceResponse, message: StoredMessage
    ) -> None:
        if message.author != "assistant":
            return
        response.latest_snapshot = message
        await self.append_event(
            response,
            "snapshot",
            {"message": stream_message_data(message, response.active_output)},
        )

    def start_response(
        self, content: str, *, message_id: str | None = None
    ) -> WorkspaceResponse:
        if self.has_active_response():
            raise HTTPException(
                status_code=409,
                detail="Response in progress",
            )
        if self.store.read_is_compacting():
            raise HTTPException(
                status_code=409,
                detail="Context refining in progress. Please wait a moment.",
            )
        state = self.store.read_state()
        user_message_id = message_id or str(uuid4())
        if any(message.id == user_message_id for message in state.messages):
            raise HTTPException(status_code=409, detail="Message already exists.")
        user_message = StoredMessage(
            author="user",
            content=content,
            id=user_message_id,
        )
        next_messages = [*state.messages, user_message]
        self.store.save_messages(next_messages)
        return self._start_response_from_messages(
            content=content,
            next_messages=next_messages,
            state=state,
            user_message=user_message,
        )

    def edit_message(
        self,
        message_id: str,
        *,
        action: Literal["resend", "save"],
        content: str,
    ) -> tuple[list[StoredMessage], WorkspaceResponse | None]:
        if self.has_active_response():
            raise HTTPException(
                status_code=409,
                detail="Response in progress",
            )
        if self.store.read_is_compacting():
            raise HTTPException(
                status_code=409,
                detail="Context refining in progress. Please wait a moment.",
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
            raise HTTPException(status_code=404, detail="Message not found.")
        message = state.messages[message_index]
        if message.author != "user":
            raise HTTPException(
                status_code=400, detail="Only user messages can be edited."
            )

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

    def retry_error(
        self,
        message_id: str,
        *,
        error_id: str,
    ) -> tuple[list[StoredMessage], WorkspaceResponse]:
        if self.has_active_response():
            raise HTTPException(
                status_code=409,
                detail="Response in progress",
            )
        if self.store.read_is_compacting():
            raise HTTPException(
                status_code=409,
                detail="Context refining in progress. Please wait a moment.",
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
            raise HTTPException(status_code=404, detail="Message not found.")
        message = state.messages[message_index]
        if message.author != "assistant":
            raise HTTPException(
                status_code=400, detail="Only assistant errors can be retried."
            )
        previous_user_message = next(
            (
                current_message
                for current_message in reversed(state.messages[:message_index])
                if current_message.author == "user"
            ),
            None,
        )
        if previous_user_message is None:
            raise HTTPException(status_code=400, detail="Message history is invalid.")
        trimmed_message = trim_assistant_message_at_error(
            message,
            error_id,
            status="running",
        )
        if trimmed_message is None:
            raise HTTPException(status_code=404, detail="Error block not found.")

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
        response = WorkspaceResponse(
            condition=asyncio.Condition(),
            generation=self.generation,
        )
        self.active_response = response

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
                return response.generation == self.generation

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

            def persist_assistant_progress() -> StoredMessage | None:
                nonlocal last_progress_flush_at
                now = time.monotonic()
                if (
                    last_progress_flush_at > 0
                    and now - last_progress_flush_at
                    < WORKSPACE_PROGRESS_FLUSH_INTERVAL_SECONDS
                ):
                    refresh_assistant()
                    return None
                last_progress_flush_at = now
                return update_assistant_message("running", persist=True)

            try:
                current_tool_id: str | None = None
                turn_usage_info: TokenUsageInfo | None = None
                current_output_index = 0
                latest_usage_output_index: int | None = None
                model_tool_specs = [
                    *tool_specs(),
                    *list(self.mcp_manager.tool_specs()),
                ]
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
                        await self.append_event(
                            response,
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
                        await self.append_event(
                            response,
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

                async def review_tool_approval(request: ApprovalReviewRequest):
                    return await review_approval_request(
                        connection,
                        request.model_copy(
                            update={
                                "transcript": approval_transcript(next_messages),
                                "user_request": content,
                            }
                        ),
                        completion=self.chat_completion,
                    )

                async def tool_runner(
                    name: str,
                    arguments: dict[str, object],
                    context: ToolContext,
                ):
                    return await run_tool_with_path_permissions(
                        name,
                        arguments,
                        context,
                        review_approval=review_tool_approval,
                        writable_paths=[
                            Path(path.path) for path in self.store.read_writable_paths()
                        ],
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

                async for event in run_agent_stream(
                    completion=self.chat_completion,
                    connection=connection,
                    context_compactor=context_compactor,
                    cwd=self.cwd,
                    extra_tool_runner=self.mcp_manager.run_tool,
                    extra_tool_specs=self.mcp_manager.tool_specs(),
                    extra_tool_title=self.mcp_manager.tool_title,
                    messages=current_request_messages,
                    tool_runner=tool_runner,
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
                        await self.append_snapshot(response, snapshot_after_event)
                        await self.append_event(response, event.event, run_event_data)
                    else:
                        if should_append_run_event:
                            await self.append_event(
                                response, event.event, run_event_data
                            )
                        if snapshot_after_event is not None:
                            await self.append_snapshot(response, snapshot_after_event)
            except asyncio.CancelledError:
                logger.info("Workspace response stopped")
                if not response.discard_on_cancel:
                    interrupted_snapshot = persist_assistant("interrupted")
                    if interrupted_snapshot is not None:
                        await self.append_snapshot(response, interrupted_snapshot)
                    await self.append_event(
                        response,
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
                        {"content": str(error) or "Tool failed.", "status": "failed"},
                    )
                error_item = assistant_output.append_error(
                    run_error_output_item(
                        assistant_message.id,
                        str(error) or EMPTY_MODEL_RESPONSE_DETAIL,
                    )
                )
                failed_snapshot = persist_assistant("failed")
                if failed_snapshot is not None:
                    await self.append_snapshot(response, failed_snapshot)
                await self.append_event(
                    response, "error", run_error_event_data(error_item)
                )
            finally:
                response.is_done = True
                async with response.condition:
                    response.condition.notify_all()
                if self.active_response is response:
                    self.active_response = None

        response.task = asyncio.create_task(response_task())
        return response

    async def response_stream(
        self,
        response: WorkspaceResponse,
        after: int = 0,
        include_snapshots: bool = True,
    ) -> AsyncIterator[str]:
        next_event_index = after + 1
        reconnect_snapshot = (
            response_snapshot_data_at(response, after) if after > 0 else None
        )
        if include_snapshots and reconnect_snapshot is not None:
            yield stream_event(
                "snapshot",
                {"message": reconnect_snapshot},
                event_id=after,
            )
        while True:
            async with response.condition:

                def has_next_event(index: int = next_event_index) -> bool:
                    return response.is_done or any(
                        event_index >= index for event_index, _, _ in response.events
                    )

                await response.condition.wait_for(has_next_event)
                events = [
                    event for event in response.events if event[0] >= next_event_index
                ]

            for index, event, data in events:
                next_event_index = index + 1
                if event == "snapshot" and not include_snapshots:
                    continue
                yield stream_event(event, data, event_id=index)
                if event in {"done", "error"}:
                    return

            if response.is_done and not events:
                return

    def stream_current_response(self) -> WorkspaceResponse:
        response = self.current_response()
        if response is None:
            raise HTTPException(status_code=404, detail="Response not found.")
        return response

    def stop_response(self) -> None:
        response = self.current_response()
        if (
            response is not None
            and response.task is not None
            and not response.task.done()
        ):
            response.task.cancel()

    def compact_stream(self) -> AsyncIterator[str]:
        async def run_manual_compact(
            *,
            checkpoint: StoredCompactionCheckpoint | None,
            connection: ProviderConnection,
            context_window_limit: int,
            state: StoredState,
        ) -> tuple[StoredMessage, TokenUsageInfo]:
            logger.info("Workspace compact requested")
            try:
                model_history: list[ChatMessage | Mapping[str, object]] = [
                    *runtime_context_messages(self.cwd, state.settings.agent_prompt),
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
            if self.current_response() is not None:
                raise HTTPException(
                    status_code=409,
                    detail="Compact is unavailable while Flowent is responding.",
                )
            state = self.store.read_state()
            connection = selected_connection(state)
            context_window_limit = context_window_for_settings(state.settings)
            checkpoint = self.store.read_active_compaction_checkpoint()
            self.store.save_is_compacting(True)
            compact_task = asyncio.create_task(
                run_manual_compact(
                    checkpoint=checkpoint,
                    connection=connection,
                    context_window_limit=context_window_limit,
                    state=state,
                )
            )
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
