import json
import os
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Literal

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, ConfigDict

from flowent.agent import run_agent_stream
from flowent.llm import (
    ChatMessage,
    CompletionCallable,
    ProviderConnection,
    ProviderFormat,
    list_provider_models,
)
from flowent.storage import (
    StateStore,
    StoredMessage,
    StoredProvider,
    StoredSettings,
    StoredState,
)

DEFAULT_STATIC_DIR = Path(__file__).parent / "static"


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

    messages: list[StoredMessage]


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


def workspace_chat_messages(messages: list[StoredMessage]) -> list[ChatMessage]:
    chat_messages: list[ChatMessage] = []
    for message in messages:
        if message.author not in ("user", "assistant"):
            raise HTTPException(status_code=400, detail="Message history is invalid.")
        role: Literal["user", "assistant"] = (
            "user" if message.author == "user" else "assistant"
        )
        chat_messages.append(ChatMessage(role=role, content=message.content))
    return chat_messages


def create_app(
    *,
    serve_frontend: bool = True,
    chat_completion: CompletionCallable | None = None,
) -> FastAPI:
    app = FastAPI(title="Flowent")
    store = StateStore()

    static_dir = frontend_static_directory().resolve(strict=False)

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

    @app.post("/api/workspace/respond")
    async def respond_to_workspace(
        request: WorkspaceRespondRequest,
    ) -> StreamingResponse:
        state = store.read_state()
        provider = next(
            (
                stored_provider
                for stored_provider in state.providers
                if stored_provider.id == state.settings.selected_provider_id
            ),
            None,
        )
        if provider is None or not state.settings.selected_model:
            raise HTTPException(
                status_code=400,
                detail="Choose a provider and model before sending.",
            )
        if not provider.api_key:
            raise HTTPException(status_code=400, detail="Add a key before sending.")

        connection = ProviderConnection(
            base_url=provider.base_url or None,
            model=state.settings.selected_model,
            name=provider.name,
            provider=provider.type,
            secret_reference=provider.api_key,
        )
        chat_messages = workspace_chat_messages(request.messages)

        async def response_stream() -> AsyncIterator[str]:
            try:
                async for event in run_agent_stream(
                    completion=chat_completion,
                    connection=connection,
                    cwd=Path.cwd(),
                    messages=[message.model_dump() for message in chat_messages],
                ):
                    yield stream_event(event.event, event.data)
            except Exception as error:
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
