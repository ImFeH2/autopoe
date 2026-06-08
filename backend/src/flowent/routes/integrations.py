from pathlib import Path

from fastapi import FastAPI, HTTPException

from flowent.api_models import (
    McpImportPreviewRequest,
    McpImportRequest,
    SkillSettingsRequest,
    TelegramSessionApproveRequest,
)
from flowent.channels import TelegramBotManager
from flowent.mcp import McpManager
from flowent.mcp_import import McpImportDiscovery, discover_imported_mcp_servers
from flowent.skills import discover_skills, update_skill_enabled
from flowent.storage import (
    StateStore,
    StoredMcpServer,
    StoredSkill,
    StoredTelegramBot,
    StoredTelegramSession,
)


def register_integration_routes(
    app: FastAPI,
    *,
    cwd: Path,
    mcp_manager: McpManager,
    store: StateStore,
    telegram_bot_manager: TelegramBotManager,
) -> None:
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
        await telegram_bot_manager.sync_bot(saved_bot)
        return telegram_bot_manager.bot_with_status(saved_bot)

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
