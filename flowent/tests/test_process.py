from __future__ import annotations

import json
import os
import subprocess
import sys
import time
from pathlib import Path

import psutil
import pytest


def start_flowent(
    data_directory: Path,
    cwd: Path | None = None,
    environment: dict[str, str] | None = None,
) -> subprocess.Popen[str]:
    isolated_environment = (os.environ if environment is None else environment).copy()
    isolated_environment["FLOWENT_DATA_DIR"] = str(data_directory)
    return subprocess.Popen(
        [sys.executable, "-m", "flowent"],
        cwd=cwd,
        env=isolated_environment,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        encoding="utf-8",
        errors="strict",
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
    while True:
        response = json.loads(process.stdout.readline())
        if response.get("event") is not None:
            continue
        assert response["id"] == request_id
        assert "error" not in response
        return response["result"]


def test_flowent_runs_until_stdin_closes(tmp_path: Path) -> None:
    process = start_flowent(tmp_path / "data")

    try:
        with pytest.raises(subprocess.TimeoutExpired):
            process.wait(timeout=0.1)

        assert process.stdin is not None
        process.stdin.close()
        assert process.wait(timeout=10) == 0
    finally:
        close_process(process)


def test_flowent_shutdown_request_stops_the_process(tmp_path: Path) -> None:
    process = start_flowent(tmp_path / "data")

    try:
        assert request(process, 1, "system.shutdown", {}) == {"stopped": True}
        assert process.wait(timeout=10) == 0
    finally:
        close_process(process)


def test_flowent_accepts_utf8_jsonl_messages(tmp_path: Path) -> None:
    process = start_flowent(tmp_path / "data")

    try:
        request(process, 1, "organization.create_agent", {"name": "Ada"})
        request(
            process,
            2,
            "discussion.create",
            {"topic": "Work", "creator_id": 1, "member_ids": [2]},
        )
        snapshot = request(
            process,
            3,
            "discussion.send",
            {
                "discussion_id": 1,
                "sender_id": 1,
                "body": "你在哪个目录下？",
            },
        )

        message = snapshot["discussions"][0]["messages"][0]
        assert message["body"] == "你在哪个目录下？"
        assert request(process, 4, "system.shutdown", {}) == {"stopped": True}
        assert process.wait(timeout=10) == 0
    finally:
        close_process(process)


def test_flowent_does_not_load_model_settings_from_dotenv(tmp_path: Path) -> None:
    working_directory = tmp_path / "project"
    working_directory.mkdir()
    (working_directory / ".env").write_text(
        "api_type=openai-responses\n"
        "base_url=https://example.invalid/v1\n"
        "api_key=ignored-secret\n"
        "model=ignored-model\n"
    )
    process = start_flowent(tmp_path / "data", working_directory)

    try:
        assert request(process, 1, "settings.get_model", {}) == {
            "api_type": "openai-chat",
            "base_url": "",
            "model": "",
            "has_api_key": False,
        }
        assert request(process, 2, "settings.get_observability", {}) == {
            "enabled": False,
            "base_url": "",
            "public_key": "",
            "environment": "development",
            "capture_content": False,
            "has_secret_key": False,
        }
        assert request(process, 3, "system.shutdown", {}) == {"stopped": True}
        assert process.wait(timeout=10) == 0
    finally:
        close_process(process)


def test_persists_state_and_model_settings_across_launch_directories(
    tmp_path: Path,
) -> None:
    first_directory = tmp_path / "first"
    second_directory = tmp_path / "second"
    first_directory.mkdir()
    second_directory.mkdir()
    data = tmp_path / "data"
    first = start_flowent(data, first_directory)

    try:
        request(first, 1, "organization.create_agent", {"name": "Ada"})
        request(
            first,
            2,
            "discussion.create",
            {"topic": "Persistent work", "creator_id": 1, "member_ids": [2]},
        )
        request(
            first,
            3,
            "discussion.send",
            {
                "discussion_id": 1,
                "sender_id": 1,
                "body": "Still here after restart",
            },
        )
        settings = request(
            first,
            4,
            "settings.update_model",
            {
                "api_type": "openai-responses",
                "base_url": "https://example.invalid/v1",
                "api_key": "restart-secret",
                "model": "test-model",
            },
        )
        assert "restart-secret" not in str(settings)
        tracing = request(
            first,
            5,
            "settings.update_observability",
            {
                "enabled": True,
                "base_url": "http://127.0.0.1:9",
                "public_key": "restart-public",
                "secret_key": "restart-trace-secret",
                "environment": "test",
                "capture_content": True,
            },
        )
        assert "restart-trace-secret" not in str(tracing)
        assert request(first, 6, "system.shutdown", {}) == {"stopped": True}
        assert first.wait(timeout=10) == 0
    finally:
        close_process(first)

    second = start_flowent(data, second_directory)
    try:
        snapshot = request(second, 1, "organization.get", {})
        settings = request(second, 2, "settings.get_model", {})
        tracing = request(second, 3, "settings.get_observability", {})
        assert snapshot["working_directory"] == str(second_directory)
        assert snapshot["members"][1]["name"] == "Ada"
        assert snapshot["discussions"][0]["topic"] == "Persistent work"
        assert snapshot["discussions"][0]["messages"][0]["body"] == (
            "Still here after restart"
        )
        assert settings == {
            "api_type": "openai-responses",
            "base_url": "https://example.invalid/v1",
            "model": "test-model",
            "has_api_key": True,
        }
        assert "restart-secret" not in str(settings)
        assert tracing == {
            "enabled": True,
            "base_url": "http://127.0.0.1:9",
            "public_key": "restart-public",
            "environment": "test",
            "capture_content": True,
            "has_secret_key": True,
        }
        assert "restart-trace-secret" not in str(tracing)
        assert request(second, 4, "system.shutdown", {}) == {"stopped": True}
        assert second.wait(timeout=10) == 0
    finally:
        close_process(second)


def test_agent_model_history_continues_across_process_restarts(
    tmp_path: Path,
) -> None:
    support = tmp_path / "history-support"
    support.mkdir()
    (support / "sitecustomize.py").write_text(
        "import flowent.model_runner as model_runner\n"
        "from pydantic_ai.messages import ModelRequest,ModelResponse,TextPart,UserPromptPart\n"
        "from flowent.runtime import AgentRunOutcome\n"
        "class PersistentRunner:\n"
        "    def shutdown(self):\n"
        "        pass\n"
        "    def run(self, activation, context):\n"
        "        previous = len(context.message_history)\n"
        "        conversation_id = (context.message_history[-1].conversation_id "
        "if context.message_history else 'flowent-agent-2')\n"
        "        for item in activation.items:\n"
        "            context.discussion('read', discussion_id=item.discussion_id, "
        "end_message_id=max(item.message_ids))\n"
        "            context.discussion('send', discussion_id=item.discussion_id, "
        "body=f'Inherited {previous} model messages')\n"
        "            context.discussion('ack', discussion_id=item.discussion_id, "
        "message_ids=list(item.message_ids))\n"
        "        return AgentRunOutcome((\n"
        "            ModelRequest(parts=[UserPromptPart(content='Activation')], "
        "run_id=context.run_id, conversation_id=conversation_id),\n"
        "            ModelResponse(parts=[TextPart(content=f'Inherited {previous} model messages')], "
        "model_name='test', run_id=context.run_id, conversation_id=conversation_id),\n"
        "        ))\n"
        "model_runner.create_runner = lambda **kwargs: PersistentRunner()\n"
    )
    environment = os.environ.copy()
    python_path = environment.get("PYTHONPATH")
    environment["PYTHONPATH"] = (
        str(support) if not python_path else f"{support}{os.pathsep}{python_path}"
    )
    data = tmp_path / "data"

    first = start_flowent(data, tmp_path, environment)
    try:
        request(first, 1, "organization.create_agent", {"name": "Ada"})
        request(
            first,
            2,
            "discussion.create",
            {"topic": "Identity", "creator_id": 1, "member_ids": [2]},
        )
        request(
            first,
            3,
            "discussion.send",
            {
                "discussion_id": 1,
                "sender_id": 1,
                "body": "Remember this",
                "mention_ids": [2],
            },
        )
        request_id = 4
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            snapshot = request(first, request_id, "organization.get", {})
            request_id += 1
            if (
                snapshot["members"][1]["status"] == "idle"
                and snapshot["discussions"][0]["messages"][0]["mentions"][0]["status"]
                == "acked"
            ):
                break
            time.sleep(0.02)
        else:
            pytest.fail("First Agent activation did not complete")
        history = request(
            first,
            request_id,
            "agent.history.get",
            {"agent_id": 2},
        )
        request_id += 1
        assert len(history["runs"]) == 1
        assert history["runs"][0]["entries"][-1]["content"] == (
            "Inherited 0 model messages"
        )
        assert request(first, request_id, "system.shutdown", {}) == {"stopped": True}
        assert first.wait(timeout=10) == 0
    finally:
        close_process(first)

    second = start_flowent(data, tmp_path, environment)
    try:
        snapshot = request(
            second,
            1,
            "discussion.send",
            {
                "discussion_id": 1,
                "sender_id": 1,
                "body": "Continue as the same Agent",
                "mention_ids": [2],
            },
        )
        triggering_message_id = snapshot["discussions"][0]["messages"][-1]["id"]
        request_id = 2
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            snapshot = request(second, request_id, "organization.get", {})
            request_id += 1
            trigger = next(
                message
                for message in snapshot["discussions"][0]["messages"]
                if message["id"] == triggering_message_id
            )
            if (
                snapshot["members"][1]["status"] == "idle"
                and trigger["mentions"][0]["status"] == "acked"
            ):
                break
            time.sleep(0.02)
        else:
            pytest.fail("Second Agent activation did not complete")
        history = request(
            second,
            request_id,
            "agent.history.get",
            {"agent_id": 2},
        )
        request_id += 1
        assert len(history["runs"]) == 2
        assert history["runs"][1]["entries"][-1]["content"] == (
            "Inherited 2 model messages"
        )
        assert request(second, request_id, "system.shutdown", {}) == {"stopped": True}
        assert second.wait(timeout=10) == 0
    finally:
        close_process(second)


def test_hard_killed_flowent_cleans_active_exec(tmp_path: Path) -> None:
    work = tmp_path / "artifacts" / "desktop" / "process-work"
    work.mkdir(parents=True)
    support = tmp_path / "test-support"
    support.mkdir()
    (support / "sitecustomize.py").write_text(
        "import sys\n"
        "import flowent.model_runner as model_runner\n"
        "class LongExecRunner:\n"
        "    def shutdown(self):\n"
        "        pass\n"
        "    def run(self, activation, context):\n"
        "        for item in activation.items:\n"
        "            context.discussion('read', discussion_id=item.discussion_id, "
        "end_message_id=max(item.message_ids))\n"
        "        context.exec([sys.executable, '-c', \"import os,pathlib,time; "
        "pathlib.Path('long.pid').write_text(str(os.getpid())); time.sleep(60)\"], "
        "'artifacts/desktop/process-work', 60)\n"
        "model_runner.create_runner = lambda **kwargs: LongExecRunner()\n"
    )
    environment = os.environ.copy()
    python_path = environment.get("PYTHONPATH")
    environment["PYTHONPATH"] = (
        str(support) if not python_path else f"{support}{os.pathsep}{python_path}"
    )
    process = start_flowent(tmp_path / "data", tmp_path, environment)

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
                "body": "Run until Flowent is killed",
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
