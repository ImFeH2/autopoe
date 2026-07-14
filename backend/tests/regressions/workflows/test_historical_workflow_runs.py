from __future__ import annotations

import json
from copy import deepcopy

import pytest

from flowent.main import create_app
from flowent.tool_protocol import tool_result_model_content
from flowent.workflow_tools import WorkflowAgentTools, workflow_tool_specs


def agent_workflow() -> dict[str, object]:
    return {
        "name": "Historical Run Workflow",
        "nodes": [
            {
                "id": "source",
                "name": "Source",
                "description": "Collect the saved value.",
                "kind": "input",
                "config": {
                    "default_value": "original value",
                    "input_type": "text",
                },
            },
            {
                "id": "result",
                "name": "Result",
                "description": "Return the saved value.",
                "kind": "output",
                "config": {"output_key": "result", "transform": ""},
            },
        ],
        "connections": [
            {
                "from": {"node_id": "source", "port": "output"},
                "to": {"node_id": "result", "port": "input"},
            }
        ],
    }


def test_agent_has_a_strict_workflow_run_reader() -> None:
    specification = next(
        item
        for item in workflow_tool_specs()
        if item["function"]["name"] == "get_workflow_run"
    )

    assert specification["function"]["parameters"] == {
        "type": "object",
        "properties": {"run_id": {"type": "string"}},
        "required": ["run_id"],
        "additionalProperties": False,
    }


@pytest.mark.anyio
async def test_agent_reads_the_trace_and_immutable_revision_for_a_run(
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

        completed = await tools.run_tool(
            "run_workflow",
            {"workflow_id": workflow_id, "input": "first run input"},
        )
        assert completed is not None and completed.ok is True
        run_id = completed.result["run_id"]

        stored_run = service.workflow_repository.read_workflow_run(run_id)
        assert stored_run is not None
        assert stored_run.inputs.model_dump(mode="json") == {
            "default_input": "first run input",
            "values": {},
        }

        changed = deepcopy(agent_workflow())
        changed["nodes"][0]["config"]["default_value"] = "changed later"
        updated = await tools.run_tool(
            "update_workflow",
            {
                "workflow_id": workflow_id,
                "base_revision": 1,
                "workflow": changed,
            },
        )
        assert updated is not None and updated.ok is True

        historical = await tools.run_tool("get_workflow_run", {"run_id": run_id})
        current = service.get_workflow(workflow_id)

    assert historical is not None and historical.ok is True
    payload = json.loads(tool_result_model_content(historical))
    assert payload["type"] == "workflow_run_read"
    assert payload["trace"]["run_id"] == run_id
    assert payload["trace"]["workflow_revision"] == 1
    assert payload["trace"]["inputs"] == {
        "default_input": "first run input",
        "values": {},
    }
    assert payload["trace"]["node_results"][1]["inputs"] == ["first run input"]
    assert payload["workflow_revision"]["workflow_id"] == workflow_id
    assert payload["workflow_revision"]["revision"] == 1
    assert payload["workflow_revision"]["spec"]["nodes"][0]["config"] == {
        "default_value": "original value",
        "input_type": "text",
    }
    assert current.revision == 2
    assert current.spec.nodes[0].config.default_value == "changed later"


@pytest.mark.anyio
async def test_agent_reports_a_missing_workflow_run(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path / "data"))
    app = create_app(serve_frontend=False)

    async with app.router.lifespan_context(app):
        result = await WorkflowAgentTools(app.state.workflow_service).run_tool(
            "get_workflow_run", {"run_id": "missing-run"}
        )

    assert result is not None
    assert result.ok is False
    assert result.result["text"] == "Workflow run not found."
    assert result.title == "Reading workflow run"
