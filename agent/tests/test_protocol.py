from __future__ import annotations

import asyncio
import io
import json
import os

import pytest

from flowent.protocol import JsonlConnection, ProtocolError


def test_connection_receives_jsonl_messages() -> None:
    async def run() -> None:
        connection = JsonlConnection(
            io.StringIO('invalid\n{"method":"runtime/ready"}\n'),
            io.StringIO(),
        )

        assert await connection.receive() == {"method": "runtime/ready"}
        assert await connection.receive() is None
        with pytest.raises(ProtocolError, match="closed"):
            await connection.request("providers/secret")

    asyncio.run(run())


def test_connection_resolves_desktop_requests() -> None:
    async def run() -> None:
        read_fd, write_fd = os.pipe()
        reader = os.fdopen(read_fd)
        writer = io.StringIO()
        connection = JsonlConnection(reader, writer)
        request = asyncio.create_task(
            connection.request("providers/secret", {"id": "provider-1"})
        )
        while not writer.getvalue():
            await asyncio.sleep(0)
        request_id = json.loads(writer.getvalue())["id"]

        os.write(
            write_fd,
            f'{{"id":"{request_id}","result":"secret"}}\n'.encode(),
        )

        assert await request == "secret"
        os.close(write_fd)
        reader.close()

    asyncio.run(run())


def test_connection_rejects_desktop_errors() -> None:
    async def run() -> None:
        read_fd, write_fd = os.pipe()
        reader = os.fdopen(read_fd)
        writer = io.StringIO()
        connection = JsonlConnection(reader, writer)
        request = asyncio.create_task(
            connection.request("providers/secret", {"id": "provider-1"})
        )
        while not writer.getvalue():
            await asyncio.sleep(0)
        request_id = json.loads(writer.getvalue())["id"]

        os.write(
            write_fd,
            f'{{"id":"{request_id}","error":{{"message":"Unavailable"}}}}\n'.encode(),
        )

        with pytest.raises(ProtocolError, match="Unavailable"):
            await request
        os.close(write_fd)
        reader.close()

    asyncio.run(run())


def test_connection_rejects_invalid_desktop_responses() -> None:
    async def run() -> None:
        read_fd, write_fd = os.pipe()
        reader = os.fdopen(read_fd)
        writer = io.StringIO()
        connection = JsonlConnection(reader, writer)
        request = asyncio.create_task(connection.request("providers/secret"))
        while not writer.getvalue():
            await asyncio.sleep(0)
        request_id = json.loads(writer.getvalue())["id"]

        os.write(write_fd, f'{{"id":"{request_id}"}}\n'.encode())

        with pytest.raises(ProtocolError, match="invalid response"):
            await request
        os.close(write_fd)
        reader.close()

    asyncio.run(run())
