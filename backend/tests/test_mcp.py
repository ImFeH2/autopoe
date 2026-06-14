from __future__ import annotations

import asyncio
import json
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from flowent.main import create_app
from flowent.mcp import McpTransport, mcp_tool_name
from flowent.storage import StateStore, StoredMcpServer


class FakeMcpTransport(McpTransport):
    def __init__(self) -> None:
        self.connect_calls: list[StoredMcpServer] = []
        self.disconnect_calls: list[str] = []
        self.disconnect_errors: dict[str, str] = {}
        self.tool_calls: list[tuple[str, str, dict[str, object]]] = []
        self.errors: dict[str, str] = {}
        self.tools_by_server: dict[str, list[dict[str, object]]] = {}
        self.results: dict[tuple[str, str], dict[str, object]] = {}
        self.sleep_on_connect: set[str] = set()

    async def connect(self, server: StoredMcpServer) -> list[dict[str, object]]:
        self.connect_calls.append(server)
        if server.id in self.sleep_on_connect:
            await asyncio.sleep(60)
        if server.id in self.errors:
            raise RuntimeError(self.errors[server.id])
        return self.tools_by_server.get(server.id, [])

    async def disconnect(self, server_id: str) -> None:
        self.disconnect_calls.append(server_id)
        if server_id in self.disconnect_errors:
            raise RuntimeError(self.disconnect_errors[server_id])

    async def call_tool(
        self,
        server_id: str,
        tool_name: str,
        arguments: dict[str, object],
    ) -> dict[str, object]:
        self.tool_calls.append((server_id, tool_name, arguments))
        result = self.results.get((server_id, tool_name))
        if result is None:
            return {
                "content": [{"type": "text", "text": "Tool result"}],
                "isError": False,
            }
        return result


def configure_provider(client: TestClient) -> None:
    client.post(
        "/api/providers",
        json={
            "api_key": "sk-local",
            "base_url": "",
            "id": "provider-openai",
            "models": ["gpt-5.1"],
            "name": "OpenAI",
            "type": "openai",
        },
    )
    client.put(
        "/api/settings",
        json={
            "reasoning_effort": "default",
            "selected_model": "gpt-5.1",
            "selected_provider_id": "provider-openai",
        },
    )


def command_server_payload(**updates: object) -> dict[str, object]:
    payload: dict[str, object] = {
        "args": ["-y", "@modelcontextprotocol/server-filesystem", "/project"],
        "command": "npx",
        "enabled": True,
        "id": "mcp-files",
        "name": "Files",
        "status": "disabled",
        "tools": [],
        "type": "command",
        "url": "",
    }
    payload.update(updates)
    return payload


def url_server_payload(**updates: object) -> dict[str, object]:
    payload = command_server_payload(
        args=[],
        command="",
        id="mcp-docs",
        name="Docs",
        type="url",
        url="https://example.com/mcp",
    )
    payload.update(updates)
    return payload


def codex_import_content(name: str = "docs", command: str = "npx") -> str:
    return f"""
[mcp_servers.{name}]
command = "{command}"
args = ["-y", "@modelcontextprotocol/server-filesystem", "/project"]
enabled = false

[mcp_servers.{name}.env]
DOCS_TOKEN = "${{DOCS_TOKEN}}"
"""


def claude_code_import_content() -> str:
    return json.dumps(
        {
            "mcpServers": {
                "Linear": {
                    "headers": {"X-Team": "${TEAM_ID:-local}"},
                    "type": "http",
                    "url": "https://linear.example.com/mcp",
                }
            }
        }
    )


def isolated_mcp_import_environment(tmp_path, monkeypatch) -> tuple[Path, Path]:
    data_dir = tmp_path / "data"
    home = tmp_path / "home"
    workspace = tmp_path / "workspace"
    home.mkdir()
    workspace.mkdir()
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(data_dir))
    monkeypatch.setenv("HOME", str(home))
    monkeypatch.chdir(workspace)
    return home, workspace


def write_config(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


async def wait_for_status(
    manager,
    server: StoredMcpServer,
    status: str,
    *,
    attempts: int = 20,
) -> StoredMcpServer:
    current = manager.server_with_status(server)
    for _ in range(attempts):
        current = manager.server_with_status(server)
        if current.status == status:
            return current
        await asyncio.sleep(0.01)
    return current


def tool_call_chunk(
    name: str,
    arguments: dict[str, object],
    call_id: str = "call-1",
) -> dict[str, object]:
    return {
        "choices": [
            {
                "delta": {
                    "tool_calls": [
                        {
                            "function": {
                                "arguments": json.dumps(arguments),
                                "name": name,
                            },
                            "id": call_id,
                            "index": 0,
                            "type": "function",
                        }
                    ]
                }
            }
        ]
    }


def text_chunk(content: str) -> dict[str, object]:
    return {"choices": [{"delta": {"content": content}}]}


def stream_events(content: str) -> list[dict[str, Any]]:
    events: list[dict[str, Any]] = []
    for raw_event in content.strip().split("\n\n"):
        event_type = ""
        data = ""
        for line in raw_event.splitlines():
            if line.startswith("event: "):
                event_type = line.removeprefix("event: ")
            if line.startswith("data: "):
                data = line.removeprefix("data: ")
        events.append({"event": event_type, "data": json.loads(data)})
    return events


def test_mcp_state_defaults_to_empty_servers(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path))
    client = TestClient(create_app(serve_frontend=False))

    state = client.get("/api/state").json()

    assert state["mcp_servers"] == []


def test_mcp_command_server_is_saved_and_persisted(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path))
    transport = FakeMcpTransport()
    client = TestClient(create_app(serve_frontend=False, mcp_transport=transport))

    response = client.put("/api/mcp/servers", json=command_server_payload())

    assert response.status_code == 200
    restarted = TestClient(create_app(serve_frontend=False))
    state = restarted.get("/api/state").json()
    assert state["mcp_servers"][0]["command"] == "npx"
    assert state["mcp_servers"][0]["args"] == [
        "-y",
        "@modelcontextprotocol/server-filesystem",
        "/project",
    ]


def test_mcp_url_server_is_saved_and_persisted(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path))
    transport = FakeMcpTransport()
    client = TestClient(create_app(serve_frontend=False, mcp_transport=transport))

    response = client.put("/api/mcp/servers", json=url_server_payload())

    assert response.status_code == 200
    restarted = TestClient(create_app(serve_frontend=False))
    state = restarted.get("/api/state").json()
    assert state["mcp_servers"][0]["type"] == "url"
    assert state["mcp_servers"][0]["url"] == "https://example.com/mcp"


def test_mcp_server_config_is_saved_and_persisted(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path))
    transport = FakeMcpTransport()
    client = TestClient(create_app(serve_frontend=False, mcp_transport=transport))

    response = client.put(
        "/api/mcp/servers",
        json=command_server_payload(
            config={
                "cwd": "/workspace",
                "env": {"DOCS_TOKEN": "${DOCS_TOKEN}"},
            },
        ),
    )

    assert response.status_code == 200
    restarted = TestClient(create_app(serve_frontend=False))
    state = restarted.get("/api/state").json()
    assert state["mcp_servers"][0]["config"] == {
        "cwd": "/workspace",
        "env": {"DOCS_TOKEN": "${DOCS_TOKEN}"},
    }


def test_mcp_import_preview_reads_codex_config(tmp_path, monkeypatch) -> None:
    home, _ = isolated_mcp_import_environment(tmp_path, monkeypatch)
    write_config(home / ".codex" / "config.toml", codex_import_content())
    client = TestClient(create_app(serve_frontend=False))

    response = client.post(
        "/api/mcp/import/preview",
        json={"source": "codex"},
    )

    assert response.status_code == 200
    result = response.json()
    assert result["sources"][0]["source"] == "codex"
    assert result["sources"][0]["path"].endswith(".codex/config.toml")
    server = result["servers"][0]
    assert server["id"] == "mcp-docs"
    assert server["name"] == "docs"
    assert server["type"] == "command"
    assert server["command"] == "npx"
    assert server["enabled"] is False
    assert server["config"]["env"] == {"DOCS_TOKEN": "${DOCS_TOKEN}"}


def test_mcp_import_preview_reads_claude_code_config(tmp_path, monkeypatch) -> None:
    home, _ = isolated_mcp_import_environment(tmp_path, monkeypatch)
    write_config(home / ".claude.json", claude_code_import_content())
    client = TestClient(create_app(serve_frontend=False))

    response = client.post(
        "/api/mcp/import/preview",
        json={"source": "claude_code"},
    )

    assert response.status_code == 200
    result = response.json()
    assert result["sources"][0]["source"] == "claude_code"
    assert result["sources"][0]["path"].endswith(".claude.json")
    server = result["servers"][0]
    assert server["id"] == "mcp-linear"
    assert server["name"] == "Linear"
    assert server["type"] == "url"
    assert server["url"] == "https://linear.example.com/mcp"
    assert server["config"]["headers"] == {"X-Team": "${TEAM_ID:-local}"}


def test_mcp_import_keeps_existing_server(tmp_path, monkeypatch) -> None:
    home, _ = isolated_mcp_import_environment(tmp_path, monkeypatch)
    write_config(home / ".codex" / "config.toml", codex_import_content())
    transport = FakeMcpTransport()
    client = TestClient(create_app(serve_frontend=False, mcp_transport=transport))
    client.put("/api/mcp/servers", json=command_server_payload(id="mcp-docs"))

    response = client.post(
        "/api/mcp/import",
        json={
            "server_id": "mcp-docs",
            "source": "codex",
        },
    )

    assert response.status_code == 200
    state = client.get("/api/state").json()
    assert state["mcp_servers"][0]["name"] == "Files"
    assert state["mcp_servers"][0]["command"] == "npx"


def test_mcp_import_only_saves_requested_server(tmp_path, monkeypatch) -> None:
    home, _ = isolated_mcp_import_environment(tmp_path, monkeypatch)
    write_config(
        home / ".codex" / "config.toml",
        codex_import_content(name="docs") + codex_import_content(name="search"),
    )
    client = TestClient(create_app(serve_frontend=False))

    response = client.post(
        "/api/mcp/import",
        json={
            "server_id": "mcp-search",
            "source": "codex",
        },
    )

    assert response.status_code == 200
    state = client.get("/api/state").json()
    assert [server["id"] for server in state["mcp_servers"]] == ["mcp-search"]


def test_mcp_import_preview_reports_empty_scan(tmp_path, monkeypatch) -> None:
    isolated_mcp_import_environment(tmp_path, monkeypatch)
    client = TestClient(create_app(serve_frontend=False))

    response = client.post(
        "/api/mcp/import/preview",
        json={"source": "codex"},
    )

    assert response.status_code == 200
    assert response.json() == {"servers": [], "sources": []}


def test_mcp_import_preview_dedupes_discovered_servers(tmp_path, monkeypatch) -> None:
    home, workspace = isolated_mcp_import_environment(tmp_path, monkeypatch)
    write_config(workspace / ".codex" / "config.toml", codex_import_content())
    write_config(
        home / ".codex" / "config.toml",
        codex_import_content(command="different-docs-server"),
    )
    write_config(home / ".claude.json", claude_code_import_content())
    client = TestClient(create_app(serve_frontend=False))

    response = client.post(
        "/api/mcp/import/preview",
        json={"source": "codex"},
    )

    assert response.status_code == 200
    result = response.json()
    assert [server["id"] for server in result["servers"]] == ["mcp-docs"]
    assert result["servers"][0]["command"] == "npx"
    assert len(result["sources"]) == 2


def test_disabled_mcp_server_does_not_connect_or_expose_tools(
    tmp_path, monkeypatch
) -> None:
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path))
    transport = FakeMcpTransport()
    client = TestClient(create_app(serve_frontend=False, mcp_transport=transport))

    response = client.put(
        "/api/mcp/servers",
        json=command_server_payload(enabled=False),
    )

    assert response.status_code == 200
    assert transport.connect_calls == []
    assert response.json()["status"] == "disabled"


@pytest.mark.anyio
async def test_enabled_mcp_server_save_returns_starting_and_connects_in_background(
    tmp_path, monkeypatch
) -> None:
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path))
    transport = FakeMcpTransport()
    transport.tools_by_server["mcp-files"] = [
        {
            "description": "Read a file",
            "inputSchema": {"type": "object"},
            "name": "read_file",
        }
    ]
    client = TestClient(create_app(serve_frontend=False, mcp_transport=transport))

    response = client.put("/api/mcp/servers", json=command_server_payload())

    assert response.status_code == 200
    assert response.json()["status"] == "starting"
    assert response.json()["tools"] == []
    manager = client.app.state.mcp_manager
    connected = await wait_for_status(
        manager,
        StoredMcpServer.model_validate(response.json()),
        "ready",
    )
    assert connected.status == "ready"
    assert connected.tools[0].name == "read_file"


@pytest.mark.anyio
async def test_mcp_connection_error_is_reported_in_state(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path))
    transport = FakeMcpTransport()
    transport.errors["mcp-files"] = "Command failed"
    client = TestClient(create_app(serve_frontend=False, mcp_transport=transport))

    response = client.put("/api/mcp/servers", json=command_server_payload())

    assert response.status_code == 200
    assert response.json()["status"] == "starting"
    manager = client.app.state.mcp_manager
    errored = await wait_for_status(
        manager,
        StoredMcpServer.model_validate(response.json()),
        "error",
    )
    assert errored.status == "error"
    assert errored.error == "Command failed"


@pytest.mark.anyio
async def test_mcp_server_can_be_reconnected(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path))
    transport = FakeMcpTransport()
    transport.tools_by_server["mcp-files"] = [
        {"inputSchema": {"type": "object"}, "name": "read_file"}
    ]
    client = TestClient(create_app(serve_frontend=False, mcp_transport=transport))
    client.put("/api/mcp/servers", json=command_server_payload())

    connected = await wait_for_status(
        client.app.state.mcp_manager,
        StoredMcpServer.model_validate(command_server_payload()),
        "ready",
    )
    assert connected.status == "ready"
    transport.tools_by_server["mcp-files"] = [
        {"inputSchema": {"type": "object"}, "name": "read_file"},
        {"inputSchema": {"type": "object"}, "name": "write_file"},
    ]

    response = client.post("/api/mcp/servers/mcp-files/reconnect")

    assert response.status_code == 200
    assert [tool["name"] for tool in response.json()["tools"]] == [
        "read_file",
        "write_file",
    ]
    assert [server.id for server in transport.connect_calls] == [
        "mcp-files",
        "mcp-files",
    ]


@pytest.mark.anyio
async def test_enabled_mcp_start_does_not_block_app_state(
    tmp_path, monkeypatch
) -> None:
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path))
    store = StateStore(tmp_path)
    server = store.save_mcp_server(
        StoredMcpServer(
            args=[],
            command="slow-server",
            id="mcp-slow",
            name="Slow",
            type="command",
        )
    )
    transport = FakeMcpTransport()
    transport.sleep_on_connect.add("mcp-slow")
    from flowent.mcp import McpManager

    manager = McpManager(store=store, transport=transport)

    await manager.start_enabled()
    state_server = manager.server_with_status(server)

    assert state_server.status == "starting"
    assert transport.connect_calls == []


@pytest.mark.anyio
async def test_mcp_connection_timeout_reports_error(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path))
    server = StoredMcpServer(
        args=[],
        command="slow-server",
        id="mcp-slow",
        name="Slow",
        type="command",
    )
    transport = FakeMcpTransport()
    transport.sleep_on_connect.add("mcp-slow")
    from flowent import mcp as mcp_module

    monkeypatch.setattr(mcp_module, "MCP_CONNECT_TIMEOUT_SECONDS", 0.01)
    manager = mcp_module.McpManager(store=StateStore(tmp_path), transport=transport)

    await manager.connect_server(server)
    state_server = manager.server_with_status(server)

    assert state_server.status == "error"
    assert state_server.error == "Connection timed out."


def test_mcp_server_can_be_deleted(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path))
    transport = FakeMcpTransport()
    client = TestClient(create_app(serve_frontend=False, mcp_transport=transport))
    client.put("/api/mcp/servers", json=command_server_payload())

    response = client.delete("/api/mcp/servers/mcp-files")
    state = client.get("/api/state").json()

    assert response.status_code == 200
    assert state["mcp_servers"] == []
    assert transport.disconnect_calls == ["mcp-files"]


def test_mcp_server_delete_removes_saved_server_when_disconnect_fails(
    tmp_path, monkeypatch
) -> None:
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path))
    transport = FakeMcpTransport()
    transport.disconnect_errors["mcp-files"] = "Disconnect failed"
    client = TestClient(create_app(serve_frontend=False, mcp_transport=transport))
    client.put("/api/mcp/servers", json=command_server_payload())

    response = client.delete("/api/mcp/servers/mcp-files")
    state = client.get("/api/state").json()

    assert response.status_code == 200
    assert state["mcp_servers"] == []
    assert transport.disconnect_calls == ["mcp-files"]


@pytest.mark.anyio
async def test_ready_mcp_tools_are_included_in_workspace_request(
    tmp_path, monkeypatch
) -> None:
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path / "data"))
    captured_requests: list[dict[str, object]] = []
    transport = FakeMcpTransport()
    transport.tools_by_server["mcp-files"] = [
        {
            "description": "Read a file",
            "inputSchema": {"type": "object"},
            "name": "read_file",
        }
    ]

    async def fake_completion(**request: object) -> object:
        captured_requests.append(request)

        async def chunks() -> object:
            yield text_chunk("Done.")

        return chunks()

    client = TestClient(
        create_app(
            serve_frontend=False,
            chat_completion=fake_completion,
            mcp_transport=transport,
        )
    )
    configure_provider(client)
    client.put("/api/mcp/servers", json=command_server_payload())
    connected = await wait_for_status(
        client.app.state.mcp_manager,
        StoredMcpServer.model_validate(command_server_payload()),
        "ready",
    )
    assert connected.status == "ready"

    response = client.post("/api/workspace/respond", json={"content": "Read file"})

    assert response.status_code == 200
    tool_names = [
        tool["function"]["name"]
        for tool in captured_requests[0]["tools"]
        if isinstance(tool, dict) and isinstance(tool.get("function"), dict)
    ]
    assert mcp_tool_name("mcp-files", "read_file") in tool_names


@pytest.mark.anyio
async def test_mcp_tool_call_is_forwarded_and_result_returns_to_agent(
    tmp_path, monkeypatch
) -> None:
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path / "data"))
    captured_requests: list[dict[str, object]] = []
    transport = FakeMcpTransport()
    transport.tools_by_server["mcp-files"] = [
        {"inputSchema": {"type": "object"}, "name": "read_file"}
    ]
    transport.results[("mcp-files", "read_file")] = {
        "content": [{"type": "text", "text": "MCP file content"}],
        "isError": False,
    }

    async def fake_completion(**request: object) -> object:
        captured_requests.append(request)

        async def chunks() -> object:
            if len(captured_requests) == 1:
                yield tool_call_chunk(
                    mcp_tool_name("mcp-files", "read_file"),
                    {"path": "README.md"},
                )
            else:
                yield text_chunk("Used MCP.")

        return chunks()

    client = TestClient(
        create_app(
            serve_frontend=False,
            chat_completion=fake_completion,
            mcp_transport=transport,
        )
    )
    configure_provider(client)
    client.put("/api/mcp/servers", json=command_server_payload())
    connected = await wait_for_status(
        client.app.state.mcp_manager,
        StoredMcpServer.model_validate(command_server_payload()),
        "ready",
    )
    assert connected.status == "ready"

    response = client.post("/api/workspace/respond", json={"content": "Use MCP"})

    assert response.status_code == 200
    assert transport.tool_calls == [("mcp-files", "read_file", {"path": "README.md"})]
    second_messages = captured_requests[1]["messages"]
    assert second_messages[-1] == {
        "content": "MCP file content",
        "role": "tool",
        "tool_call_id": "call-1",
    }
    events = stream_events(response.text)
    assert events[2]["event"] == "output_done"
    assert events[3]["event"] == "tool_start"
    assert events[3]["data"]["tool"]["title"] == "Calling Files.read_file"
    assert events[4]["event"] == "tool_done"
    assert events[4]["data"]["result"]["server"] == "Files"
    assert events[4]["data"]["result"]["tool"] == "read_file"
    assert events[4]["data"]["result"]["output"] == "MCP file content"


@pytest.mark.anyio
async def test_mcp_tool_call_failure_is_reported_in_workspace(
    tmp_path, monkeypatch
) -> None:
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path / "data"))
    captured_requests: list[dict[str, object]] = []
    transport = FakeMcpTransport()
    transport.tools_by_server["mcp-files"] = [
        {"inputSchema": {"type": "object"}, "name": "read_file"}
    ]
    transport.results[("mcp-files", "read_file")] = {
        "content": [{"type": "text", "text": "Permission denied"}],
        "isError": True,
    }

    async def fake_completion(**request: object) -> object:
        captured_requests.append(request)

        async def chunks() -> object:
            if len(captured_requests) == 1:
                yield tool_call_chunk(
                    mcp_tool_name("mcp-files", "read_file"),
                    {"path": "secret.txt"},
                )
            else:
                yield text_chunk("Could not use MCP.")

        return chunks()

    client = TestClient(
        create_app(
            serve_frontend=False,
            chat_completion=fake_completion,
            mcp_transport=transport,
        )
    )
    configure_provider(client)
    client.put("/api/mcp/servers", json=command_server_payload())
    connected = await wait_for_status(
        client.app.state.mcp_manager,
        StoredMcpServer.model_validate(command_server_payload()),
        "ready",
    )
    assert connected.status == "ready"

    response = client.post("/api/workspace/respond", json={"content": "Use MCP"})

    assert response.status_code == 200
    events = stream_events(response.text)
    assert events[2]["event"] == "output_done"
    assert events[4]["event"] == "tool_error"
    assert events[4]["data"]["status"] == "failed"
    assert events[4]["data"]["result"]["output"] == "Permission denied"


@pytest.mark.anyio
async def test_mcp_server_reload_reconnects_saved_enabled_servers(
    tmp_path, monkeypatch
) -> None:
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path))
    store = StateStore(tmp_path)
    server = store.save_mcp_server(
        StoredMcpServer.model_validate(command_server_payload())
    )
    transport = FakeMcpTransport()
    transport.tools_by_server["mcp-files"] = [
        {"inputSchema": {"type": "object"}, "name": "read_file"}
    ]
    client = TestClient(create_app(serve_frontend=False, mcp_transport=transport))

    response = client.post("/api/mcp/reload")

    assert response.status_code == 200
    assert response.json()[0]["status"] == "starting"
    manager = client.app.state.mcp_manager
    connected = await wait_for_status(manager, server, "ready")
    assert connected.status == "ready"
    assert connected.tools[0].name == "read_file"
    assert transport.connect_calls[0].id == "mcp-files"


@pytest.mark.anyio
async def test_enabled_mcp_server_save_does_not_block_response(
    tmp_path, monkeypatch
) -> None:
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path))
    transport = FakeMcpTransport()
    transport.sleep_on_connect.add("mcp-files")
    client = TestClient(create_app(serve_frontend=False, mcp_transport=transport))

    response = client.put("/api/mcp/servers", json=command_server_payload())

    assert response.status_code == 200
    assert response.json()["status"] == "starting"
    assert response.json()["tools"] == []
