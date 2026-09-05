from __future__ import annotations

import json
import subprocess
import sys
from collections.abc import Sequence
from pathlib import Path
from typing import Any

import pytest

TIMEOUT = 90


def drive(
    data_directory: Path,
    requests: Sequence[dict[str, Any]],
    *,
    cwd: Path | None = None,
    shutdown: bool = True,
) -> tuple[list[dict[str, Any]], int, str]:
    lines = list(requests)
    if shutdown:
        lines.append({"id": 9999, "method": "system.shutdown"})
    completed = subprocess.run(
        [sys.executable, "-m", "huddol"],
        input="".join(json.dumps(item) + "\n" for item in lines),
        capture_output=True,
        text=True,
        timeout=TIMEOUT,
        cwd=cwd or Path.cwd(),
        env={
            "HUDDOL_DATA_DIR": str(data_directory),
            "PATH": "/usr/bin:/bin:/usr/local/bin",
            "PYTHONPATH": str(Path(__file__).resolve().parents[1] / "src"),
        },
        check=False,
    )
    frames = [
        json.loads(line) for line in completed.stdout.splitlines() if line.strip()
    ]
    return frames, completed.returncode, completed.stderr


def response(frames: list[dict[str, Any]], request_id: int) -> dict[str, Any]:
    for frame in frames:
        if frame.get("type") == "response" and frame.get("id") == request_id:
            return frame
    raise AssertionError(f"no response for id {request_id}")


def events(frames: list[dict[str, Any]], kind: str) -> list[dict[str, Any]]:
    return [frame for frame in frames if frame.get("type") == kind]


def test_the_process_starts_and_announces_itself(tmp_path: Path) -> None:
    frames, code, stderr = drive(tmp_path / "data", [])
    assert code == 0, stderr
    ready = events(frames, "ready")
    assert len(ready) == 1
    assert ready[0]["human_id"] == 1
    assert ready[0]["model_configured"] is False
    assert len(ready[0]["methods"]) > 20


def test_the_data_directory_variable_is_honoured(tmp_path: Path) -> None:
    target = tmp_path / "somewhere" / "else"
    frames, code, stderr = drive(target, [])
    assert code == 0, stderr
    assert events(frames, "ready")[0]["data_directory"] == str(target)
    assert (target / "huddol.sqlite3").is_file()


def test_the_working_root_is_a_workspace_inside_the_data_directory(
    tmp_path: Path,
) -> None:
    target = tmp_path / "somewhere" / "else"
    frames, code, stderr = drive(target, [], cwd=tmp_path)
    assert code == 0, stderr
    assert events(frames, "ready")[0]["working_directory"] == str(target / "workspace")
    assert (target / "workspace").is_dir()


def test_shutdown_answers_and_exits_cleanly(tmp_path: Path) -> None:
    frames, code, _ = drive(tmp_path / "data", [])
    assert code == 0
    assert response(frames, 9999)["result"] == {"stopped": True}


def test_a_full_conversation_survives_the_real_pipe(tmp_path: Path) -> None:
    frames, code, stderr = drive(
        tmp_path / "data",
        [
            {
                "id": 1,
                "method": "organization.create_agent",
                "params": {"name": "Main"},
            },
            {
                "id": 2,
                "method": "discussion.create",
                "params": {"topic": "ship it", "member_ids": [2]},
            },
            {
                "id": 3,
                "method": "discussion.send",
                "params": {"discussion_id": 1, "body": "@Main please start"},
            },
            {"id": 4, "method": "discussion.list", "params": {}},
            {"id": 5, "method": "discussion.read", "params": {"discussion_id": 1}},
        ],
    )
    assert code == 0, stderr
    assert response(frames, 1)["result"]["name"] == "Main"
    assert response(frames, 2)["result"]["member_ids"] == [1, 2]
    assert response(frames, 3)["result"]["mentioned"] == [2]
    assert response(frames, 4)["result"][0]["topic"] == "ship it"
    assert response(frames, 5)["result"]["messages"][0]["body"] == "@Main please start"


def test_acknowledgement_ownership_survives_the_real_pipe(tmp_path: Path) -> None:
    from huddol.adapters.sqlite.store import SqliteStore

    data = tmp_path / "data"
    data.mkdir()
    store = SqliteStore(data / "huddol.sqlite3")
    try:
        store.create_member("human", "You")
        store.create_member("agent", "Helper")
        store.create_member("human", "Reporter")
        store.set_agent_state(2, "paused")
        store.create_discussion("review", [1, 2, 3])
        store.append_message(1, 3, "@You @Helper please review")
        for member_id in (1, 2):
            store.ack(1, [1], member_id)
    finally:
        store.close()

    requests = [
        ("discussion.read", {"discussion_id": 1}),
        (
            "discussion.revoke_ack",
            {"discussion_id": 1, "message_ids": [1], "member_id": 2},
        ),
        ("discussion.read", {"discussion_id": 1}),
        ("discussion.ack", {"discussion_id": 1, "message_ids": [1]}),
        ("discussion.read", {"discussion_id": 1}),
        ("discussion.set_members", {"discussion_id": 1, "member_ids": [2, 3]}),
        ("discussion.revoke_ack", {"discussion_id": 1, "message_ids": [1]}),
    ]
    frames, code, stderr = drive(
        data,
        [
            {"id": index, "method": method, "params": params}
            for index, (method, params) in enumerate(requests, 1)
        ],
    )
    assert code == 0, stderr
    assert response(frames, 1)["result"]["acknowledged"] == [1]
    assert response(frames, 2)["result"]["revoked"] == 1
    assert response(frames, 3)["result"]["acknowledged"] == []
    assert response(frames, 3)["result"]["awaiting_ack"] == [1]
    assert response(frames, 5)["result"]["acknowledged"] == [1]
    assert response(frames, 7)["error"]["code"] == "not_a_member"
    assert len(events(frames, "mention.revoked")) == 1
    store = SqliteStore(data / "huddol.sqlite3")
    try:
        assert store.acknowledged(1, 2) == (1,)
        assert store.acknowledged(1, 1) == (1,)
    finally:
        store.close()


def test_membership_changes_preserve_history_and_pending(tmp_path: Path) -> None:
    from huddol.adapters.sqlite.store import SqliteStore

    data = tmp_path / "data"
    setup = [
        ("organization.create_agent", {"name": "Helper"}),
        ("organization.pause_agent", {"agent_id": 2}),
        ("discussion.create", {"topic": "review", "member_ids": [2]}),
        ("discussion.send", {"discussion_id": 1, "body": "@Helper review this"}),
    ]
    _, code, stderr = drive(
        data,
        [
            {"id": index, "method": method, "params": params}
            for index, (method, params) in enumerate(setup, 1)
        ],
    )
    assert code == 0, stderr

    for member_ids in ([1], [1, 2], [2]):
        frames, code, stderr = drive(
            data,
            [
                {
                    "id": 1,
                    "method": "discussion.set_members",
                    "params": {"discussion_id": 1, "member_ids": member_ids},
                },
                {"id": 2, "method": "discussion.read", "params": {"discussion_id": 1}},
                {"id": 3, "method": "discussion.list"},
            ],
        )
        assert code == 0, stderr
        assert response(frames, 1)["result"]["member_ids"] == member_ids
        if 1 in member_ids:
            detail = response(frames, 2)["result"]
            assert [member["id"] for member in detail["members"]] == member_ids
            assert detail["messages"][0]["body"] == "@Helper review this"
        else:
            assert response(frames, 2)["error"]["code"] == "not_a_member"
            assert response(frames, 3)["result"] == []
        assert len(events(frames, "discussion.updated")) == 1
        store = SqliteStore(data / "huddol.sqlite3")
        try:
            assert store.message_count(1) == 1
            assert [item.message_id for item in store.pending(2)] == (
                [1] if 2 in member_ids else []
            )
        finally:
            store.close()


def test_state_survives_a_restart(tmp_path: Path) -> None:
    data = tmp_path / "data"
    drive(
        data,
        [
            {
                "id": 1,
                "method": "organization.create_agent",
                "params": {"name": "Main"},
            },
            {
                "id": 2,
                "method": "discussion.create",
                "params": {"topic": "persisted", "member_ids": [2]},
            },
            {
                "id": 3,
                "method": "discussion.send",
                "params": {"discussion_id": 1, "body": "@Main remember this"},
            },
        ],
    )

    frames, code, stderr = drive(
        data, [{"id": 1, "method": "discussion.read", "params": {"discussion_id": 1}}]
    )
    assert code == 0, stderr
    result = response(frames, 1)["result"]
    assert result["topic"] == "persisted"
    assert result["messages"][0]["body"] == "@Main remember this"
    assert result["awaiting_ack"] == []


def test_errors_arrive_as_structured_responses(tmp_path: Path) -> None:
    frames, code, _ = drive(
        tmp_path / "data",
        [
            {"id": 1, "method": "organization.create_agent", "params": {"name": "  "}},
            {"id": 2, "method": "no.such.method", "params": {}},
        ],
    )
    assert code == 0
    assert response(frames, 1)["error"]["code"] == "invalid_name"
    assert response(frames, 2)["error"]["code"] == "unknown_method"


def test_malformed_frames_do_not_kill_the_process(tmp_path: Path) -> None:
    data = tmp_path / "data"
    completed = subprocess.run(
        [sys.executable, "-m", "huddol"],
        input='not json at all\n{"id":1,"method":"organization.get","params":{}}\n'
        '{"method":"system.shutdown"}\n',
        capture_output=True,
        text=True,
        timeout=TIMEOUT,
        env={
            "HUDDOL_DATA_DIR": str(data),
            "PATH": "/usr/bin:/bin",
            "PYTHONPATH": str(Path(__file__).resolve().parents[1] / "src"),
        },
        check=False,
    )
    frames = [
        json.loads(line) for line in completed.stdout.splitlines() if line.strip()
    ]
    assert completed.returncode == 0
    assert any(frame.get("code") == "invalid_frame" for frame in frames)
    assert response(frames, 1)["result"]["human_id"] == 1


def test_unusable_write_directories_are_reported_not_fatal(tmp_path: Path) -> None:
    data = tmp_path / "data"
    drive(
        data,
        [
            {
                "id": 1,
                "method": "settings.update",
                "params": {
                    "section": "execution",
                    "values": {"write_directories": [str(tmp_path)]},
                },
            }
        ],
    )
    import sqlite3

    connection = sqlite3.connect(data / "huddol.sqlite3")
    connection.execute("DELETE FROM write_directories")
    connection.execute("INSERT INTO write_directories VALUES (0, 'relative/bad')")
    connection.commit()
    connection.close()

    frames, code, stderr = drive(data, [])
    assert code == 0, stderr
    ready = events(frames, "ready")[0]
    assert ready["write_directories"] == []
    assert ready["unusable_write_directories"] == [
        {"path": "relative/bad", "reason": "invalid_directory"}
    ]


def test_interrupted_turns_are_marked_on_the_next_start(tmp_path: Path) -> None:
    data = tmp_path / "data"
    drive(
        data,
        [{"id": 1, "method": "organization.create_agent", "params": {"name": "Main"}}],
    )
    import sqlite3

    connection = sqlite3.connect(data / "huddol.sqlite3")
    connection.execute(
        "INSERT INTO agent_runs (agent_id, sequence, run_id, status, started_at,"
        " messages_json) VALUES (2, 1, 'r1', 'running', '2026-01-01T00:00:00Z', '[]')"
    )
    connection.commit()
    connection.close()

    _frames, code, stderr = drive(data, [])
    assert code == 0, stderr

    connection = sqlite3.connect(data / "huddol.sqlite3")
    status = connection.execute(
        "SELECT status FROM agent_runs WHERE agent_id = 2"
    ).fetchone()[0]
    connection.close()
    assert status == "interrupted"


def test_internal_methods_are_refused_over_the_pipe(tmp_path: Path) -> None:
    frames, code, _ = drive(
        tmp_path / "data", [{"id": 1, "method": "system.diagnostics", "params": {}}]
    )
    assert code == 0
    assert response(frames, 1)["error"]["code"] == "internal_method"


def test_agents_wake_and_report_turns_over_the_pipe(tmp_path: Path) -> None:
    with subprocess.Popen(
        [sys.executable, "-m", "huddol"],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        bufsize=1,
        env={
            "HUDDOL_DATA_DIR": str(tmp_path / "data"),
            "PATH": "/usr/bin:/bin",
            "PYTHONPATH": str(Path(__file__).resolve().parents[1] / "src"),
        },
    ) as process:
        assert process.stdin is not None
        assert process.stdout is not None

        def send(payload: dict[str, Any]) -> None:
            assert process.stdin is not None
            process.stdin.write(json.dumps(payload) + "\n")
            process.stdin.flush()

        def wait_for(predicate: Any, limit: int = 60) -> dict[str, Any]:
            assert process.stdout is not None
            for _ in range(limit):
                line = process.stdout.readline()
                if not line:
                    break
                frame = json.loads(line)
                if predicate(frame):
                    return frame
            raise AssertionError("expected frame never arrived")

        try:
            wait_for(lambda frame: frame.get("type") == "ready")
            send(
                {
                    "id": 1,
                    "method": "organization.create_agent",
                    "params": {"name": "Main"},
                }
            )
            wait_for(lambda frame: frame.get("id") == 1)
            send(
                {
                    "id": 2,
                    "method": "discussion.create",
                    "params": {"topic": "wake up", "member_ids": [2]},
                }
            )
            wait_for(lambda frame: frame.get("id") == 2)
            send(
                {
                    "id": 3,
                    "method": "discussion.send",
                    "params": {"discussion_id": 1, "body": "@Main go"},
                }
            )

            started = wait_for(lambda frame: frame.get("type") == "turn.started")
            assert started["agent_id"] == 2
            assert started["items"] == 1

            finished = wait_for(lambda frame: frame.get("type") == "turn.finished")
            assert finished["agent_id"] == 2
        finally:
            send({"method": "system.shutdown"})
            process.stdin.close()
            process.wait(timeout=TIMEOUT)


@pytest.mark.parametrize("section", ["model", "observability"])
def test_secrets_never_come_back_over_the_pipe(tmp_path: Path, section: str) -> None:
    values = (
        {
            "api_type": "openai",
            "base_url": "https://example.invalid/v1",
            "model": "m",
            "api_key": "SECRET-API-KEY",
        }
        if section == "model"
        else {
            "enabled": True,
            "base_url": "https://example.invalid",
            "public_key": "SECRET-PUBLIC",
            "secret_key": "SECRET-SECRET",
        }
    )
    frames, code, _ = drive(
        tmp_path / "data",
        [
            {
                "id": 1,
                "method": "settings.update",
                "params": {"section": section, "values": values},
            },
            {"id": 2, "method": "settings.get", "params": {"section": section}},
        ],
    )
    assert code == 0
    rendered = json.dumps(frames)
    assert "SECRET-API-KEY" not in rendered
    assert "SECRET-PUBLIC" not in rendered
    assert "SECRET-SECRET" not in rendered


def test_ping_answers_without_touching_the_domain(tmp_path: Path) -> None:
    frames, code, stderr = drive(
        tmp_path / "data",
        [{"id": 1, "method": "ping", "params": {"token": "abc"}}],
    )
    assert code == 0, stderr
    assert response(frames, 1)["result"] == {"pong": "abc"}


def test_ping_works_without_a_token(tmp_path: Path) -> None:
    frames, code, _ = drive(tmp_path / "data", [{"id": 1, "method": "ping"}])
    assert code == 0
    assert response(frames, 1)["result"] == {"pong": None}


def test_the_packaging_smoke_sequence_holds(tmp_path: Path) -> None:
    frames, code, stderr = drive(
        tmp_path / "data",
        [{"id": 1, "method": "ping", "params": {"token": "huddol-smoke"}}],
    )
    assert code == 0, stderr
    ready = events(frames, "ready")
    assert ready and ready[0]["methods"]
    assert response(frames, 1)["result"]["pong"] == "huddol-smoke"
    assert response(frames, 9999)["result"] == {"stopped": True}
