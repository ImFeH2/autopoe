import json
from pathlib import Path

from fastapi.testclient import TestClient

from flowent.main import create_app
from flowent.sandbox import SandboxRunner
from flowent.tools import ToolContext, run_tool


def stream_events(content: str) -> list[dict[str, object]]:
    events: list[dict[str, object]] = []
    for raw_event in content.strip().split("\n\n"):
        event_type = ""
        data = ""
        for line in raw_event.splitlines():
            if line.startswith("event: "):
                event_type = line.removeprefix("event: ")
            if line.startswith("data: "):
                data = line.removeprefix("data: ")
        events.append({"event": event_type, "data": json.loads(data)})
    return events


def configure_provider(client: TestClient) -> None:
    client.post(
        "/api/providers",
        json={
            "api_key": "sk-local",
            "base_url": "",
            "id": "provider-openai",
            "models": ["gpt-5.1"],
            "name": "OpenAI",
            "type": "openai",
        },
    )
    client.put(
        "/api/settings",
        json={
            "selected_model": "gpt-5.1",
            "selected_provider_id": "provider-openai",
        },
    )


def tool_call_chunk(
    name: str, arguments: dict[str, object], call_id: str = "call-1"
) -> dict[str, object]:
    return {
        "choices": [
            {
                "delta": {
                    "tool_calls": [
                        {
                            "index": 0,
                            "id": call_id,
                            "type": "function",
                            "function": {
                                "name": name,
                                "arguments": json.dumps(arguments),
                            },
                        }
                    ]
                }
            }
        ]
    }


def text_chunk(content: str) -> dict[str, object]:
    return {"choices": [{"delta": {"content": content}}]}


def test_workspace_response_streams_tool_process_and_final_text(
    tmp_path, monkeypatch
) -> None:
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path / "data"))
    workdir = tmp_path / "workdir"
    workdir.mkdir()
    (workdir / "notes.txt").write_text("Launch notes")
    monkeypatch.chdir(workdir)
    call_count = 0

    async def fake_completion(**request: object) -> object:
        nonlocal call_count
        call_count += 1

        async def chunks() -> object:
            if call_count == 1:
                yield tool_call_chunk("read_file", {"path": "notes.txt"})
            else:
                yield text_chunk("Read the notes.")

        return chunks()

    client = TestClient(
        create_app(serve_frontend=False, chat_completion=fake_completion)
    )
    configure_provider(client)

    response = client.post(
        "/api/workspace/respond",
        json={
            "messages": [
                {"author": "user", "content": "Use the notes.", "id": "message-1"}
            ]
        },
    )

    assert response.status_code == 200
    events = stream_events(response.text)
    assert [event["event"] for event in events] == [
        "start",
        "tool_start",
        "tool_done",
        "delta",
        "done",
    ]
    assert events[1]["data"]["tool"]["status"] == "running"
    assert events[2]["data"]["status"] == "success"
    assert events[3]["data"] == {"content": "Read the notes."}
    assert events[4]["data"]["message"]["content"] == "Read the notes."


def test_tools_can_read_paths_outside_workdir(tmp_path) -> None:
    outside = tmp_path / "outside.txt"
    outside.write_text("outside content")

    result = run_tool(
        "read_file", {"path": str(outside)}, ToolContext(cwd=tmp_path / "work")
    )

    assert result.ok
    assert result.content == "outside content"


def test_list_dir_can_list_paths_outside_workdir(tmp_path) -> None:
    outside = tmp_path / "outside"
    outside.mkdir()
    (outside / "file.txt").write_text("content")

    result = run_tool(
        "list_dir", {"path": str(outside)}, ToolContext(cwd=tmp_path / "work")
    )

    assert result.ok
    assert "file.txt" in result.content


def test_grep_files_can_search_paths_outside_workdir(tmp_path) -> None:
    outside = tmp_path / "outside"
    outside.mkdir()
    (outside / "file.txt").write_text("alpha beta")

    result = run_tool(
        "grep_files",
        {"pattern": "alpha", "path": str(outside)},
        ToolContext(cwd=tmp_path / "work"),
    )

    assert result.ok
    assert "file.txt" in result.content


def test_shell_command_can_write_workdir_and_tmp(tmp_path) -> None:
    result = run_tool(
        "shell_command",
        {"command": "echo ok > work.txt && echo tmp > /tmp/flowent-tool-test.txt"},
        ToolContext(cwd=tmp_path),
    )

    assert result.ok
    assert (tmp_path / "work.txt").read_text().strip() == "ok"


def test_shell_command_cannot_write_outside_workdir_and_tmp(tmp_path) -> None:
    outside = Path("/project/flowent/backend/tests/flowent-outside-denied.txt")
    if outside.exists():
        outside.unlink()

    result = run_tool(
        "shell_command",
        {"command": f"echo denied > {outside}"},
        ToolContext(cwd=tmp_path),
    )

    assert not result.ok
    assert not outside.exists()


def test_shell_command_has_network_by_default(tmp_path) -> None:
    result = run_tool(
        "shell_command",
        {
            "command": "python - <<'PY'\nimport socket\ns=socket.socket()\nprint('network-ready')\nPY"
        },
        ToolContext(cwd=tmp_path),
    )

    assert result.ok
    assert "network-ready" in result.content


def test_shell_command_denies_ptrace_when_seccomp_is_available(tmp_path) -> None:
    command = SandboxRunner(cwd=tmp_path).build_command(["/bin/true"])
    if not command.seccomp_available:
        assert command.args[0].endswith("bwrap")
        return

    result = run_tool(
        "shell_command",
        {
            "command": "python - <<'PY'\nimport ctypes, os\nprint(ctypes.CDLL(None).ptrace(0, 0, None, None))\nPY"
        },
        ToolContext(cwd=tmp_path),
    )

    assert not result.ok or "-1" in result.content


def test_apply_patch_modifies_workdir_file(tmp_path) -> None:
    target = tmp_path / "notes.txt"
    target.write_text("alpha\nbeta\n")
    patch = """*** Begin Patch
*** Update File: notes.txt
@@
-beta
+ready
*** End Patch
"""

    result = run_tool("apply_patch", {"patch": patch}, ToolContext(cwd=tmp_path))

    assert result.ok
    assert target.read_text() == "alpha\nready\n"


def test_apply_patch_rejects_outside_workdir_file(tmp_path) -> None:
    outside = Path("/project/flowent/backend/tests/outside-patch.txt")
    outside.write_text("alpha\n")
    try:
        patch = f"""*** Begin Patch
*** Update File: {outside}
@@
-alpha
+beta
*** End Patch
"""

        result = run_tool("apply_patch", {"patch": patch}, ToolContext(cwd=tmp_path))

        assert not result.ok
        assert outside.read_text() == "alpha\n"
    finally:
        outside.unlink(missing_ok=True)


def test_apply_patch_uses_internal_subcommand(tmp_path, monkeypatch) -> None:
    calls: list[list[str]] = []

    def fake_run(self, command, **kwargs):
        calls.append(command)
        from flowent.sandbox import CommandResult

        return CommandResult(
            command=" ".join(command), exit_code=0, stderr="", stdout="{}"
        )

    monkeypatch.setattr(SandboxRunner, "run", fake_run)
    patch = """*** Begin Patch
*** Add File: created.txt
+hello
*** End Patch
"""

    result = run_tool("apply_patch", {"patch": patch}, ToolContext(cwd=tmp_path))

    assert result.ok
    assert calls
    assert calls[0][1:4] == ["-m", "flowent.cli", "apply-patch"]


def test_web_search_result_enters_tool_output(tmp_path) -> None:
    def fake_search(query: str):
        return [{"title": "Result", "url": "https://example.test", "snippet": query}]

    result = run_tool(
        "web_search",
        {"query": "release checklist"},
        ToolContext(cwd=tmp_path, web_searcher=fake_search),
    )

    assert result.ok
    assert "https://example.test" in result.content


def test_tool_failure_is_reported_and_agent_continues(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.chdir(tmp_path)
    call_count = 0

    async def fake_completion(**request: object) -> object:
        nonlocal call_count
        call_count += 1

        async def chunks() -> object:
            if call_count == 1:
                yield tool_call_chunk("read_file", {"path": "missing.txt"})
            else:
                yield text_chunk("I could not read it.")

        return chunks()

    client = TestClient(
        create_app(serve_frontend=False, chat_completion=fake_completion)
    )
    configure_provider(client)

    response = client.post(
        "/api/workspace/respond",
        json={
            "messages": [{"author": "user", "content": "Read it.", "id": "message-1"}]
        },
    )

    events = stream_events(response.text)
    assert "tool_error" in [event["event"] for event in events]
    assert events[-1]["data"]["message"]["content"] == "I could not read it."


def test_update_plan_outputs_plan_state(tmp_path) -> None:
    result = run_tool(
        "update_plan",
        {"items": [{"step": "Read files", "status": "completed"}]},
        ToolContext(cwd=tmp_path),
    )

    assert result.ok
    assert "Read files" in result.content
