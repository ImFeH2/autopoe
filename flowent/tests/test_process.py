from __future__ import annotations

import json
import os
import subprocess
import sys
import time
from pathlib import Path

import psutil
import pytest

from flowent.domain import OrganizationState
from flowent.memory import AgentMemory
from flowent.persistence import SQLiteStore


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


def test_flowent_writes_private_diagnostics_without_request_content(
    tmp_path: Path,
) -> None:
    data = tmp_path / "data"
    process = start_flowent(data)
    api_key = "process-api-key-secret"
    trace_secret = "process-trace-secret"
    message_body = "process-private-message"

    try:
        request(
            process,
            1,
            "settings.update_model",
            {
                "api_type": "openai-chat",
                "base_url": "https://example.invalid/v1",
                "api_key": api_key,
                "model": "test-model",
            },
        )
        request(
            process,
            2,
            "settings.update_observability",
            {
                "enabled": False,
                "base_url": "",
                "public_key": "process-public-key",
                "secret_key": trace_secret,
                "environment": "test",
                "capture_content": False,
            },
        )
        request(process, 3, "organization.create_agent", {"name": "Ada"})
        request(
            process,
            4,
            "discussion.create",
            {"topic": "Diagnostics", "creator_id": 1, "member_ids": [2]},
        )
        request(
            process,
            5,
            "discussion.send",
            {
                "discussion_id": 1,
                "sender_id": 1,
                "body": message_body,
                "mention_ids": [],
            },
        )
        assert request(process, 6, "system.shutdown", {}) == {"stopped": True}
        assert process.wait(timeout=10) == 0
    finally:
        close_process(process)

    log_path = data / "logs" / "flowent.jsonl"
    content = log_path.read_text()
    records = [json.loads(line) for line in content.splitlines()]
    events = {record["event"] for record in records}
    assert {
        "diagnostics.configured",
        "process.started",
        "database.open.completed",
        "scheduler.started",
        "protocol.request.completed",
        "database.model_config.saved",
        "database.observability_config.saved",
        "process.stopped",
    } <= events
    assert api_key not in content
    assert trace_secret not in content
    assert message_body not in content
    if os.name == "posix":
        assert (data / "logs").stat().st_mode & 0o777 == 0o700
        assert log_path.stat().st_mode & 0o777 == 0o600


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


def test_memory_stays_in_data_directory_and_orphans_are_removed_on_startup(
    tmp_path: Path,
) -> None:
    data = tmp_path / "data"
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    store = SQLiteStore(data)
    state = OrganizationState(
        workspace,
        persisted=store.load_organization(),
        on_persist=store.save_organization,
    )
    state.create_agent("Ada")
    memories = AgentMemory(data)
    memories.write(2, "MEMORY.md", "Persistent Agent Memory")
    memories.write(3, "MEMORY.md", "Orphaned Agent Memory")

    process = start_flowent(data, workspace)
    try:
        assert request(process, 1, "system.shutdown", {}) == {"stopped": True}
        assert process.wait(timeout=10) == 0
    finally:
        close_process(process)

    restored = AgentMemory(data)
    assert restored.read(2, "MEMORY.md")["content"] == "Persistent Agent Memory"
    assert restored.list(3) == {"paths": [], "count": 0}
    assert list(workspace.iterdir()) == []


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


def test_persists_state_and_uses_home_across_launch_directories(
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
        assert snapshot["working_directory"] == str(Path.home())
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
        "        todos = context.todo('list')['todos']\n"
        "        if not todos:\n"
        "            todo = context.todo('create', subject='Persistent task')['todo']\n"
        "            todo = context.todo('start', todo_id=todo['id'])['todo']\n"
        "        else:\n"
        "            todo = todos[0]\n"
        '        result = f\'Inherited {previous} model messages; Todo {todo["id"]} {todo["status"]}\'\n'
        "        conversation_id = (context.message_history[-1].conversation_id "
        "if context.message_history else 'flowent-agent-2')\n"
        "        context.discussion('read', discussion_id=activation.mentions[0].discussion_id, "
        "end_message_id=activation.mentions[0].message_id)\n"
        "        context.discussion('send', discussion_id=activation.mentions[0].discussion_id, "
        "body=result)\n"
        "        context.discussion('ack', discussion_id=activation.mentions[0].discussion_id, "
        "message_ids=[activation.mentions[0].message_id])\n"
        "        return AgentRunOutcome((\n"
        "            ModelRequest(parts=[UserPromptPart(content='Reminder')], "
        "run_id=context.run_id, conversation_id=conversation_id),\n"
        "            ModelResponse(parts=[TextPart(content=result)], "
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
            "Inherited 0 model messages; Todo 1 in_progress"
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
            "Inherited 2 model messages; Todo 1 in_progress"
        )
        assert request(second, request_id, "system.shutdown", {}) == {"stopped": True}
        assert second.wait(timeout=10) == 0
    finally:
        close_process(second)


def test_hard_killed_flowent_cleans_active_run(tmp_path: Path) -> None:
    work = tmp_path / "artifacts" / "desktop" / "process-work"
    work.mkdir(parents=True)
    support = tmp_path / "test-support"
    support.mkdir()
    (support / "sitecustomize.py").write_text(
        "import sys\n"
        "import flowent.model_runner as model_runner\n"
        "class LongRunRunner:\n"
        "    def shutdown(self):\n"
        "        pass\n"
        "    def run(self, activation, context):\n"
        "        context.discussion('read', discussion_id=activation.mentions[0].discussion_id, "
        "end_message_id=activation.mentions[0].message_id)\n"
        "        context.run([sys.executable, '-c', \"import os,pathlib,time; "
        "pathlib.Path('long.pid').write_text(str(os.getpid())); time.sleep(60)\"], "
        "'artifacts/desktop/process-work', 60)\n"
        "model_runner.create_runner = lambda **kwargs: LongRunRunner()\n"
    )
    environment = os.environ.copy()
    environment["FLOWENT_WORKING_DIRECTORY"] = str(tmp_path)
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
