import logging
import os
from collections.abc import AsyncIterator, Awaitable
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from flowent.channels import TelegramBotManager, TelegramTransport
from flowent.compact import LocalSummaryCompactProvider
from flowent.llm import CompletionCallable
from flowent.logging import ensure_logging_configured
from flowent.mcp import McpManager, McpTransport
from flowent.paths import resolve_workdir
from flowent.routes.integrations import register_integration_routes
from flowent.routes.permissions import register_permission_routes
from flowent.routes.providers import register_provider_routes
from flowent.routes.system import register_system_routes
from flowent.routes.workflow_routes import register_workflow_routes
from flowent.routes.workspace import register_workspace_routes
from flowent.sandbox import ensure_sandbox_available
from flowent.storage import StateStore
from flowent.system_tools import ensure_ripgrep_available
from flowent.workspace.runtime import WorkspaceRuntime

logger = logging.getLogger("flowent.app")


DEFAULT_STATIC_DIR = Path(__file__).parent / "static"


def frontend_static_directory() -> Path:
    configured_directory = os.environ.get("FLOWENT_STATIC_DIR")
    if configured_directory:
        return Path(configured_directory)
    repository_frontend_dist = Path(__file__).resolve().parents[3] / "frontend" / "dist"
    if repository_frontend_dist.is_dir():
        return repository_frontend_dist
    return DEFAULT_STATIC_DIR


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
    ensure_ripgrep_available()

    cwd = resolve_workdir(workdir)
    store = StateStore()
    compact_provider = LocalSummaryCompactProvider()
    mcp_manager = McpManager(store=store, transport=mcp_transport)

    static_dir = frontend_static_directory().resolve(strict=False)
    logger.debug("Flowent app created serve_frontend=%s", serve_frontend)
    logger.info("Workdir: %s", cwd)
    logger.info("Static directory: %s", static_dir)

    runtime = WorkspaceRuntime(
        chat_completion=chat_completion,
        compact_provider=compact_provider,
        cwd=cwd,
        mcp_manager=mcp_manager,
        store=store,
    )

    telegram_bot_manager = TelegramBotManager(
        message_handler=runtime.reply_text,
        store=store,
        telegram_transport=telegram_transport,
    )

    async def run_shutdown_step(label: str, cleanup: Awaitable[object]) -> None:
        try:
            await cleanup
        except Exception:
            logger.exception("%s cleanup failed during shutdown", label)

    async def graceful_shutdown() -> None:
        await run_shutdown_step("Workspace", runtime.stop_for_shutdown())
        await run_shutdown_step("Telegram", telegram_bot_manager.stop_all())
        await run_shutdown_step("MCP", mcp_manager.stop_all())

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        app.state.mcp_manager = mcp_manager
        app.state.telegram_bot_manager = telegram_bot_manager
        await mcp_manager.start_enabled()
        await telegram_bot_manager.start_enabled()
        try:
            yield
        finally:
            await graceful_shutdown()

    app = FastAPI(title="Flowent", lifespan=lifespan)
    app.state.mcp_manager = mcp_manager
    app.state.telegram_bot_manager = telegram_bot_manager

    register_system_routes(
        app,
        cwd=cwd,
        mcp_manager=mcp_manager,
        runtime=runtime,
        store=store,
        telegram_bot_manager=telegram_bot_manager,
    )
    register_provider_routes(app, store=store)
    register_integration_routes(
        app,
        cwd=cwd,
        mcp_manager=mcp_manager,
        store=store,
        telegram_bot_manager=telegram_bot_manager,
    )
    register_workflow_routes(
        app,
        chat_completion=chat_completion,
        store=store,
    )
    register_permission_routes(app, cwd=cwd, store=store)
    register_workspace_routes(app, runtime=runtime, store=store)

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
