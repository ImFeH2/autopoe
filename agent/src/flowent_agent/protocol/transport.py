import asyncio
import sys

from flowent_agent.protocol.models import Envelope


class JsonlTransport:
    def __init__(self) -> None:
        self._write_lock = asyncio.Lock()

    async def receive(self) -> Envelope | None:
        line = await asyncio.to_thread(sys.stdin.buffer.readline)
        if line == b"":
            return None
        return Envelope.model_validate_json(line)

    async def send(self, envelope: Envelope) -> None:
        data = envelope.model_dump_json(exclude_none=True).encode("utf-8") + b"\n"
        async with self._write_lock:
            await asyncio.to_thread(self._write, data)

    @staticmethod
    def _write(data: bytes) -> None:
        sys.stdout.buffer.write(data)
        sys.stdout.buffer.flush()
