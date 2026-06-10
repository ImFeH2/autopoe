from fastapi.testclient import TestClient

from flowent.main import create_app


def single_input_node_workflow() -> dict[str, object]:
    return {
        "created_at": 0,
        "definition": {
            "edges": [],
            "nodes": [
                {
                    "data": {"default_value": "", "input_type": "text"},
                    "description": "",
                    "id": "input",
                    "name": "Input",
                    "position": {"x": 0, "y": 0},
                    "type": "input",
                }
            ],
            "version": 1,
        },
        "id": "workflow-draft",
        "name": "Draft Workflow",
        "updated_at": 0,
    }


def test_workflow_save_keeps_single_node_draft(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path))
    client = TestClient(create_app(serve_frontend=False))

    response = client.put("/api/workflows", json=single_input_node_workflow())

    assert response.status_code == 200
    state = client.get("/api/state").json()
    assert state["workflows"][0]["id"] == "workflow-draft"
    assert state["workflows"][0]["definition"]["nodes"][0]["id"] == "input"


def test_workflow_run_still_requires_complete_saved_draft(
    tmp_path, monkeypatch
) -> None:
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path))
    client = TestClient(create_app(serve_frontend=False))
    client.put("/api/workflows", json=single_input_node_workflow())

    response = client.post("/api/workflows/workflow-draft/run")

    assert response.status_code == 400
    assert response.json()["detail"] == "Workflow needs an output node."
