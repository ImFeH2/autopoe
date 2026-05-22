from __future__ import annotations

import json
from typing import Any

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

    async def connect(self, server: StoredMcpServer) -> list[dict[str, object]]:
        self.connect_calls.append(server)
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


def test_enabled_mcp_server_connects_and_lists_tools(tmp_path, monkeypatch) -> None:
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
    assert response.json()["status"] == "ready"
    assert response.json()["tools"][0]["name"] == "read_file"


def test_mcp_connection_error_is_reported_in_state(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path))
    transport = FakeMcpTransport()
    transport.errors["mcp-files"] = "Command failed"
    client = TestClient(create_app(serve_frontend=False, mcp_transport=transport))

    response = client.put("/api/mcp/servers", json=command_server_payload())

    assert response.status_code == 200
    assert response.json()["status"] == "error"
    assert response.json()["error"] == "Command failed"


def test_mcp_server_can_be_reconnected(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path))
    transport = FakeMcpTransport()
    transport.tools_by_server["mcp-files"] = [
        {"inputSchema": {"type": "object"}, "name": "read_file"}
    ]
    client = TestClient(create_app(serve_frontend=False, mcp_transport=transport))
    client.put("/api/mcp/servers", json=command_server_payload())
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


def test_ready_mcp_tools_are_included_in_workspace_request(
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

    response = client.post("/api/workspace/respond", json={"content": "Read file"})

    assert response.status_code == 200
    tool_names = [
        tool["function"]["name"]
        for tool in captured_requests[0]["tools"]
        if isinstance(tool, dict) and isinstance(tool.get("function"), dict)
    ]
    assert mcp_tool_name("mcp-files", "read_file") in tool_names


def test_mcp_tool_call_is_forwarded_and_result_returns_to_agent(
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
    assert events[2]["event"] == "tool_start"
    assert events[2]["data"]["tool"]["title"] == "Calling Files.read_file"
    assert events[3]["event"] == "tool_done"
    assert events[3]["data"]["data"]["server"] == "Files"
    assert events[3]["data"]["data"]["tool"] == "read_file"


def test_mcp_tool_call_failure_is_reported_in_workspace(tmp_path, monkeypatch) -> None:
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

    response = client.post("/api/workspace/respond", json={"content": "Use MCP"})

    assert response.status_code == 200
    events = stream_events(response.text)
    assert events[3]["event"] == "tool_error"
    assert events[3]["data"]["status"] == "failed"
    assert events[3]["data"]["content"] == "Permission denied"


def test_mcp_server_reload_reconnects_saved_enabled_servers(
    tmp_path, monkeypatch
) -> None:
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path))
    store = StateStore(tmp_path)
    store.save_mcp_server(StoredMcpServer.model_validate(command_server_payload()))
    transport = FakeMcpTransport()
    transport.tools_by_server["mcp-files"] = [
        {"inputSchema": {"type": "object"}, "name": "read_file"}
    ]
    client = TestClient(create_app(serve_frontend=False, mcp_transport=transport))

    response = client.post("/api/mcp/reload")

    assert response.status_code == 200
    assert response.json()[0]["status"] == "ready"
    assert transport.connect_calls[0].id == "mcp-files"
