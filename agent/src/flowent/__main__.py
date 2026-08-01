from __future__ import annotations

import json
import sys
from importlib.metadata import version
from typing import Any

APP_NAME = "Flowent"
APP_VERSION = version("flowent")
APP_INFO = "app/info"
RUNTIME_READY = "runtime/ready"
RUNTIME_SHUTDOWN = "runtime/shutdown"


def send(message: dict[str, Any]) -> None:
    sys.stdout.write(f"{json.dumps(message, separators=(',', ':'))}\n")
    sys.stdout.flush()


def respond(request_id: str, result: dict[str, Any]) -> None:
    send({"id": request_id, "result": result})


def reject(request_id: str, message: str) -> None:
    send({"id": request_id, "error": {"message": message}})


def main() -> None:
    send(
        {
            "method": RUNTIME_READY,
            "params": {"capabilities": [APP_INFO, RUNTIME_SHUTDOWN]},
        }
    )
    for line in sys.stdin:
        try:
            message = json.loads(line)
        except json.JSONDecodeError:
            continue
        if not isinstance(message, dict):
            continue

        request_id = message.get("id")
        method = message.get("method")
        if not isinstance(request_id, str) or not isinstance(method, str):
            continue

        if method == APP_INFO:
            respond(request_id, {"name": APP_NAME, "version": APP_VERSION})
            continue
        if method == RUNTIME_SHUTDOWN:
            respond(request_id, {"stopping": True})
            return
        reject(request_id, f"unknown method: {method}")


if __name__ == "__main__":
    main()
