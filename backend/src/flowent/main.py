import asyncio
import logging
import os
import time
from collections.abc import AsyncIterator, Awaitable, Mapping, Sequence
from contextlib import asynccontextmanager, suppress
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal
from uuid import uuid4

from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

from flowent._version import __version__
from flowent.agent import AgentContextUpdate, run_agent_stream
from flowent.api_models import (
    AboutResponse,
    McpImportPreviewRequest,
    McpImportRequest,
    ProviderModelsRequest,
    ProviderModelsResponse,
    SkillSettingsRequest,
    TelegramSessionApproveRequest,
    WorkspaceClearResponse,
    WorkspaceMessagesRequest,
    WorkspaceRespondRequest,
    WorkspaceRunResponse,
    WritablePathListResponse,
    WritablePathRequest,
)
from flowent.approval import (
    ApprovalReviewRequest,
    review_approval_request,
)
from flowent.channels import TelegramBotManager, TelegramTransport
from flowent.compact import (
    CompactInput,
    LocalSummaryCompactProvider,
)
from flowent.context import runtime_context_messages
from flowent.llm import (
    ChatMessage,
    CompletionCallable,
    ProviderConnection,
    list_provider_models,
)
from flowent.logging import (
    TRACE_LEVEL,
    ensure_logging_configured,
)
from flowent.mcp import McpManager, McpTransport
from flowent.mcp_import import McpImportDiscovery, discover_imported_mcp_servers
from flowent.paths import resolve_workdir
from flowent.permissions import run_tool_with_path_permissions
from flowent.sandbox import ensure_sandbox_available
from flowent.skills import (
    discover_skills,
    explicit_skill_messages,
    update_skill_enabled,
)
from flowent.storage import (
    StateStore,
    StoredCompactionCheckpoint,
    StoredMcpServer,
    StoredMessage,
    StoredProvider,
    StoredSettings,
    StoredSkill,
    StoredState,
    StoredTelegramBot,
    StoredTelegramSession,
    StoredToolItem,
    StoredWorkflow,
    StoredWritablePath,
)
from flowent.tools import ToolContext
from flowent.usage import (
    TokenUsage,
    TokenUsageInfo,
    append_token_usage,
    recompute_context_usage,
)
from flowent.workflows import (
    WorkflowRunResponse,
    run_workflow_definition,
    validate_workflow,
    workflow_requires_connection,
)
from flowent.workspace.context import (
    COMPACTED_CONTEXT_MARKER,
    OPTIMIZED_CONTEXT_MARKER,
    context_window_for_settings,
    should_auto_compact,
    state_with_current_model_context_window,
    update_context_usage_for_response,
    usage_event_data,
    workspace_chat_messages,
)
from flowent.workspace.events import (
    WorkspaceRun,
    append_or_replace_message,
    run_snapshot_data_at,
    stream_event,
    stream_message_data,
)
from flowent.workspace.output import (
    EMPTY_MODEL_RESPONSE_DETAIL,
    AssistantOutputBuilder,
    approval_transcript,
    run_error_event_data,
    run_error_output_item,
)

logger = logging.getLogger("flowent.main")


DEFAULT_STATIC_DIR = Path(__file__).parent / "static"
AUTO_COMPACT_RETAINED_MESSAGE_TOKEN_BUDGET = 20_000
WORKSPACE_PROGRESS_FLUSH_INTERVAL_SECONDS = 0.5


@dataclass
class WorkspaceCompactTask:
    task: asyncio.Task[tuple[StoredMessage, TokenUsageInfo]]


def frontend_static_directory() -> Path:
    configured_directory = os.environ.get("FLOWENT_STATIC_DIR")
    if configured_directory:
        return Path(configured_directory)
    repository_frontend_dist = Path(__file__).resolve().parents[3] / "frontend" / "dist"
    if repository_frontend_dist.is_dir():
        return repository_frontend_dist
    return DEFAULT_STATIC_DIR


def selected_connection(state: StoredState) -> ProviderConnection:
    provider = next(
        (
            stored_provider
            for stored_provider in state.providers
            if stored_provider.id == state.settings.selected_provider_id
        ),
        None,
    )
    if provider is None or not state.settings.selected_model:
        logger.warning("Workspace request blocked because provider or model is missing")
        raise HTTPException(
            status_code=400,
            detail="Choose a provider and model before sending.",
        )
    if not provider.api_key:
        logger.warning("Workspace request blocked because selected provider has no key")
        raise HTTPException(status_code=400, detail="Add a key before sending.")

    logger.debug(
        "Workspace request using provider=%s model=%s",
        provider.name,
        state.settings.selected_model,
    )
    return ProviderConnection(
        base_url=provider.base_url or None,
        model=state.settings.selected_model,
        name=provider.name,
        provider=provider.type,
        reasoning_effort=state.settings.reasoning_effort,
        secret_reference=provider.api_key,
    )


def normalized_request_path(path: str, cwd: Path) -> Path:
    raw_path = Path(path).expanduser()
    if not raw_path.is_absolute():
        raw_path = cwd / raw_path
    return raw_path.resolve(strict=False)


def create_app(
    *,
    serve_frontend: bool = True,
    chat_completion: CompletionCallable | None = None,
    mcp_transport: McpTransport | None = None,
    telegram_transport: TelegramTransport | None = None,
    workdir: Path | str | None = None,
) -> FastAPI:
    ensure_logging_configured()
    ensure_sandbox_available()

    cwd = resolve_workdir(workdir)
    store = StateStore()
    compact_provider = LocalSummaryCompactProvider()
    mcp_manager = McpManager(store=store, transport=mcp_transport)
    telegram_bot_manager: TelegramBotManager | None = None
    workspace_runs: dict[str, WorkspaceRun] = {}
    active_workspace_run_id: str | None = None
    workspace_generation = 0
    active_compact_task: WorkspaceCompactTask | None = None

    static_dir = frontend_static_directory().resolve(strict=False)
    logger.debug("Flowent app created serve_frontend=%s", serve_frontend)
    logger.info("Workdir: %s", cwd)
    logger.info("Static directory: %s", static_dir)

    def request_messages_for_content(
        state: StoredState,
        messages: list[StoredMessage],
        content: str,
    ) -> list[dict[str, object]]:
        compacted_context = store.read_compacted_context()
        checkpoint = store.read_active_compaction_checkpoint()
        chat_messages = workspace_chat_messages(
            messages,
            compacted_context,
            checkpoint,
        )
        return [
            message.model_dump()
            for message in [
                *runtime_context_messages(cwd, state.settings.agent_prompt),
                *explicit_skill_messages(cwd, store, content),
                *chat_messages,
            ]
        ]

    async def save_context_checkpoint(
        *,
        connection: ProviderConnection,
        context_window_limit: int,
        messages: list[StoredMessage],
        model_history: list[ChatMessage],
        marker_content: str,
        source_message_id: str | None = None,
        trigger: Literal["manual", "auto"],
    ) -> tuple[StoredMessage, list[dict[str, object]], TokenUsageInfo]:
        compact_result = await compact_provider.compact(
            connection,
            CompactInput(
                messages=messages,
                model_history=model_history,
                retained_message_token_budget=AUTO_COMPACT_RETAINED_MESSAGE_TOKEN_BUDGET,
                trigger=trigger,
            ),
            completion=chat_completion,
        )
        usage_info = store.read_usage_info()
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
        store.save_usage_info(usage_info)
        marker = StoredMessage(
            author="system",
            content=marker_content,
            id=str(uuid4()),
            usage_info=usage_info,
        )
        store.save_compaction_checkpoint(
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

    async def auto_compact_workspace_messages(
        *,
        connection: ProviderConnection,
        context_window_limit: int,
        messages: list[StoredMessage],
        model_history: list[ChatMessage],
        source_message_id: str | None = None,
    ) -> tuple[StoredMessage, list[dict[str, object]], TokenUsageInfo] | None:
        if not should_auto_compact(
            model_history,
            context_window=context_window_limit,
        ):
            return None
        logger.info("Workspace auto compact requested")
        try:
            return await save_context_checkpoint(
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

    async def run_workspace_turn(content: str) -> StoredMessage:
        state = store.read_state()
        connection = selected_connection(state)
        context_window_limit = context_window_for_settings(state.settings)
        user_message = StoredMessage(
            author="user",
            content=content,
            id=str(uuid4()),
        )
        next_messages = [*state.messages, user_message]
        store.save_messages(next_messages)
        model_history = [
            *runtime_context_messages(cwd, state.settings.agent_prompt),
            *workspace_chat_messages(
                state.messages,
                store.read_compacted_context(),
                store.read_active_compaction_checkpoint(),
            ),
        ]
        auto_compaction = await auto_compact_workspace_messages(
            connection=connection,
            context_window_limit=context_window_limit,
            messages=state.messages,
            model_history=model_history,
            source_message_id=None,
        )
        if auto_compaction is not None:
            marker, _, _ = auto_compaction
            next_messages = [*state.messages, marker, user_message]
            store.save_messages(next_messages)
        request_messages = request_messages_for_content(state, next_messages, content)
        assistant_id = str(uuid4())
        assistant_output = AssistantOutputBuilder(assistant_id)
        turn_usage_info: TokenUsageInfo | None = None

        async def review_tool_approval(request: ApprovalReviewRequest):
            return await review_approval_request(
                connection,
                request.model_copy(
                    update={
                        "transcript": approval_transcript(next_messages),
                        "user_request": content,
                    }
                ),
                completion=chat_completion,
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
                    Path(path.path) for path in store.read_writable_paths()
                ],
            )

        async for event in run_agent_stream(
            completion=chat_completion,
            connection=connection,
            cwd=cwd,
            extra_tool_runner=mcp_manager.run_tool,
            extra_tool_specs=mcp_manager.tool_specs(),
            extra_tool_title=mcp_manager.tool_title,
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
                    assistant_output.start_group(index)
            if event.event == "delta":
                assistant_output.append_text(str(event.data.get("content") or ""))
            if event.event == "thinking_delta":
                assistant_output.append_thinking(str(event.data.get("content") or ""))
            if event.event == "usage":
                usage_data = event.data.get("usage")
                if isinstance(usage_data, dict):
                    usage_info = update_context_usage_for_response(
                        append_token_usage(
                            store.read_usage_info(),
                            TokenUsage.model_validate(usage_data),
                            model_context_window=context_window_limit,
                        ),
                        messages=request_messages,
                        output_content=assistant_output.content,
                        model_context_window=context_window_limit,
                    )
                    store.save_usage_info(usage_info)
                    turn_usage_info = usage_info
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
        if final_usage_info is None:
            final_usage_info = update_context_usage_for_response(
                store.read_usage_info(),
                messages=request_messages,
                output_content=assistant_output.content,
                model_context_window=context_window_limit,
            )
        else:
            final_usage_info = update_context_usage_for_response(
                final_usage_info,
                messages=request_messages,
                output_content=assistant_output.content,
                model_context_window=context_window_limit,
            )
        store.save_usage_info(final_usage_info)

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
        store.save_messages([*next_messages, assistant_message])
        return assistant_message

    async def workspace_reply_text(content: str) -> str:
        return (await run_workspace_turn(content)).content

    telegram_bot_manager = TelegramBotManager(
        message_handler=workspace_reply_text,
        store=store,
        telegram_transport=telegram_transport,
    )

    async def gather_shutdown_tasks(
        label: str, tasks: Sequence[asyncio.Task[Any]]
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

    async def stop_workspace_runs_for_shutdown() -> None:
        tasks: list[asyncio.Task[None]] = []
        for run in workspace_runs.values():
            if run.task is None or run.task.done():
                continue
            run.task.cancel()
            tasks.append(run.task)
        await gather_shutdown_tasks("Workspace run", tasks)

    async def stop_workspace_compact_for_shutdown() -> None:
        nonlocal active_compact_task
        if active_compact_task is None:
            store.save_is_compacting(False)
            return
        task = active_compact_task.task
        active_compact_task = None
        if not task.done():
            task.cancel()
        await gather_shutdown_tasks("Workspace compact", [task])
        store.save_is_compacting(False)

    async def run_shutdown_step(label: str, cleanup: Awaitable[object]) -> None:
        try:
            await cleanup
        except Exception:
            logger.exception("%s cleanup failed during shutdown", label)

    async def graceful_shutdown() -> None:
        await run_shutdown_step("Workspace run", stop_workspace_runs_for_shutdown())
        await run_shutdown_step(
            "Workspace compact", stop_workspace_compact_for_shutdown()
        )
        if telegram_bot_manager is not None:
            await run_shutdown_step("Telegram", telegram_bot_manager.stop_all())
        await run_shutdown_step("MCP", mcp_manager.stop_all())

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        app.state.mcp_manager = mcp_manager
        app.state.telegram_bot_manager = telegram_bot_manager
        await mcp_manager.start_enabled()
        if telegram_bot_manager is not None:
            await telegram_bot_manager.start_enabled()
        try:
            yield
        finally:
            await graceful_shutdown()

    app = FastAPI(title="Flowent", lifespan=lifespan)
    app.state.mcp_manager = mcp_manager
    app.state.telegram_bot_manager = telegram_bot_manager

    @app.get("/api/health")
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/api/state")
    async def app_state() -> StoredState:
        state = state_with_current_model_context_window(store.read_state())
        active_run = (
            workspace_runs.get(active_workspace_run_id)
            if active_workspace_run_id
            else None
        )
        update: dict[str, object] = {
            "active_run_event_index": active_run.latest_event_index
            if active_run
            else 0,
            "active_run_id": active_run.id
            if active_run and not active_run.is_done
            else None,
            "mcp_servers": mcp_manager.servers_with_status(state.mcp_servers),
            "skills": discover_skills(cwd, store),
        }
        if telegram_bot_manager is not None:
            update["telegram_bot"] = telegram_bot_manager.bot_with_status(
                state.telegram_bot
            )
        return state.model_copy(update=update)

    @app.get("/api/about")
    async def about() -> AboutResponse:
        return AboutResponse(version=__version__)

    @app.post("/api/providers")
    async def save_provider(provider: StoredProvider) -> StoredProvider:
        return store.save_provider(provider)

    @app.delete("/api/providers/{provider_id}")
    async def delete_provider(provider_id: str) -> dict[str, bool]:
        store.delete_provider(provider_id)
        return {"ok": True}

    @app.put("/api/mcp/servers")
    async def save_mcp_server(server: StoredMcpServer) -> StoredMcpServer:
        saved_server = store.save_mcp_server(server)
        return await mcp_manager.sync_server(saved_server)

    @app.post("/api/mcp/import/preview")
    async def preview_mcp_import(
        request: McpImportPreviewRequest,
    ) -> McpImportDiscovery:
        return discover_imported_mcp_servers(cwd, source=request.source)

    @app.post("/api/mcp/import")
    async def import_mcp_servers(request: McpImportRequest) -> list[StoredMcpServer]:
        imported_servers = discover_imported_mcp_servers(
            cwd,
            source=request.source,
        ).servers
        existing_servers = {server.id for server in store.read_mcp_servers()}
        for server in imported_servers:
            if server.id != request.server_id:
                continue
            if server.id in existing_servers:
                continue
            store.save_mcp_server(server)
            existing_servers.add(server.id)
        return mcp_manager.servers_with_status(store.read_mcp_servers())

    @app.delete("/api/mcp/servers/{server_id}")
    async def delete_mcp_server(server_id: str) -> dict[str, bool]:
        await mcp_manager.delete_server(server_id)
        return {"ok": True}

    @app.post("/api/mcp/servers/{server_id}/reconnect")
    async def reconnect_mcp_server(server_id: str) -> StoredMcpServer:
        try:
            return await mcp_manager.reconnect_server(server_id)
        except KeyError as error:
            raise HTTPException(status_code=404, detail="Server not found.") from error

    @app.post("/api/mcp/reload")
    async def reload_mcp_servers() -> list[StoredMcpServer]:
        return await mcp_manager.reload()

    @app.post("/api/skills/reload")
    async def reload_skills() -> list[StoredSkill]:
        return discover_skills(cwd, store)

    @app.put("/api/skills/{skill_id:path}")
    async def save_skill_settings(
        skill_id: str,
        request: SkillSettingsRequest,
    ) -> StoredSkill:
        try:
            return update_skill_enabled(cwd, store, skill_id, request.enabled)
        except KeyError as error:
            raise HTTPException(status_code=404, detail="Skill not found.") from error

    @app.put("/api/telegram-bot")
    async def save_telegram_bot(telegram_bot: StoredTelegramBot) -> StoredTelegramBot:
        saved_bot = store.save_telegram_bot(telegram_bot)
        if telegram_bot_manager is not None:
            await telegram_bot_manager.sync_bot(saved_bot)
            return telegram_bot_manager.bot_with_status(saved_bot)
        return saved_bot

    @app.post("/api/telegram-bot/approve")
    async def approve_telegram_session(
        request: TelegramSessionApproveRequest,
    ) -> StoredTelegramSession:
        try:
            return store.approve_telegram_session(request.chat_id)
        except KeyError as error:
            raise HTTPException(
                status_code=404,
                detail="Conversation not found.",
            ) from error

    @app.post("/api/providers/models")
    async def provider_models(request: ProviderModelsRequest) -> ProviderModelsResponse:
        return ProviderModelsResponse(
            models=list_provider_models(
                base_url=request.base_url,
                provider=request.provider,
                secret_reference=request.secret_reference,
            ),
        )

    @app.put("/api/settings")
    async def save_settings(settings: StoredSettings) -> StoredSettings:
        return store.save_settings(settings)

    @app.put("/api/workflows")
    async def save_workflow(workflow: StoredWorkflow) -> StoredWorkflow:
        try:
            return store.save_workflow(
                validate_workflow(
                    workflow.model_copy(
                        update={"name": workflow.name.strip() or "Untitled Workflow"}
                    )
                )
            )
        except ValueError as error:
            raise HTTPException(status_code=400, detail=str(error)) from error

    @app.delete("/api/workflows/{workflow_id}")
    async def delete_workflow(workflow_id: str) -> dict[str, bool]:
        store.delete_workflow(workflow_id)
        return {"ok": True}

    @app.post("/api/workflows/{workflow_id}/run")
    async def run_workflow(workflow_id: str) -> WorkflowRunResponse:
        workflow = next(
            (
                current_workflow
                for current_workflow in store.read_workflows()
                if current_workflow.id == workflow_id
            ),
            None,
        )
        if workflow is None:
            raise HTTPException(status_code=404, detail="Workflow not found.")
        try:
            connection = (
                selected_connection(store.read_state())
                if workflow_requires_connection(workflow.definition)
                else None
            )
            return await run_workflow_definition(
                completion=chat_completion,
                connection=connection,
                definition=workflow.definition,
                workflow_id=workflow.id,
            )
        except ValueError as error:
            raise HTTPException(status_code=400, detail=str(error)) from error

    @app.post("/api/permissions/writable-paths")
    async def save_writable_path(
        request: WritablePathRequest,
    ) -> StoredWritablePath:
        return store.save_writable_path(normalized_request_path(request.path, cwd))

    @app.delete("/api/permissions/writable-paths")
    async def delete_writable_path(
        request: WritablePathRequest,
    ) -> WritablePathListResponse:
        return WritablePathListResponse(
            writable_paths=store.delete_writable_path(
                normalized_request_path(request.path, cwd)
            )
        )

    @app.put("/api/workspace/messages")
    async def save_workspace_messages(
        request: WorkspaceMessagesRequest,
    ) -> WorkspaceMessagesRequest:
        return WorkspaceMessagesRequest(messages=store.save_messages(request.messages))

    @app.post("/api/workspace/clear")
    async def clear_workspace() -> WorkspaceClearResponse:
        nonlocal active_workspace_run_id
        nonlocal workspace_generation
        workspace_generation += 1
        for run in workspace_runs.values():
            run.is_done = True
            if run.task is not None and not run.task.done():
                run.discard_on_cancel = True
                run.task.cancel()
            async with run.condition:
                run.condition.notify_all()
        active_workspace_run_id = None
        messages = store.save_messages([])
        return WorkspaceClearResponse(messages=messages)

    async def append_run_event(
        run: WorkspaceRun, event: str, data: dict[str, object]
    ) -> None:
        async with run.condition:
            run.events.append((run.latest_event_index + 1, event, data))
            run.condition.notify_all()

    async def append_run_snapshot(run: WorkspaceRun, message: StoredMessage) -> None:
        if message.author != "assistant":
            return
        run.latest_snapshot = message
        await append_run_event(
            run,
            "snapshot",
            {"message": stream_message_data(message, run.active_output)},
        )

    def active_workspace_run() -> WorkspaceRun | None:
        if active_workspace_run_id is None:
            return None
        run = workspace_runs.get(active_workspace_run_id)
        if run is None or run.is_done:
            return None
        return run

    def has_active_workspace_run() -> bool:
        return any(
            not run.is_done and run.task is not None and not run.task.done()
            for run in workspace_runs.values()
        )

    def create_workspace_run(content: str) -> WorkspaceRun:
        nonlocal active_workspace_run_id
        if has_active_workspace_run():
            active_run = active_workspace_run()
            raise HTTPException(
                status_code=409,
                detail="Response in progress",
                headers={"X-Flowent-Run-Id": active_run.id if active_run else ""},
            )
        state = store.read_state()
        connection = selected_connection(state)
        context_window_limit = context_window_for_settings(state.settings)

        user_message = StoredMessage(
            author="user",
            content=content,
            id=str(uuid4()),
        )
        next_messages = [*state.messages, user_message]
        store.save_messages(next_messages)
        run = WorkspaceRun(
            condition=asyncio.Condition(),
            generation=workspace_generation,
        )
        workspace_runs[run.id] = run
        active_workspace_run_id = run.id

        async def run_task() -> None:
            nonlocal active_workspace_run_id
            nonlocal next_messages
            assistant_message = StoredMessage(
                author="assistant",
                content="",
                id=str(uuid4()),
                status="running",
            )
            assistant_output = AssistantOutputBuilder(assistant_message.id)
            last_progress_flush_at = 0.0

            def is_current_generation() -> bool:
                return run.generation == workspace_generation

            def update_assistant_message(
                status: str = "running", *, persist: bool
            ) -> StoredMessage | None:
                nonlocal next_messages, assistant_message
                if not is_current_generation() or run.discard_on_cancel:
                    return None
                assistant_message = StoredMessage(
                    author="assistant",
                    content=assistant_output.content,
                    groups=assistant_output.groups,
                    id=assistant_message.id,
                    status=status,
                    thinking=assistant_output.thinking,
                    tools=list(assistant_output.tools.values()),
                    usage_info=store.read_usage_info(),
                )
                next_messages = append_or_replace_message(
                    next_messages, assistant_message
                )
                if persist:
                    store.upsert_message(assistant_message)
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
                current_request_messages = request_messages_for_content(
                    state,
                    next_messages,
                    content,
                )
                pre_turn_request_messages = request_messages_for_content(
                    state,
                    state.messages,
                    content,
                )
                auto_compaction = await auto_compact_workspace_messages(
                    connection=connection,
                    context_window_limit=context_window_limit,
                    messages=state.messages,
                    model_history=[
                        ChatMessage.model_validate(message)
                        for message in pre_turn_request_messages
                    ],
                    source_message_id=None,
                )
                if auto_compaction is not None:
                    marker, _, usage_info = auto_compaction
                    next_messages = [*state.messages, marker, user_message]
                    store.save_messages(next_messages)
                    await append_run_event(
                        run,
                        "context_optimized",
                        {
                            "message": marker.model_dump(),
                            **usage_event_data(usage_info),
                        },
                    )
                    current_request_messages = request_messages_for_content(
                        state,
                        next_messages,
                        content,
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
                        completion=chat_completion,
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
                            Path(path.path) for path in store.read_writable_paths()
                        ],
                    )

                async def context_compactor(
                    conversation: Sequence[Mapping[str, object]],
                ) -> AgentContextUpdate | None:
                    nonlocal next_messages
                    if not is_current_generation() or run.discard_on_cancel:
                        return None
                    assistant_snapshot = StoredMessage(
                        author="assistant",
                        content=assistant_output.content,
                        groups=assistant_output.groups,
                        id=assistant_message.id,
                        status="running",
                        thinking=assistant_output.thinking,
                        tools=list(assistant_output.tools.values()),
                        usage_info=store.read_usage_info(),
                    )
                    model_history: list[ChatMessage] = []
                    for message in conversation:
                        role_value = message.get("role")
                        content = str(message.get("content") or "")
                        if role_value == "system":
                            model_history.append(
                                ChatMessage(role="system", content=content)
                            )
                        if role_value == "user":
                            model_history.append(
                                ChatMessage(role="user", content=content)
                            )
                        if role_value == "assistant":
                            model_history.append(
                                ChatMessage(role="assistant", content=content)
                            )
                        if role_value == "tool":
                            model_history.append(
                                ChatMessage(
                                    role="user",
                                    content=f"Tool result: {content}",
                                )
                            )
                    auto_result = await auto_compact_workspace_messages(
                        connection=connection,
                        context_window_limit=context_window_limit,
                        messages=next_messages,
                        model_history=model_history,
                        source_message_id=assistant_snapshot.id,
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
                    store.save_messages(next_messages)
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
                    completion=chat_completion,
                    connection=connection,
                    context_compactor=context_compactor,
                    cwd=cwd,
                    extra_tool_runner=mcp_manager.run_tool,
                    extra_tool_specs=mcp_manager.tool_specs(),
                    extra_tool_title=mcp_manager.tool_title,
                    messages=current_request_messages,
                    tool_runner=tool_runner,
                ):
                    if not is_current_generation() or run.discard_on_cancel:
                        raise asyncio.CancelledError
                    run_event_data = event.data
                    should_append_run_event = event.event != "usage"
                    snapshot_after_event: StoredMessage | None = None
                    if event.event == "start":
                        event_id = event.data.get("id")
                        if isinstance(event_id, str):
                            assistant_message = assistant_message.model_copy(
                                update={"id": event_id}
                            )
                            assistant_output.set_assistant_id(event_id)
                            snapshot_after_event = persist_assistant()
                    if event.event == "output_start":
                        index = event.data.get("index")
                        if isinstance(index, int):
                            run.active_output = None
                            assistant_output.start_group(index)
                            snapshot_after_event = persist_assistant()
                    if event.event == "output_done":
                        run.active_output = None
                    if event.event == "tool_start":
                        tool = event.data.get("tool")
                        if isinstance(tool, dict) and isinstance(tool.get("id"), str):
                            run.active_output = None
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
                        run.active_output = "text"
                        assistant_output.append_text(
                            str(event.data.get("content") or "")
                        )
                        snapshot_after_event = persist_assistant_progress()
                    if event.event == "thinking_delta":
                        run.active_output = "thinking"
                        assistant_output.append_thinking(
                            str(event.data.get("content") or "")
                        )
                        snapshot_after_event = persist_assistant_progress()
                    if event.event == "usage":
                        usage_data = event.data.get("usage")
                        if isinstance(usage_data, dict):
                            usage_info = update_context_usage_for_response(
                                append_token_usage(
                                    store.read_usage_info(),
                                    TokenUsage.model_validate(usage_data),
                                    model_context_window=context_window_limit,
                                ),
                                messages=current_request_messages,
                                output_content=assistant_output.content,
                                model_context_window=context_window_limit,
                            )
                            store.save_usage_info(usage_info)
                            turn_usage_info = usage_info
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
                            run.active_output = None
                            assistant_output.apply_done_message(message)
                            response_usage_info = store.read_usage_info()
                            final_usage_info = turn_usage_info
                            if final_usage_info is None:
                                final_usage_info = update_context_usage_for_response(
                                    response_usage_info,
                                    messages=current_request_messages,
                                    output_content=assistant_output.content,
                                    model_context_window=context_window_limit,
                                )
                            else:
                                final_usage_info = update_context_usage_for_response(
                                    final_usage_info,
                                    messages=current_request_messages,
                                    output_content=assistant_output.content,
                                    model_context_window=context_window_limit,
                                )
                            store.save_usage_info(final_usage_info)
                            snapshot_after_event = persist_assistant("completed")
                            if snapshot_after_event is not None:
                                run_event_data = {
                                    "message": stream_message_data(snapshot_after_event)
                                }
                    if event.event == "done" and snapshot_after_event is not None:
                        await append_run_snapshot(run, snapshot_after_event)
                        await append_run_event(run, event.event, run_event_data)
                    else:
                        if should_append_run_event:
                            await append_run_event(run, event.event, run_event_data)
                        if snapshot_after_event is not None:
                            await append_run_snapshot(run, snapshot_after_event)
            except asyncio.CancelledError:
                logger.info("Workspace run stopped")
                if not run.discard_on_cancel:
                    interrupted_snapshot = persist_assistant("interrupted")
                    if interrupted_snapshot is not None:
                        await append_run_snapshot(run, interrupted_snapshot)
                    await append_run_event(
                        run,
                        "error",
                        {"message": "Response stopped."},
                    )
                raise
            except Exception as error:
                logger.exception("Workspace response failed")
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
                    await append_run_snapshot(run, failed_snapshot)
                await append_run_event(run, "error", run_error_event_data(error_item))
            finally:
                run.is_done = True
                async with run.condition:
                    run.condition.notify_all()
                if active_workspace_run_id == run.id:
                    active_workspace_run_id = None

        run.task = asyncio.create_task(run_task())
        return run

    async def workspace_run_stream(
        run: WorkspaceRun, after: int = 0, include_snapshots: bool = True
    ) -> AsyncIterator[str]:
        next_event_index = after + 1
        reconnect_snapshot = run_snapshot_data_at(run, after) if after > 0 else None
        if include_snapshots and reconnect_snapshot is not None:
            yield stream_event(
                "snapshot",
                {"message": reconnect_snapshot},
                event_id=after,
            )
        while True:
            async with run.condition:

                def has_next_event(index: int = next_event_index) -> bool:
                    return run.is_done or any(
                        event_index >= index for event_index, _, _ in run.events
                    )

                await run.condition.wait_for(has_next_event)
                events = [event for event in run.events if event[0] >= next_event_index]

            for index, event, data in events:
                next_event_index = index + 1
                if event == "snapshot" and not include_snapshots:
                    continue
                yield stream_event(event, data, event_id=index)
                if event in {"done", "error"}:
                    return

            if run.is_done and not events:
                return

    @app.post("/api/workspace/runs")
    async def start_workspace_run(
        request: WorkspaceRespondRequest,
    ) -> WorkspaceRunResponse:
        logger.info("Workspace run requested content_length=%s", len(request.content))
        logger.log(TRACE_LEVEL, "Workspace user content=%r", request.content)
        run = create_workspace_run(request.content)
        return WorkspaceRunResponse(run_id=run.id)

    @app.get("/api/workspace/runs/{run_id}/stream")
    async def stream_workspace_run(
        run_id: str,
        after: int = Query(default=0, ge=0),
    ) -> StreamingResponse:
        run = workspace_runs.get(run_id)
        if run is None:
            raise HTTPException(status_code=404, detail="Run not found.")
        return StreamingResponse(
            workspace_run_stream(run, after),
            media_type="text/event-stream",
        )

    @app.post("/api/workspace/runs/{run_id}/stop")
    async def stop_workspace_run(run_id: str) -> dict[str, bool]:
        run = workspace_runs.get(run_id)
        if run is None:
            raise HTTPException(status_code=404, detail="Run not found.")
        if run.task is not None and not run.task.done():
            run.task.cancel()
        return {"ok": True}

    @app.post("/api/workspace/compact", response_class=StreamingResponse)
    async def compact_workspace() -> StreamingResponse:
        nonlocal active_compact_task

        async def run_manual_compact(
            *,
            checkpoint: StoredCompactionCheckpoint | None,
            connection: ProviderConnection,
            context_window_limit: int,
            state: StoredState,
        ) -> tuple[StoredMessage, TokenUsageInfo]:
            logger.info("Workspace compact requested")
            try:
                model_history = [
                    *runtime_context_messages(cwd, state.settings.agent_prompt),
                    *workspace_chat_messages(
                        state.messages,
                        store.read_compacted_context(),
                        checkpoint,
                    ),
                ]

                marker, _, usage_info = await save_context_checkpoint(
                    connection=connection,
                    context_window_limit=context_window_limit,
                    marker_content=COMPACTED_CONTEXT_MARKER,
                    messages=state.messages,
                    model_history=model_history,
                    source_message_id=None,
                    trigger="manual",
                )
                store.save_messages([*state.messages, marker])
                logger.info("Workspace compact completed")
                return marker, usage_info
            except Exception:
                logger.exception("Workspace compact failed")
                raise
            finally:
                store.save_is_compacting(False)

        def clear_active_compact_task(
            task: asyncio.Task[tuple[StoredMessage, TokenUsageInfo]],
        ) -> None:
            nonlocal active_compact_task
            if active_compact_task is not None and active_compact_task.task is task:
                active_compact_task = None
            with suppress(asyncio.CancelledError):
                task.exception()

        if active_compact_task is not None:
            if not active_compact_task.task.done():
                compact_task = active_compact_task.task
            else:
                active_compact_task = None

        if active_compact_task is None:
            if active_workspace_run() is not None:
                raise HTTPException(
                    status_code=409,
                    detail="Compact is unavailable while Flowent is responding.",
                )
            state = store.read_state()
            connection = selected_connection(state)
            context_window_limit = context_window_for_settings(state.settings)
            checkpoint = store.read_active_compaction_checkpoint()
            store.save_is_compacting(True)
            compact_task = asyncio.create_task(
                run_manual_compact(
                    checkpoint=checkpoint,
                    connection=connection,
                    context_window_limit=context_window_limit,
                    state=state,
                )
            )
            compact_task.add_done_callback(clear_active_compact_task)
            active_compact_task = WorkspaceCompactTask(task=compact_task)

        async def compact_workspace_stream() -> AsyncIterator[str]:
            try:
                marker, usage_info = await asyncio.shield(compact_task)
            except Exception:
                yield stream_event(
                    "error",
                    {"message": "Context could not be compacted."},
                )
                return

            marker_data = marker.model_dump()
            yield stream_event("usage", usage_event_data(usage_info))
            yield stream_event(
                "context_optimized",
                {"message": marker_data, **usage_event_data(usage_info)},
            )
            yield stream_event("done", {"message": marker_data})

        return StreamingResponse(
            compact_workspace_stream(),
            media_type="text/event-stream",
        )

    @app.post("/api/workspace/respond")
    async def respond_to_workspace(
        request: WorkspaceRespondRequest,
    ) -> StreamingResponse:
        logger.info(
            "Workspace response requested content_length=%s", len(request.content)
        )
        logger.log(TRACE_LEVEL, "Workspace user content=%r", request.content)
        run = create_workspace_run(request.content)
        return StreamingResponse(
            workspace_run_stream(run, include_snapshots=False),
            media_type="text/event-stream",
        )

    if serve_frontend and static_dir.is_dir():
        assets_dir = static_dir / "assets"
        if assets_dir.is_dir():
            app.mount("/assets", StaticFiles(directory=assets_dir), name="assets")

        @app.get("/{path:path}")
        async def spa_fallback(path: str) -> FileResponse:
            file = (static_dir / path).resolve(strict=False)
            if file.is_file() and file.is_relative_to(static_dir):
                return FileResponse(file)
            return FileResponse(static_dir / "index.html")

    return app


app = create_app()


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app)
