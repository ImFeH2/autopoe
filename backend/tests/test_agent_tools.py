import asyncio
import json
import logging
import shlex
import subprocess
import sys
import time
from pathlib import Path
from uuid import UUID

import pytest
from fastapi.testclient import TestClient

from flowent.agent import FLOWENT_AGENT_SYSTEM_PROMPT, run_agent_stream
from flowent.llm import ProviderConnection, ProviderFormat
from flowent.main import create_app
from flowent.network import flowent_user_agent
from flowent.sandbox import CommandResult, SandboxCommand, SandboxRunner
from flowent.tools import (
    ToolContext,
    ToolResult,
    default_web_search,
    run_tool,
    text_tool_result,
    tool_result_model_content,
)


class UserRecord:
    def __init__(self, pw_shell: str) -> None:
        self.pw_shell = pw_shell


def sandbox_bind_pairs(args: list[str]) -> list[tuple[str, str]]:
    pairs: list[tuple[str, str]] = []
    for index, arg in enumerate(args[:-2]):
        if arg == "--bind":
            pairs.append((args[index + 1], args[index + 2]))
    return pairs


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
            "reasoning_effort": "default",
            "selected_model": "gpt-5.1",
            "selected_provider_id": "provider-openai",
        },
    )


def input_output_workflow(workflow_id: str = "workflow-1") -> dict[str, object]:
    return {
        "id": workflow_id,
        "name": "Launch Workflow",
        "spec": {
            "connections": [
                {
                    "id": "edge-input-output",
                    "from": {"node_id": "input", "port": "output"},
                    "to": {"node_id": "output", "port": "input"},
                }
            ],
            "nodes": [
                {
                    "config": {"default_value": "saved input", "input_type": "text"},
                    "id": "input",
                    "kind": "input",
                },
                {
                    "config": {"output_key": "final_result", "transform": ""},
                    "id": "output",
                    "kind": "output",
                },
            ],
        },
        "presentation": {
            "connections": {"edge-input-output": {"label": ""}},
            "nodes": {
                "input": {
                    "description": "",
                    "name": "Input",
                    "position": {"x": 0, "y": 0},
                },
                "output": {
                    "description": "",
                    "name": "Output",
                    "position": {"x": 260, "y": 0},
                },
            },
        },
    }


def steward_input_output_workflow() -> dict[str, object]:
    return {
        "name": "Launch Workflow",
        "nodes": [
            {
                "id": "input",
                "kind": "input",
                "config": {"default_value": "saved input", "input_type": "text"},
                "name": "Input",
                "description": "",
            },
            {
                "id": "output",
                "kind": "output",
                "config": {"output_key": "final_result", "transform": ""},
                "name": "Output",
                "description": "",
            },
        ],
        "connections": [
            {
                "id": "edge-input-output",
                "from": {"node_id": "input", "port": "output"},
                "to": {"node_id": "output", "port": "input"},
                "label": "",
            }
        ],
    }


def save_workflow(client: TestClient):
    return client.put(
        "/api/workflows",
        json={"base_revision": None, "workflow": input_output_workflow()},
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


def thinking_chunk(content: str) -> dict[str, object]:
    return {"choices": [{"delta": {"reasoning_content": content}}]}


def test_agent_prompt_treats_tool_calls_as_intermediate_work() -> None:
    assert "A tool call is not a final response." in FLOWENT_AGENT_SYSTEM_PROMPT
    assert "After every tool result, continue the same turn" in (
        FLOWENT_AGENT_SYSTEM_PROMPT
    )
    assert "If a tool fails, use the error as context" in FLOWENT_AGENT_SYSTEM_PROMPT


def test_agent_prompt_explains_workflow_tool_rules() -> None:
    assert "Use workflow tools when the user asks" in FLOWENT_AGENT_SYSTEM_PROMPT
    assert "pass that content as the run_workflow input" in (
        FLOWENT_AGENT_SYSTEM_PROMPT
    )
    assert "get_workflow_run" in FLOWENT_AGENT_SYSTEM_PROMPT
    assert "run_id" in FLOWENT_AGENT_SYSTEM_PROMPT
    assert "valid node ids and connections" in FLOWENT_AGENT_SYSTEM_PROMPT
    assert "valid node ids and edges" not in FLOWENT_AGENT_SYSTEM_PROMPT
    assert "delete saved workflows when the user clearly asks" in (
        FLOWENT_AGENT_SYSTEM_PROMPT
    )
    assert "Do not delete workflows." not in FLOWENT_AGENT_SYSTEM_PROMPT


def test_workspace_response_streams_tool_process_and_final_text(
    tmp_path, monkeypatch
) -> None:
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path / "data"))
    workdir = tmp_path / "workdir"
    workdir.mkdir()
    (workdir / "notes.txt").write_text("Launch notes")
    monkeypatch.chdir(workdir)
    captured_requests: list[dict[str, object]] = []

    async def fake_completion(**request: object) -> object:
        captured_requests.append(request)

        async def chunks() -> object:
            if len(captured_requests) == 1:
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
        json={"content": "Use the notes."},
    )

    assert response.status_code == 200
    events = stream_events(response.text)
    assert [event["event"] for event in events] == [
        "start",
        "output_start",
        "output_done",
        "tool_start",
        "tool_done",
        "output_start",
        "delta",
        "output_done",
        "done",
    ]
    assert events[1]["data"] == {"index": 1}
    assert events[3]["data"]["tool"]["status"] == "running"
    assert events[4]["data"]["status"] == "success"
    assert events[5]["data"] == {"index": 2}
    assert events[6]["data"] == {"content": "Read the notes."}
    assert events[8]["data"]["message"]["content"] == "Read the notes."
    assert len(captured_requests) == 2
    assert captured_requests[0]["messages"][0] == {
        "role": "system",
        "content": FLOWENT_AGENT_SYSTEM_PROMPT,
    }
    second_messages = captured_requests[1]["messages"]
    assert second_messages[0] == {
        "role": "system",
        "content": FLOWENT_AGENT_SYSTEM_PROMPT,
    }
    assert second_messages[-2]["tool_calls"][0]["function"]["name"] == "read_file"
    assert second_messages[-1] == {
        "role": "tool",
        "tool_call_id": "call-1",
        "content": "Launch notes",
    }


def test_workspace_agent_can_run_workflow_with_current_message_input(
    tmp_path, monkeypatch
) -> None:
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.chdir(tmp_path)
    captured_requests: list[dict[str, object]] = []

    async def fake_completion(**request: object) -> object:
        captured_requests.append(request)

        async def chunks() -> object:
            if len(captured_requests) == 1:
                yield tool_call_chunk(
                    "run_workflow",
                    {
                        "workflow_id": "workflow-1",
                        "input": "release blockers",
                    },
                    call_id="call-run",
                )
            else:
                yield text_chunk("The workflow returned release blockers.")

        return chunks()

    client = TestClient(
        create_app(serve_frontend=False, chat_completion=fake_completion)
    )
    configure_provider(client)
    assert save_workflow(client).status_code == 200

    response = client.post(
        "/api/workspace/respond",
        json={"content": "Run Launch Workflow for release blockers."},
    )

    assert response.status_code == 200
    events = stream_events(response.text)
    tool_done = next(event for event in events if event["event"] == "tool_done")
    assert tool_done["data"]["status"] == "success"
    assert tool_done["data"]["result"]["type"] == "workflow_run"
    assert tool_done["data"]["result"]["outputs"] == {
        "final_result": "release blockers"
    }
    assert len(captured_requests) == 2
    tool_names = {tool["function"]["name"] for tool in captured_requests[0]["tools"]}
    assert "run_workflow" in tool_names
    tool_message = captured_requests[1]["messages"][-1]
    assert tool_message["role"] == "tool"
    assert tool_message["tool_call_id"] == "call-run"
    tool_payload = json.loads(tool_message["content"])
    assert tool_payload["run_id"]
    assert tool_payload["workflow_revision"] == 1
    assert tool_payload["outputs"] == {"final_result": "release blockers"}
    assert tool_payload["node_results"][1]["inputs"] == ["release blockers"]
    assert events[-1]["data"]["message"]["content"] == (
        "The workflow returned release blockers."
    )


def test_workspace_agent_creates_workflow_with_generated_uuid(
    tmp_path, monkeypatch
) -> None:
    fixed_uuid = UUID("00000000-0000-4000-8000-000000000000")
    monkeypatch.setattr("flowent.workflow_tools.uuid4", lambda: fixed_uuid)
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.chdir(tmp_path)
    workflow = steward_input_output_workflow()
    captured_requests: list[dict[str, object]] = []

    async def fake_completion(**request: object) -> object:
        captured_requests.append(request)

        async def chunks() -> object:
            if len(captured_requests) == 1:
                yield tool_call_chunk(
                    "create_workflow",
                    {"workflow": workflow},
                    call_id="call-create",
                )
            else:
                yield text_chunk("I created the workflow.")

        return chunks()

    client = TestClient(
        create_app(serve_frontend=False, chat_completion=fake_completion)
    )
    configure_provider(client)

    response = client.post(
        "/api/workspace/respond",
        json={"content": "Create a workflow."},
    )

    assert response.status_code == 200
    events = stream_events(response.text)
    tool_done = next(event for event in events if event["event"] == "tool_done")
    assert tool_done["data"]["status"] == "success"
    assert tool_done["data"]["result"]["workflow"]["id"] == str(fixed_uuid)
    assert captured_requests[1]["messages"][-1] == {
        "role": "tool",
        "tool_call_id": "call-create",
        "content": "Created Launch Workflow with 2 nodes and 1 connections.",
    }
    state = client.get("/api/state").json()
    assert [workflow["id"] for workflow in state["workflows"]] == [str(fixed_uuid)]
    assert events[-1]["data"]["message"]["content"] == "I created the workflow."


def test_workspace_agent_deletes_workflow(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.chdir(tmp_path)
    captured_requests: list[dict[str, object]] = []

    async def fake_completion(**request: object) -> object:
        captured_requests.append(request)

        async def chunks() -> object:
            if len(captured_requests) == 1:
                yield tool_call_chunk(
                    "delete_workflow",
                    {"workflow_id": "workflow-1"},
                    call_id="call-delete",
                )
            else:
                yield text_chunk("I deleted Launch Workflow.")

        return chunks()

    client = TestClient(
        create_app(serve_frontend=False, chat_completion=fake_completion)
    )
    configure_provider(client)
    assert save_workflow(client).status_code == 200

    response = client.post(
        "/api/workspace/respond",
        json={"content": "Delete Launch Workflow."},
    )

    assert response.status_code == 200
    events = stream_events(response.text)
    tool_done = next(event for event in events if event["event"] == "tool_done")
    assert tool_done["data"]["status"] == "success"
    assert tool_done["data"]["title"] == "Deleted Launch Workflow"
    assert tool_done["data"]["result"] == {
        "type": "workflow_delete",
        "output": "Deleted Launch Workflow.",
        "summary": {
            "active_revision": 1,
            "connection_count": 1,
            "id": "workflow-1",
            "name": "Launch Workflow",
            "node_count": 2,
            "nodes": [
                {"id": "input", "kind": "input", "name": "Input"},
                {"id": "output", "kind": "output", "name": "Output"},
            ],
            "revision": 1,
        },
    }
    assert len(captured_requests) == 2
    tool_names = {tool["function"]["name"] for tool in captured_requests[0]["tools"]}
    assert "delete_workflow" in tool_names
    assert captured_requests[1]["messages"][-1] == {
        "role": "tool",
        "tool_call_id": "call-delete",
        "content": "Deleted Launch Workflow.",
    }
    state = client.get("/api/state").json()
    assert state["workflows"] == []
    assert events[-1]["data"]["message"]["content"] == "I deleted Launch Workflow."


def test_workspace_agent_reports_missing_workflow_delete(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.chdir(tmp_path)
    captured_requests: list[dict[str, object]] = []

    async def fake_completion(**request: object) -> object:
        captured_requests.append(request)

        async def chunks() -> object:
            if len(captured_requests) == 1:
                yield tool_call_chunk(
                    "delete_workflow",
                    {"workflow_id": "missing-workflow"},
                    call_id="call-delete",
                )
            else:
                yield text_chunk("I could not find that workflow.")

        return chunks()

    client = TestClient(
        create_app(serve_frontend=False, chat_completion=fake_completion)
    )
    configure_provider(client)
    assert save_workflow(client).status_code == 200

    response = client.post(
        "/api/workspace/respond",
        json={"content": "Delete the missing workflow."},
    )

    assert response.status_code == 200
    events = stream_events(response.text)
    tool_error = next(event for event in events if event["event"] == "tool_error")
    assert tool_error["data"]["status"] == "failed"
    assert tool_error["data"]["title"] == "Deleting workflow"
    assert tool_error["data"]["result"]["text"] == "Workflow not found."
    assert captured_requests[1]["messages"][-1] == {
        "role": "tool",
        "tool_call_id": "call-delete",
        "content": "Workflow not found.",
    }
    state = client.get("/api/state").json()
    assert [workflow["id"] for workflow in state["workflows"]] == ["workflow-1"]
    assert events[-1]["data"]["message"]["content"] == (
        "I could not find that workflow."
    )


def test_workspace_agent_rejects_invalid_workflow_update_without_saving(
    tmp_path, monkeypatch
) -> None:
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.chdir(tmp_path)
    invalid_workflow = steward_input_output_workflow()
    invalid_workflow["connections"][0]["to"]["node_id"] = "missing"
    captured_requests: list[dict[str, object]] = []

    async def fake_completion(**request: object) -> object:
        captured_requests.append(request)

        async def chunks() -> object:
            if len(captured_requests) == 1:
                yield tool_call_chunk(
                    "update_workflow",
                    {
                        "workflow_id": "workflow-1",
                        "base_revision": 1,
                        "workflow": invalid_workflow,
                    },
                    call_id="call-update",
                )
            else:
                yield text_chunk(
                    "I could not save the workflow because an edge is invalid."
                )

        return chunks()

    client = TestClient(
        create_app(serve_frontend=False, chat_completion=fake_completion)
    )
    configure_provider(client)
    assert save_workflow(client).status_code == 200

    response = client.post(
        "/api/workspace/respond",
        json={"content": "Change Launch Workflow."},
    )

    assert response.status_code == 200
    events = stream_events(response.text)
    tool_error = next(event for event in events if event["event"] == "tool_error")
    assert tool_error["data"]["status"] == "failed"
    assert tool_error["data"]["title"] == "Updating workflow"
    assert tool_error["data"]["result"]["text"] == (
        "Connection edge-input-output must connect existing nodes."
    )
    assert captured_requests[1]["messages"][-1] == {
        "role": "tool",
        "tool_call_id": "call-update",
        "content": "Connection edge-input-output must connect existing nodes.",
    }
    state = client.get("/api/state").json()
    assert state["workflows"][0]["spec"]["connections"][0]["to"] == {
        "node_id": "output",
        "port": "input",
    }
    assert events[-1]["data"]["message"]["content"] == (
        "I could not save the workflow because an edge is invalid."
    )


def test_tools_can_read_paths_outside_workdir(tmp_path) -> None:
    outside = tmp_path / "outside.txt"
    outside.write_text("outside content")

    result = run_tool(
        "read_file", {"path": str(outside)}, ToolContext(cwd=tmp_path / "work")
    )

    assert result.ok
    assert tool_result_model_content(result) == "outside content"


def test_list_dir_can_list_paths_outside_workdir(tmp_path) -> None:
    outside = tmp_path / "outside"
    outside.mkdir()
    (outside / "file.txt").write_text("content")

    result = run_tool(
        "list_dir", {"path": str(outside)}, ToolContext(cwd=tmp_path / "work")
    )

    assert result.ok
    assert "file.txt" in tool_result_model_content(result)


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
    assert "file.txt" in tool_result_model_content(result)


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


def test_shell_command_has_network_by_default(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("SHELL", "/bin/sh")
    monkeypatch.setattr("pwd.getpwuid", lambda _uid: UserRecord("/bin/sh"))
    script = "import socket; socket.socket().close(); print('network-ready')"

    result = run_tool(
        "shell_command",
        {"command": f"{shlex.quote(sys.executable)} -c {shlex.quote(script)}"},
        ToolContext(cwd=tmp_path),
    )

    assert result.ok
    assert "network-ready" in tool_result_model_content(result)


def test_shell_command_uses_executable_default_shell(
    tmp_path, monkeypatch, make_executable_file
) -> None:
    shell = make_executable_file(tmp_path / "user-shell")
    captured: dict[str, object] = {}

    def fake_run(self, command, **kwargs):
        captured["command"] = command
        captured["env"] = kwargs.get("env")
        return CommandResult(
            command=" ".join(command),
            exit_code=0,
            stderr="",
            stdout="ok",
        )

    monkeypatch.setenv("SHELL", str(shell))
    monkeypatch.setattr("pwd.getpwuid", lambda _uid: UserRecord(str(shell)))
    monkeypatch.setattr(SandboxRunner, "run", fake_run)

    result = run_tool(
        "shell_command",
        {"command": "echo ok"},
        ToolContext(cwd=tmp_path),
    )

    assert result.ok
    assert captured["command"] == [str(shell), "-c", "echo ok"]
    assert captured["env"] == {"SHELL": str(shell)}


def test_shell_command_prefers_user_record_shell_over_environment_shell(
    tmp_path, monkeypatch, make_executable_file
) -> None:
    user_shell = make_executable_file(tmp_path / "user-shell")
    environment_shell = make_executable_file(tmp_path / "environment-shell")
    captured: dict[str, object] = {}

    def fake_run(self, command, **kwargs):
        captured["command"] = command
        captured["env"] = kwargs.get("env")
        return CommandResult(
            command=" ".join(command),
            exit_code=0,
            stderr="",
            stdout="ok",
        )

    monkeypatch.setenv("SHELL", str(environment_shell))
    monkeypatch.setattr("pwd.getpwuid", lambda _uid: UserRecord(str(user_shell)))
    monkeypatch.setattr(SandboxRunner, "run", fake_run)

    result = run_tool(
        "shell_command",
        {"command": "echo ok"},
        ToolContext(cwd=tmp_path),
    )

    assert result.ok
    assert captured["command"] == [str(user_shell), "-c", "echo ok"]
    assert captured["env"] == {"SHELL": str(user_shell)}


def test_shell_command_falls_back_to_bash_when_default_shell_is_unavailable(
    tmp_path, monkeypatch, make_executable_file
) -> None:
    bin_dir = tmp_path / "bin"
    bash = make_executable_file(bin_dir / "bash")
    captured: dict[str, object] = {}

    def fake_run(self, command, **kwargs):
        captured["command"] = command
        captured["env"] = kwargs.get("env")
        return CommandResult(
            command=" ".join(command),
            exit_code=0,
            stderr="",
            stdout="ok",
        )

    monkeypatch.setenv("SHELL", str(tmp_path / "missing-shell"))
    monkeypatch.setattr(
        "pwd.getpwuid", lambda _uid: UserRecord(str(tmp_path / "missing-shell"))
    )
    monkeypatch.setenv("PATH", str(bin_dir))
    monkeypatch.setattr(SandboxRunner, "run", fake_run)

    result = run_tool(
        "shell_command",
        {"command": "echo ok"},
        ToolContext(cwd=tmp_path),
    )

    assert result.ok
    assert captured["command"] == [str(bash), "-c", "echo ok"]
    assert captured["env"] == {"SHELL": str(bash)}


def test_shell_command_falls_back_to_sh_when_bash_is_unavailable(
    tmp_path, monkeypatch, make_executable_file
) -> None:
    bin_dir = tmp_path / "bin"
    shell = make_executable_file(bin_dir / "sh")
    captured: dict[str, object] = {}

    def fake_run(self, command, **kwargs):
        captured["command"] = command
        captured["env"] = kwargs.get("env")
        return CommandResult(
            command=" ".join(command),
            exit_code=0,
            stderr="",
            stdout="ok",
        )

    monkeypatch.delenv("SHELL", raising=False)
    monkeypatch.setattr("pwd.getpwuid", lambda _uid: UserRecord(""))
    monkeypatch.setenv("PATH", str(bin_dir))
    monkeypatch.setattr("flowent.shell.FALLBACK_SHELL_PATHS", {"bash": [], "sh": []})
    monkeypatch.setattr(SandboxRunner, "run", fake_run)

    result = run_tool(
        "shell_command",
        {"command": "echo ok"},
        ToolContext(cwd=tmp_path),
    )

    assert result.ok
    assert captured["command"] == [str(shell), "-c", "echo ok"]
    assert captured["env"] == {"SHELL": str(shell)}


def test_sandbox_command_keeps_proc_mount_when_preflight_succeeds(
    tmp_path, monkeypatch
) -> None:
    runner = SandboxRunner(cwd=tmp_path)
    monkeypatch.setattr("flowent.sandbox.sandbox_supports_proc_mount", lambda: True)

    command = runner.build_command(["/bin/true"])

    assert command.args[command.args.index("--proc") + 1] == "/proc"


def test_sandbox_command_omits_proc_mount_when_preflight_reports_permission_error(
    tmp_path, monkeypatch
) -> None:
    runner = SandboxRunner(cwd=tmp_path)
    monkeypatch.setattr("flowent.sandbox.sandbox_supports_proc_mount", lambda: False)

    command = runner.build_command(["/bin/true"])

    assert "--proc" not in command.args


def test_sandbox_command_binds_writable_socket_path(tmp_path, monkeypatch) -> None:
    socket_path = tmp_path / "docker.sock"
    socket_path.touch()
    runner = SandboxRunner(cwd=tmp_path, writable_roots=[socket_path])
    monkeypatch.setattr("flowent.sandbox.sandbox_supports_proc_mount", lambda: False)

    command = runner.build_command(["/bin/true"])

    bind_index = command.args.index(str(socket_path))
    assert command.args[bind_index - 1] == "--bind"
    assert command.args[bind_index + 1] == str(socket_path)


def test_sandbox_command_does_not_create_missing_writable_root(
    tmp_path, monkeypatch
) -> None:
    missing_path = tmp_path / "external" / "note.txt"
    runner = SandboxRunner(cwd=tmp_path, writable_roots=[missing_path])
    monkeypatch.setattr("flowent.sandbox.sandbox_supports_proc_mount", lambda: False)

    runner.build_command(["/bin/true"])

    assert not missing_path.exists()
    assert not missing_path.parent.exists()


def test_sandbox_command_omits_missing_writable_root_bind(
    tmp_path, monkeypatch
) -> None:
    missing_path = tmp_path / "external" / "note.txt"
    runner = SandboxRunner(cwd=tmp_path, writable_roots=[missing_path])
    monkeypatch.setattr("flowent.sandbox.sandbox_supports_proc_mount", lambda: False)

    command = runner.build_command(["/bin/true"])

    assert (str(missing_path), str(missing_path)) not in sandbox_bind_pairs(
        command.args
    )


def test_sandbox_command_binds_existing_writable_directory(
    tmp_path, monkeypatch
) -> None:
    writable_directory = tmp_path / "external"
    writable_directory.mkdir()
    runner = SandboxRunner(cwd=tmp_path, writable_roots=[writable_directory])
    monkeypatch.setattr("flowent.sandbox.sandbox_supports_proc_mount", lambda: False)

    command = runner.build_command(["/bin/true"])

    assert (str(writable_directory), str(writable_directory)) in sandbox_bind_pairs(
        command.args
    )


def test_sandbox_command_binds_existing_writable_file(tmp_path, monkeypatch) -> None:
    writable_file = tmp_path / "external.txt"
    writable_file.write_text("existing")
    runner = SandboxRunner(cwd=tmp_path, writable_roots=[writable_file])
    monkeypatch.setattr("flowent.sandbox.sandbox_supports_proc_mount", lambda: False)

    command = runner.build_command(["/bin/true"])

    assert (str(writable_file), str(writable_file)) in sandbox_bind_pairs(command.args)


def test_sandbox_proc_preflight_does_not_hide_non_proc_errors(
    tmp_path, monkeypatch
) -> None:
    bwrap = tmp_path / "bwrap"
    bwrap.write_text("#!/bin/sh\necho 'bwrap: unrelated startup failure' >&2\nexit 1\n")
    bwrap.chmod(0o700)
    monkeypatch.setattr("flowent.sandbox.sandbox_binary", lambda: str(bwrap))

    assert SandboxRunner(cwd=tmp_path).build_command(["/bin/true"]).args[0:7] == [
        str(bwrap),
        "--ro-bind",
        "/",
        "/",
        "--dev",
        "/dev",
        "--proc",
    ]


def test_shell_command_runs_without_proc_mount_after_preflight_fallback(
    tmp_path, monkeypatch
) -> None:
    bwrap = tmp_path / "bwrap"
    bwrap.write_text(
        "#!/bin/sh\n"
        'for arg in "$@"; do\n'
        '  if [ "$arg" = --proc ]; then\n'
        '    echo "bwrap: Can\'t mount proc on /newroot/proc: Operation not permitted" >&2\n'
        "    exit 1\n"
        "  fi\n"
        "done\n"
        'while [ "$#" -gt 0 ]; do\n'
        '  if [ "$1" = -- ]; then\n'
        "    shift\n"
        '    exec "$@"\n'
        "  fi\n"
        "  shift\n"
        "done\n"
    )
    bwrap.chmod(0o700)
    monkeypatch.setattr("flowent.sandbox.sandbox_binary", lambda: str(bwrap))

    result = SandboxRunner(cwd=tmp_path).run(["/bin/sh", "-c", "printf ok"])

    assert result.exit_code == 0
    assert result.stdout == "ok"


def test_apply_patch_runs_without_proc_mount_after_preflight_fallback(
    tmp_path, monkeypatch
) -> None:
    bwrap = tmp_path / "bwrap"
    bwrap.write_text(
        "#!/bin/sh\n"
        'for arg in "$@"; do\n'
        '  if [ "$arg" = --proc ]; then\n'
        '    echo "bwrap: Can\'t mount proc on /newroot/proc: Operation not permitted" >&2\n'
        "    exit 1\n"
        "  fi\n"
        "done\n"
        'while [ "$#" -gt 0 ]; do\n'
        '  if [ "$1" = -- ]; then\n'
        "    shift\n"
        '    exec "$@"\n'
        "  fi\n"
        "  shift\n"
        "done\n"
    )
    bwrap.chmod(0o700)
    monkeypatch.setattr("flowent.sandbox.sandbox_binary", lambda: str(bwrap))
    target = tmp_path / "notes.txt"
    target.write_text("alpha\n")
    patch = """*** Begin Patch
*** Update File: notes.txt
@@
-alpha
+beta
*** End Patch
"""

    result = run_tool("apply_patch", {"patch": patch}, ToolContext(cwd=tmp_path))

    assert result.ok
    assert target.read_text() == "beta\n"


def test_shell_command_environment_omits_development_variables(
    tmp_path, monkeypatch
) -> None:
    monkeypatch.setenv("NODE_ENV", "production")
    monkeypatch.setenv("VIRTUAL_ENV", "/tmp/flowent-venv")
    monkeypatch.setenv("PYTHONPATH", "/tmp/flowent-pythonpath")
    runner = SandboxRunner(cwd=tmp_path)
    monkeypatch.setattr(
        runner,
        "build_command",
        lambda command: SandboxCommand(command, seccomp_available=False),
    )

    result = runner.run(
        [
            "/bin/sh",
            "-c",
            'printf \'%s|%s|%s\' "${NODE_ENV-unset}" "${VIRTUAL_ENV-unset}" "${PYTHONPATH-unset}"',
        ]
    )

    assert result.exit_code == 0
    assert result.stdout == "unset|unset|unset"


def test_shell_command_environment_omits_sensitive_variables(
    tmp_path, monkeypatch
) -> None:
    monkeypatch.setenv("OPENAI_API_KEY", "sk-local")
    monkeypatch.setenv("SECRET_TOKEN", "secret")
    monkeypatch.setenv("NPM_TOKEN", "npm")
    runner = SandboxRunner(cwd=tmp_path)
    monkeypatch.setattr(
        runner,
        "build_command",
        lambda command: SandboxCommand(command, seccomp_available=False),
    )

    result = runner.run(
        [
            "/bin/sh",
            "-c",
            'printf \'%s|%s|%s\' "${OPENAI_API_KEY-unset}" "${SECRET_TOKEN-unset}" "${NPM_TOKEN-unset}"',
        ]
    )

    assert result.exit_code == 0
    assert result.stdout == "unset|unset|unset"


def test_shell_command_environment_keeps_core_variables(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("HOME", str(tmp_path / "home"))
    monkeypatch.setenv("PATH", "/usr/local/bin:/usr/bin:/bin")
    monkeypatch.setenv("SHELL", "/bin/sh")
    monkeypatch.setenv("USER", "flowent")
    runner = SandboxRunner(cwd=tmp_path)
    monkeypatch.setattr(
        runner,
        "build_command",
        lambda command: SandboxCommand(command, seccomp_available=False),
    )

    result = runner.run(
        [
            "/bin/sh",
            "-c",
            'printf \'%s|%s|%s|%s\' "$HOME" "$PATH" "$SHELL" "$USER"',
        ]
    )

    assert result.exit_code == 0
    assert (
        result.stdout
        == f"{tmp_path / 'home'}|/usr/local/bin:/usr/bin:/bin|/bin/sh|flowent"
    )


def test_shell_command_environment_uses_default_path_when_missing(
    tmp_path, monkeypatch
) -> None:
    monkeypatch.delenv("PATH", raising=False)
    runner = SandboxRunner(cwd=tmp_path)
    captured_env: dict[str, str] = {}

    def fake_run(*args, **kwargs):
        captured_env.update(kwargs["env"])
        return subprocess.CompletedProcess(
            args=args[0], returncode=0, stdout="", stderr=""
        )

    monkeypatch.setattr(
        runner,
        "build_command",
        lambda command: SandboxCommand(command, seccomp_available=False),
    )
    monkeypatch.setattr("subprocess.run", fake_run)

    result = runner.run(["/bin/sh", "-c", "true"])

    assert result.exit_code == 0
    assert (
        captured_env["PATH"]
        == "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
    )


def test_shell_command_environment_accepts_explicit_overrides(
    tmp_path, monkeypatch
) -> None:
    monkeypatch.delenv("FLOWENT_TOOL_VAR", raising=False)
    runner = SandboxRunner(cwd=tmp_path)
    monkeypatch.setattr(
        runner,
        "build_command",
        lambda command: SandboxCommand(command, seccomp_available=False),
    )

    result = runner.run(
        ["/bin/sh", "-c", "printf '%s' \"$FLOWENT_TOOL_VAR\""],
        env={"FLOWENT_TOOL_VAR": "explicit"},
    )

    assert result.exit_code == 0
    assert result.stdout == "explicit"


@pytest.mark.anyio
async def test_async_shell_command_does_not_block_other_tasks(
    tmp_path, monkeypatch
) -> None:
    runner = SandboxRunner(cwd=tmp_path)
    command = [
        "/bin/sh",
        "-c",
        "python - <<'PY'\nimport time\ntime.sleep(0.2)\nprint('done')\nPY",
    ]
    monkeypatch.setattr(
        runner,
        "build_command",
        lambda command: SandboxCommand(command, seccomp_available=False),
    )
    command_task = asyncio.create_task(runner.run_async(command, timeout_seconds=1))
    start = time.perf_counter()
    await asyncio.sleep(0.01)
    elapsed = time.perf_counter() - start
    result = await command_task

    assert elapsed < 0.1
    assert result.exit_code == 0
    assert "done" in result.stdout


@pytest.mark.anyio
async def test_async_shell_command_timeout_returns_failed_result(
    tmp_path, monkeypatch
) -> None:
    runner = SandboxRunner(cwd=tmp_path)
    command = [
        "/bin/sh",
        "-c",
        "python - <<'PY'\nimport time\ntime.sleep(1)\nprint('late')\nPY",
    ]
    monkeypatch.setattr(
        runner,
        "build_command",
        lambda command: SandboxCommand(command, seccomp_available=False),
    )
    result = await runner.run_async(
        command,
        timeout_seconds=0.05,
    )

    assert result.exit_code == 124
    assert "late" not in result.stdout


@pytest.mark.anyio
async def test_agent_stream_stops_after_cancelled_tool(tmp_path) -> None:
    cancelled = False

    async def fake_completion(**request: object) -> object:
        async def chunks() -> object:
            yield tool_call_chunk("shell_command", {"command": "slow"})

        return chunks()

    async def fake_runner(
        name: str, arguments: dict[str, object], context: ToolContext
    ):
        nonlocal cancelled
        try:
            await asyncio.sleep(10)
        except asyncio.CancelledError:
            cancelled = True
            raise

    stream = run_agent_stream(
        completion=fake_completion,
        connection=ProviderConnection(
            base_url=None,
            model="gpt-5.1",
            name="OpenAI",
            provider=ProviderFormat.OPENAI,
            secret_reference="sk-local",
        ),
        cwd=tmp_path,
        messages=[{"role": "user", "content": "Run it."}],
        tool_runner=fake_runner,
    )

    await stream.__anext__()
    await stream.__anext__()
    await stream.__anext__()
    await stream.__anext__()
    next_event = asyncio.create_task(stream.__anext__())
    await asyncio.sleep(0)
    next_event.cancel()
    with pytest.raises(asyncio.CancelledError):
        await next_event
    await stream.aclose()

    assert cancelled


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

    assert not result.ok or "-1" in tool_result_model_content(result)


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
    assert result.title == "Edited notes.txt"
    assert target.read_text() == "alpha\nready\n"


def test_apply_patch_added_file_title(tmp_path) -> None:
    patch = """*** Begin Patch
*** Add File: created.txt
+hello
*** End Patch
"""

    result = run_tool("apply_patch", {"patch": patch}, ToolContext(cwd=tmp_path))

    assert result.ok
    assert result.title == "Added created.txt"
    assert (tmp_path / "created.txt").read_text() == "hello\n"


def test_apply_patch_deleted_file_title(tmp_path) -> None:
    target = tmp_path / "old.txt"
    target.write_text("remove me\n")
    patch = """*** Begin Patch
*** Delete File: old.txt
*** End Patch
"""

    result = run_tool("apply_patch", {"patch": patch}, ToolContext(cwd=tmp_path))

    assert result.ok
    assert result.title == "Deleted old.txt"
    assert not target.exists()


def test_apply_patch_multiple_files_title(tmp_path) -> None:
    target = tmp_path / "notes.txt"
    target.write_text("alpha\nbeta\n")
    patch = """*** Begin Patch
*** Update File: notes.txt
@@
-beta
+ready
*** Add File: created.txt
+hello
*** End Patch
"""

    result = run_tool("apply_patch", {"patch": patch}, ToolContext(cwd=tmp_path))

    assert result.ok
    assert result.title == "Edited 2 files"
    assert target.read_text() == "alpha\nready\n"
    assert (tmp_path / "created.txt").read_text() == "hello\n"


def test_apply_patch_rejects_outside_workdir_file(tmp_path) -> None:
    outside = Path(__file__).resolve().parent / "outside-patch.txt"
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
        assert result.title == "Edit failed"
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
    assert result.title == "Edited files"
    assert calls
    assert calls[0][1:4] == ["-m", "flowent.cli", "apply-patch"]


def test_apply_patch_reports_patch_error_when_stderr_has_warning(
    tmp_path, monkeypatch
) -> None:
    def fake_run(self, command, **kwargs):
        from flowent.sandbox import CommandResult

        return CommandResult(
            command=" ".join(command),
            exit_code=1,
            stderr="RuntimeWarning: flowent.cli was already imported\n",
            stdout='{"error": "Patch context was not found."}\n',
        )

    monkeypatch.setattr(SandboxRunner, "run", fake_run)
    patch = """*** Begin Patch
*** Update File: notes.txt
@@
-missing
+ready
*** End Patch
"""

    result = run_tool("apply_patch", {"patch": patch}, ToolContext(cwd=tmp_path))

    assert not result.ok
    assert result.title == "Edit failed"
    assert tool_result_model_content(result) == "Patch context was not found."


def test_web_search_result_enters_tool_output(tmp_path) -> None:
    def fake_search(query: str):
        return [{"title": "Result", "url": "https://example.test", "snippet": query}]

    result = run_tool(
        "web_search",
        {"query": "release checklist"},
        ToolContext(cwd=tmp_path, web_searcher=fake_search),
    )

    assert result.ok
    assert "https://example.test" in tool_result_model_content(result)


def test_default_web_search_uses_flowent_user_agent(monkeypatch) -> None:
    captured_headers: dict[str, str | None] = {}

    class FakeResponse:
        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, traceback):
            return None

        def read(self) -> bytes:
            return b'<a class="result__a" href="https://example.test">Result</a>'

    def fake_urlopen(request, timeout: int):
        captured_headers["user_agent"] = request.get_header("User-agent")
        captured_headers["timeout"] = str(timeout)
        return FakeResponse()

    monkeypatch.setattr("urllib.request.urlopen", fake_urlopen)

    results = default_web_search("release checklist")

    assert captured_headers == {
        "timeout": "10",
        "user_agent": flowent_user_agent(),
    }
    assert results == [
        {"title": "Result", "url": "https://example.test", "snippet": ""}
    ]


def test_agent_continues_until_final_text_after_multiple_tool_rounds(
    tmp_path, monkeypatch
) -> None:
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path / "data"))
    workdir = tmp_path / "workdir"
    workdir.mkdir()
    (workdir / "notes.txt").write_text("Launch notes")
    monkeypatch.chdir(workdir)
    captured_requests: list[dict[str, object]] = []

    async def fake_completion(**request: object) -> object:
        captured_requests.append(request)

        async def chunks() -> object:
            if len(captured_requests) == 1:
                yield tool_call_chunk("list_dir", {"path": "."}, call_id="call-list")
            elif len(captured_requests) == 2:
                yield tool_call_chunk(
                    "read_file", {"path": "notes.txt"}, call_id="call-read"
                )
            else:
                yield text_chunk("The notes are ready.")

        return chunks()

    client = TestClient(
        create_app(serve_frontend=False, chat_completion=fake_completion)
    )
    configure_provider(client)

    response = client.post(
        "/api/workspace/respond",
        json={"content": "Inspect the workspace."},
    )

    assert response.status_code == 200
    events = stream_events(response.text)
    assert [event["event"] for event in events] == [
        "start",
        "output_start",
        "output_done",
        "tool_start",
        "tool_done",
        "output_start",
        "output_done",
        "tool_start",
        "tool_done",
        "output_start",
        "delta",
        "output_done",
        "done",
    ]
    assert len(captured_requests) == 3
    assert captured_requests[2]["messages"][-1] == {
        "role": "tool",
        "tool_call_id": "call-read",
        "content": "Launch notes",
    }
    assert events[-1]["data"]["message"]["content"] == "The notes are ready."


@pytest.mark.anyio
async def test_agent_logs_model_call_decisions_after_tool_rounds(
    tmp_path, caplog
) -> None:
    (tmp_path / "notes.txt").write_text("Launch notes")
    captured_requests: list[dict[str, object]] = []
    caplog.set_level(logging.INFO, logger="flowent.agent")

    async def fake_completion(**request: object) -> object:
        captured_requests.append(request)

        async def chunks() -> object:
            if len(captured_requests) == 1:
                yield tool_call_chunk("read_file", {"path": "notes.txt"})
            else:
                yield text_chunk("The notes are ready.")

        return chunks()

    events = [
        event
        async for event in run_agent_stream(
            completion=fake_completion,
            connection=ProviderConnection(
                model="gpt-5.1",
                name="Provider",
                provider=ProviderFormat.OPENAI,
                secret_reference="secret",
            ),
            cwd=tmp_path,
            messages=[{"role": "user", "content": "Inspect notes."}],
        )
    ]
    rendered_logs = "\n".join(record.getMessage() for record in caplog.records)

    assert events[-1].data["message"]["content"] == "The notes are ready."
    assert "Agent model call started" in rendered_logs
    assert "round=1" in rendered_logs
    assert "round=2" in rendered_logs
    assert "decision=run_tools" in rendered_logs
    assert "decision=final_response" in rendered_logs
    assert "Agent continuing after tools" in rendered_logs


@pytest.mark.anyio
async def test_agent_logs_model_call_failure_after_tool_result(
    tmp_path, caplog
) -> None:
    (tmp_path / "notes.txt").write_text("Launch notes")
    captured_requests: list[dict[str, object]] = []
    caplog.set_level(logging.INFO, logger="flowent.agent")

    async def fake_completion(**request: object) -> object:
        captured_requests.append(request)

        async def chunks() -> object:
            if len(captured_requests) == 1:
                yield tool_call_chunk("read_file", {"path": "notes.txt"})
                return
            raise RuntimeError("stream request failed")

        return chunks()

    with pytest.raises(RuntimeError, match="stream request failed"):
        [
            event
            async for event in run_agent_stream(
                completion=fake_completion,
                connection=ProviderConnection(
                    model="gpt-5.1",
                    name="Provider",
                    provider=ProviderFormat.OPENAI,
                    secret_reference="secret",
                ),
                cwd=tmp_path,
                messages=[{"role": "user", "content": "Inspect notes."}],
            )
        ]
    rendered_logs = "\n".join(record.getMessage() for record in caplog.records)

    assert len(captured_requests) == 7
    assert "Agent model call failed" in rendered_logs
    assert "round=2" in rendered_logs
    assert "chunk_count=0" in rendered_logs


@pytest.mark.anyio
async def test_agent_does_not_log_final_response_when_responses_stream_fails(
    tmp_path, caplog, fake_litellm_responses_transformer
) -> None:
    caplog.set_level(logging.INFO, logger="flowent.agent")

    async def fake_completion(**request: object) -> object:
        async def chunks() -> object:
            from litellm.completion_extras.litellm_responses_transformation.transformation import (
                OpenAiResponsesToChatCompletionStreamIterator,
            )

            yield text_chunk("Partial answer.")
            yield OpenAiResponsesToChatCompletionStreamIterator.translate_responses_chunk_to_openai_stream(
                {
                    "response": {
                        "error": {
                            "code": "upstream_error",
                            "message": "Upstream request failed",
                        },
                        "status": "failed",
                    },
                    "type": "response.failed",
                }
            )

        return chunks()

    with pytest.raises(RuntimeError, match="Upstream request failed"):
        [
            event
            async for event in run_agent_stream(
                completion=fake_completion,
                connection=ProviderConnection(
                    model="gpt-5.1",
                    name="Provider",
                    provider=ProviderFormat.OPENAI,
                    secret_reference="secret",
                ),
                cwd=tmp_path,
                messages=[{"role": "user", "content": "Inspect notes."}],
            )
        ]
    rendered_logs = "\n".join(record.getMessage() for record in caplog.records)

    assert "Agent model call failed" in rendered_logs
    assert "decision=final_response" not in rendered_logs


def test_agent_finishes_without_tools(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.chdir(tmp_path)
    captured_requests: list[dict[str, object]] = []

    async def fake_completion(**request: object) -> object:
        captured_requests.append(request)

        async def chunks() -> object:
            yield text_chunk("Direct answer.")

        return chunks()

    client = TestClient(
        create_app(serve_frontend=False, chat_completion=fake_completion)
    )
    configure_provider(client)

    response = client.post(
        "/api/workspace/respond",
        json={"content": "Answer directly."},
    )

    assert response.status_code == 200
    events = stream_events(response.text)
    assert [event["event"] for event in events] == [
        "start",
        "output_start",
        "delta",
        "output_done",
        "done",
    ]
    assert len(captured_requests) == 1
    assert events[-1]["data"]["message"]["content"] == "Direct answer."


def test_agent_streams_and_persists_thinking(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.chdir(tmp_path)

    async def fake_completion(**request: object) -> object:
        async def chunks() -> object:
            yield thinking_chunk("Checking context.")
            yield thinking_chunk(" Preparing answer.")
            yield text_chunk("Direct answer.")

        return chunks()

    client = TestClient(
        create_app(serve_frontend=False, chat_completion=fake_completion)
    )
    configure_provider(client)

    response = client.post(
        "/api/workspace/respond",
        json={"content": "Answer directly."},
    )

    assert response.status_code == 200
    events = stream_events(response.text)
    assert [event["event"] for event in events] == [
        "start",
        "output_start",
        "thinking_delta",
        "thinking_delta",
        "delta",
        "output_done",
        "done",
    ]
    assert events[2]["data"] == {"content": "Checking context."}
    assert events[-1]["data"]["message"]["thinking"] == (
        "Checking context. Preparing answer."
    )
    state = client.get("/api/state").json()
    assert state["messages"][-1]["thinking"] == ("Checking context. Preparing answer.")


def test_tool_failure_is_reported_and_agent_continues(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.chdir(tmp_path)
    captured_requests: list[dict[str, object]] = []

    async def fake_completion(**request: object) -> object:
        captured_requests.append(request)

        async def chunks() -> object:
            if len(captured_requests) == 1:
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
        json={"content": "Read it."},
    )

    events = stream_events(response.text)
    assert "tool_error" in [event["event"] for event in events]
    assert len(captured_requests) == 2
    assert captured_requests[1]["messages"][-1]["role"] == "tool"
    assert captured_requests[1]["messages"][-1]["tool_call_id"] == "call-1"
    assert "missing.txt" in captured_requests[1]["messages"][-1]["content"]
    assert events[-1]["data"]["message"]["content"] == "I could not read it."


@pytest.mark.anyio
async def test_approval_denial_result_is_sent_to_agent(tmp_path) -> None:
    captured_requests: list[dict[str, object]] = []

    async def fake_completion(**request: object) -> object:
        captured_requests.append(request)

        async def chunks() -> object:
            if len(captured_requests) == 1:
                yield tool_call_chunk(
                    "shell_command",
                    {"command": "rm -rf /important"},
                )
            else:
                yield text_chunk("I need explicit approval for that risk.")

        return chunks()

    async def denying_tool_runner(
        name: str,
        arguments: dict[str, object],
        context: ToolContext,
    ) -> ToolResult:
        return ToolResult(
            result=text_tool_result(
                "Automatic approval review denied this action as high risk: "
                "The command can delete broad data. The agent must not work around "
                "this denial.",
                approval={
                    "decision": "denied",
                    "evidence": [
                        {
                            "message": "The command targets /important.",
                            "why": "It can remove broad user data.",
                        }
                    ],
                    "reason": "The command can delete broad data.",
                    "reviewer_output": '{"risk_level":"high","risk_score":96}',
                    "risk_level": "high",
                    "risk_score": 96,
                    "write_paths": ["/important"],
                },
            ),
            ok=False,
            title="Denied by reviewer",
        )

    events = [
        event
        async for event in run_agent_stream(
            completion=fake_completion,
            connection=ProviderConnection(
                model="gpt-5.1",
                name="Provider",
                provider=ProviderFormat.OPENAI,
                secret_reference="secret",
            ),
            cwd=tmp_path,
            messages=[{"role": "user", "content": "Delete the important directory."}],
            tool_runner=denying_tool_runner,
        )
    ]

    assert len(captured_requests) == 2
    assert captured_requests[1]["messages"][-1]["role"] == "tool"
    assert "Automatic approval review denied this action" in str(
        captured_requests[1]["messages"][-1]["content"]
    )
    assert "must not work around" in str(
        captured_requests[1]["messages"][-1]["content"]
    )
    assert "Risk: high (96/100)" in str(captured_requests[1]["messages"][-1]["content"])
    assert "The command targets /important." in str(
        captured_requests[1]["messages"][-1]["content"]
    )
    assert '{"risk_level":"high","risk_score":96}' in str(
        captured_requests[1]["messages"][-1]["content"]
    )
    assert next(
        event.data["content"] for event in events if event.event == "delta"
    ) == ("I need explicit approval for that risk.")
    assert events[-1].data["message"]["content"] == (
        "I need explicit approval for that risk."
    )


def test_update_plan_outputs_plan_state(tmp_path) -> None:
    result = run_tool(
        "update_plan",
        {"items": [{"step": "Read files", "status": "completed"}]},
        ToolContext(cwd=tmp_path),
    )

    assert result.ok
    assert "Read files" in tool_result_model_content(result)
