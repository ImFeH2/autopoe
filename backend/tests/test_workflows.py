from fastapi.testclient import TestClient

from flowent.main import create_app


def input_output_workflow(workflow_id: str = "workflow-1") -> dict[str, object]:
    return {
        "created_at": 0,
        "definition": {
            "edges": [
                {
                    "id": "edge-input-output",
                    "label": "",
                    "source": "input",
                    "source_handle": "out",
                    "target": "output",
                    "target_handle": "in",
                }
            ],
            "nodes": [
                {
                    "data": {"default_value": "launch checklist"},
                    "description": "",
                    "id": "input",
                    "name": "Input",
                    "position": {"x": 0, "y": 0},
                    "type": "input",
                },
                {
                    "data": {"output_key": "final_result"},
                    "description": "",
                    "id": "output",
                    "name": "Output",
                    "position": {"x": 260, "y": 0},
                    "type": "output",
                },
            ],
            "version": 1,
        },
        "id": workflow_id,
        "name": "Launch Workflow",
        "updated_at": 0,
    }


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

    response = client.put("/api/workflows", json=input_output_workflow())

    assert response.status_code == 200
    state = client.get("/api/state").json()
    assert state["workflows"][0]["id"] == "workflow-1"
    assert state["workflows"][0]["definition"]["nodes"][0]["id"] == "input"


def test_workflow_save_rejects_invalid_edges(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path))
    client = TestClient(create_app(serve_frontend=False))
    workflow = input_output_workflow()
    workflow["definition"]["edges"][0]["target"] = "missing"

    response = client.put("/api/workflows", json=workflow)

    assert response.status_code == 400
    assert response.json()["detail"] == "Workflow edges must connect existing nodes."


def test_workflow_run_returns_output_node_result(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path))
    client = TestClient(create_app(serve_frontend=False))
    client.put("/api/workflows", json=input_output_workflow())

    response = client.post("/api/workflows/workflow-1/run")

    assert response.status_code == 200
    result = response.json()
    assert result["status"] == "success"
    assert result["outputs"] == {"final_result": "launch checklist"}
    assert [node["status"] for node in result["node_results"]] == [
        "success",
        "success",
    ]


def test_workflow_run_uses_agent_node_completion(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path))
    requests: list[dict[str, object]] = []

    async def fake_completion(**request: object) -> dict[str, object]:
        requests.append(dict(request))
        return {
            "choices": [
                {
                    "message": {
                        "content": "Draft, review, ship.",
                        "role": "assistant",
                    }
                }
            ]
        }

    client = TestClient(
        create_app(serve_frontend=False, chat_completion=fake_completion)
    )
    configure_provider(client)
    workflow = input_output_workflow()
    workflow["definition"]["nodes"].insert(
        1,
        {
            "data": {
                "agent": "Default agent",
                "prompt": "Create steps for {{input.output}}.",
            },
            "description": "",
            "id": "agent",
            "name": "Agent",
            "position": {"x": 260, "y": 0},
            "type": "agent",
        },
    )
    workflow["definition"]["nodes"][2]["position"] = {"x": 520, "y": 0}
    workflow["definition"]["edges"] = [
        {
            "id": "edge-input-agent",
            "label": "",
            "source": "input",
            "source_handle": "out",
            "target": "agent",
            "target_handle": "in",
        },
        {
            "id": "edge-agent-output",
            "label": "",
            "source": "agent",
            "source_handle": "out",
            "target": "output",
            "target_handle": "in",
        },
    ]
    client.put("/api/workflows", json=workflow)

    response = client.post("/api/workflows/workflow-1/run")

    assert response.status_code == 200
    assert response.json()["outputs"] == {"final_result": "Draft, review, ship."}
    assert requests[0]["messages"] == [
        {"content": "Create steps for launch checklist.", "role": "user"}
    ]
