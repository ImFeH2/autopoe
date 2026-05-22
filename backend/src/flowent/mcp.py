from __future__ import annotations

import json
import logging
import re
from contextlib import AsyncExitStack
from importlib import import_module
from typing import Any, Protocol

from flowent.storage import StateStore, StoredMcpServer, StoredMcpTool
from flowent.tools import ToolResult

logger = logging.getLogger("flowent.mcp")


class McpTransport(Protocol):
    async def connect(self, server: StoredMcpServer) -> list[dict[str, object]]: ...

    async def disconnect(self, server_id: str) -> None: ...

    async def call_tool(
        self,
        server_id: str,
        tool_name: str,
        arguments: dict[str, object],
    ) -> dict[str, object]: ...


def mcp_tool_name(server_id: str, tool_name: str) -> str:
    return f"mcp__{server_id}__{tool_name}"


def parse_mcp_tool_name(name: str) -> tuple[str, str] | None:
    if not name.startswith("mcp__"):
        return None
    parts = name.removeprefix("mcp__").split("__", 1)
    if len(parts) != 2 or not parts[0] or not parts[1]:
        return None
    return parts[0], parts[1]


def stable_mcp_server_id(name: str) -> str:
    normalized = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    return f"mcp-{normalized or 'server'}"


def mcp_tools_from_result(raw_tools: list[dict[str, object]]) -> list[StoredMcpTool]:
    tools: list[StoredMcpTool] = []
    for raw_tool in raw_tools:
        name = raw_tool.get("name")
        if not isinstance(name, str) or not name:
            continue
        input_schema = raw_tool.get("inputSchema", raw_tool.get("input_schema", {}))
        output_schema = raw_tool.get("outputSchema", raw_tool.get("output_schema"))
        tools.append(
            StoredMcpTool(
                description=str(raw_tool.get("description") or ""),
                input_schema=input_schema if isinstance(input_schema, dict) else {},
                name=name,
                output_schema=output_schema
                if isinstance(output_schema, dict)
                else None,
            )
        )
    return tools


def mcp_result_content(result: dict[str, object]) -> str:
    content = result.get("content")
    if isinstance(content, list):
        parts: list[str] = []
        for item in content:
            if isinstance(item, dict) and isinstance(item.get("text"), str):
                parts.append(item["text"])
            elif hasattr(item, "text") and isinstance(item.text, str):
                parts.append(item.text)
        if parts:
            return "\n".join(parts)
    structured_content = result.get("structuredContent")
    if structured_content is not None:
        return json.dumps(structured_content, ensure_ascii=False)
    return json.dumps(result, ensure_ascii=False)


def mcp_result_is_error(result: dict[str, object]) -> bool:
    return bool(result.get("isError") or result.get("is_error"))


class DefaultMcpTransport:
    def __init__(self) -> None:
        self._sessions: dict[str, Any] = {}
        self._stacks: dict[str, AsyncExitStack] = {}

    async def connect(self, server: StoredMcpServer) -> list[dict[str, object]]:
        from mcp import ClientSession, StdioServerParameters
        from mcp.client.stdio import stdio_client

        await self.disconnect(server.id)
        stack = AsyncExitStack()
        if server.type == "url":
            http_module = import_module("mcp.client.streamable_http")
            if hasattr(http_module, "streamable_http_client"):
                streamable_http_client = http_module.streamable_http_client
            else:
                streamable_http_client = http_module.streamablehttp_client
            read_stream, write_stream, _ = await stack.enter_async_context(
                streamable_http_client(server.url)
            )
        else:
            read_stream, write_stream = await stack.enter_async_context(
                stdio_client(
                    StdioServerParameters(command=server.command, args=server.args)
                )
            )
        session = await stack.enter_async_context(
            ClientSession(read_stream, write_stream)
        )
        await session.initialize()
        result = await session.list_tools()
        self._sessions[server.id] = session
        self._stacks[server.id] = stack
        return [self._model_dump(tool) for tool in result.tools]

    async def disconnect(self, server_id: str) -> None:
        stack = self._stacks.pop(server_id, None)
        self._sessions.pop(server_id, None)
        if stack is not None:
            await stack.aclose()

    async def call_tool(
        self,
        server_id: str,
        tool_name: str,
        arguments: dict[str, object],
    ) -> dict[str, object]:
        session = self._sessions.get(server_id)
        if session is None:
            raise RuntimeError("Server is not connected.")
        result = await session.call_tool(tool_name, arguments=arguments)
        return self._model_dump(result)

    def _model_dump(self, value: Any) -> dict[str, object]:
        if hasattr(value, "model_dump"):
            dumped = value.model_dump(by_alias=True)
            return dumped if isinstance(dumped, dict) else {}
        if isinstance(value, dict):
            return value
        return {}


class McpManager:
    def __init__(
        self,
        *,
        store: StateStore,
        transport: McpTransport | None = None,
    ) -> None:
        self.store = store
        self.transport = transport or DefaultMcpTransport()
        self._status_by_server: dict[str, str] = {}
        self._error_by_server: dict[str, str] = {}
        self._tools_by_server: dict[str, list[StoredMcpTool]] = {}
        self._server_names: dict[str, str] = {}

    async def start_enabled(self) -> None:
        for server in self.store.read_mcp_servers():
            if server.enabled:
                await self.connect_server(server)
            else:
                await self.disconnect_server(server.id)

    async def stop_all(self) -> None:
        for server_id in list(self._status_by_server):
            await self.transport.disconnect(server_id)
        self._status_by_server.clear()
        self._error_by_server.clear()
        self._tools_by_server.clear()
        self._server_names.clear()

    async def sync_server(self, server: StoredMcpServer) -> StoredMcpServer:
        if not server.enabled:
            await self.disconnect_server(server.id)
            return self.server_with_status(server)
        await self.connect_server(server)
        return self.server_with_status(server)

    async def reconnect_server(self, server_id: str) -> StoredMcpServer:
        server = self.find_server(server_id)
        await self.transport.disconnect(server_id)
        if server.enabled:
            await self.connect_server(server)
        else:
            await self.disconnect_server(server_id)
        return self.server_with_status(server)

    async def delete_server(self, server_id: str) -> None:
        self.store.delete_mcp_server(server_id)
        try:
            await self.transport.disconnect(server_id)
        except Exception:
            logger.exception("MCP server disconnect failed during delete")
        self._status_by_server.pop(server_id, None)
        self._error_by_server.pop(server_id, None)
        self._tools_by_server.pop(server_id, None)
        self._server_names.pop(server_id, None)

    async def reload(self) -> list[StoredMcpServer]:
        await self.stop_all()
        await self.start_enabled()
        return self.servers_with_status(self.store.read_mcp_servers())

    def find_server(self, server_id: str) -> StoredMcpServer:
        for server in self.store.read_mcp_servers():
            if server.id == server_id:
                return server
        raise KeyError(server_id)

    async def connect_server(self, server: StoredMcpServer) -> None:
        self._server_names[server.id] = server.name
        self._status_by_server[server.id] = "starting"
        self._error_by_server[server.id] = ""
        try:
            raw_tools = await self.transport.connect(server)
        except Exception as error:
            self._status_by_server[server.id] = "error"
            self._error_by_server[server.id] = str(error)
            self._tools_by_server[server.id] = []
            return
        tools = mcp_tools_from_result(raw_tools)
        self.store.save_mcp_tools(server.id, tools)
        self._tools_by_server[server.id] = tools
        self._status_by_server[server.id] = "ready"
        self._error_by_server[server.id] = ""

    async def disconnect_server(self, server_id: str) -> None:
        await self.transport.disconnect(server_id)
        self._status_by_server[server_id] = "disabled"
        self._error_by_server[server_id] = ""
        self._tools_by_server[server_id] = []

    def server_with_status(self, server: StoredMcpServer) -> StoredMcpServer:
        if not server.enabled:
            status = "disabled"
            error = ""
            tools: list[StoredMcpTool] = []
        else:
            status = self._status_by_server.get(server.id, server.status)
            error = self._error_by_server.get(server.id, server.error)
            tools = self._tools_by_server.get(server.id, server.tools)
        self._server_names[server.id] = server.name
        return server.model_copy(
            update={
                "error": error,
                "status": status,
                "tools": tools,
            }
        )

    def servers_with_status(
        self, servers: list[StoredMcpServer]
    ) -> list[StoredMcpServer]:
        return [self.server_with_status(server) for server in servers]

    def tool_specs(self) -> list[dict[str, object]]:
        specs: list[dict[str, object]] = []
        for server in self.servers_with_status(self.store.read_mcp_servers()):
            if server.status != "ready":
                continue
            for tool in server.tools:
                specs.append(
                    {
                        "type": "function",
                        "function": {
                            "name": mcp_tool_name(server.id, tool.name),
                            "description": tool.description
                            or f"Call {server.name}.{tool.name}.",
                            "parameters": tool.input_schema or {"type": "object"},
                        },
                    }
                )
        return specs

    def tool_title(self, name: str) -> str | None:
        parsed = parse_mcp_tool_name(name)
        if parsed is None:
            return None
        server_id, tool_name = parsed
        return f"Calling {self._server_names.get(server_id, server_id)}.{tool_name}"

    async def run_tool(
        self, name: str, arguments: dict[str, object]
    ) -> ToolResult | None:
        parsed = parse_mcp_tool_name(name)
        if parsed is None:
            return None
        server_id, tool_name = parsed
        result = await self.transport.call_tool(server_id, tool_name, arguments)
        content = mcp_result_content(result)
        server_name = self._server_names.get(server_id, server_id)
        return ToolResult(
            content=content,
            data={
                "server": server_name,
                "tool": tool_name,
                "result": result,
            },
            ok=not mcp_result_is_error(result),
            title=f"Calling {server_name}.{tool_name}",
        )
