from __future__ import annotations

import json
import subprocess
import sys
from importlib.metadata import version


def test_sidecar_lifecycle() -> None:
    requests = [
        {
            "protocol_version": 1,
            "id": "info",
            "kind": "request",
            "name": "app.info",
            "payload": {},
        },
        {
            "protocol_version": 1,
            "id": "shutdown",
            "kind": "request",
            "name": "runtime.shutdown",
            "payload": {},
        },
    ]
    result = subprocess.run(
        [sys.executable, "-m", "flowent"],
        input="".join(f"{json.dumps(request)}\n" for request in requests),
        text=True,
        capture_output=True,
        timeout=5,
        check=True,
    )
    messages = [json.loads(line) for line in result.stdout.splitlines()]

    assert messages == [
        {
            "protocol_version": 1,
            "kind": "event",
            "name": "runtime.ready",
            "payload": {"capabilities": ["app.info"]},
        },
        {
            "protocol_version": 1,
            "kind": "response",
            "name": "app.info",
            "reply_to": "info",
            "payload": {"name": "Flowent", "version": version("flowent")},
        },
        {
            "protocol_version": 1,
            "kind": "response",
            "name": "runtime.shutdown",
            "reply_to": "shutdown",
            "payload": {"stopping": True},
        },
    ]
