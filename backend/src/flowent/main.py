import asyncio
import json
import logging
import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from pathlib import Path
from typing import Literal
from uuid import uuid4

from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, ConfigDict

from flowent._version import __version__
from flowent.agent import run_agent_stream
from flowent.approval import ApprovalReviewRequest, review_approval_request
from flowent.channels import TelegramBotManager, TelegramTransport
from flowent.compact import (
    CompactInput,
    LocalSummaryCompactProvider,
    transcript_messages_after,
)
from flowent.context import runtime_context_messages
from flowent.llm import (
    ChatMessage,
    CompletionCallable,
    ProviderConnection,
    ProviderFormat,
    list_provider_models,
)
from flowent.logging import TRACE_LEVEL, ensure_logging_configured
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
    StoredWritablePath,
)
from flowent.tools import ToolContext

logger = logging.getLogger("flowent.main")


DEFAULT_STATIC_DIR = Path(__file__).parent / "static"
COMPACTED_CONTEXT_MARKER = "Context compacted"


class ProviderModelsRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    provider: ProviderFormat
    secret_reference: str
    base_url: str | None = None


class ProviderModelsResponse(BaseModel):
    models: list[str]


class WorkspaceMessagesRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    messages: list[StoredMessage]


class WorkspaceRespondRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    content: str


class WorkspaceRunResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    run_id: str


class WorkspaceCompactResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    message: StoredMessage


class AboutResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    version: str


class TelegramSessionApproveRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    chat_id: str


class SkillSettingsRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    enabled: bool


class McpImportRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    server_id: str
    source: Literal["claude_code", "codex"]


class McpImportPreviewRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    source: Literal["claude_code", "codex"]


class WritablePathRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    path: str


class WritablePathListResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    writable_paths: list[StoredWritablePath]


@dataclass
class WorkspaceRun:
    condition: asyncio.Condition
    discard_on_cancel: bool = False
    events: list[tuple[int, str, dict[str, object]]] = field(default_factory=list)
    id: str = field(default_factory=lambda: str(uuid4()))
    is_done: bool = False
    task: asyncio.Task[None] | None = None

    @property
    def latest_event_index(self) -> int:
        return self.events[-1][0] if self.events else 0


def stream_event(event: str, data: dict[str, object]) -> str:
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"


def append_or_replace_message(
    messages: list[StoredMessage], message: StoredMessage
) -> list[StoredMessage]:
    return [
        *(current for current in messages if current.id != message.id),
        message,
    ]


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


def latest_compacted_context_index(messages: list[StoredMessage]) -> int | None:
    for index in range(len(messages) - 1, -1, -1):
        message = messages[index]
        if message.author == "system" and message.content == COMPACTED_CONTEXT_MARKER:
            return index
    return None


def workspace_chat_messages(
    messages: list[StoredMessage],
    compacted_context: str = "",
    checkpoint: StoredCompactionCheckpoint | None = None,
) -> list[ChatMessage]:
    chat_messages: list[ChatMessage] = []

    if checkpoint is not None:
        chat_messages.extend(checkpoint.replacement_history)
        visible_messages = transcript_messages_after(
            messages,
            checkpoint.source_message_id,
        )
        for message in visible_messages:
            if (
                message.author == "system"
                and message.content == COMPACTED_CONTEXT_MARKER
            ):
                continue
            if message.author not in ("user", "assistant"):
                raise HTTPException(
                    status_code=400, detail="Message history is invalid."
                )
            checkpoint_role: Literal["user", "assistant"] = (
                "user" if message.author == "user" else "assistant"
            )
            chat_messages.append(
                ChatMessage(role=checkpoint_role, content=message.content)
            )
        return chat_messages

    marker_index = latest_compacted_context_index(messages)
    visible_messages = messages

    if compacted_context and marker_index is not None:
        chat_messages.extend(
            [
                ChatMessage(role="user", content=COMPACTED_CONTEXT_MARKER),
                ChatMessage(role="assistant", content=compacted_context),
            ]
        )
        visible_messages = messages[marker_index + 1 :]

    for message in visible_messages:
        if message.author == "system" and message.content == COMPACTED_CONTEXT_MARKER:
            continue
        if message.author not in ("user", "assistant"):
            raise HTTPException(status_code=400, detail="Message history is invalid.")
        role: Literal["user", "assistant"] = (
            "user" if message.author == "user" else "assistant"
        )
        chat_messages.append(ChatMessage(role=role, content=message.content))
    return chat_messages


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

    static_dir = frontend_static_directory().resolve(strict=False)
    logger.debug("Flowent app created serve_frontend=%s", serve_frontend)
    logger.info("Workdir: %s", cwd)
    logger.info("Static directory: %s", static_dir)

    async def run_workspace_turn(content: str) -> StoredMessage:
        state = store.read_state()
        connection = selected_connection(state)
        user_message = StoredMessage(
            author="user",
            content=content,
            id=str(uuid4()),
        )
        next_messages = [*state.messages, user_message]
        store.save_messages(next_messages)
        chat_messages = workspace_chat_messages(
            next_messages,
            store.read_compacted_context(),
            store.read_active_compaction_checkpoint(),
        )
        skill_messages = explicit_skill_messages(cwd, store, content)
        request_messages = [
            message.model_dump()
            for message in [
                *runtime_context_messages(cwd, state.settings.agent_prompt),
                *skill_messages,
                *chat_messages,
            ]
        ]
        assistant_content = ""
        assistant_thinking = ""
        assistant_tools: dict[str, StoredToolItem] = {}
        assistant_id = str(uuid4())

        async def review_tool_approval(request: ApprovalReviewRequest):
            return await review_approval_request(
                connection,
                request,
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
            if event.event == "delta":
                assistant_content += str(event.data.get("content") or "")
            if event.event == "thinking_delta":
                assistant_thinking += str(event.data.get("content") or "")
            if event.event == "tool_start":
                tool = event.data.get("tool")
                if isinstance(tool, dict) and isinstance(tool.get("id"), str):
                    assistant_tools[tool["id"]] = StoredToolItem.model_validate(tool)
            if event.event in {"tool_done", "tool_error"}:
                tool_id = event.data.get("id")
                if isinstance(tool_id, str) and tool_id in assistant_tools:
                    assistant_tools[tool_id] = StoredToolItem.model_validate(
                        {
                            **assistant_tools[tool_id].model_dump(exclude_none=True),
                            **event.data,
                        }
                    )
            if event.event == "done":
                message = event.data.get("message")
                if isinstance(message, dict):
                    assistant_id = str(message.get("id") or assistant_id)
                    assistant_content = str(message.get("content") or assistant_content)
                    assistant_thinking = str(
                        message.get("thinking") or assistant_thinking
                    )

        assistant_message = StoredMessage(
            author="assistant",
            content=assistant_content,
            id=assistant_id,
            status="completed",
            thinking=assistant_thinking,
            tools=list(assistant_tools.values()),
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
            if telegram_bot_manager is not None:
                await telegram_bot_manager.stop_all()
            await mcp_manager.stop_all()

    app = FastAPI(title="Flowent", lifespan=lifespan)
    app.state.mcp_manager = mcp_manager
    app.state.telegram_bot_manager = telegram_bot_manager

    @app.get("/api/health")
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/api/state")
    async def app_state() -> StoredState:
        state = store.read_state()
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
        nonlocal active_workspace_run_id
        if not request.messages:
            run = active_workspace_run()
            if run is not None and run.task is not None and not run.task.done():
                run.discard_on_cancel = True
                run.task.cancel()
                active_workspace_run_id = None
        return WorkspaceMessagesRequest(messages=store.save_messages(request.messages))

    async def append_run_event(
        run: WorkspaceRun, event: str, data: dict[str, object]
    ) -> None:
        async with run.condition:
            run.events.append((run.latest_event_index + 1, event, data))
            run.condition.notify_all()

    def active_workspace_run() -> WorkspaceRun | None:
        if active_workspace_run_id is None:
            return None
        return workspace_runs.get(active_workspace_run_id)

    def create_workspace_run(content: str) -> WorkspaceRun:
        nonlocal active_workspace_run_id
        state = store.read_state()
        connection = selected_connection(state)

        user_message = StoredMessage(
            author="user",
            content=content,
            id=str(uuid4()),
        )
        next_messages = [*state.messages, user_message]
        store.save_messages(next_messages)
        chat_messages = workspace_chat_messages(
            next_messages,
            store.read_compacted_context(),
            store.read_active_compaction_checkpoint(),
        )
        request_messages = [
            message.model_dump()
            for message in [
                *runtime_context_messages(cwd, state.settings.agent_prompt),
                *explicit_skill_messages(cwd, store, content),
                *chat_messages,
            ]
        ]
        run = WorkspaceRun(condition=asyncio.Condition())
        workspace_runs[run.id] = run
        active_workspace_run_id = run.id

        async def run_task() -> None:
            nonlocal active_workspace_run_id
            assistant_tools: dict[str, StoredToolItem] = {}
            assistant_message = StoredMessage(
                author="assistant",
                content="",
                id=str(uuid4()),
                status="running",
            )
            assistant_content = ""
            assistant_thinking = ""

            def persist_assistant(status: str = "running") -> None:
                nonlocal next_messages, assistant_message
                assistant_message = StoredMessage(
                    author="assistant",
                    content=assistant_content,
                    id=assistant_message.id,
                    status=status,
                    thinking=assistant_thinking,
                    tools=list(assistant_tools.values()),
                )
                next_messages = append_or_replace_message(
                    next_messages, assistant_message
                )
                store.upsert_message(assistant_message)

            try:
                current_tool_id: str | None = None

                async def review_tool_approval(request: ApprovalReviewRequest):
                    return await review_approval_request(
                        connection,
                        request,
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
                            assistant_message = assistant_message.model_copy(
                                update={"id": event_id}
                            )
                            persist_assistant()
                    if event.event == "tool_start":
                        tool = event.data.get("tool")
                        if isinstance(tool, dict) and isinstance(tool.get("id"), str):
                            current_tool_id = tool["id"]
                            assistant_tools[tool["id"]] = StoredToolItem.model_validate(
                                tool
                            )
                            persist_assistant()
                    if event.event in {"tool_done", "tool_error"}:
                        tool_id = event.data.get("id")
                        if isinstance(tool_id, str) and tool_id in assistant_tools:
                            current_tool_id = (
                                None if current_tool_id == tool_id else current_tool_id
                            )
                            assistant_tools[tool_id] = StoredToolItem.model_validate(
                                {
                                    **assistant_tools[tool_id].model_dump(
                                        exclude_none=True
                                    ),
                                    **event.data,
                                }
                            )
                            persist_assistant()
                    if event.event == "delta":
                        assistant_content += str(event.data.get("content") or "")
                        persist_assistant()
                    if event.event == "thinking_delta":
                        assistant_thinking += str(event.data.get("content") or "")
                        persist_assistant()
                    logger.log(
                        TRACE_LEVEL,
                        "Workspace stream event=%s data=%r",
                        event.event,
                        event.data,
                    )
                    if event.event == "done":
                        message = event.data.get("message")
                        if isinstance(message, dict):
                            assistant_content = str(
                                message.get("content") or assistant_content
                            )
                            assistant_thinking = str(
                                message.get("thinking") or assistant_thinking
                            )
                            persist_assistant("completed")
                    await append_run_event(run, event.event, event.data)
            except asyncio.CancelledError:
                logger.info("Workspace run stopped")
                if not run.discard_on_cancel:
                    persist_assistant("interrupted")
                    await append_run_event(
                        run,
                        "error",
                        {"message": "Response stopped."},
                    )
                raise
            except Exception as error:
                logger.exception("Workspace response failed")
                persist_assistant("failed")
                await append_run_event(
                    run,
                    "error",
                    {"message": str(error) or "Message could not be sent."},
                )
            finally:
                run.is_done = True
                async with run.condition:
                    run.condition.notify_all()
                if active_workspace_run_id == run.id:
                    active_workspace_run_id = None

        run.task = asyncio.create_task(run_task())
        return run

    async def workspace_run_stream(
        run: WorkspaceRun, after: int = 0
    ) -> AsyncIterator[str]:
        next_event_index = after + 1
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
                yield stream_event(event, data)
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

    @app.post("/api/workspace/compact")
    async def compact_workspace() -> WorkspaceCompactResponse:
        if active_workspace_run() is not None:
            raise HTTPException(
                status_code=409,
                detail="Compact is unavailable while Flowent is responding.",
            )
        logger.info("Workspace compact requested")
        state = store.read_state()
        connection = selected_connection(state)
        checkpoint = store.read_active_compaction_checkpoint()
        model_history = [
            *runtime_context_messages(cwd, state.settings.agent_prompt),
            *workspace_chat_messages(
                state.messages,
                store.read_compacted_context(),
                checkpoint,
            ),
        ]

        try:
            compact_result = await compact_provider.compact(
                connection,
                CompactInput(
                    messages=state.messages,
                    model_history=model_history,
                    trigger="manual",
                ),
                completion=chat_completion,
            )
        except HTTPException:
            raise
        except Exception as error:
            logger.exception("Workspace compact failed")
            raise HTTPException(
                status_code=500,
                detail="Context could not be compacted.",
            ) from error

        marker = StoredMessage(
            author="system",
            content=COMPACTED_CONTEXT_MARKER,
            id=str(uuid4()),
        )
        source_message_id = state.messages[-1].id if state.messages else None
        store.save_compaction_checkpoint(
            StoredCompactionCheckpoint(
                id=str(uuid4()),
                method=compact_result.method,
                replacement_history=compact_result.replacement_history,
                source_message_id=source_message_id,
                summary=compact_result.summary,
                token_after=compact_result.token_after,
                token_before=compact_result.token_before,
                trigger="manual",
            )
        )
        store.save_messages([*state.messages, marker])
        logger.info(
            "Workspace compact completed method=%s summary_length=%s token_before=%s token_after=%s",
            compact_result.method,
            len(compact_result.summary),
            compact_result.token_before,
            compact_result.token_after,
        )
        logger.log(TRACE_LEVEL, "Workspace compact summary=%r", compact_result.summary)
        return WorkspaceCompactResponse(message=marker)

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
            workspace_run_stream(run),
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
