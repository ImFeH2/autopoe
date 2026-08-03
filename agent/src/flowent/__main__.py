from __future__ import annotations

import asyncio
import json
import os
import sys
from pathlib import Path
from typing import Any

from flowent.project import Project, ProjectStore
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


def state(project: Project | None, runtime: AgentRuntime | None) -> dict[str, Any]:
    runtime_state = (
        runtime.state()
        if runtime
        else {"agent": None, "messages": [], "last_turn": None}
    )
    return {
        "project": project.to_dict() if project else None,
        **runtime_state,
    }


async def serve() -> None:
    data_dir = os.environ.get("FLOWENT_DATA_DIR")
    if not data_dir:
        raise RuntimeError("FLOWENT_DATA_DIR is required")

    root = Path(data_dir)
    store = ProjectStore(root)
    await store.initialize()
    project = await store.current()
    runtime = (
        AgentRuntime(root, project, send, os.environ.get("FLOWENT_MODEL"))
        if project
        else None
    )
    send(
        {
            "method": RUNTIME_READY,
            "params": {
                "project": project.to_dict() if project else None,
                "agent": runtime.agent_info() if runtime else None,
                "capabilities": [
                    "state/get",
                    "project/open",
                    "chat/send",
                    RUNTIME_SHUTDOWN,
                ],
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
            if runtime and isinstance(content, str) and content.strip():
                await runtime.run_turn(content.strip())
            continue
        if not isinstance(request_id, str):
            continue
        if method == "state/get":
            respond(request_id, state(project, runtime))
            continue
        if method == "project/open":
            params = message.get("params")
            workspace = params.get("workspace") if isinstance(params, dict) else None
            if not isinstance(workspace, str) or not workspace.strip():
                reject(request_id, "workspace is required")
                continue
            try:
                project = await store.open(workspace)
            except (OSError, ValueError) as error:
                reject(request_id, str(error))
                continue
            runtime = AgentRuntime(
                root,
                project,
                send,
                os.environ.get("FLOWENT_MODEL"),
            )
            respond(request_id, state(project, runtime))
            continue
        if method == RUNTIME_SHUTDOWN:
            respond(request_id, {"stopping": True})
            return
        reject(request_id, f"unknown method: {method}")


def main() -> None:
    asyncio.run(serve())


if __name__ == "__main__":
    main()
