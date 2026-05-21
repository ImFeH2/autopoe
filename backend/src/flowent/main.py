import json
import logging
import os
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Literal
from uuid import uuid4

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, ConfigDict

from flowent.agent import run_agent_stream
from flowent.context import runtime_context_messages
from flowent.llm import (
    ChatMessage,
    CompletionCallable,
    ProviderConnection,
    ProviderFormat,
    complete_chat,
    list_provider_models,
)
from flowent.logging import TRACE_LEVEL, ensure_logging_configured
from flowent.sandbox import ensure_sandbox_available
from flowent.storage import (
    StateStore,
    StoredMessage,
    StoredProvider,
    StoredSettings,
    StoredState,
    StoredToolItem,
)

logger = logging.getLogger("flowent.main")


DEFAULT_STATIC_DIR = Path(__file__).parent / "static"
COMPACTED_CONTEXT_MARKER = "Context compacted"
COMPACT_SYSTEM_PROMPT = "You are compacting Flowent workspace context."


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


class WorkspaceCompactResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    message: StoredMessage


def stream_event(event: str, data: dict[str, object]) -> str:
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"


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
) -> list[ChatMessage]:
    chat_messages: list[ChatMessage] = []
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


def compact_prompt_messages(
    messages: list[StoredMessage],
    compacted_context: str,
    runtime_messages: list[ChatMessage] | None = None,
) -> list[ChatMessage]:
    history_messages = [
        *(runtime_messages or []),
        *workspace_chat_messages(messages, compacted_context),
    ]
    history = "\n\n".join(
        f"{message.role}: {message.content}" for message in history_messages
    )
    return [
        ChatMessage(role="system", content=COMPACT_SYSTEM_PROMPT),
        ChatMessage(
            role="user",
            content=(
                "Compact the current Flowent workspace context for the next turn.\n\n"
                "Keep the details needed to continue accurately, including decisions, "
                "constraints, pending work, and referenced facts.\n\n"
                f"Conversation:\n{history}"
            ),
        ),
    ]


def create_app(
    *,
    serve_frontend: bool = True,
    chat_completion: CompletionCallable | None = None,
) -> FastAPI:
    ensure_logging_configured()
    ensure_sandbox_available()

    app = FastAPI(title="Flowent")
    store = StateStore()

    static_dir = frontend_static_directory().resolve(strict=False)
    logger.debug("Flowent app created serve_frontend=%s", serve_frontend)
    logger.info("Static directory: %s", static_dir)

    @app.get("/api/health")
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/api/state")
    async def app_state() -> StoredState:
        return store.read_state()

    @app.post("/api/providers")
    async def save_provider(provider: StoredProvider) -> StoredProvider:
        return store.save_provider(provider)

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

    @app.put("/api/workspace/messages")
    async def save_workspace_messages(
        request: WorkspaceMessagesRequest,
    ) -> WorkspaceMessagesRequest:
        return WorkspaceMessagesRequest(messages=store.save_messages(request.messages))

    @app.post("/api/workspace/compact")
    async def compact_workspace() -> WorkspaceCompactResponse:
        logger.info("Workspace compact requested")
        state = store.read_state()
        connection = selected_connection(state)
        compacted_context = store.read_compacted_context()
        cwd = Path.cwd()

        try:
            summary = await complete_chat(
                connection,
                compact_prompt_messages(
                    state.messages,
                    compacted_context,
                    runtime_context_messages(cwd),
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
        store.save_compacted_context(summary.content)
        store.save_messages([*state.messages, marker])
        logger.info(
            "Workspace compact completed summary_length=%s", len(summary.content)
        )
        logger.log(TRACE_LEVEL, "Workspace compact summary=%r", summary.content)
        return WorkspaceCompactResponse(message=marker)

    @app.post("/api/workspace/respond")
    async def respond_to_workspace(
        request: WorkspaceRespondRequest,
    ) -> StreamingResponse:
        logger.info(
            "Workspace response requested content_length=%s", len(request.content)
        )
        logger.log(TRACE_LEVEL, "Workspace user content=%r", request.content)
        state = store.read_state()
        connection = selected_connection(state)
        cwd = Path.cwd()

        user_message = StoredMessage(
            author="user",
            content=request.content,
            id=str(uuid4()),
        )
        next_messages = [*state.messages, user_message]
        store.save_messages(next_messages)
        chat_messages = workspace_chat_messages(
            next_messages,
            store.read_compacted_context(),
        )
        request_messages = [
            message.model_dump()
            for message in [*runtime_context_messages(cwd), *chat_messages]
        ]

        async def response_stream() -> AsyncIterator[str]:
            assistant_tools: dict[str, StoredToolItem] = {}
            try:
                async for event in run_agent_stream(
                    completion=chat_completion,
                    connection=connection,
                    cwd=cwd,
                    messages=request_messages,
                ):
                    if event.event == "tool_start":
                        tool = event.data.get("tool")
                        if isinstance(tool, dict) and isinstance(tool.get("id"), str):
                            assistant_tools[tool["id"]] = StoredToolItem.model_validate(
                                tool
                            )
                    if event.event in {"tool_done", "tool_error"}:
                        tool_id = event.data.get("id")
                        if isinstance(tool_id, str) and tool_id in assistant_tools:
                            assistant_tools[tool_id] = StoredToolItem.model_validate(
                                {
                                    **assistant_tools[tool_id].model_dump(
                                        exclude_none=True
                                    ),
                                    **event.data,
                                }
                            )
                    logger.log(
                        TRACE_LEVEL,
                        "Workspace stream event=%s data=%r",
                        event.event,
                        event.data,
                    )
                    if event.event == "done":
                        message = event.data.get("message")
                        if isinstance(message, dict):
                            next_messages.append(
                                StoredMessage(
                                    author="assistant",
                                    content=str(message.get("content") or ""),
                                    id=str(message.get("id") or uuid4()),
                                    thinking=str(message.get("thinking") or ""),
                                    tools=list(assistant_tools.values()),
                                )
                            )
                            store.save_messages(next_messages)
                    yield stream_event(event.event, event.data)
            except Exception as error:
                logger.exception("Workspace response failed")
                yield stream_event(
                    "error",
                    {"message": str(error) or "Message could not be sent."},
                )
                return

        return StreamingResponse(
            response_stream(),
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
