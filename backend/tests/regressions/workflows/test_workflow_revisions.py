from __future__ import annotations

import asyncio
import copy
from collections.abc import Callable
from pathlib import Path

import httpx
import pytest

from flowent.main import create_app
from flowent.sandbox import CommandResult


def timer_workflow(
    *,
    payload: str = "active payload",
    code: str | None = None,
    workflow_id: str = "workflow-revisions",
) -> dict[str, object]:
    nodes: list[dict[str, object]] = [
        {
            "id": "timer",
            "kind": "timer",
            "config": {
                "interval_seconds": 1,
                "mode": "interval",
                "payload": payload,
            },
        }
    ]
    presentation_nodes: dict[str, object] = {
        "timer": {
            "name": "Timer",
            "description": "",
            "position": {"x": 0, "y": 0},
        }
    }
    connections: list[dict[str, object]] = []
    presentation_connections: dict[str, object] = {}
    previous_node_id = "timer"
    previous_x = 0
    if code is not None:
        nodes.append({"id": "code", "kind": "code", "config": {"code": code}})
        presentation_nodes["code"] = {
            "name": "Code",
            "description": "",
            "position": {"x": 260, "y": 0},
        }
        connections.append(
            {
                "id": "timer-code",
                "from": {"node_id": "timer", "port": "output"},
                "to": {"node_id": "code", "port": "input"},
            }
        )
        presentation_connections["timer-code"] = {"label": ""}
        previous_node_id = "code"
        previous_x = 260
    nodes.append({"id": "output", "kind": "output", "config": {"output_key": "result"}})
    presentation_nodes["output"] = {
        "name": "Output",
        "description": "",
        "position": {"x": previous_x + 260, "y": 0},
    }
    final_connection_id = f"{previous_node_id}-output"
    connections.append(
        {
            "id": final_connection_id,
            "from": {"node_id": previous_node_id, "port": "output"},
            "to": {"node_id": "output", "port": "input"},
        }
    )
    presentation_connections[final_connection_id] = {"label": ""}
    return {
        "id": workflow_id,
        "name": "Revision Workflow",
        "spec": {"nodes": nodes, "connections": connections},
        "presentation": {
            "nodes": presentation_nodes,
            "connections": presentation_connections,
        },
    }


def input_output_workflow(
    default_value: str, *, workflow_id: str = "workflow-conflict"
) -> dict[str, object]:
    return {
        "id": workflow_id,
        "name": "Conflict Workflow",
        "spec": {
            "nodes": [
                {
                    "id": "input",
                    "kind": "input",
                    "config": {"default_value": default_value, "input_type": "text"},
                },
                {
                    "id": "output",
                    "kind": "output",
                    "config": {"output_key": "result"},
                },
            ],
            "connections": [
                {
                    "id": "input-output",
                    "from": {"node_id": "input", "port": "output"},
                    "to": {"node_id": "output", "port": "input"},
                }
            ],
        },
        "presentation": {
            "nodes": {
                "input": {
                    "name": "Input",
                    "description": "",
                    "position": {"x": 0, "y": 0},
                },
                "output": {
                    "name": "Output",
                    "description": "",
                    "position": {"x": 260, "y": 0},
                },
            },
            "connections": {"input-output": {"label": ""}},
        },
    }


def save_body(
    workflow: dict[str, object], *, base_revision: int | None
) -> dict[str, object]:
    return {"base_revision": base_revision, "workflow": workflow}


async def save_workflow(
    client: httpx.AsyncClient,
    workflow: dict[str, object],
    *,
    base_revision: int | None,
) -> dict[str, object]:
    response = await client.put(
        "/api/workflows",
        json=save_body(workflow, base_revision=base_revision),
    )
    assert response.status_code == 200, response.text
    return response.json()


async def wait_for_schedule(
    client: httpx.AsyncClient,
    workflow_id: str,
    predicate: Callable[[dict[str, object]], bool],
    *,
    timeout: float = 4,
) -> dict[str, object]:
    async def poll() -> dict[str, object]:
        while True:
            response = await client.get(f"/api/workflows/{workflow_id}/schedule")
            assert response.status_code == 200
            schedule = response.json()
            if predicate(schedule):
                return schedule
            await asyncio.sleep(0.02)

    return await asyncio.wait_for(poll(), timeout=timeout)


def schedule_has_new_result(
    previous_run_id: str,
) -> Callable[[dict[str, object]], bool]:
    def predicate(schedule: dict[str, object]) -> bool:
        result = schedule.get("last_result")
        if not isinstance(result, dict):
            return False
        run_id = result.get("run_id")
        return isinstance(run_id, str) and run_id != previous_run_id

    return predicate


def schedule_has_result(schedule: dict[str, object]) -> bool:
    result = schedule.get("last_result")
    return isinstance(result, dict) and isinstance(result.get("run_id"), str)


@pytest.mark.anyio
async def test_invalid_draft_does_not_replace_active_scheduled_revision(
    tmp_path: Path, monkeypatch
) -> None:
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path / "data"))
    app = create_app(serve_frontend=False)
    async with (
        app.router.lifespan_context(app),
        httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://testserver"
        ) as client,
    ):
        workflow = timer_workflow()
        created = await save_workflow(client, workflow, base_revision=None)
        assert created["revision"] == 1
        assert created["active_revision"] == 1
        start = await client.post(
            "/api/workflows/workflow-revisions/schedule/start", json={}
        )
        assert start.status_code == 200
        first = await wait_for_schedule(
            client,
            "workflow-revisions",
            schedule_has_result,
        )
        first_result = first["last_result"]
        assert isinstance(first_result, dict)

        incomplete = copy.deepcopy(workflow)
        incomplete["spec"]["nodes"] = [incomplete["spec"]["nodes"][0]]
        incomplete["spec"]["connections"] = []
        incomplete["presentation"]["nodes"] = {
            "timer": incomplete["presentation"]["nodes"]["timer"]
        }
        incomplete["presentation"]["connections"] = {}
        saved_draft = await save_workflow(client, incomplete, base_revision=1)
        assert saved_draft["revision"] == 2
        assert saved_draft["active_revision"] == 1

        second = await wait_for_schedule(
            client,
            "workflow-revisions",
            schedule_has_new_result(str(first_result["run_id"])),
        )

    assert second["status"] == "scheduled"
    assert second["last_result"]["workflow_revision"] == 1
    assert second["last_result"]["outputs"] == {"result": "active payload"}


@pytest.mark.anyio
async def test_valid_draft_becomes_the_next_scheduled_revision(
    tmp_path: Path, monkeypatch
) -> None:
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path / "data"))
    app = create_app(serve_frontend=False)
    async with (
        app.router.lifespan_context(app),
        httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://testserver"
        ) as client,
    ):
        workflow = timer_workflow(payload="first payload")
        created = await save_workflow(client, workflow, base_revision=None)
        assert created["active_revision"] == 1
        start = await client.post(
            "/api/workflows/workflow-revisions/schedule/start", json={}
        )
        assert start.status_code == 200
        first = await wait_for_schedule(
            client,
            "workflow-revisions",
            schedule_has_result,
        )
        first_result = first["last_result"]
        assert isinstance(first_result, dict)

        updated = copy.deepcopy(workflow)
        updated["spec"]["nodes"][0]["config"]["payload"] = "second payload"
        saved = await save_workflow(client, updated, base_revision=1)
        assert saved["revision"] == 2
        assert saved["active_revision"] == 2
        second = await wait_for_schedule(
            client,
            "workflow-revisions",
            schedule_has_new_result(str(first_result["run_id"])),
        )

    assert second["status"] == "scheduled"
    assert second["last_result"]["workflow_revision"] == 2
    assert second["last_result"]["outputs"] == {"result": "second payload"}


@pytest.mark.anyio
async def test_presentation_only_draft_revision_runs_its_active_spec(
    tmp_path: Path, monkeypatch
) -> None:
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path / "data"))
    app = create_app(serve_frontend=False)
    async with (
        app.router.lifespan_context(app),
        httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://testserver"
        ) as client,
    ):
        workflow = input_output_workflow("ready", workflow_id="presentation-run")
        created = await save_workflow(client, workflow, base_revision=None)
        assert created["revision"] == 1
        assert created["active_revision"] == 1

        moved = copy.deepcopy(workflow)
        moved["presentation"]["nodes"]["input"]["position"] = {"x": 120, "y": 40}
        saved = await save_workflow(client, moved, base_revision=1)
        assert saved["revision"] == 2
        assert saved["active_revision"] == 1

        response = await client.post(
            "/api/workflows/presentation-run/run",
            json={"workflow_revision": 2},
        )

    assert response.status_code == 200, response.text
    assert response.json()["workflow_revision"] == 1
    assert response.json()["outputs"] == {"result": "ready"}


@pytest.mark.anyio
async def test_stale_base_revision_is_rejected_without_overwriting_latest_draft(
    tmp_path: Path, monkeypatch
) -> None:
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path / "data"))
    app = create_app(serve_frontend=False)
    async with (
        app.router.lifespan_context(app),
        httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://testserver"
        ) as client,
    ):
        original = input_output_workflow("original")
        created = await save_workflow(client, original, base_revision=None)
        assert created["revision"] == 1

        latest = input_output_workflow("latest")
        saved = await save_workflow(client, latest, base_revision=1)
        assert saved["revision"] == 2

        stale = input_output_workflow("stale")
        conflict = await client.put(
            "/api/workflows",
            json=save_body(stale, base_revision=1),
        )
        run = await client.post("/api/workflows/workflow-conflict/run")

    assert conflict.status_code == 409
    assert conflict.json()["workflow"]["revision"] == 2
    assert conflict.json()["workflow"]["spec"] == saved["spec"]
    assert run.status_code == 200
    assert run.json()["workflow_revision"] == 2
    assert run.json()["outputs"] == {"result": "latest"}


def assert_failed_code_trace(trace: dict[str, object], revision: int) -> None:
    assert isinstance(trace["run_id"], str)
    assert trace["run_id"]
    assert trace["workflow_revision"] == revision
    code_result = next(
        result for result in trace["node_results"] if result["id"] == "code"
    )
    assert code_result["inputs"] == ["scheduled input"]
    assert isinstance(code_result["error"], dict)
    assert code_result["error"]["code"]
    assert code_result["error"]["message"] == "RuntimeError: scheduled failure"


@pytest.mark.anyio
async def test_manual_and_scheduled_traces_keep_the_executed_revision_and_node_inputs(
    tmp_path: Path, monkeypatch
) -> None:
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path / "data"))

    async def fail_code(self, command, **kwargs):
        return CommandResult(
            command=" ".join(command),
            exit_code=1,
            stderr="RuntimeError: scheduled failure",
            stdout="",
        )

    monkeypatch.setattr("flowent.sandbox.SandboxRunner.run_async", fail_code)
    app = create_app(serve_frontend=False)
    async with (
        app.router.lifespan_context(app),
        httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://testserver"
        ) as client,
    ):
        workflow = timer_workflow(
            payload="scheduled input", code="raise RuntimeError('scheduled failure')"
        )
        created = await save_workflow(client, workflow, base_revision=None)
        assert created["active_revision"] == 1

        manual_response = await client.post("/api/workflows/workflow-revisions/run")
        assert manual_response.status_code == 200
        manual_trace = manual_response.json()
        assert_failed_code_trace(manual_trace, 1)

        start = await client.post(
            "/api/workflows/workflow-revisions/schedule/start", json={}
        )
        assert start.status_code == 200
        failed_schedule = await wait_for_schedule(
            client,
            "workflow-revisions",
            lambda schedule: schedule.get("status") == "error",
        )
        scheduled_trace = failed_schedule["last_result"]
        assert isinstance(scheduled_trace, dict)
        assert_failed_code_trace(scheduled_trace, 1)
        assert scheduled_trace["run_id"] != manual_trace["run_id"]

        repaired = copy.deepcopy(workflow)
        repaired["spec"]["nodes"][1]["config"]["code"] = "output = input"
        saved = await save_workflow(client, repaired, base_revision=1)
        assert saved["active_revision"] == 2
        retained = (
            await client.get("/api/workflows/workflow-revisions/schedule")
        ).json()

    assert retained["last_result"]["run_id"] == scheduled_trace["run_id"]
    assert retained["last_result"]["workflow_revision"] == 1


@pytest.mark.anyio
async def test_non_finite_workflow_numbers_are_rejected_before_persistence(
    tmp_path: Path, monkeypatch
) -> None:
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path / "data"))
    app = create_app(serve_frontend=False)
    workflow = input_output_workflow("value", workflow_id="non-finite")
    workflow["presentation"]["nodes"]["input"]["position"]["x"] = "Infinity"

    async with (
        app.router.lifespan_context(app),
        httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://testserver"
        ) as client,
    ):
        response = await client.put(
            "/api/workflows",
            json=save_body(workflow, base_revision=None),
        )
        state = await client.get("/api/state")

    assert response.status_code == 422
    assert state.status_code == 200
    assert state.json()["workflows"] == []


@pytest.mark.anyio
async def test_manual_run_uses_the_requested_revision_and_rejects_an_invalid_draft(
    tmp_path: Path, monkeypatch
) -> None:
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path / "data"))
    app = create_app(serve_frontend=False)

    async with (
        app.router.lifespan_context(app),
        httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://testserver"
        ) as client,
    ):
        original = input_output_workflow("revision one")
        created = await save_workflow(client, original, base_revision=None)
        invalid = copy.deepcopy(original)
        invalid["spec"]["nodes"] = [invalid["spec"]["nodes"][0]]
        invalid["spec"]["connections"] = []
        invalid["presentation"]["nodes"].pop("output")
        invalid["presentation"]["connections"] = {}
        saved_draft = await save_workflow(
            client, invalid, base_revision=int(created["revision"])
        )

        rejected = await client.post(
            "/api/workflows/workflow-conflict/run",
            json={"workflow_revision": saved_draft["revision"]},
        )
        pinned = await client.post(
            "/api/workflows/workflow-conflict/run",
            json={"workflow_revision": created["revision"]},
        )

    assert saved_draft["active_revision"] == created["revision"]
    assert rejected.status_code == 400
    assert rejected.json()["detail"] == "Workflow needs an Output node."
    assert pinned.status_code == 200
    assert pinned.json()["workflow_revision"] == created["revision"]
    assert pinned.json()["outputs"] == {"result": "revision one"}
