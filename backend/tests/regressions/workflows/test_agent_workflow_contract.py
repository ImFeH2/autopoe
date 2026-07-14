from __future__ import annotations

import json
from copy import deepcopy
from uuid import UUID

import pytest

from flowent.main import create_app
from flowent.tool_protocol import tool_result_model_content
from flowent.workflow_tools import WorkflowAgentTools, workflow_tool_specs


def agent_workflow() -> dict[str, object]:
    return {
        "name": "Launch Workflow",
        "nodes": [
            {
                "id": "source",
                "name": "Source",
                "description": "Collect the launch checklist.",
                "kind": "input",
                "config": {
                    "default_value": "launch checklist",
                    "input_type": "text",
                },
            },
            {
                "id": "result",
                "name": "Result",
                "description": "Return the checklist.",
                "kind": "output",
                "config": {"output_key": "final_result", "transform": ""},
            },
        ],
        "connections": [
            {
                "id": "source-to-result",
                "label": "",
                "from": {"node_id": "source", "port": "output"},
                "to": {"node_id": "result", "port": "input"},
            }
        ],
    }


def saved_connections() -> list[dict[str, object]]:
    return [
        {
            "id": "source-to-result",
            "from": {"node_id": "source", "port": "output"},
            "to": {"node_id": "result", "port": "input"},
        }
    ]


def workflow_tool_parameters(name: str) -> dict[str, object]:
    return next(
        item["function"]["parameters"]
        for item in workflow_tool_specs()
        if item["function"]["name"] == name
    )


def nested_dicts(value: object):
    if isinstance(value, dict):
        yield value
        for item in value.values():
            yield from nested_dicts(item)
    elif isinstance(value, list):
        for item in value:
            yield from nested_dicts(item)


def property_schemas(
    schemas: list[dict[str, object]], property_name: str
) -> list[dict[str, object]]:
    return [
        properties[property_name]
        for schema in schemas
        if isinstance((properties := schema.get("properties")), dict)
        and isinstance(properties.get(property_name), dict)
    ]


def test_agent_is_given_the_strict_semantic_workflow_contract() -> None:
    create_parameters = workflow_tool_parameters("create_workflow")
    workflow_schema = create_parameters["properties"]["workflow"]

    assert workflow_schema["additionalProperties"] is False
    assert set(workflow_schema["required"]) == {"name", "nodes", "connections"}
    assert set(workflow_schema["properties"]) == {"name", "nodes", "connections"}

    schemas = list(nested_dicts(workflow_schema))
    port_values = {
        value
        for schema in property_schemas(schemas, "port")
        for value in schema.get("enum", [])
        if isinstance(value, str)
    }
    node_kinds = {
        value
        for schema in property_schemas(schemas, "kind")
        for value in [schema.get("const")]
        if isinstance(value, str)
    }
    assert {"input", "output"}.issubset(port_values)
    assert {"input", "agent", "merge", "code", "timer", "output"}.issubset(node_kinds)
    assert "in" not in port_values
    assert "out" not in port_values
    node_items = workflow_schema["properties"]["nodes"]["items"]
    assert set(node_items["discriminator"]["mapping"]) == node_kinds
    assert len(node_items["oneOf"]) == 6
    definitions = workflow_schema["$defs"]
    assert set(definitions["WorkflowInputNodeConfig"]["properties"]) == {
        "default_value",
        "input_type",
    }
    assert set(definitions["WorkflowCodeNodeConfig"]["properties"]) == {"code"}
    assert definitions["WorkflowInputNodeConfig"]["additionalProperties"] is False
    assert set(definitions["WorkflowToolConnection"]["required"]) == {
        "from",
        "to",
    }


@pytest.mark.anyio
async def test_agent_can_update_a_workflow_from_the_read_result(
    tmp_path, monkeypatch
) -> None:
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path / "data"))
    app = create_app(serve_frontend=False)

    async with app.router.lifespan_context(app):
        service = app.state.workflow_service
        tools = WorkflowAgentTools(service)
        created = await tools.run_tool(
            "create_workflow", {"workflow": agent_workflow()}
        )
        assert created is not None and created.ok is True
        workflow_id = created.result["workflow"]["id"]

        read = await tools.run_tool("get_workflow", {"workflow_id": workflow_id})
        assert read is not None and read.ok is True
        update_payload = json.loads(tool_result_model_content(read))
        update_payload["workflow"]["nodes"][0]["name"] = "Updated Source"

        updated = await tools.run_tool("update_workflow", update_payload)
        stored = service.get_workflow(workflow_id)

    assert updated is not None and updated.ok is True
    assert update_payload["base_revision"] == 1
    assert stored.revision == 2
    assert stored.presentation.nodes["source"].name == "Updated Source"


@pytest.mark.anyio
async def test_agent_can_create_connections_without_display_metadata(
    tmp_path, monkeypatch
) -> None:
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path / "data"))
    app = create_app(serve_frontend=False)
    workflow = agent_workflow()
    workflow["connections"][0].pop("id")
    workflow["connections"][0].pop("label")

    async with app.router.lifespan_context(app):
        service = app.state.workflow_service
        result = await WorkflowAgentTools(service).run_tool(
            "create_workflow", {"workflow": workflow}
        )
        stored = service.list_workflows()

    assert result is not None and result.ok is True
    assert len(stored[0].spec.connections) == 1
    assert stored[0].spec.connections[0].id
    assert (
        stored[0].presentation.connections[stored[0].spec.connections[0].id].label == ""
    )


@pytest.mark.anyio
async def test_agent_receives_structured_run_trace(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path / "data"))
    app = create_app(serve_frontend=False)

    async with app.router.lifespan_context(app):
        tools = WorkflowAgentTools(app.state.workflow_service)
        created = await tools.run_tool(
            "create_workflow", {"workflow": agent_workflow()}
        )
        assert created is not None and created.ok is True
        workflow_id = created.result["workflow"]["id"]
        run = await tools.run_tool("run_workflow", {"workflow_id": workflow_id})

    assert run is not None and run.ok is True
    trace = json.loads(tool_result_model_content(run))
    assert trace["run_id"]
    assert trace["workflow_revision"] == 1
    assert trace["node_results"][1]["inputs"] == ["launch checklist"]
    assert trace["node_results"][1]["error"] is None


@pytest.mark.anyio
async def test_agent_receives_latest_workflow_after_an_update_conflict(
    tmp_path, monkeypatch
) -> None:
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path / "data"))
    app = create_app(serve_frontend=False)

    async with app.router.lifespan_context(app):
        service = app.state.workflow_service
        tools = WorkflowAgentTools(service)
        created = await tools.run_tool(
            "create_workflow", {"workflow": agent_workflow()}
        )
        assert created is not None and created.ok is True
        workflow_id = created.result["workflow"]["id"]
        changed = deepcopy(agent_workflow())
        changed["nodes"][0]["name"] = "New Source"
        first_update = await tools.run_tool(
            "update_workflow",
            {
                "workflow_id": workflow_id,
                "base_revision": 1,
                "workflow": changed,
            },
        )
        assert first_update is not None and first_update.ok is True

        conflict = await tools.run_tool(
            "update_workflow",
            {
                "workflow_id": workflow_id,
                "base_revision": 1,
                "workflow": agent_workflow(),
            },
        )
        assert conflict is not None and conflict.ok is False
        retry_payload = json.loads(tool_result_model_content(conflict))
        retry_payload["workflow"]["nodes"][1]["name"] = "New Result"
        retried = await tools.run_tool("update_workflow", retry_payload)
        stored = service.get_workflow(workflow_id)

    assert retried is not None and retried.ok is True
    assert retry_payload["base_revision"] == 2
    assert stored.revision == 3
    assert stored.presentation.nodes["source"].name == "New Source"
    assert stored.presentation.nodes["result"].name == "New Result"


@pytest.mark.anyio
async def test_agent_cannot_create_a_workflow_with_an_unknown_node_setting(
    tmp_path, monkeypatch
) -> None:
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path / "data"))
    app = create_app(serve_frontend=False)
    workflow = agent_workflow()
    workflow["nodes"][0]["config"]["unexpected"] = True

    async with app.router.lifespan_context(app):
        service = app.state.workflow_service
        result = await WorkflowAgentTools(service).run_tool(
            "create_workflow", {"workflow": workflow}
        )

        assert result is not None
        assert result.ok is False
        assert "source" in result.result["text"].lower()
        assert "unexpected" in result.result["text"].lower()
        assert service.list_workflows() == []


@pytest.mark.anyio
@pytest.mark.parametrize(
    ("source_port", "target_port", "invalid_port", "node_id"),
    [
        ("out", "input", "out", "source"),
        ("output", "in", "in", "result"),
    ],
)
async def test_agent_cannot_replace_canonical_connections_with_canvas_aliases(
    tmp_path,
    monkeypatch,
    source_port: str,
    target_port: str,
    invalid_port: str,
    node_id: str,
) -> None:
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path / "data"))
    app = create_app(serve_frontend=False)

    async with app.router.lifespan_context(app):
        service = app.state.workflow_service
        tools = WorkflowAgentTools(service)
        created = await tools.run_tool(
            "create_workflow", {"workflow": agent_workflow()}
        )
        assert created is not None and created.ok is True
        saved_workflow = created.result["workflow"]
        workflow_id = saved_workflow["id"]
        base_revision = saved_workflow["revision"]
        changed = deepcopy(agent_workflow())
        changed["connections"][0]["from"]["port"] = source_port
        changed["connections"][0]["to"]["port"] = target_port

        result = await tools.run_tool(
            "update_workflow",
            {
                "workflow_id": workflow_id,
                "base_revision": base_revision,
                "workflow": changed,
            },
        )
        stored = service.get_workflow(workflow_id).model_dump(mode="json")

    assert result is not None
    assert result.ok is False
    assert invalid_port in result.result["text"].lower()
    assert node_id in result.result["text"].lower()
    assert stored["revision"] == base_revision
    assert stored["spec"]["connections"] == saved_connections()
    assert stored["presentation"]["connections"]["source-to-result"]["label"] == ""


@pytest.mark.anyio
async def test_agent_created_connections_are_saved_and_run_with_canonical_ports(
    tmp_path, monkeypatch
) -> None:
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path / "data"))
    app = create_app(serve_frontend=False)

    async with app.router.lifespan_context(app):
        service = app.state.workflow_service
        tools = WorkflowAgentTools(service)
        created = await tools.run_tool(
            "create_workflow", {"workflow": agent_workflow()}
        )
        assert created is not None and created.ok is True
        saved_workflow = created.result["workflow"]
        workflow_id = saved_workflow["id"]
        run = await tools.run_tool("run_workflow", {"workflow_id": workflow_id})
        stored = service.get_workflow(workflow_id).model_dump(mode="json")

    UUID(workflow_id)
    assert stored["spec"]["connections"] == saved_connections()
    assert stored["presentation"]["connections"]["source-to-result"]["label"] == ""
    assert run is not None and run.ok is True
    assert run.result["outputs"] == {"final_result": "launch checklist"}
