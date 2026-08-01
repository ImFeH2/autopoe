from __future__ import annotations

import json
import subprocess
import sys
from importlib.metadata import version


def test_sidecar_lifecycle() -> None:
    requests = [
        {
            "id": "info",
            "type": "app.info",
        },
        {
            "id": "shutdown",
            "type": "runtime.shutdown",
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
            "type": "runtime.ready",
            "data": {"capabilities": ["app.info"]},
        },
        {
            "id": "info",
            "type": "app.info",
            "data": {"name": "Flowent", "version": version("flowent")},
        },
        {
            "id": "shutdown",
            "type": "runtime.shutdown",
            "data": {"stopping": True},
        },
    ]
