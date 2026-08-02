from __future__ import annotations

import asyncio
import json
import os
import sys
from pathlib import Path
from typing import Any

from flowent.runtime import AgentRuntime

RUNTIME_READY = "runtime/ready"
RUNTIME_SHUTDOWN = "runtime/shutdown"


def send(message: dict[str, Any]) -> None:
    sys.stdout.write(f"{json.dumps(message, separators=(',', ':'))}\n")
    sys.stdout.flush()


def respond(request_id: str, result: Any) -> None:
    send({"id": request_id, "result": result})


def reject(request_id: str, message: str) -> None:
    send({"id": request_id, "error": {"message": message}})


async def serve() -> None:
    data_dir = os.environ.get("FLOWENT_DATA_DIR")
    if not data_dir:
        raise RuntimeError("FLOWENT_DATA_DIR is required")

    runtime = AgentRuntime(
        Path(data_dir),
        send,
        os.environ.get("FLOWENT_MODEL"),
    )
    send(
        {
            "method": RUNTIME_READY,
            "params": {
                "agent": runtime.agent_info(),
                "capabilities": ["state/get", "chat/send", RUNTIME_SHUTDOWN],
            },
        }
    )
    while line := await asyncio.to_thread(sys.stdin.readline):
        try:
            message = json.loads(line)
        except json.JSONDecodeError:
            continue
        if not isinstance(message, dict):
            continue

        request_id = message.get("id")
        method = message.get("method")
        if not isinstance(method, str):
            continue

        if method == "chat/send":
            params = message.get("params")
            content = params.get("content") if isinstance(params, dict) else None
            if isinstance(content, str) and content.strip():
                await runtime.run_turn(content.strip())
            continue
        if not isinstance(request_id, str):
            continue
        if method == "state/get":
            respond(request_id, runtime.state())
            continue
        if method == RUNTIME_SHUTDOWN:
            respond(request_id, {"stopping": True})
            return
        reject(request_id, f"unknown method: {method}")


def main() -> None:
    asyncio.run(serve())


if __name__ == "__main__":
    main()
