from __future__ import annotations

import asyncio
import copy
import time
from collections.abc import Callable
from pathlib import Path

import httpx
import pytest

from flowent.main import create_app
from flowent.storage import WorkflowDraft
from flowent.workflows import WorkflowNodeRunResult, WorkflowRunResponse


def timer_workflow(
    *,
    interval_seconds: float = 60,
    payload: str = "tick",
    workflow_id: str = "workflow-consistency",
) -> dict[str, object]:
    return {
        "id": workflow_id,
        "name": "Consistency Workflow",
        "spec": {
            "nodes": [
                {
                    "id": "timer",
                    "kind": "timer",
                    "config": {
                        "cron": "",
                        "interval_seconds": interval_seconds,
                        "mode": "interval",
                        "payload": payload,
                    },
                },
                {
                    "id": "output",
                    "kind": "output",
                    "config": {"output_key": "result", "transform": ""},
                },
            ],
            "connections": [
                {
                    "id": "timer-output",
                    "from": {"node_id": "timer", "port": "output"},
                    "to": {"node_id": "output", "port": "input"},
                }
            ],
        },
        "presentation": {
            "nodes": {
                "timer": {
                    "name": "Timer",
                    "description": "",
                    "position": {"x": 0, "y": 0},
                },
                "output": {
                    "name": "Output",
                    "description": "",
                    "position": {"x": 260, "y": 0},
                },
            },
            "connections": {"timer-output": {"label": ""}},
        },
    }


async def save_workflow(
    client: httpx.AsyncClient,
    workflow: dict[str, object],
    *,
    base_revision: int | None,
) -> dict[str, object]:
    response = await client.put(
        "/api/workflows",
        json={"base_revision": base_revision, "workflow": workflow},
    )
    assert response.status_code == 200, response.text
    return response.json()


async def wait_for_schedule(
    client: httpx.AsyncClient,
    predicate: Callable[[dict[str, object]], bool],
    *,
    timeout: float = 4,
) -> dict[str, object]:
    async def poll() -> dict[str, object]:
        while True:
            response = await client.get("/api/workflows/workflow-consistency/schedule")
            assert response.status_code == 200
            schedule = response.json()
            if predicate(schedule):
                return schedule
            await asyncio.sleep(0.02)

    return await asyncio.wait_for(poll(), timeout=timeout)


@pytest.mark.anyio
async def test_interrupted_trace_uses_the_revision_claimed_before_later_saves(
    tmp_path: Path, monkeypatch
) -> None:
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path / "data"))
    claimed = asyncio.Event()
    claimed_revision = 0

    async def hold_claimed_revision(*args, **kwargs):
        nonlocal claimed_revision
        claimed_revision = int(kwargs["workflow_revision"])
        claimed.set()
        await asyncio.Future()

    monkeypatch.setattr(
        "flowent.workflow_service.run_workflow_spec", hold_claimed_revision
    )
    app = create_app(serve_frontend=False)
    async with (
        app.router.lifespan_context(app),
        httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://testserver"
        ) as client,
    ):
        original = timer_workflow()
        created = await save_workflow(client, original, base_revision=None)
        await client.post("/api/workflows/workflow-consistency/schedule/start", json={})
        await asyncio.wait_for(claimed.wait(), timeout=2)

        same_timer = copy.deepcopy(original)
        same_timer["spec"]["nodes"][0]["config"]["payload"] = "new payload"
        second = await save_workflow(
            client, same_timer, base_revision=int(created["revision"])
        )
        changed_timer = copy.deepcopy(same_timer)
        changed_timer["spec"]["nodes"][0]["config"]["interval_seconds"] = 120
        await save_workflow(
            client, changed_timer, base_revision=int(second["revision"])
        )
        interrupted = (
            await client.get("/api/workflows/workflow-consistency/schedule")
        ).json()

    assert claimed_revision == 1
    assert interrupted["last_result"]["workflow_revision"] == claimed_revision
    assert interrupted["last_result"]["node_results"][0]["error"]["code"] == (
        "run_interrupted"
    )


@pytest.mark.anyio
async def test_worker_exits_when_a_lower_layer_finishes_after_cancellation(
    tmp_path: Path, monkeypatch
) -> None:
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path / "data"))
    run_started = asyncio.Event()
    cancellation_received = asyncio.Event()

    async def finish_after_cancellation(*args, **kwargs):
        run_started.set()
        try:
            await asyncio.Future()
        except asyncio.CancelledError:
            cancellation_received.set()
            return WorkflowRunResponse(
                node_results=[
                    WorkflowNodeRunResult(
                        id="timer", inputs=[], output="tick", status="success"
                    )
                ],
                outputs={"result": "tick"},
                run_id="completed-during-cancellation",
                status="success",
                trigger="schedule",
                workflow_id="workflow-consistency",
                workflow_revision=1,
            )

    app = create_app(serve_frontend=False)
    async with app.router.lifespan_context(app):
        service = app.state.workflow_service
        await service.save_workflow(
            WorkflowDraft.model_validate(timer_workflow()),
            base_revision=None,
        )
        monkeypatch.setattr(service, "run_workflow", finish_after_cancellation)
        await service.scheduler.start_schedule("workflow-consistency")
        await asyncio.wait_for(run_started.wait(), timeout=2)
        worker = service.scheduler.tasks["workflow-consistency"]

        stopped = await asyncio.wait_for(
            service.scheduler.stop_schedule("workflow-consistency"), timeout=1
        )

    assert cancellation_received.is_set()
    assert worker.done()
    assert stopped.status == "stopped"


@pytest.mark.anyio
async def test_restart_reconciles_persisted_timers_with_the_active_revision(
    tmp_path: Path, monkeypatch
) -> None:
    data_dir = tmp_path / "data"
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(data_dir))
    first_app = create_app(serve_frontend=False)
    async with (
        first_app.router.lifespan_context(first_app),
        httpx.AsyncClient(
            transport=httpx.ASGITransport(app=first_app),
            base_url="http://testserver",
        ) as client,
    ):
        created = await save_workflow(
            client, timer_workflow(interval_seconds=60), base_revision=None
        )
        await client.post("/api/workflows/workflow-consistency/schedule/start", json={})
        before = await wait_for_schedule(
            client,
            lambda schedule: isinstance(schedule.get("last_result"), dict),
        )

    changed = timer_workflow(interval_seconds=3600)
    committed = first_app.state.workflow_service.store.save_workflow(
        WorkflowDraft.model_validate(changed),
        base_revision=int(created["revision"]),
        executable=True,
    )
    assert committed.active_revision == 2

    second_app = create_app(serve_frontend=False)
    async with (
        second_app.router.lifespan_context(second_app),
        httpx.AsyncClient(
            transport=httpx.ASGITransport(app=second_app),
            base_url="http://testserver",
        ) as client,
    ):
        recovered = (
            await client.get("/api/workflows/workflow-consistency/schedule")
        ).json()

    assert before["next_run_at"] < time.time() + 120
    assert recovered["status"] == "scheduled"
    assert recovered["next_run_at"] >= time.time() + 3500


@pytest.mark.anyio
async def test_scheduler_exception_does_not_retain_the_previous_success_trace(
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
        await save_workflow(
            client, timer_workflow(interval_seconds=1), base_revision=None
        )
        await client.post("/api/workflows/workflow-consistency/schedule/start", json={})
        successful = await wait_for_schedule(
            client,
            lambda schedule: isinstance(schedule.get("last_result"), dict),
        )
        successful_run_id = successful["last_result"]["run_id"]
        service = app.state.workflow_service

        async def fail_run(*args, **kwargs):
            raise RuntimeError("scheduler exploded")

        monkeypatch.setattr(service, "run_workflow", fail_run)
        failed = await wait_for_schedule(
            client,
            lambda schedule: schedule.get("status") == "error",
        )

    assert failed["last_error"] == "scheduler exploded"
    assert failed["last_result"] is None or (
        failed["last_result"]["run_id"] != successful_run_id
        and failed["last_result"]["status"] == "failed"
    )


@pytest.mark.anyio
async def test_next_run_failure_does_not_reuse_the_completed_workflow_run_id(
    tmp_path: Path, monkeypatch
) -> None:
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path / "data"))
    app = create_app(serve_frontend=False)
    async with app.router.lifespan_context(app):
        service = app.state.workflow_service
        await service.save_workflow(
            WorkflowDraft.model_validate(timer_workflow()),
            base_revision=None,
        )

        def fail_next_run(*args, **kwargs):
            raise RuntimeError("next run could not be calculated")

        monkeypatch.setattr(service.scheduler, "_future_timers", fail_next_run)
        await service.scheduler.start_schedule("workflow-consistency")
        worker = service.scheduler.tasks["workflow-consistency"]
        await asyncio.wait_for(asyncio.shield(worker), timeout=2)

        schedule = service.scheduler.get("workflow-consistency")
        with service.store.connect() as connection:
            runs = connection.execute(
                """
                SELECT run_id, status
                FROM workflow_runs
                WHERE workflow_id = ?
                ORDER BY rowid
                """,
                ("workflow-consistency",),
            ).fetchall()

    assert schedule.status == "error"
    assert schedule.last_result is not None
    assert [row["status"] for row in runs] == ["success", "failed"]
    assert runs[0]["run_id"] != runs[1]["run_id"]
    assert schedule.last_result["run_id"] == runs[1]["run_id"]
