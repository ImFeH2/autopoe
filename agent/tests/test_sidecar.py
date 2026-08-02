from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path


def run_sidecar(
    data_dir: Path,
    messages: list[dict[str, object]],
    model: str | None = None,
) -> list[dict[str, object]]:
    env = {**os.environ, "FLOWENT_DATA_DIR": str(data_dir)}
    if model:
        env["FLOWENT_MODEL"] = model
    result = subprocess.run(
        [sys.executable, "-m", "flowent"],
        input="".join(f"{json.dumps(message)}\n" for message in messages),
        text=True,
        capture_output=True,
        timeout=10,
        check=True,
        env=env,
    )
    return [json.loads(line) for line in result.stdout.splitlines()]


def test_sidecar_streams_agent_turn(tmp_path: Path) -> None:
    messages = run_sidecar(
        tmp_path,
        [
            {"id": "initial", "method": "state/get"},
            {"method": "chat/send", "params": {"content": "Hello"}},
            {"id": "final", "method": "state/get"},
            {"id": "shutdown", "method": "runtime/shutdown"},
        ],
    )

    assert messages[0]["method"] == "runtime/ready"
    assert messages[1]["result"]["agent"]["status"] == "idle"
    assert messages[2]["method"] == "turn/started"

    events = [
        message["params"]["event"]
        for message in messages
        if message.get("method") == "turn/event"
    ]
    assert any(event["kind"] == "tool_call" for event in events)
    assert any(event["kind"] == "tool_result" for event in events)
    assert (
        "".join(event["content"] for event in events if event["kind"] == "text_delta")
        == "Flowent received: Hello"
    )

    completed = next(
        message for message in messages if message.get("method") == "turn/completed"
    )
    assert completed["params"]["message"]["content"] == "Flowent received: Hello"
    assert completed["params"]["agent"]["status"] == "idle"
    assert completed["params"]["turn"]["context"]["messages"]
    assert completed["params"]["turn"]["usage"]["requests"] == 2

    final = next(message for message in messages if message.get("id") == "final")
    assert len(final["result"]["messages"]) == 2
    assert final["result"]["last_turn"]["status"] == "completed"
    assert (tmp_path / "projects/default/agents/leader/home/AGENTS.md").is_file()


def test_sidecar_reports_failed_turn(tmp_path: Path) -> None:
    messages = run_sidecar(
        tmp_path,
        [
            {"method": "chat/send", "params": {"content": "Hello"}},
            {"id": "shutdown", "method": "runtime/shutdown"},
        ],
        model="missing:model",
    )

    failed = next(
        message for message in messages if message.get("method") == "turn/failed"
    )
    assert failed["params"]["agent"]["status"] == "failed"
    assert failed["params"]["message"]["status"] == "failed"
    assert failed["params"]["turn"]["error"]
