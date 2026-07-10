from pathlib import Path

from fastapi import FastAPI

from flowent._version import __version__
from flowent.api_models import AboutResponse, AppStateResponse
from flowent.channels import TelegramBotManager
from flowent.mcp import McpManager
from flowent.skills import discover_skills
from flowent.storage import StateStore
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
    async def app_state() -> AppStateResponse:
        state = state_with_current_model_context_window(store.read_state())
        active_response = runtime.current_response()
        update: dict[str, object] = {
            "is_responding": active_response is not None
            and not active_response.is_done,
            "response_event_index": active_response.latest_event_index
            if active_response
            else 0,
            "mcp_servers": mcp_manager.servers_with_status(state.mcp_servers),
            "skills": discover_skills(cwd, store),
        }
        update["telegram_bot"] = telegram_bot_manager.bot_with_status(
            state.telegram_bot
        )
        return AppStateResponse.from_stored(state.model_copy(update=update))

    @app.get("/api/about")
    async def about() -> AboutResponse:
        return AboutResponse(version=__version__)
