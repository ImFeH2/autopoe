from fastapi.testclient import TestClient

from flowent.main import create_app


def single_input_node_workflow() -> dict[str, object]:
    return {
        "id": "workflow-draft",
        "name": "Draft Workflow",
        "spec": {
            "connections": [],
            "nodes": [
                {
                    "config": {"default_value": "", "input_type": "text"},
                    "id": "input",
                    "kind": "input",
                }
            ],
        },
        "presentation": {
            "connections": {},
            "nodes": {
                "input": {
                    "description": "",
                    "name": "Input",
                    "position": {"x": 0, "y": 0},
                }
            },
        },
    }


def test_workflow_save_keeps_single_node_draft(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path))
    client = TestClient(create_app(serve_frontend=False))

    response = client.put(
        "/api/workflows",
        json={"base_revision": None, "workflow": single_input_node_workflow()},
    )

    assert response.status_code == 200
    state = client.get("/api/state").json()
    assert state["workflows"][0]["id"] == "workflow-draft"
    assert state["workflows"][0]["spec"]["nodes"][0]["id"] == "input"
    assert state["workflows"][0]["active_revision"] is None


def test_workflow_run_still_requires_complete_saved_draft(
    tmp_path, monkeypatch
) -> None:
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path))
    client = TestClient(create_app(serve_frontend=False))
    client.put(
        "/api/workflows",
        json={"base_revision": None, "workflow": single_input_node_workflow()},
    )

    response = client.post("/api/workflows/workflow-draft/run")

    assert response.status_code == 400
    assert response.json()["detail"] == "Workflow is not ready to run."
