import json

from fastapi.testclient import TestClient

from flowent.main import create_app
from flowent.sandbox import CommandResult


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


def workflow_node(
    node_id: str,
    kind: str,
    config: dict[str, object],
    *,
    name: str | None = None,
    x: float = 0,
    y: float = 0,
) -> tuple[dict[str, object], dict[str, object]]:
    return (
        {"id": node_id, "kind": kind, "config": config},
        {
            "name": name or node_id.replace("-", " ").title(),
            "description": "",
            "position": {"x": x, "y": y},
        },
    )


def workflow_connection(
    connection_id: str, source: str, target: str
) -> tuple[dict[str, object], dict[str, str]]:
    return (
        {
            "id": connection_id,
            "from": {"node_id": source, "port": "output"},
            "to": {"node_id": target, "port": "input"},
        },
        {"label": ""},
    )


def workflow_payload(
    nodes: list[tuple[dict[str, object], dict[str, object]]],
    connections: list[tuple[dict[str, object], dict[str, str]]],
    *,
    name: str = "Launch Workflow",
    workflow_id: str = "workflow-1",
) -> dict[str, object]:
    return {
        "id": workflow_id,
        "name": name,
        "spec": {
            "nodes": [node for node, _ in nodes],
            "connections": [connection for connection, _ in connections],
        },
        "presentation": {
            "nodes": {node["id"]: presentation for node, presentation in nodes},
            "connections": {
                connection["id"]: presentation
                for connection, presentation in connections
            },
        },
    }


def input_output_workflow(workflow_id: str = "workflow-1") -> dict[str, object]:
    return workflow_payload(
        [
            workflow_node(
                "input",
                "input",
                {"default_value": "launch checklist", "input_type": "text"},
                name="Input",
            ),
            workflow_node(
                "output",
                "output",
                {"output_key": "final_result", "transform": ""},
                name="Output",
                x=260,
            ),
        ],
        [workflow_connection("edge-input-output", "input", "output")],
        workflow_id=workflow_id,
    )


def agent_workflow(prompt: str) -> dict[str, object]:
    return workflow_payload(
        [
            workflow_node(
                "input",
                "input",
                {"default_value": "launch checklist", "input_type": "text"},
                name="Input",
            ),
            workflow_node(
                "agent",
                "agent",
                {"agent": "Default agent", "prompt": prompt},
                name="Agent",
                x=260,
            ),
            workflow_node(
                "output",
                "output",
                {"output_key": "final_result", "transform": ""},
                name="Output",
                x=520,
            ),
        ],
        [
            workflow_connection("edge-input-agent", "input", "agent"),
            workflow_connection("edge-agent-output", "agent", "output"),
        ],
    )


def code_workflow(code: str) -> dict[str, object]:
    return workflow_payload(
        [
            workflow_node(
                "input",
                "input",
                {"default_value": "launch checklist", "input_type": "text"},
                name="Input",
            ),
            workflow_node("code", "code", {"code": code}, name="Code", x=260),
            workflow_node(
                "output",
                "output",
                {"output_key": "final_result", "transform": ""},
                name="Output",
                x=520,
            ),
        ],
        [
            workflow_connection("edge-input-code", "input", "code"),
            workflow_connection("edge-code-output", "code", "output"),
        ],
    )


def save_workflow(
    client: TestClient,
    workflow: dict[str, object],
    *,
    base_revision: int | None = None,
):
    return client.put(
        "/api/workflows",
        json={"base_revision": base_revision, "workflow": workflow},
    )


def configure_provider(client: TestClient) -> None:
    client.post(
        "/api/providers",
        json={
            "api_key": "sk-local",
            "base_url": "https://api.example.test/v1",
            "id": "provider-openai",
            "models": ["gpt-5.1"],
            "name": "OpenAI",
            "type": "openai",
        },
    )
    client.put(
        "/api/settings",
        json={
            "agent_prompt": "",
            "context_window_limit": None,
            "reasoning_effort": "default",
            "selected_model": "gpt-5.1",
            "selected_provider_id": "provider-openai",
        },
    )


def test_workflow_persists_in_app_state(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path))
    client = TestClient(create_app(serve_frontend=False))

    response = save_workflow(client, input_output_workflow())

    assert response.status_code == 200
    state = client.get("/api/state").json()
    assert state["workflows"][0]["id"] == "workflow-1"
    assert state["workflows"][0]["spec"]["nodes"][0]["id"] == "input"
    assert state["workflows"][0]["revision"] == 1
    assert state["workflows"][0]["active_revision"] == 1


def test_workflow_save_rejects_invalid_connections(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path))
    client = TestClient(create_app(serve_frontend=False))
    workflow = input_output_workflow()
    workflow["spec"]["connections"][0]["to"]["node_id"] = "missing"

    response = save_workflow(client, workflow)

    assert response.status_code == 400
    assert response.json()["detail"] == (
        "Connection edge-input-output must connect existing nodes."
    )


def test_delete_missing_workflow_remains_idempotent(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path))
    client = TestClient(create_app(serve_frontend=False))

    response = client.delete("/api/workflows/missing")

    assert response.status_code == 200
    assert response.json() == {"ok": True}


def test_workflow_run_returns_output_node_result(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path))
    client = TestClient(create_app(serve_frontend=False))
    save_workflow(client, input_output_workflow())

    response = client.post("/api/workflows/workflow-1/run")

    assert response.status_code == 200
    result = response.json()
    assert result["status"] == "success"
    assert result["outputs"] == {"final_result": "launch checklist"}
    assert result["workflow_revision"] == 1
    assert [node["status"] for node in result["node_results"]] == [
        "success",
        "success",
    ]


def test_workflow_run_accepts_multiple_input_values(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path))
    client = TestClient(create_app(serve_frontend=False))
    workflow = workflow_payload(
        [
            workflow_node(
                "input",
                "input",
                {"default_value": "launch checklist", "input_type": "text"},
            ),
            workflow_node(
                "input-window",
                "input",
                {"default_value": "default window", "input_type": "text"},
                name="Window",
                y=120,
            ),
            workflow_node("merge", "merge", {"merge_strategy": "text"}, x=260),
            workflow_node(
                "output",
                "output",
                {"output_key": "final_result", "transform": ""},
                x=520,
            ),
        ],
        [
            workflow_connection("edge-input-merge", "input", "merge"),
            workflow_connection("edge-window-merge", "input-window", "merge"),
            workflow_connection("edge-merge-output", "merge", "output"),
        ],
    )
    save_workflow(client, workflow)

    response = client.post(
        "/api/workflows/workflow-1/run",
        json={"inputs": {"input": "release blockers"}},
    )

    assert response.status_code == 200
    assert response.json()["outputs"] == {
        "final_result": "release blockers\ndefault window"
    }


def test_workflow_run_returns_multiple_output_nodes(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path))
    client = TestClient(create_app(serve_frontend=False))
    workflow = workflow_payload(
        [
            workflow_node(
                "input",
                "input",
                {"default_value": "launch checklist", "input_type": "text"},
            ),
            workflow_node(
                "output",
                "output",
                {"output_key": "final_result", "transform": ""},
                x=260,
            ),
            workflow_node(
                "output-summary",
                "output",
                {"output_key": "summary", "transform": ""},
                name="Summary",
                x=260,
                y=120,
            ),
        ],
        [
            workflow_connection("edge-input-output", "input", "output"),
            workflow_connection("edge-input-summary", "input", "output-summary"),
        ],
    )
    save_workflow(client, workflow)

    response = client.post("/api/workflows/workflow-1/run")

    assert response.status_code == 200
    assert response.json()["outputs"] == {
        "final_result": "launch checklist",
        "summary": "launch checklist",
    }


def timer_workflow() -> dict[str, object]:
    return workflow_payload(
        [
            workflow_node(
                "timer",
                "timer",
                {
                    "cron": "",
                    "interval_seconds": 5,
                    "mode": "interval",
                    "payload": "tick",
                },
            ),
            workflow_node(
                "output",
                "output",
                {"output_key": "final_result", "transform": ""},
                x=260,
            ),
        ],
        [workflow_connection("edge-timer-output", "timer", "output")],
        name="Timer Workflow",
    )


def test_workflow_run_accepts_timer_node_without_input(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path))
    client = TestClient(create_app(serve_frontend=False))
    save_workflow(client, timer_workflow())

    response = client.post("/api/workflows/workflow-1/run")

    assert response.status_code == 200
    assert response.json()["outputs"] == {"final_result": "tick"}


def test_workflow_run_rejects_internal_timer_selector(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path))
    client = TestClient(create_app(serve_frontend=False))
    save_workflow(client, timer_workflow())

    response = client.post("/api/workflows/workflow-1/run", json={"timer_id": "timer"})

    assert response.status_code == 422


def test_workflow_run_accepts_input_override(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path))
    client = TestClient(create_app(serve_frontend=False))
    save_workflow(client, input_output_workflow())

    response = client.post(
        "/api/workflows/workflow-1/run", json={"input": "release blockers"}
    )

    assert response.status_code == 200
    assert response.json()["outputs"] == {"final_result": "release blockers"}


def test_workflow_run_uses_agent_node_runtime(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path))
    requests: list[dict[str, object]] = []

    async def fake_completion(**request: object) -> object:
        requests.append(dict(request))

        async def chunks() -> object:
            yield text_chunk("Draft, review, ship.")

        return chunks()

    client = TestClient(
        create_app(serve_frontend=False, chat_completion=fake_completion)
    )
    configure_provider(client)
    save_workflow(client, agent_workflow("Create steps for {{input.output}}."))

    response = client.post("/api/workflows/workflow-1/run")

    assert response.status_code == 200
    assert response.json()["outputs"] == {"final_result": "Draft, review, ship."}
    assert requests[0]["stream"] is True
    assert requests[0]["messages"][-1] == {
        "content": "Create steps for launch checklist.",
        "role": "user",
    }
    assert requests[0]["tools"]


def test_workflow_agent_node_continues_after_tool_result(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path / "data"))
    workdir = tmp_path / "workdir"
    workdir.mkdir()
    (workdir / "notes.txt").write_text("Launch notes")
    requests: list[dict[str, object]] = []

    async def fake_completion(**request: object) -> object:
        requests.append(dict(request))

        async def chunks() -> object:
            if len(requests) == 1:
                yield tool_call_chunk(
                    "read_file", {"path": "notes.txt"}, call_id="call-read"
                )
            else:
                yield text_chunk("The notes say: Launch notes.")

        return chunks()

    client = TestClient(
        create_app(
            serve_frontend=False,
            chat_completion=fake_completion,
            workdir=workdir,
        )
    )
    configure_provider(client)
    save_workflow(
        client,
        agent_workflow("Read notes.txt and summarize {{input.output}}."),
    )

    response = client.post("/api/workflows/workflow-1/run")

    assert response.status_code == 200
    assert response.json()["outputs"] == {
        "final_result": "The notes say: Launch notes."
    }
    assert len(requests) == 2
    assert requests[1]["messages"][-1] == {
        "role": "tool",
        "tool_call_id": "call-read",
        "content": "Launch notes",
    }


def test_workflow_agent_node_reuses_its_own_history(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path / "data"))
    workdir = tmp_path / "workdir"
    workdir.mkdir()
    (workdir / "notes.txt").write_text("Launch notes")
    requests: list[dict[str, object]] = []

    async def fake_completion(**request: object) -> object:
        requests.append(dict(request))

        async def chunks() -> object:
            if len(requests) == 1:
                yield tool_call_chunk(
                    "read_file", {"path": "notes.txt"}, call_id="call-read"
                )
            elif len(requests) == 2:
                yield text_chunk("First summary.")
            else:
                yield text_chunk("Second summary.")

        return chunks()

    client = TestClient(
        create_app(
            serve_frontend=False,
            chat_completion=fake_completion,
            workdir=workdir,
        )
    )
    configure_provider(client)
    save_workflow(
        client,
        agent_workflow("Read notes.txt and summarize {{input.output}}."),
    )

    first_response = client.post(
        "/api/workflows/workflow-1/run", json={"input": "first launch"}
    )
    second_response = client.post(
        "/api/workflows/workflow-1/run", json={"input": "second launch"}
    )

    assert first_response.json()["outputs"] == {"final_result": "First summary."}
    assert second_response.json()["outputs"] == {"final_result": "Second summary."}
    second_run_messages = requests[2]["messages"]
    assert second_run_messages[-2] == {
        "role": "assistant",
        "content": "First summary.",
    }
    assert second_run_messages[-1] == {
        "role": "user",
        "content": "Read notes.txt and summarize second launch.",
    }


def test_workflow_agent_node_cannot_call_workflow_recursively(
    tmp_path, monkeypatch
) -> None:
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path))
    requests: list[dict[str, object]] = []

    async def fake_completion(**request: object) -> object:
        requests.append(dict(request))

        async def chunks() -> object:
            if len(requests) < 5:
                yield tool_call_chunk(
                    "run_workflow", {"workflow_id": "workflow-1"}, call_id="call-run"
                )
            else:
                yield text_chunk("Nested workflow stopped.")

        return chunks()

    client = TestClient(
        create_app(serve_frontend=False, chat_completion=fake_completion)
    )
    configure_provider(client)
    save_workflow(client, agent_workflow("Run this workflow again."))

    response = client.post("/api/workflows/workflow-1/run")

    assert response.status_code == 200
    assert response.json()["outputs"] == {"final_result": "Nested workflow stopped."}
    assert any(
        request["messages"][-1]["content"] == "Workflow nesting is too deep."
        for request in requests
    )


def test_workflow_run_uses_code_node_python_output(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path))
    requests: list[dict[str, object]] = []

    async def fake_run_async(self, command, **kwargs):
        requests.append({"command": command, **kwargs})
        return CommandResult(
            command=" ".join(command),
            exit_code=0,
            stderr="",
            stdout="LAUNCH CHECKLIST",
        )

    monkeypatch.setattr("flowent.sandbox.SandboxRunner.run_async", fake_run_async)
    client = TestClient(create_app(serve_frontend=False))
    save_workflow(client, code_workflow("output = input.upper()"))

    response = client.post("/api/workflows/workflow-1/run")

    assert response.status_code == 200
    result = response.json()
    assert result["outputs"] == {"final_result": "LAUNCH CHECKLIST"}
    assert [node["status"] for node in result["node_results"]] == [
        "success",
        "success",
        "success",
    ]
    assert requests[0]["command"][1:3] == ["-I", "-c"]
    assert '"code": "output = input.upper()"' in requests[0]["input_text"]
    assert '"input": "launch checklist"' in requests[0]["input_text"]


def test_workflow_run_reports_structured_code_node_failure(
    tmp_path, monkeypatch
) -> None:
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path))

    async def fake_run_async(self, command, **kwargs):
        return CommandResult(
            command=" ".join(command),
            exit_code=1,
            stderr="NameError: name 'missing' is not defined",
            stdout="",
        )

    monkeypatch.setattr("flowent.sandbox.SandboxRunner.run_async", fake_run_async)
    client = TestClient(create_app(serve_frontend=False))
    save_workflow(client, code_workflow("output = missing"))

    response = client.post("/api/workflows/workflow-1/run")

    assert response.status_code == 200
    result = response.json()
    assert result["status"] == "failed"
    assert result["outputs"] == {}
    assert result["node_results"][1] == {
        "error": {
            "code": "node_execution_failed",
            "message": "NameError: name 'missing' is not defined",
        },
        "id": "code",
        "inputs": ["launch checklist"],
        "output": "",
        "status": "failed",
    }
