from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import sys
from collections.abc import Callable
from contextlib import AsyncExitStack, suppress
from dataclasses import dataclass
from importlib import import_module
from typing import Any, Protocol, TextIO, cast

from flowent.storage import StateStore, StoredMcpServer, StoredMcpTool
from flowent.tools import ToolResult

logger = logging.getLogger("flowent.mcp")
MCP_CONNECT_TIMEOUT_SECONDS = 10
PYTHON_TRACEBACK_START = "Traceback (most recent call last):"
PYTHON_TRACEBACK_TERMINAL_PATTERN = re.compile(
    r"^(?:[A-Za-z_][A-Za-z0-9_.]*(?:Error|Exception|Interrupt|Warning)|"
    r"BaseExceptionGroup|ExceptionGroup)(?::|$)"
)


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


_template_pattern = re.compile(r"\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-(.*?))?\}")


def expand_mcp_template(value: str, *, env: dict[str, str] | None = None) -> str:
    lookup = env or os.environ

    def replace(match: re.Match[str]) -> str:
        name = match.group(1)
        default = match.group(2)
        return lookup.get(name, default or "")

    return _template_pattern.sub(replace, value)


def expand_mcp_value(value: Any, *, env: dict[str, str] | None = None) -> Any:
    if isinstance(value, str):
        return expand_mcp_template(value, env=env)
    if isinstance(value, list):
        return [expand_mcp_value(item, env=env) for item in value]
    if isinstance(value, dict):
        return {key: expand_mcp_value(item, env=env) for key, item in value.items()}
    return value


def expand_mcp_config(config: dict[str, object]) -> dict[str, object]:
    expanded = expand_mcp_value(config) if config else {}
    return expanded if isinstance(expanded, dict) else {}


@dataclass
class _McpConnection:
    close_event: asyncio.Event
    ready: asyncio.Future[list[dict[str, object]]]
    owner_task: asyncio.Task[None] | None = None
    session: Any = None


class _McpStdioErrorFilter:
    def __init__(self, target: TextIO) -> None:
        self.target = target
        self.line_buffer = ""
        self.traceback_lines: list[str] | None = None

    def feed(self, text: str) -> None:
        self.line_buffer += text
        while "\n" in self.line_buffer:
            line, self.line_buffer = self.line_buffer.split("\n", 1)
            self.feed_line(f"{line}\n")

    def finish(self) -> None:
        if self.line_buffer:
            self.feed_line(self.line_buffer)
            self.line_buffer = ""
        if self.traceback_lines is not None:
            self.write("".join(self.traceback_lines))
            self.traceback_lines = None

    def feed_line(self, line: str) -> None:
        stripped_line = line.rstrip("\r\n")
        if self.traceback_lines is not None:
            self.traceback_lines.append(line)
            if stripped_line == "KeyboardInterrupt":
                self.traceback_lines = None
                return
            if PYTHON_TRACEBACK_TERMINAL_PATTERN.match(stripped_line):
                self.write("".join(self.traceback_lines))
                self.traceback_lines = None
            return
        if stripped_line == PYTHON_TRACEBACK_START:
            self.traceback_lines = [line]
            return
        self.write(line)

    def write(self, text: str) -> None:
        self.target.write(text)
        self.target.flush()


class _McpStdioErrorLog:
    def __init__(self, target: TextIO | None = None) -> None:
        self.target = target or sys.stderr
        self.filter = _McpStdioErrorFilter(self.target)
        self.read_fd, write_fd = os.pipe()
        self.write_file = os.fdopen(write_fd, "wb", buffering=0)
        self.drain_task: asyncio.Task[None] | None = None

    async def __aenter__(self) -> _McpStdioErrorLog:
        self.drain_task = asyncio.create_task(self.drain())
        return self

    async def __aexit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        traceback: object,
    ) -> None:
        self.close_write_file()
        if self.drain_task is not None:
            await asyncio.gather(self.drain_task, return_exceptions=True)
        else:
            self.close_read_fd()

    def fileno(self) -> int:
        return self.write_file.fileno()

    async def drain(self) -> None:
        try:
            while True:
                chunk = await asyncio.to_thread(os.read, self.read_fd, 4096)
                if not chunk:
                    break
                self.filter.feed(chunk.decode("utf-8", errors="replace"))
        except OSError:
            pass
        finally:
            self.filter.finish()
            self.close_read_fd()

    def close_write_file(self) -> None:
        with suppress(OSError, ValueError):
            self.write_file.close()

    def close_read_fd(self) -> None:
        with suppress(OSError):
            os.close(self.read_fd)


class DefaultMcpTransport:
    def __init__(self) -> None:
        self._connections: dict[str, _McpConnection] = {}

    async def connect(self, server: StoredMcpServer) -> list[dict[str, object]]:
        await self.disconnect(server.id)
        loop = asyncio.get_running_loop()
        connection = _McpConnection(
            close_event=asyncio.Event(),
            ready=loop.create_future(),
        )
        connection.owner_task = asyncio.create_task(
            self._run_connection(server, connection)
        )
        self._connections[server.id] = connection
        try:
            return await asyncio.shield(connection.ready)
        except asyncio.CancelledError:
            await self._close_connection(
                server.id,
                connection,
                cancel_owner=True,
                suppress_errors=True,
            )
            raise
        except Exception:
            await self._close_connection(
                server.id,
                connection,
                cancel_owner=False,
                suppress_errors=True,
            )
            raise

    async def _run_connection(
        self,
        server: StoredMcpServer,
        connection: _McpConnection,
    ) -> None:
        from mcp import ClientSession
        from mcp.client.stdio import stdio_client

        stack = AsyncExitStack()
        try:
            async with stack:
                config = expand_mcp_config(server.config)
                if server.type == "url":
                    http_module = import_module("mcp.client.streamable_http")
                    http_headers = self._streamable_http_headers(config) or None
                    if hasattr(http_module, "streamablehttp_client"):
                        read_stream, write_stream, _ = await stack.enter_async_context(
                            http_module.streamablehttp_client(
                                server.url or str(config.get("url") or ""),
                                headers=http_headers,
                            )
                        )
                    else:
                        import httpx

                        http_client = await stack.enter_async_context(
                            httpx.AsyncClient(headers=http_headers)
                        )
                        read_stream, write_stream, _ = await stack.enter_async_context(
                            http_module.streamable_http_client(
                                server.url or str(config.get("url") or ""),
                                http_client=http_client,
                            )
                        )
                else:
                    stdio_errlog = await stack.enter_async_context(_McpStdioErrorLog())
                    read_stream, write_stream = await stack.enter_async_context(
                        stdio_client(
                            self._stdio_parameters(server, config),
                            errlog=cast(TextIO, stdio_errlog),
                        )
                    )
                session = await stack.enter_async_context(
                    ClientSession(read_stream, write_stream)
                )
                await session.initialize()
                result = await session.list_tools()
                connection.session = session
                if not connection.ready.done():
                    connection.ready.set_result(
                        [self._model_dump(tool) for tool in result.tools]
                    )
                await connection.close_event.wait()
        except asyncio.CancelledError:
            if not connection.ready.done():
                connection.ready.cancel()
            raise
        except Exception as error:
            if not connection.ready.done():
                connection.ready.set_exception(error)
            raise
        finally:
            connection.session = None

    async def _close_connection(
        self,
        server_id: str,
        connection: _McpConnection,
        *,
        cancel_owner: bool,
        suppress_errors: bool = False,
    ) -> None:
        if self._connections.get(server_id) is connection:
            self._connections.pop(server_id, None)
        connection.session = None
        owner_task = connection.owner_task
        if owner_task is None:
            return
        if not owner_task.done():
            if cancel_owner:
                owner_task.cancel()
            else:
                connection.close_event.set()
        try:
            await asyncio.shield(owner_task)
        except asyncio.CancelledError:
            if cancel_owner or suppress_errors:
                return
            raise
        except Exception:
            if not suppress_errors:
                raise

    def _streamable_http_headers(self, config: dict[str, object]) -> dict[str, str]:
        headers: dict[str, str] = {}
        for key in ("http_headers", "headers"):
            raw_headers = config.get(key)
            if isinstance(raw_headers, dict):
                headers.update(
                    {
                        str(header_name): str(header_value)
                        for header_name, header_value in raw_headers.items()
                    }
                )
                break

        raw_env_headers = config.get("env_http_headers") or config.get("envHeaders")
        if isinstance(raw_env_headers, dict):
            for header_name, env_name in raw_env_headers.items():
                if isinstance(env_name, str):
                    env_value = os.environ.get(env_name)
                    if env_value is not None:
                        headers[str(header_name)] = env_value

        bearer_token_env_var = config.get("bearer_token_env_var") or config.get(
            "bearerTokenEnvVar"
        )
        if isinstance(bearer_token_env_var, str):
            env_bearer_token = os.environ.get(bearer_token_env_var)
            if env_bearer_token and "Authorization" not in headers:
                headers["Authorization"] = f"Bearer {env_bearer_token}"

        bearer_token: object = config.get("bearer_token") or config.get("bearerToken")
        if (
            isinstance(bearer_token, str)
            and bearer_token
            and "Authorization" not in headers
        ):
            headers["Authorization"] = f"Bearer {bearer_token}"
        return headers

    def _stdio_parameters(
        self,
        server: StoredMcpServer,
        config: dict[str, object],
    ) -> Any:
        from mcp import StdioServerParameters

        env: dict[str, str] = {}
        raw_env = config.get("env")
        if isinstance(raw_env, dict):
            for key, value in raw_env.items():
                if isinstance(key, str) and isinstance(value, str):
                    env[key] = value
        raw_env_vars = config.get("env_vars")
        if isinstance(raw_env_vars, list):
            for key in raw_env_vars:
                if isinstance(key, str) and key not in env:
                    value = os.environ.get(key)
                    if value is not None:
                        env[key] = value
        cwd = config.get("cwd")
        raw_args = config.get("args")
        config_args = raw_args if isinstance(raw_args, list) else []
        return StdioServerParameters(
            command=server.command or str(config.get("command") or ""),
            args=server.args
            or [str(argument) for argument in config_args if isinstance(argument, str)],
            cwd=cwd if isinstance(cwd, str) else None,
            env=env or None,
        )

    async def disconnect(self, server_id: str) -> None:
        connection = self._connections.pop(server_id, None)
        if connection is not None:
            await self._close_connection(
                server_id,
                connection,
                cancel_owner=not connection.ready.done(),
            )

    async def call_tool(
        self,
        server_id: str,
        tool_name: str,
        arguments: dict[str, object],
    ) -> dict[str, object]:
        connection = self._connections.get(server_id)
        session = connection.session if connection is not None else None
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
        self._connect_tasks: dict[str, asyncio.Task[None]] = {}

    async def start_enabled(self) -> None:
        for server in self.store.read_mcp_servers():
            if server.enabled:
                self.schedule_connect_server(server)
            else:
                await self.disconnect_server(server.id)

    async def stop_all(self) -> None:
        tasks = list(self._connect_tasks.values())
        self._connect_tasks.clear()
        for task in tasks:
            task.cancel()
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)
        for server_id in list(self._status_by_server):
            await self.transport.disconnect(server_id)
        self._status_by_server.clear()
        self._error_by_server.clear()
        self._tools_by_server.clear()
        self._server_names.clear()

    async def sync_server(self, server: StoredMcpServer) -> StoredMcpServer:
        await self.cancel_connect_server(server.id)
        if not server.enabled:
            await self.disconnect_server(server.id)
            return self.server_with_status(server)
        self.schedule_connect_server(server)
        return self.server_with_status(server)

    def schedule_connect_server(self, server: StoredMcpServer) -> None:
        task = self._connect_tasks.pop(server.id, None)
        if task is not None and not task.done():
            task.cancel()
        self._server_names[server.id] = server.name
        self._status_by_server[server.id] = "starting"
        self._error_by_server[server.id] = ""
        self._tools_by_server[server.id] = []
        connect_task = asyncio.create_task(self.connect_server(server))
        self._connect_tasks[server.id] = connect_task
        connect_task.add_done_callback(self._connect_task_callback(server.id))

    def _connect_task_callback(
        self,
        server_id: str,
    ) -> Callable[[asyncio.Task[None]], None]:
        def finish(completed_task: asyncio.Task[None]) -> None:
            self._finish_connect_task(server_id, completed_task)

        return finish

    def _finish_connect_task(
        self,
        server_id: str,
        task: asyncio.Task[None],
    ) -> None:
        if self._connect_tasks.get(server_id) is task:
            self._connect_tasks.pop(server_id, None)
        if task.cancelled():
            return
        try:
            task.result()
        except Exception:
            logger.exception("MCP server background connect failed")

    async def cancel_connect_server(self, server_id: str) -> None:
        task = self._connect_tasks.pop(server_id, None)
        if task is None or task.done():
            return
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)

    async def reconnect_server(self, server_id: str) -> StoredMcpServer:
        server = self.find_server(server_id)
        await self.cancel_connect_server(server_id)
        await self.transport.disconnect(server_id)
        if server.enabled:
            await self.connect_server(server)
        else:
            await self.disconnect_server(server_id)
        return self.server_with_status(server)

    async def delete_server(self, server_id: str) -> None:
        await self.cancel_connect_server(server_id)
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
        self._tools_by_server[server.id] = []
        try:
            raw_tools = await asyncio.wait_for(
                self.transport.connect(server),
                timeout=MCP_CONNECT_TIMEOUT_SECONDS,
            )
        except TimeoutError:
            self._status_by_server[server.id] = "error"
            self._error_by_server[server.id] = "Connection timed out."
            self._tools_by_server[server.id] = []
            return
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
            result={
                "type": "mcp",
                "output": content,
                "server": server_name,
                "tool": tool_name,
                "raw_result": result,
            },
            ok=not mcp_result_is_error(result),
            title=f"Calling {server_name}.{tool_name}",
        )
