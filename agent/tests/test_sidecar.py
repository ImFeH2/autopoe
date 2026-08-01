from __future__ import annotations

import json
import subprocess
import sys
from importlib.metadata import version


def test_sidecar_lifecycle() -> None:
    requests = [
        {
            "id": "info",
            "method": "app/info",
        },
        {
            "id": "unknown",
            "method": "unknown",
        },
        {
            "id": "shutdown",
            "method": "runtime/shutdown",
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
            "method": "runtime/ready",
            "params": {"capabilities": ["app/info", "runtime/shutdown"]},
        },
        {
            "id": "info",
            "result": {"name": "Flowent", "version": version("flowent")},
        },
        {
            "id": "unknown",
            "error": {"message": "unknown method: unknown"},
        },
        {
            "id": "shutdown",
            "result": {"stopping": True},
        },
    ]
