from __future__ import annotations

import json
import sys
from importlib.metadata import version
from typing import Any

APP_NAME = "Flowent"
APP_VERSION = version("flowent")


def send(message: dict[str, Any]) -> None:
    sys.stdout.write(f"{json.dumps(message, separators=(',', ':'))}\n")
    sys.stdout.flush()


def main() -> None:
    send(
        {
            "type": "runtime.ready",
            "data": {"capabilities": ["app.info"]},
        }
    )
    for line in sys.stdin:
        try:
            message = json.loads(line)
        except json.JSONDecodeError:
            continue
        if not isinstance(message, dict):
            continue
        if message.get("type") == "app.info":
            send(
                {
                    "id": message.get("id"),
                    "type": "app.info",
                    "data": {"name": APP_NAME, "version": APP_VERSION},
                }
            )
            continue
        if message.get("type") == "runtime.shutdown":
            send(
                {
                    "id": message.get("id"),
                    "type": "runtime.shutdown",
                    "data": {"stopping": True},
                }
            )
            return


if __name__ == "__main__":
    main()
