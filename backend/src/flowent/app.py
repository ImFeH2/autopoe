import logging
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from flowent.bootstrap import (
    AppConfig,
    AppDependencies,
    bind_app_state,
    build_app_dependencies,
    create_application_lifespan,
    ensure_application_requirements,
    resolve_app_config,
)
from flowent.bootstrap import (
    frontend_static_directory as resolve_frontend_static_directory,
)
from flowent.channels import TelegramTransport
from flowent.llm import CompletionCallable
from flowent.mcp import McpTransport
from flowent.routes.integrations import register_integration_routes
from flowent.routes.permissions import register_permission_routes
from flowent.routes.providers import register_provider_routes
from flowent.routes.system import register_system_routes
from flowent.routes.workflow_routes import register_workflow_routes
from flowent.routes.workspace import register_workspace_routes

logger = logging.getLogger("flowent.app")
frontend_static_directory = resolve_frontend_static_directory


def create_app(
    *,
    serve_frontend: bool = True,
    chat_completion: CompletionCallable | None = None,
    mcp_transport: McpTransport | None = None,
    telegram_transport: TelegramTransport | None = None,
    workdir: Path | str | None = None,
    config: AppConfig | None = None,
    dependencies: AppDependencies | None = None,
) -> FastAPI:
    ensure_application_requirements()
    resolved_config = config or resolve_app_config(
        serve_frontend=serve_frontend,
        workdir=workdir,
    )
    resolved_dependencies = dependencies or build_app_dependencies(
        resolved_config,
        chat_completion=chat_completion,
        mcp_transport=mcp_transport,
        telegram_transport=telegram_transport,
    )

    logger.debug(
        "Flowent app created serve_frontend=%s", resolved_config.serve_frontend
    )
    logger.info("Workdir: %s", resolved_config.cwd)
    logger.info("Static directory: %s", resolved_config.static_dir)

    app = FastAPI(
        title="Flowent",
        lifespan=create_application_lifespan(resolved_dependencies),
    )
    bind_app_state(app, resolved_dependencies)

    register_system_routes(
        app,
        cwd=resolved_config.cwd,
        mcp_manager=resolved_dependencies.mcp_manager,
        runtime=resolved_dependencies.runtime,
        store=resolved_dependencies.store,
        telegram_bot_manager=resolved_dependencies.telegram_bot_manager,
    )
    register_provider_routes(app, store=resolved_dependencies.store)
    register_integration_routes(
        app,
        cwd=resolved_config.cwd,
        mcp_manager=resolved_dependencies.mcp_manager,
        store=resolved_dependencies.store,
        telegram_bot_manager=resolved_dependencies.telegram_bot_manager,
    )
    register_workflow_routes(
        app,
        workflow_service=resolved_dependencies.workflow_service,
    )
    register_permission_routes(
        app,
        cwd=resolved_config.cwd,
        store=resolved_dependencies.store,
    )
    register_workspace_routes(app, runtime=resolved_dependencies.runtime)

    if resolved_config.serve_frontend and resolved_config.static_dir.is_dir():
        assets_dir = resolved_config.static_dir / "assets"
        if assets_dir.is_dir():
            app.mount("/assets", StaticFiles(directory=assets_dir), name="assets")

        @app.get("/{path:path}")
        async def spa_fallback(path: str) -> FileResponse:
            file = (resolved_config.static_dir / path).resolve(strict=False)
            if file.is_file() and file.is_relative_to(resolved_config.static_dir):
                return FileResponse(file)
            return FileResponse(resolved_config.static_dir / "index.html")

    return app


app = create_app()


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app)
