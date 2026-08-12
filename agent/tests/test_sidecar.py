from __future__ import annotations

import json
import os
import subprocess
import sys
import time
from pathlib import Path

import psutil
import pytest


def start_sidecar(
    cwd: Path | None = None,
    environment: dict[str, str] | None = None,
) -> subprocess.Popen[str]:
    return subprocess.Popen(
        [sys.executable, "-m", "flowent"],
        cwd=cwd,
        env=environment,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )


def close_process(process: subprocess.Popen[str]) -> None:
    if process.poll() is None:
        process.kill()
        process.wait()
    for stream in (process.stdin, process.stdout, process.stderr):
        if stream is not None and not stream.closed:
            stream.close()


def request(
    process: subprocess.Popen[str],
    request_id: int,
    method: str,
    params: object,
) -> object:
    assert process.stdin is not None
    assert process.stdout is not None
    process.stdin.write(
        json.dumps({"id": request_id, "method": method, "params": params}) + "\n"
    )
    process.stdin.flush()
    response = json.loads(process.stdout.readline())
    assert response["id"] == request_id
    assert "error" not in response
    return response["result"]


def test_sidecar_runs_until_stdin_closes() -> None:
    process = start_sidecar()

    try:
        with pytest.raises(subprocess.TimeoutExpired):
            process.wait(timeout=0.1)

        assert process.stdin is not None
        process.stdin.close()
        assert process.wait(timeout=10) == 0
    finally:
        close_process(process)


def test_sidecar_shutdown_request_stops_the_process() -> None:
    process = start_sidecar()

    try:
        assert request(process, 1, "system.shutdown", {}) == {"stopped": True}
        assert process.wait(timeout=10) == 0
    finally:
        close_process(process)


def test_hard_killed_sidecar_cleans_active_exec(tmp_path: Path) -> None:
    work = tmp_path / "artifacts" / "desktop" / "e2e-agent-work"
    work.mkdir(parents=True)
    support = tmp_path / "test-support"
    support.mkdir()
    (support / "sitecustomize.py").write_text(
        "import sys\n"
        "import flowent.model_runner as model_runner\n"
        "class LongExecRunner:\n"
        "    def run(self, activation, context):\n"
        "        for item in activation.items:\n"
        "            context.discussion('read', discussion_id=item.discussion_id, "
        "message_ids=list(item.message_ids))\n"
        "        context.exec([sys.executable, '-c', \"import os,pathlib,time; "
        "pathlib.Path('long.pid').write_text(str(os.getpid())); time.sleep(60)\"], "
        "'artifacts/desktop/e2e-agent-work', 60)\n"
        "model_runner.create_runner = lambda directory: LongExecRunner()\n"
    )
    environment = os.environ.copy()
    python_path = environment.get("PYTHONPATH")
    environment["PYTHONPATH"] = (
        str(support) if not python_path else f"{support}{os.pathsep}{python_path}"
    )
    process = start_sidecar(tmp_path, environment)

    try:
        request(process, 1, "organization.create_agent", {"name": "Ada"})
        request(
            process,
            2,
            "discussion.create",
            {"topic": "Kill test", "creator_id": 1, "member_ids": [2]},
        )
        request(
            process,
            3,
            "discussion.send",
            {
                "discussion_id": 1,
                "sender_id": 1,
                "body": "Run until the Sidecar is killed",
                "mention_ids": [2],
            },
        )
        pid_path = work / "long.pid"
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline and not pid_path.exists():
            time.sleep(0.02)
        assert pid_path.exists()
        command_pid = int(pid_path.read_text())

        process.kill()
        process.wait(timeout=5)
        cleanup_deadline = time.monotonic() + 10
        while cleanup_deadline > time.monotonic() and psutil.pid_exists(command_pid):
            time.sleep(0.05)

        assert not psutil.pid_exists(command_pid)
    finally:
        close_process(process)
