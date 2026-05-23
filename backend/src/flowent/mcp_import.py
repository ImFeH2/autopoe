from __future__ import annotations

import json
import tomllib
from collections.abc import Iterable
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from flowent.mcp import stable_mcp_server_id
from flowent.storage import StoredMcpServer

McpImportSource = Literal["claude_code", "codex"]


class McpImportSourceResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    error: str = ""
    path: str
    servers: list[StoredMcpServer] = Field(default_factory=list)
    source: McpImportSource


class McpImportDiscovery(BaseModel):
    model_config = ConfigDict(extra="forbid")

    servers: list[StoredMcpServer] = Field(default_factory=list)
    sources: list[McpImportSourceResult] = Field(default_factory=list)


def discover_imported_mcp_servers(
    cwd: Path | None = None,
    home: Path | None = None,
) -> McpImportDiscovery:
    workspace = (cwd or Path.cwd()).resolve(strict=False)
    user_home = (home or Path.home()).resolve(strict=False)
    sources: list[McpImportSourceResult] = []

    for path, source in candidate_mcp_config_files(workspace, user_home):
        if not path.is_file():
            continue
        try:
            servers = parse_mcp_config_file(path, source, workspace)
            sources.append(
                McpImportSourceResult(
                    path=str(path.resolve(strict=False)),
                    servers=servers,
                    source=source,
                )
            )
        except Exception as error:
            sources.append(
                McpImportSourceResult(
                    error=str(error),
                    path=str(path.resolve(strict=False)),
                    source=source,
                )
            )

    return McpImportDiscovery(
        servers=dedupe_mcp_servers(
            server for source_result in sources for server in source_result.servers
        ),
        sources=sources,
    )


def candidate_mcp_config_files(
    cwd: Path,
    home: Path,
) -> list[tuple[Path, McpImportSource]]:
    candidates: list[tuple[Path, McpImportSource]] = [
        (cwd / ".mcp.json", "claude_code"),
        (cwd / ".claude" / "settings.local.json", "claude_code"),
        (cwd / ".claude" / "settings.json", "claude_code"),
        (home / ".claude.json", "claude_code"),
        (home / ".claude" / "settings.json", "claude_code"),
        (cwd / ".codex" / "config.toml", "codex"),
        (home / ".codex" / "config.toml", "codex"),
    ]
    seen: set[tuple[Path, McpImportSource]] = set()
    unique_candidates: list[tuple[Path, McpImportSource]] = []
    for path, source in candidates:
        key = (path.resolve(strict=False), source)
        if key in seen:
            continue
        seen.add(key)
        unique_candidates.append((path, source))
    return unique_candidates


def parse_mcp_config_file(
    path: Path,
    source: McpImportSource,
    cwd: Path,
) -> list[StoredMcpServer]:
    if source == "codex":
        payload = tomllib.loads(path.read_text(encoding="utf-8"))
        return parse_codex_mcp_servers(payload)
    payload = json.loads(path.read_text(encoding="utf-8"))
    return parse_claude_code_mcp_servers(payload, cwd)


def parse_codex_mcp_servers(payload: object) -> list[StoredMcpServer]:
    if not isinstance(payload, dict):
        return []
    raw_servers = payload.get("mcp_servers")
    if not isinstance(raw_servers, dict):
        return []
    return servers_from_map(raw_servers)


def parse_claude_code_mcp_servers(payload: object, cwd: Path) -> list[StoredMcpServer]:
    if not isinstance(payload, dict):
        return []
    server_maps: list[dict[object, object]] = []
    projects = payload.get("projects")
    if isinstance(projects, dict):
        workspace_keys = [str(cwd.resolve(strict=False)), str(cwd)]
        for workspace_key in dict.fromkeys(workspace_keys):
            project_config = projects.get(workspace_key)
            if isinstance(project_config, dict):
                project_servers = project_config.get("mcpServers")
                if isinstance(project_servers, dict):
                    server_maps.append(project_servers)
    top_level_servers = payload.get("mcpServers")
    if isinstance(top_level_servers, dict):
        server_maps.append(top_level_servers)

    return dedupe_mcp_servers(
        server for server_map in server_maps for server in servers_from_map(server_map)
    )


def servers_from_map(raw_servers: dict[object, object]) -> list[StoredMcpServer]:
    servers: list[StoredMcpServer] = []
    for raw_name, raw_config in raw_servers.items():
        if not isinstance(raw_config, dict):
            continue
        server = server_from_config(str(raw_name), raw_config)
        if server is not None:
            servers.append(server)
    return dedupe_mcp_servers(servers)


def server_from_config(
    name: str,
    raw_config: dict[object, object],
) -> StoredMcpServer | None:
    config = {str(key): value for key, value in raw_config.items()}
    url = string_config(config, "url")
    command = string_config(config, "command")
    args = string_list_config(config, "args")
    server_type = "url" if url else "command"
    if server_type == "command" and not command:
        return None
    enabled = enabled_config(config)
    return StoredMcpServer(
        args=args if server_type == "command" else [],
        command=command if server_type == "command" else "",
        config=config,
        enabled=enabled,
        id=stable_mcp_server_id(name),
        name=name,
        type=server_type,
        url=url if server_type == "url" else "",
    )


def string_config(config: dict[str, object], key: str) -> str:
    value = config.get(key)
    return value if isinstance(value, str) else ""


def string_list_config(config: dict[str, object], key: str) -> list[str]:
    value = config.get(key)
    if not isinstance(value, list):
        return []
    return [item for item in value if isinstance(item, str)]


def enabled_config(config: dict[str, object]) -> bool:
    enabled = config.get("enabled")
    if isinstance(enabled, bool):
        return enabled
    disabled = config.get("disabled")
    if isinstance(disabled, bool):
        return not disabled
    return True


def dedupe_mcp_servers(servers: Iterable[StoredMcpServer]) -> list[StoredMcpServer]:
    unique_servers: list[StoredMcpServer] = []
    seen_ids: set[str] = set()
    for server in servers:
        if server.id in seen_ids:
            continue
        seen_ids.add(server.id)
        unique_servers.append(server)
    return unique_servers
