import logging

from fastapi import FastAPI, Query
from fastapi.responses import StreamingResponse

from flowent.api_models import (
    WorkspaceClearResponse,
    WorkspaceMessageEditRequest,
    WorkspaceMessageEditResponse,
    WorkspaceMessagesRequest,
    WorkspaceRespondRequest,
    WorkspaceRunResponse,
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
        messages, run = runtime.edit_message(
            message_id,
            action=request.action,
            content=request.content,
        )
        return WorkspaceMessageEditResponse(
            messages=messages,
            run_id=run.id if run else None,
        )

    @app.post("/api/workspace/clear")
    async def clear_workspace() -> WorkspaceClearResponse:
        messages = runtime.clear()
        await runtime.notify_cleared_runs()
        return WorkspaceClearResponse(messages=messages)

    @app.post("/api/workspace/runs")
    async def start_workspace_run(
        request: WorkspaceRespondRequest,
    ) -> WorkspaceRunResponse:
        logger.info("Workspace run requested content_length=%s", len(request.content))
        logger.log(TRACE_LEVEL, "Workspace user content=%r", request.content)
        run = runtime.create_run(request.content, message_id=request.message_id)
        return WorkspaceRunResponse(run_id=run.id)

    @app.get("/api/workspace/runs/{run_id}/stream")
    async def stream_workspace_run(
        run_id: str,
        after: int = Query(default=0, ge=0),
    ) -> StreamingResponse:
        run = runtime.run_by_id(run_id)
        return StreamingResponse(
            runtime.run_stream(run, after),
            media_type="text/event-stream",
        )

    @app.post("/api/workspace/runs/{run_id}/stop")
    async def stop_workspace_run(run_id: str) -> dict[str, bool]:
        runtime.stop_run(run_id)
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
        run = runtime.create_run(request.content, message_id=request.message_id)
        return StreamingResponse(
            runtime.run_stream(run, include_snapshots=False),
            media_type="text/event-stream",
        )
