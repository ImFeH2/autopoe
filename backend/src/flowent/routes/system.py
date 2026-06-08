from pathlib import Path

from fastapi import FastAPI

from flowent._version import __version__
from flowent.api_models import AboutResponse
from flowent.channels import TelegramBotManager
from flowent.mcp import McpManager
from flowent.skills import discover_skills
from flowent.storage import StateStore, StoredState
from flowent.workspace.context import state_with_current_model_context_window
from flowent.workspace.runtime import WorkspaceRuntime


def register_system_routes(
    app: FastAPI,
    *,
    cwd: Path,
    mcp_manager: McpManager,
    runtime: WorkspaceRuntime,
    store: StateStore,
    telegram_bot_manager: TelegramBotManager,
) -> None:
    @app.get("/api/health")
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/api/state")
    async def app_state() -> StoredState:
        state = state_with_current_model_context_window(store.read_state())
        active_run = runtime.active_run()
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
        update["telegram_bot"] = telegram_bot_manager.bot_with_status(
            state.telegram_bot
        )
        return state.model_copy(update=update)

    @app.get("/api/about")
    async def about() -> AboutResponse:
        return AboutResponse(version=__version__)
