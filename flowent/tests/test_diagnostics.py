from __future__ import annotations

import json
import os
import stat
import sys
from pathlib import Path

from flowent.diagnostics import (
    configure_diagnostics,
    log_event,
    log_exception,
    register_secret,
    shutdown_diagnostics,
)
from flowent.domain import OrganizationState
from flowent.host_tools import HostTools
from flowent.protocol import Dispatcher
from flowent.runtime import AgentRunContext


def read_records(directory: Path) -> list[dict[str, object]]:
    records: list[dict[str, object]] = []
    for path in sorted((directory / "logs").glob("flowent.jsonl*")):
        records.extend(json.loads(line) for line in path.read_text().splitlines())
    return records


def test_writes_private_redacted_jsonl_logs(tmp_path: Path) -> None:
    secret = "diagnostic-test-secret"
    path = configure_diagnostics(tmp_path)
    assert path is not None
    register_secret(secret)
    log_event(
        "test.event",
        agent_id=2,
        api_key="other-sensitive-value",
        detail=f"Bearer bearer-value and {secret}",
    )
    try:
        raise RuntimeError(secret)
    except RuntimeError as error:
        log_exception("test.failed", error, agent_id=2)
    shutdown_diagnostics()

    content = path.read_text()
    records = [json.loads(line) for line in content.splitlines()]
    assert records[-2] == {
        "timestamp": records[-2]["timestamp"],
        "level": "INFO",
        "event": "test.event",
        "process_id": os.getpid(),
        "thread": "MainThread",
        "agent_id": 2,
        "api_key": "[REDACTED]",
        "detail": "Bearer [REDACTED] and [REDACTED]",
    }
    assert records[-1]["event"] == "test.failed"
    assert records[-1]["error_type"] == "RuntimeError"
    assert secret not in content
    assert "other-sensitive-value" not in content
    if os.name == "posix":
        assert stat.S_IMODE(tmp_path.stat().st_mode) == 0o700
        assert stat.S_IMODE((tmp_path / "logs").stat().st_mode) == 0o700
        assert stat.S_IMODE(path.stat().st_mode) == 0o600


def test_rotates_logs_without_weakening_permissions(tmp_path: Path) -> None:
    configure_diagnostics(tmp_path, max_bytes=300, backup_count=2)
    for index in range(30):
        log_event("test.rotation", index=index, detail="x" * 80)
    shutdown_diagnostics()

    paths = sorted((tmp_path / "logs").glob("flowent.jsonl*"))
    assert len(paths) == 3
    assert all(path.read_text() for path in paths)
    if os.name == "posix":
        assert all(stat.S_IMODE(path.stat().st_mode) == 0o600 for path in paths)


def test_logging_failure_does_not_prevent_startup(
    tmp_path: Path,
    capsys,
) -> None:
    blocked = tmp_path / "blocked"
    blocked.write_text("not a directory")

    assert configure_diagnostics(blocked) is None
    assert "Diagnostic logging unavailable" in capsys.readouterr().err


def test_invalid_protocol_metadata_is_not_logged(tmp_path: Path) -> None:
    secret = "invalid-protocol-secret"
    configure_diagnostics(tmp_path)
    response = Dispatcher(OrganizationState()).dispatch(
        {"id": secret, "method": secret, "params": {}}
    )
    shutdown_diagnostics()

    assert response["error"]["code"] == "invalid_request"
    content = (tmp_path / "logs" / "flowent.jsonl").read_text()
    assert secret not in content
    record = json.loads(content.splitlines()[-1])
    assert record["request_id"] is None
    assert record["method"] == "unknown"


def test_tool_logs_exclude_argv_output_and_message_content(tmp_path: Path) -> None:
    secret = "tool-private-content"
    configure_diagnostics(tmp_path)
    state = OrganizationState(tmp_path)
    state.create_agent("Ada")
    state.create_discussion("Private topic", 1, [2])
    tools = HostTools(tmp_path)
    context = AgentRunContext(2, state, tools, run_id="turn-1")

    try:
        result = context.exec(
            [sys.executable, "-c", f"print('{secret}')"],
            timeout_seconds=5,
        )
        assert result["stdout"].strip() == secret
        state.send_message(1, 1, secret, [2])
        context.discussion("read", discussion_id=1)
    finally:
        tools.close()
        shutdown_diagnostics()

    content = "\n".join(
        path.read_text() for path in sorted((tmp_path / "logs").glob("flowent.jsonl*"))
    )
    records = [json.loads(line) for line in content.splitlines()]
    assert secret not in content
    assert "-c" not in content
    assert any(
        record["event"] == "tool.completed"
        and record["tool_name"] == "exec"
        and record["exit_code"] == 0
        and record["stdout_bytes"] > 0
        for record in records
    )
    assert any(
        record["event"] == "tool.completed"
        and record["tool_name"] == "discussion"
        and record["action"] == "read"
        for record in records
    )
