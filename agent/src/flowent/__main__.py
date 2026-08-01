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
            "protocol_version": 1,
            "kind": "event",
            "name": "runtime.ready",
            "payload": {"capabilities": ["app.info"]},
        }
    )
    for line in sys.stdin:
        try:
            message = json.loads(line)
        except json.JSONDecodeError:
            continue
        if not isinstance(message, dict):
            continue
        if message.get("kind") != "request":
            continue
        if message.get("name") == "app.info":
            send(
                {
                    "protocol_version": 1,
                    "kind": "response",
                    "name": "app.info",
                    "reply_to": message.get("id"),
                    "payload": {"name": APP_NAME, "version": APP_VERSION},
                }
            )
            continue
        if message.get("name") == "runtime.shutdown":
            send(
                {
                    "protocol_version": 1,
                    "kind": "response",
                    "name": "runtime.shutdown",
                    "reply_to": message.get("id"),
                    "payload": {"stopping": True},
                }
            )
            return


if __name__ == "__main__":
    main()
