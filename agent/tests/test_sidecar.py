from __future__ import annotations

import json
import subprocess
import sys


def test_sidecar_lifecycle() -> None:
    request = {
        "protocol_version": 1,
        "id": "shutdown",
        "kind": "request",
        "name": "runtime.shutdown",
        "payload": {},
    }
    result = subprocess.run(
        [sys.executable, "-m", "flowent"],
        input=f"{json.dumps(request)}\n",
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
            "payload": {"capabilities": []},
        },
        {
            "protocol_version": 1,
            "kind": "response",
            "name": "runtime.shutdown",
            "reply_to": "shutdown",
            "payload": {"stopping": True},
        },
    ]
