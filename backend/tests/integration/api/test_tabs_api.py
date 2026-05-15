from copy import deepcopy
from typing import Any

import pytest
from fastapi.testclient import TestClient


def _create_agent_node(
    client: TestClient,
    *,
    tab_id: str,
    name: str,
    role_name: str = "Worker",
) -> dict[str, Any]:
    response = client.post(
        f"/api/workflows/{tab_id}/nodes",
        json={"role_name": role_name, "name": name},
    )
    assert response.status_code == 200
    return response.json()


def _create_graph_node(
    client: TestClient,
    *,
    tab_id: str,
    node_type: str,
    name: str,
    config: dict[str, object] | None = None,
) -> dict[str, Any]:
    response = client.post(
        f"/api/workflows/{tab_id}/nodes",
        json={
            "node_type": node_type,
            "name": name,
            "config": config or {},
        },
    )
    assert response.status_code == 200
    return response.json()


def test_list_tabs_is_empty_at_startup(client: TestClient):
    response = client.get("/api/workflows")

    assert response.status_code == 200
    assert response.json() == {"workflows": []}


def test_create_tab_node_and_edge_round_trip(client: TestClient):
    create_tab_response = client.post(
        "/api/workflows",
        json={
            "title": "Review Task",
            "allow_network": True,
            "write_dirs": ["/tmp"],
        },
    )

    assert create_tab_response.status_code == 200
    tab = create_tab_response.json()
    tab_id = tab["id"]
    assert tab["title"] == "Review Task"
    assert "goal" not in tab
    assert tab["node_count"] == 0
    assert tab["edge_count"] == 0
    assert "activation_state" not in tab
    assert tab["allow_network"] is True
    assert tab["write_dirs"] == ["/tmp"]
    assert tab["definition"] == {"version": 1, "nodes": [], "edges": []}
    assert isinstance(tab["leader_id"], str)

    reader = _create_agent_node(client, tab_id=tab_id, name="Reader")
    writer = _create_agent_node(client, tab_id=tab_id, name="Writer")

    assert reader["workflow_id"] == tab_id
    assert writer["workflow_id"] == tab_id
    assert reader["node_type"] == "agent"
    assert writer["node_type"] == "agent"
    assert reader["config"]["role_name"] == "Worker"
    assert writer["config"]["role_name"] == "Worker"
    assert "write_dirs" not in reader["config"]
    assert "allow_network" not in reader["config"]

    removed_permission_response = client.post(
        f"/api/workflows/{tab_id}/nodes",
        json={
            "role_name": "Worker",
            "write_dirs": ["/tmp"],
        },
    )
    assert removed_permission_response.status_code == 422

    edge_response = client.post(
        f"/api/workflows/{tab_id}/edges",
        json={
            "from_node_id": reader["id"],
            "from_port_key": "out",
            "to_node_id": writer["id"],
            "to_port_key": "in",
        },
    )

    assert edge_response.status_code == 200
    edge = edge_response.json()
    assert edge["tab_id"] == tab_id
    assert edge["from_node_id"] == reader["id"]
    assert edge["from_port_key"] == "out"
    assert edge["to_node_id"] == writer["id"]
    assert edge["to_port_key"] == "in"

    tab_detail_response = client.get(f"/api/workflows/{tab_id}")
    assert tab_detail_response.status_code == 200
    tab_detail = tab_detail_response.json()
    assert tab_detail["workflow"]["id"] == tab_id
    assert "goal" not in tab_detail["workflow"]
    assert "activation_state" not in tab_detail["workflow"]
    assert tab_detail["workflow"]["allow_network"] is True
    assert tab_detail["workflow"]["write_dirs"] == ["/tmp"]
    assert tab_detail["workflow"]["node_count"] == 2
    assert tab_detail["workflow"]["edge_count"] == 1
    assert {node["name"] for node in tab_detail["nodes"]} == {"Reader", "Writer"}
    assert tab_detail["edges"] == [edge]
    assert len(tab_detail["workflow"]["definition"]["nodes"]) == 2
    assert tab_detail["workflow"]["definition"]["edges"] == [edge]

    nodes_response = client.get("/api/nodes")
    assert nodes_response.status_code == 200
    nodes = nodes_response.json()["nodes"]
    reader_node = next(node for node in nodes if node["id"] == reader["id"])
    writer_node = next(node for node in nodes if node["id"] == writer["id"])
    assert reader_node["workflow_id"] == tab_id
    assert writer_node["workflow_id"] == tab_id
    assert reader_node["connections"] == [writer["id"]]
    assert writer_node["connections"] == [reader["id"]]


def test_delete_tab_cleans_up_nodes_and_edges(client: TestClient):
    create_tab_response = client.post(
        "/api/workflows",
        json={"title": "Disposable"},
    )

    assert create_tab_response.status_code == 200
    created_tab = create_tab_response.json()
    tab_id = created_tab["id"]
    leader_id = created_tab["leader_id"]

    left = _create_agent_node(client, tab_id=tab_id, name="Left")
    right = _create_agent_node(client, tab_id=tab_id, name="Right")

    edge_response = client.post(
        f"/api/workflows/{tab_id}/edges",
        json={"from_node_id": left["id"], "to_node_id": right["id"]},
    )
    assert edge_response.status_code == 200
    edge_id = edge_response.json()["id"]

    delete_response = client.delete(f"/api/workflows/{tab_id}")

    assert delete_response.status_code == 200
    assert delete_response.json()["id"] == tab_id
    assert set(delete_response.json()["removed_node_ids"]) == {
        leader_id,
        left["id"],
        right["id"],
    }
    assert delete_response.json()["removed_edge_ids"] == [edge_id]

    tab_detail_response = client.get(f"/api/workflows/{tab_id}")
    assert tab_detail_response.status_code == 404

    nodes_response = client.get("/api/nodes")
    assert nodes_response.status_code == 200
    node_ids = {node["id"] for node in nodes_response.json()["nodes"]}
    assert left["id"] not in node_ids
    assert right["id"] not in node_ids


def test_delete_tab_edge_requires_exact_direction_and_removes_only_target_edge(
    client: TestClient,
):
    tab = client.post(
        "/api/workflows",
        json={"title": "Edge Delete"},
    ).json()
    tab_id = tab["id"]

    left = _create_agent_node(client, tab_id=tab_id, name="Left")
    middle = _create_agent_node(client, tab_id=tab_id, name="Middle")
    right = _create_agent_node(client, tab_id=tab_id, name="Right")

    left_to_middle = client.post(
        f"/api/workflows/{tab_id}/edges",
        json={"from_node_id": left["id"], "to_node_id": middle["id"]},
    )
    middle_to_right = client.post(
        f"/api/workflows/{tab_id}/edges",
        json={"from_node_id": middle["id"], "to_node_id": right["id"]},
    )

    assert left_to_middle.status_code == 200
    assert middle_to_right.status_code == 200

    reverse_delete_response = client.delete(
        f"/api/workflows/{tab_id}/edges",
        params={
            "from_node_id": middle["id"],
            "to_node_id": left["id"],
        },
    )
    assert reverse_delete_response.status_code == 404
    assert reverse_delete_response.json()["detail"] == "Edge not found"

    delete_response = client.delete(
        f"/api/workflows/{tab_id}/edges",
        params={
            "from_node_id": left["id"],
            "to_node_id": middle["id"],
        },
    )

    assert delete_response.status_code == 200
    assert delete_response.json()["from_node_id"] == left["id"]
    assert delete_response.json()["to_node_id"] == middle["id"]

    detail = client.get(f"/api/workflows/{tab_id}").json()
    remaining_edges = {
        (edge["from_node_id"], edge["to_node_id"]) for edge in detail["edges"]
    }
    assert remaining_edges == {(middle["id"], right["id"])}


def test_delete_tab_node_removes_node_and_all_incident_edges(client: TestClient):
    tab = client.post(
        "/api/workflows",
        json={"title": "Node Delete"},
    ).json()
    tab_id = tab["id"]

    left = _create_agent_node(client, tab_id=tab_id, name="Left")
    middle = _create_agent_node(client, tab_id=tab_id, name="Middle")
    right = _create_agent_node(client, tab_id=tab_id, name="Right")

    assert (
        client.post(
            f"/api/workflows/{tab_id}/edges",
            json={"from_node_id": left["id"], "to_node_id": middle["id"]},
        ).status_code
        == 200
    )
    assert (
        client.post(
            f"/api/workflows/{tab_id}/edges",
            json={"from_node_id": middle["id"], "to_node_id": right["id"]},
        ).status_code
        == 200
    )

    delete_response = client.delete(f"/api/workflows/{tab_id}/nodes/{middle['id']}")

    assert delete_response.status_code == 200
    assert delete_response.json()["id"] == middle["id"]

    detail = client.get(f"/api/workflows/{tab_id}").json()
    remaining_nodes = {node["id"] for node in detail["nodes"]}
    assert middle["id"] not in remaining_nodes
    assert left["id"] in remaining_nodes
    assert right["id"] in remaining_nodes
    assert detail["edges"] == []


def test_tab_edge_creation_enforces_directed_ports_and_single_input(
    client: TestClient,
):
    tab = client.post(
        "/api/workflows",
        json={"title": "Edge Validation"},
    ).json()
    tab_id = tab["id"]
    worker = _create_agent_node(client, tab_id=tab_id, name="Worker")
    reviewer = _create_agent_node(client, tab_id=tab_id, name="Reviewer")
    observer = _create_agent_node(client, tab_id=tab_id, name="Observer")

    self_loop_response = client.post(
        f"/api/workflows/{tab_id}/edges",
        json={"from_node_id": worker["id"], "to_node_id": worker["id"]},
    )
    assert self_loop_response.status_code == 400
    assert self_loop_response.json()["detail"] == "Self-loop edges are not allowed"

    first_edge_response = client.post(
        f"/api/workflows/{tab_id}/edges",
        json={"from_node_id": worker["id"], "to_node_id": reviewer["id"]},
    )
    assert first_edge_response.status_code == 200

    duplicate_edge_response = client.post(
        f"/api/workflows/{tab_id}/edges",
        json={"from_node_id": worker["id"], "to_node_id": reviewer["id"]},
    )
    assert duplicate_edge_response.status_code == 400
    assert duplicate_edge_response.json()["detail"] == "Duplicate edges are not allowed"

    reverse_edge_response = client.post(
        f"/api/workflows/{tab_id}/edges",
        json={"from_node_id": reviewer["id"], "to_node_id": worker["id"]},
    )
    assert reverse_edge_response.status_code == 200

    conflicting_input_response = client.post(
        f"/api/workflows/{tab_id}/edges",
        json={"from_node_id": observer["id"], "to_node_id": reviewer["id"]},
    )
    assert conflicting_input_response.status_code == 400
    assert (
        conflicting_input_response.json()["detail"]
        == "Input port 'in' already has an incoming edge"
    )


def test_update_tab_definition_updates_metadata_and_positions(client: TestClient):
    tab = client.post(
        "/api/workflows",
        json={"title": "JSON Editor"},
    ).json()
    tab_id = tab["id"]

    agent_node = _create_agent_node(client, tab_id=tab_id, name="Draft Reviewer")
    code_node = _create_graph_node(
        client,
        tab_id=tab_id,
        node_type="code",
        name="Formatter",
    )

    current = client.get(f"/api/workflows/{tab_id}").json()["workflow"]["definition"]
    definition = deepcopy(current)
    for node in definition["nodes"]:
        if node["id"] == agent_node["id"]:
            node["config"]["name"] = "Final Reviewer"
        if node["id"] == code_node["id"]:
            node["config"]["name"] = "Formatter"
            node["config"]["runtime"] = "python"
            node["config"]["source"] = "outputs = {'out': inputs['in']}"
    definition["view"] = {
        "positions": {
            agent_node["id"]: {"x": 60, "y": 80},
            code_node["id"]: {"x": 260, "y": 80},
        }
    }
    definition["edges"] = [
        {
            "id": "edge-control",
            "from_node_id": agent_node["id"],
            "from_port_key": "out",
            "to_node_id": code_node["id"],
            "to_port_key": "in",
        }
    ]

    update_response = client.put(
        f"/api/workflows/{tab_id}/definition",
        json={"definition": definition},
    )

    assert update_response.status_code == 200
    updated = update_response.json()
    assert updated["definition"]["view"]["positions"][agent_node["id"]] == {
        "x": 60.0,
        "y": 80.0,
    }
    assert "kind" not in updated["definition"]["edges"][0]

    detail = client.get(f"/api/workflows/{tab_id}").json()
    reviewer_detail = next(
        node for node in detail["nodes"] if node["id"] == agent_node["id"]
    )
    formatter_detail = next(
        node for node in detail["nodes"] if node["id"] == code_node["id"]
    )
    assert reviewer_detail["name"] == "Final Reviewer"
    assert reviewer_detail["position"] == {"x": 60.0, "y": 80.0}
    assert formatter_detail["config"]["runtime"] == "python"
    assert formatter_detail["position"] == {"x": 260.0, "y": 80.0}

    runtime_node = client.get(f"/api/nodes/{agent_node['id']}")
    assert runtime_node.status_code == 200
    assert runtime_node.json()["name"] == "Final Reviewer"


def test_update_tab_definition_rejects_invalid_node_config(client: TestClient):
    tab = client.post(
        "/api/workflows",
        json={"title": "Config Guard"},
    ).json()
    trigger = _create_graph_node(
        client,
        tab_id=tab["id"],
        node_type="trigger",
        name="Trigger",
    )
    definition = deepcopy(
        client.get(f"/api/workflows/{tab['id']}").json()["workflow"]["definition"]
    )
    for node in definition["nodes"]:
        if node["id"] == trigger["id"]:
            node["config"]["kind"] = "webhook"

    response = client.put(
        f"/api/workflows/{tab['id']}/definition",
        json={"definition": definition},
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "trigger kind must be manual or cron"


def test_update_tab_definition_rejects_agent_set_changes(client: TestClient):
    tab = client.post(
        "/api/workflows",
        json={"title": "Guard Rails"},
    ).json()
    tab_id = tab["id"]

    agent_node = _create_agent_node(client, tab_id=tab_id, name="Existing Worker")
    definition = deepcopy(
        client.get(f"/api/workflows/{tab_id}").json()["workflow"]["definition"]
    )
    definition["nodes"].append(
        {
            "id": "new-agent",
            "type": "agent",
            "config": {"role_name": "Worker", "name": "Injected Worker"},
            "inputs": [
                {
                    "key": "in",
                    "direction": "in",
                    "type": "parts",
                    "required": False,
                    "multiple": False,
                }
            ],
            "outputs": [
                {
                    "key": "out",
                    "direction": "out",
                    "type": "parts",
                    "required": False,
                    "multiple": True,
                }
            ],
        }
    )

    response = client.put(
        f"/api/workflows/{tab_id}/definition",
        json={"definition": definition},
    )

    assert response.status_code == 400
    assert response.json()["detail"] == (
        "Agent nodes must be created or deleted through workflow node APIs"
    )
    untouched = client.get(f"/api/nodes/{agent_node['id']}")
    assert untouched.status_code == 200


def test_agent_only_workflow_is_available_without_trigger(client: TestClient):
    tab = client.post("/api/workflows", json={"title": "Collaborative"}).json()
    worker = _create_agent_node(client, tab_id=tab["id"], name="Worker")

    detail = client.get(f"/api/workflows/{tab['id']}").json()
    assert "activation_state" not in detail["workflow"]
    assert detail["nodes"][0]["id"] == worker["id"]


def test_manual_trigger_workflow_is_available_after_creation(client: TestClient):
    tab = client.post("/api/workflows", json={"title": "Manual"}).json()
    trigger = _create_graph_node(
        client,
        tab_id=tab["id"],
        node_type="trigger",
        name="Manual start",
        config={"kind": "manual", "output_type": "string", "message": "Run"},
    )

    detail = client.get(f"/api/workflows/{tab['id']}").json()
    assert "activation_state" not in detail["workflow"]
    assert detail["nodes"][0]["id"] == trigger["id"]


def test_workflow_allows_graph_and_json_edits(
    client: TestClient,
):
    tab = client.post("/api/workflows", json={"title": "Editable"}).json()
    trigger = _create_graph_node(
        client,
        tab_id=tab["id"],
        node_type="trigger",
        name="Manual start",
        config={"kind": "manual", "output_type": "string", "message": "Run"},
    )

    create_response = client.post(
        f"/api/workflows/{tab['id']}/nodes",
        json={"node_type": "trigger", "config": {"kind": "manual"}},
    )
    assert create_response.status_code == 200

    definition = deepcopy(
        client.get(f"/api/workflows/{tab['id']}").json()["workflow"]["definition"]
    )
    definition["nodes"][0]["config"]["message"] = "Changed"
    semantic_response = client.put(
        f"/api/workflows/{tab['id']}/definition",
        json={"definition": definition},
    )
    assert semantic_response.status_code == 200
    assert "activation_state" not in semantic_response.json()
    assert semantic_response.json()["definition"]["nodes"][0]["config"]["message"] == (
        "Changed"
    )

    view_definition = deepcopy(
        client.get(f"/api/workflows/{tab['id']}").json()["workflow"]["definition"]
    )
    view_definition["view"] = {"positions": {trigger["id"]: {"x": 12, "y": 24}}}
    view_response = client.put(
        f"/api/workflows/{tab['id']}/definition",
        json={"definition": view_definition},
    )
    assert view_response.status_code == 200
    assert "activation_state" not in view_response.json()
    assert view_response.json()["definition"]["view"]["positions"][trigger["id"]] == {
        "x": 12.0,
        "y": 24.0,
    }


@pytest.mark.parametrize("active_state", ["running", "sleeping"])
def test_delete_workflow_requests_active_nodes_to_stop(
    active_state: str,
    monkeypatch,
    client: TestClient,
):
    from flowent.models import AgentState
    from flowent.registry import registry

    tab = client.post("/api/workflows", json={"title": "Delete Running"}).json()
    trigger = _create_graph_node(
        client,
        tab_id=tab["id"],
        node_type="trigger",
        name="Manual start",
        config={
            "kind": "manual",
            "output_type": "parts",
            "message": [{"type": "text", "text": "Run"}],
        },
    )
    worker = _create_agent_node(client, tab_id=tab["id"], name="Worker")
    assert (
        client.post(
            f"/api/workflows/{tab['id']}/edges",
            json={"from_node_id": trigger["id"], "to_node_id": worker["id"]},
        ).status_code
        == 200
    )
    live_worker = registry.get(worker["id"])
    assert live_worker is not None
    live_worker.set_state(AgentState(active_state), "test")
    interrupted: list[str] = []

    def fake_request_interrupt() -> bool:
        interrupted.append(live_worker.uuid)
        live_worker.set_state(AgentState.IDLE, "interrupted")
        return True

    monkeypatch.setattr(live_worker, "request_interrupt", fake_request_interrupt)

    response = client.delete(f"/api/workflows/{tab['id']}")

    assert response.status_code == 200
    assert response.json()["id"] == tab["id"]
    assert interrupted == [worker["id"]]


def test_delete_workflow_keeps_records_when_active_node_does_not_stop(
    monkeypatch,
    client: TestClient,
):
    from flowent.models import AgentState
    from flowent.registry import registry
    from flowent.workspace_store import workspace_store

    tab = client.post("/api/workflows", json={"title": "Delete Timeout"}).json()
    worker = _create_agent_node(client, tab_id=tab["id"], name="Worker")
    live_worker = registry.get(worker["id"])
    assert live_worker is not None
    live_worker.set_state(AgentState.SLEEPING, "test")
    interrupted: list[str] = []

    def fake_request_interrupt() -> bool:
        interrupted.append(live_worker.uuid)
        return True

    monkeypatch.setattr(live_worker, "request_interrupt", fake_request_interrupt)
    monkeypatch.setattr(live_worker, "wait_until_idle", lambda timeout=None: False)

    response = client.delete(f"/api/workflows/{tab['id']}")

    assert response.status_code == 400
    assert "some nodes did not stop" in response.json()["detail"]
    assert interrupted == [worker["id"]]
    assert workspace_store.get_tab(tab["id"]) is not None
    assert workspace_store.get_node_record(worker["id"]) is not None


def test_workflow_detail_tolerates_existing_invalid_port_connection(
    client: TestClient,
):
    from flowent.models import GraphEdge
    from flowent.workspace_store import workspace_store

    provider = client.post(
        "/api/providers",
        json={
            "name": "Primary",
            "type": "openai_compatible",
            "base_url": "https://api.example.com",
            "models": [{"model": "gpt-5", "structured_output": True}],
        },
    ).json()
    tab = client.post("/api/workflows", json={"title": "Typed"}).json()
    trigger = _create_graph_node(
        client,
        tab_id=tab["id"],
        node_type="trigger",
        name="Text trigger",
        config={"kind": "manual", "output_type": "string", "message": "Run"},
    )
    llm = _create_graph_node(
        client,
        tab_id=tab["id"],
        node_type="llm",
        name="JSON reader",
        config={
            "model": {"provider_id": provider["id"], "model": "gpt-5"},
            "system_prompt": "Read input.",
            "temperature": 0,
            "max_output_tokens": 100,
            "stop_sequences": [],
            "response_format": {"kind": "text"},
            "input_type": "json",
            "output_type": "string",
        },
    )
    stored_tab = workspace_store.get_tab(tab["id"])
    assert stored_tab is not None
    stored_tab.definition.edges.append(
        GraphEdge(
            id="invalid-edge",
            tab_id=tab["id"],
            from_node_id=trigger["id"],
            from_port_key="out",
            to_node_id=llm["id"],
            to_port_key="in",
        )
    )
    workspace_store.upsert_tab(stored_tab)

    detail = client.get(f"/api/workflows/{tab['id']}").json()
    assert detail["workflow"]["id"] == tab["id"]
    assert "activation_state" not in detail["workflow"]


def test_save_definition_validates_llm_model_capabilities(client: TestClient):
    provider = client.post(
        "/api/providers",
        json={
            "name": "Primary",
            "type": "openai_compatible",
            "base_url": "https://api.example.com",
            "models": [{"model": "gpt-5", "structured_output": False}],
        },
    ).json()
    tab = client.post("/api/workflows", json={"title": "Structured Save"}).json()
    response = client.post(
        f"/api/workflows/{tab['id']}/nodes",
        json={
            "node_type": "llm",
            "name": "JSON writer",
            "config": {
                "model": {"provider_id": provider["id"], "model": "gpt-5"},
                "system_prompt": "Return JSON.",
                "temperature": 0,
                "max_output_tokens": 100,
                "stop_sequences": [],
                "response_format": {
                    "kind": "json_schema",
                    "schema": {"type": "object"},
                },
                "input_type": "json",
                "output_type": "json",
            },
        },
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "llm model does not support structured_output"


def test_workflow_detail_does_not_validate_existing_llm_model_capabilities(
    client: TestClient,
):
    provider = client.post(
        "/api/providers",
        json={
            "name": "Primary",
            "type": "openai_compatible",
            "base_url": "https://api.example.com",
            "models": [{"model": "gpt-5", "structured_output": False}],
        },
    ).json()
    tab = client.post("/api/workflows", json={"title": "Structured"}).json()
    llm_response = client.post(
        f"/api/workflows/{tab['id']}/nodes",
        json={
            "node_type": "llm",
            "name": "JSON writer",
            "config": {
                "model": {"provider_id": provider["id"], "model": "gpt-5"},
                "system_prompt": "Return JSON.",
                "temperature": 0,
                "max_output_tokens": 100,
                "stop_sequences": [],
                "response_format": {"kind": "text"},
                "input_type": "json",
                "output_type": "string",
            },
        },
    )
    assert llm_response.status_code == 200
    llm = llm_response.json()
    from flowent.workspace_store import workspace_store

    stored_tab = workspace_store.get_tab(tab["id"])
    assert stored_tab is not None
    stored_node = stored_tab.definition.get_node(llm["id"])
    assert stored_node is not None
    stored_node.config["response_format"] = {
        "kind": "json_schema",
        "schema": {"type": "object"},
    }
    stored_node.config["output_type"] = "json"
    workspace_store.upsert_tab(stored_tab)

    detail = client.get(f"/api/workflows/{tab['id']}").json()

    assert detail["workflow"]["id"] == tab["id"]
    assert "activation_state" not in detail["workflow"]
