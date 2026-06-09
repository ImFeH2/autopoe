import asyncio
import os
import sys
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from types import SimpleNamespace
from typing import Any

import pytest

from flowent.mcp import DefaultMcpTransport, McpManager
from flowent.storage import StateStore, StoredMcpServer


@dataclass(frozen=True)
class FakeStream:
    server_id: str


@dataclass
class FakeMcpProbe:
    block_initialize: set[str] = field(default_factory=set)
    entered_events: dict[str, asyncio.Event] = field(default_factory=dict)
    entered_tasks: dict[str, asyncio.Task[Any] | None] = field(default_factory=dict)
    exited_events: dict[str, asyncio.Event] = field(default_factory=dict)
    exited_tasks: dict[str, asyncio.Task[Any] | None] = field(default_factory=dict)
    initialize_can_finish: dict[str, asyncio.Event] = field(default_factory=dict)
    initialize_started: dict[str, asyncio.Event] = field(default_factory=dict)
    list_tools_errors: dict[str, str] = field(default_factory=dict)
    stderr_by_server: dict[str, str] = field(default_factory=dict)

    def event_for(
        self, events: dict[str, asyncio.Event], server_id: str
    ) -> asyncio.Event:
        event = events.get(server_id)
        if event is None:
            event = asyncio.Event()
            events[server_id] = event
        return event


def mcp_server(server_id: str) -> StoredMcpServer:
    return StoredMcpServer(
        args=[],
        command=server_id,
        id=server_id,
        name=server_id,
        type="command",
    )


def install_fake_mcp(monkeypatch: pytest.MonkeyPatch) -> FakeMcpProbe:
    import mcp
    import mcp.client.stdio

    probe = FakeMcpProbe()

    @asynccontextmanager
    async def stdio_client(
        parameters: Any,
        *,
        errlog: Any = None,
    ) -> AsyncIterator[tuple[FakeStream, FakeStream]]:
        server_id = parameters.command
        entered_task = asyncio.current_task()
        probe.entered_tasks[server_id] = entered_task
        probe.event_for(probe.entered_events, server_id).set()
        try:
            yield FakeStream(server_id), FakeStream(server_id)
        finally:
            stderr = probe.stderr_by_server.get(server_id)
            stderr_target = errlog if errlog is not None else sys.stderr
            if stderr is not None:
                try:
                    os.write(stderr_target.fileno(), stderr.encode())
                except (AttributeError, OSError, ValueError):
                    stderr_target.write(stderr)
                    stderr_target.flush()
            exited_task = asyncio.current_task()
            probe.exited_tasks[server_id] = exited_task
            probe.event_for(probe.exited_events, server_id).set()
            if exited_task is not entered_task:
                raise RuntimeError(
                    "Attempted to exit cancel scope in a different task than it was "
                    "entered in"
                )

    class FakeClientSession:
        def __init__(self, read_stream: FakeStream, write_stream: FakeStream) -> None:
            self.server_id = read_stream.server_id

        async def __aenter__(self) -> "FakeClientSession":
            return self

        async def __aexit__(
            self,
            exc_type: type[BaseException] | None,
            exc: BaseException | None,
            traceback: object,
        ) -> None:
            return None

        async def initialize(self) -> None:
            probe.event_for(probe.initialize_started, self.server_id).set()
            if self.server_id in probe.block_initialize:
                await probe.event_for(
                    probe.initialize_can_finish, self.server_id
                ).wait()

        async def list_tools(self) -> object:
            error = probe.list_tools_errors.get(self.server_id)
            if error is not None:
                raise RuntimeError(error)
            return SimpleNamespace(
                tools=[
                    {
                        "inputSchema": {"type": "object"},
                        "name": "read_file",
                    }
                ]
            )

        async def call_tool(
            self, tool_name: str, arguments: dict[str, object]
        ) -> dict[str, object]:
            return {"content": [{"text": "Done."}], "isError": False}

    monkeypatch.setattr(mcp, "ClientSession", FakeClientSession)
    monkeypatch.setattr(mcp.client.stdio, "stdio_client", stdio_client)
    return probe


@pytest.mark.anyio
async def test_stdio_connection_disconnect_closes_transport_in_owner_task(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    probe = install_fake_mcp(monkeypatch)
    transport = DefaultMcpTransport()
    server = mcp_server("mcp-files")

    tools = await asyncio.wait_for(
        asyncio.create_task(transport.connect(server)), timeout=2
    )
    await transport.disconnect(server.id)

    assert tools[0]["name"] == "read_file"
    assert probe.exited_tasks[server.id] is probe.entered_tasks[server.id]


@pytest.mark.anyio
async def test_stdio_connection_shutdown_suppresses_keyboard_interrupt_traceback(
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    probe = install_fake_mcp(monkeypatch)
    probe.stderr_by_server["mcp-files"] = (
        "Traceback (most recent call last):\n"
        '  File "/server.py", line 12, in <module>\n'
        "    run()\n"
        "KeyboardInterrupt\n"
    )
    transport = DefaultMcpTransport()
    server = mcp_server("mcp-files")

    await asyncio.wait_for(asyncio.create_task(transport.connect(server)), timeout=2)
    await transport.disconnect(server.id)

    assert "KeyboardInterrupt" not in capsys.readouterr().err


@pytest.mark.anyio
async def test_stdio_connection_shutdown_keeps_unexpected_stderr_traceback(
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    probe = install_fake_mcp(monkeypatch)
    probe.stderr_by_server["mcp-files"] = (
        "Traceback (most recent call last):\n"
        '  File "/server.py", line 12, in <module>\n'
        "    run()\n"
        "RuntimeError: Shutdown failed\n"
    )
    transport = DefaultMcpTransport()
    server = mcp_server("mcp-files")

    await asyncio.wait_for(asyncio.create_task(transport.connect(server)), timeout=2)
    await transport.disconnect(server.id)

    stderr = capsys.readouterr().err
    assert "Traceback (most recent call last)" in stderr
    assert "RuntimeError: Shutdown failed" in stderr


@pytest.mark.anyio
async def test_stdio_connection_cancel_during_initialization_closes_transport(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    probe = install_fake_mcp(monkeypatch)
    probe.block_initialize.add("mcp-slow")
    transport = DefaultMcpTransport()
    server = mcp_server("mcp-slow")

    connect_task = asyncio.create_task(transport.connect(server))
    await asyncio.wait_for(
        probe.event_for(probe.initialize_started, server.id).wait(), timeout=2
    )
    connect_task.cancel()

    with pytest.raises(asyncio.CancelledError):
        await asyncio.wait_for(connect_task, timeout=2)

    assert probe.exited_tasks[server.id] is probe.entered_tasks[server.id]


@pytest.mark.anyio
async def test_multiple_stdio_connections_disconnect_cleanly(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    probe = install_fake_mcp(monkeypatch)
    transport = DefaultMcpTransport()
    servers = [mcp_server("mcp-files"), mcp_server("mcp-docs")]

    await asyncio.wait_for(
        asyncio.gather(
            *(asyncio.create_task(transport.connect(server)) for server in servers)
        ),
        timeout=2,
    )
    await asyncio.wait_for(
        asyncio.gather(*(transport.disconnect(server.id) for server in servers)),
        timeout=2,
    )

    assert {
        server.id: probe.exited_tasks[server.id] is probe.entered_tasks[server.id]
        for server in servers
    } == {"mcp-files": True, "mcp-docs": True}


@pytest.mark.anyio
async def test_stdio_connection_failure_closes_transport_without_task_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    probe = install_fake_mcp(monkeypatch)
    probe.list_tools_errors["mcp-broken"] = "List failed"
    transport = DefaultMcpTransport()
    server = mcp_server("mcp-broken")
    loop = asyncio.get_running_loop()
    unhandled_contexts: list[dict[str, object]] = []
    previous_exception_handler = loop.get_exception_handler()
    loop.set_exception_handler(
        lambda _, context: unhandled_contexts.append(dict(context))
    )

    try:
        with pytest.raises(RuntimeError, match="List failed"):
            await asyncio.wait_for(
                asyncio.create_task(transport.connect(server)), timeout=2
            )
        await asyncio.sleep(0)
    finally:
        loop.set_exception_handler(previous_exception_handler)

    assert probe.exited_tasks[server.id] is probe.entered_tasks[server.id]
    assert unhandled_contexts == []
    with pytest.raises(RuntimeError, match="Server is not connected"):
        await transport.call_tool(server.id, "read_file", {})


@pytest.mark.anyio
async def test_mcp_manager_shutdown_disconnects_ready_stdio_connection(
    tmp_path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    probe = install_fake_mcp(monkeypatch)
    store = StateStore(tmp_path)
    server = store.save_mcp_server(mcp_server("mcp-files"))
    transport = DefaultMcpTransport()
    manager = McpManager(store=store, transport=transport)

    manager.schedule_connect_server(server)
    await asyncio.wait_for(
        probe.event_for(probe.initialize_started, server.id).wait(), timeout=2
    )
    for _ in range(20):
        if manager.server_with_status(server).status == "ready":
            break
        await asyncio.sleep(0.01)

    await asyncio.wait_for(manager.stop_all(), timeout=2)

    assert probe.exited_tasks[server.id] is probe.entered_tasks[server.id]
    with pytest.raises(RuntimeError, match="Server is not connected"):
        await transport.call_tool(server.id, "read_file", {})


@pytest.mark.anyio
async def test_mcp_manager_shutdown_cancels_initializing_stdio_connection(
    tmp_path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    probe = install_fake_mcp(monkeypatch)
    probe.block_initialize.add("mcp-slow")
    store = StateStore(tmp_path)
    server = store.save_mcp_server(mcp_server("mcp-slow"))
    transport = DefaultMcpTransport()
    manager = McpManager(store=store, transport=transport)

    manager.schedule_connect_server(server)
    await asyncio.wait_for(
        probe.event_for(probe.initialize_started, server.id).wait(), timeout=2
    )

    await asyncio.wait_for(manager.stop_all(), timeout=2)

    assert probe.exited_tasks[server.id] is probe.entered_tasks[server.id]
    with pytest.raises(RuntimeError, match="Server is not connected"):
        await transport.call_tool(server.id, "read_file", {})
