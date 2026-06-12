import logging

from fastapi import FastAPI, Query
from fastapi.responses import StreamingResponse

from flowent.api_models import (
    WorkspaceClearResponse,
    WorkspaceMessageEditRequest,
    WorkspaceMessageEditResponse,
    WorkspaceMessagesRequest,
    WorkspaceRespondRequest,
)
from flowent.logging import TRACE_LEVEL
from flowent.storage import StateStore
from flowent.workspace.runtime import WorkspaceRuntime

logger = logging.getLogger("flowent.routes.workspace")


def register_workspace_routes(
    app: FastAPI,
    *,
    runtime: WorkspaceRuntime,
    store: StateStore,
) -> None:
    @app.put("/api/workspace/messages")
    async def save_workspace_messages(
        request: WorkspaceMessagesRequest,
    ) -> WorkspaceMessagesRequest:
        return WorkspaceMessagesRequest(messages=store.save_messages(request.messages))

    @app.post("/api/workspace/messages/{message_id}/edit")
    async def edit_workspace_message(
        message_id: str,
        request: WorkspaceMessageEditRequest,
    ) -> WorkspaceMessageEditResponse:
        logger.info(
            "Workspace message edit requested action=%s message_id=%s content_length=%s",
            request.action,
            message_id,
            len(request.content),
        )
        logger.log(TRACE_LEVEL, "Workspace edited user content=%r", request.content)
        messages, response = runtime.edit_message(
            message_id,
            action=request.action,
            content=request.content,
        )
        return WorkspaceMessageEditResponse(
            is_responding=response is not None,
            messages=messages,
        )

    @app.post("/api/workspace/messages/{message_id}/errors/{error_id}/retry")
    async def retry_workspace_error(
        message_id: str,
        error_id: str,
    ) -> WorkspaceMessageEditResponse:
        logger.info(
            "Workspace error retry requested message_id=%s error_id=%s",
            message_id,
            error_id,
        )
        messages, response = runtime.retry_error(
            message_id,
            error_id=error_id,
        )
        return WorkspaceMessageEditResponse(
            is_responding=response is not None,
            messages=messages,
        )

    @app.post("/api/workspace/clear")
    async def clear_workspace() -> WorkspaceClearResponse:
        messages = runtime.clear()
        await runtime.notify_cleared_response()
        return WorkspaceClearResponse(messages=messages)

    @app.get("/api/workspace/stream")
    async def stream_workspace_response(
        after: int = Query(default=0, ge=0),
    ) -> StreamingResponse:
        response = runtime.stream_current_response()
        return StreamingResponse(
            runtime.response_stream(response, after),
            media_type="text/event-stream",
        )

    @app.post("/api/workspace/stop")
    async def stop_workspace_response() -> dict[str, bool]:
        runtime.stop_response()
        return {"ok": True}

    @app.post("/api/workspace/compact", response_class=StreamingResponse)
    async def compact_workspace() -> StreamingResponse:
        return StreamingResponse(
            runtime.compact_stream(),
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
        response = runtime.start_response(
            request.content, message_id=request.message_id
        )
        return StreamingResponse(
            runtime.response_stream(response, include_snapshots=False),
            media_type="text/event-stream",
        )
