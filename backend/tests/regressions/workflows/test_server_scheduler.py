from __future__ import annotations

import asyncio
import time
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import httpx
import pytest

from flowent.main import create_app
from flowent.sandbox import CommandResult
from flowent.storage import StoredWorkflow
from flowent.workflow_scheduler import next_cron_run_at
from flowent.workflow_tools import WorkflowAgentTools, workflow_tool_specs
from flowent.workflows import WorkflowNodeRunResult, WorkflowRunResponse


def timer_workflow(
    *,
    interval_seconds: object = 1,
    with_failure: bool = False,
    workflow_id: str = "workflow-timer",
) -> dict[str, object]:
    middle_nodes: list[dict[str, object]] = []
    edges = [
        {
            "id": "edge-timer-output",
            "label": "",
            "source": "timer",
            "source_handle": "out",
            "target": "output",
            "target_handle": "in",
        }
    ]
    if with_failure:
        middle_nodes = [
            {
                "data": {"code": "raise RuntimeError('scheduled failure')"},
                "description": "",
                "id": "code",
                "name": "Code",
                "position": {"x": 260, "y": 0},
                "type": "code",
            }
        ]
        edges = [
            {
                "id": "edge-timer-code",
                "label": "",
                "source": "timer",
                "source_handle": "out",
                "target": "code",
                "target_handle": "in",
            },
            {
                "id": "edge-code-output",
                "label": "",
                "source": "code",
                "source_handle": "out",
                "target": "output",
                "target_handle": "in",
            },
        ]
    return {
        "created_at": 0,
        "definition": {
            "edges": edges,
            "nodes": [
                {
                    "data": {
                        "interval_seconds": interval_seconds,
                        "mode": "interval",
                        "payload": "tick",
                    },
                    "description": "",
                    "id": "timer",
                    "name": "Timer",
                    "position": {"x": 0, "y": 0},
                    "type": "timer",
                },
                *middle_nodes,
                {
                    "data": {"output_key": "result"},
                    "description": "",
                    "id": "output",
                    "name": "Output",
                    "position": {"x": 520, "y": 0},
                    "type": "output",
                },
            ],
            "version": 1,
        },
        "id": workflow_id,
        "name": "Timer Workflow",
        "updated_at": 0,
    }


async def wait_for_schedule(
    client: httpx.AsyncClient,
    workflow_id: str,
    predicate,
    *,
    timeout: float = 3,
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


@pytest.mark.anyio
async def test_timer_schedule_runs_without_an_open_browser(
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
        assert (await client.put("/api/workflows", json=timer_workflow())).is_success
        start = await client.post(
            "/api/workflows/workflow-timer/schedule/start", json={}
        )
        assert start.status_code == 200
        schedule = await wait_for_schedule(
            client,
            "workflow-timer",
            lambda value: value["last_result"] is not None,
        )

    assert schedule["status"] == "scheduled"
    assert schedule["last_result"]["outputs"] == {"result": "tick"}
    assert schedule["last_error"] == ""
    assert schedule["next_run_at"] is not None


@pytest.mark.anyio
async def test_schedule_failure_persists_trace_and_pauses(
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
        await client.put("/api/workflows", json=timer_workflow(with_failure=True))
        response = await client.post(
            "/api/workflows/workflow-timer/schedule/start", json={}
        )
        assert response.status_code == 200
        schedule = await wait_for_schedule(
            client,
            "workflow-timer",
            lambda value: value["status"] == "error",
        )

    assert schedule["next_run_at"] is None
    assert schedule["last_result"]["status"] == "failed"
    assert schedule["last_result"]["node_results"][1]["error"] == (
        "RuntimeError: scheduled failure"
    )
    assert schedule["last_error"] == "RuntimeError: scheduled failure"


@pytest.mark.anyio
async def test_invalid_interval_is_rejected_without_fallback(
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
        await client.put(
            "/api/workflows", json=timer_workflow(interval_seconds="invalid")
        )
        response = await client.post(
            "/api/workflows/workflow-timer/schedule/start", json={}
        )

    assert response.status_code == 400
    assert response.json()["detail"] == "Timer interval must be at least 1 second."


@pytest.mark.anyio
async def test_stopped_schedule_does_not_run_again(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path / "data"))
    app = create_app(serve_frontend=False)
    async with (
        app.router.lifespan_context(app),
        httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://testserver"
        ) as client,
    ):
        await client.put("/api/workflows", json=timer_workflow())
        await client.post("/api/workflows/workflow-timer/schedule/start", json={})
        first = await wait_for_schedule(
            client,
            "workflow-timer",
            lambda value: value["last_run_at"] is not None,
        )
        stop = await client.post("/api/workflows/workflow-timer/schedule/stop")
        await asyncio.sleep(1.1)
        stopped = (await client.get("/api/workflows/workflow-timer/schedule")).json()

    assert stop.status_code == 200
    assert stopped["status"] == "stopped"
    assert stopped["next_run_at"] is None
    assert stopped["last_run_at"] == first["last_run_at"]


@pytest.mark.anyio
async def test_schedule_state_recovers_after_app_recreation(
    tmp_path: Path, monkeypatch
) -> None:
    data_dir = tmp_path / "data"
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(data_dir))
    first_app = create_app(serve_frontend=False)
    async with (
        first_app.router.lifespan_context(first_app),
        httpx.AsyncClient(
            transport=httpx.ASGITransport(app=first_app), base_url="http://testserver"
        ) as client,
    ):
        await client.put("/api/workflows", json=timer_workflow(interval_seconds=60))
        await client.post("/api/workflows/workflow-timer/schedule/start", json={})
        before = await wait_for_schedule(
            client,
            "workflow-timer",
            lambda value: value["last_result"] is not None,
        )

    second_app = create_app(serve_frontend=False)
    async with (
        second_app.router.lifespan_context(second_app),
        httpx.AsyncClient(
            transport=httpx.ASGITransport(app=second_app), base_url="http://testserver"
        ) as client,
    ):
        after = (await client.get("/api/workflows/workflow-timer/schedule")).json()

    assert after["status"] == "scheduled"
    assert after["last_result"] == before["last_result"]
    assert after["next_run_at"] == before["next_run_at"]


@pytest.mark.anyio
async def test_recovered_schedule_executes_its_next_interval(
    tmp_path: Path, monkeypatch
) -> None:
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path / "data"))
    first_app = create_app(serve_frontend=False)
    async with first_app.router.lifespan_context(first_app):
        service = first_app.state.workflow_service
        await service.save_workflow(StoredWorkflow.model_validate(timer_workflow()))
        await service.scheduler.start_schedule("workflow-timer")
        await _wait_until(
            lambda: service.scheduler.get("workflow-timer").last_run_at is not None
        )
        before = service.scheduler.get("workflow-timer").last_run_at

    second_app = create_app(serve_frontend=False)
    async with second_app.router.lifespan_context(second_app):
        service = second_app.state.workflow_service
        await asyncio.wait_for(
            _wait_until(
                lambda: service.scheduler.get("workflow-timer").last_run_at > before
            ),
            timeout=2,
        )
        after = service.scheduler.get("workflow-timer")

    assert after.status == "scheduled"
    assert after.last_run_at > before


@pytest.mark.anyio
async def test_steward_schedule_tools_start_stop_and_get(
    tmp_path: Path, monkeypatch
) -> None:
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path / "data"))
    app = create_app(serve_frontend=False)
    async with app.router.lifespan_context(app):
        service = app.state.workflow_service
        await service.save_workflow(StoredWorkflow.model_validate(timer_workflow()))
        tools = WorkflowAgentTools(service)

        start = await tools.run_tool(
            "start_workflow_schedule", {"workflow_id": "workflow-timer"}
        )
        await _wait_until(
            lambda: service.scheduler.get("workflow-timer").last_result is not None
        )
        get = await tools.run_tool(
            "get_workflow_schedule", {"workflow_id": "workflow-timer"}
        )
        stop = await tools.run_tool(
            "stop_workflow_schedule", {"workflow_id": "workflow-timer"}
        )

    tool_names = {item["function"]["name"] for item in workflow_tool_specs()}
    assert {
        "get_workflow_schedule",
        "start_workflow_schedule",
        "stop_workflow_schedule",
    }.issubset(tool_names)
    assert start is not None and start.ok is True
    assert get is not None and get.result["status"] in {"running", "scheduled"}
    assert "Next run:" in get.result["output"]
    assert "Latest outputs:" in get.result["output"]
    assert stop is not None and stop.result["status"] == "stopped"


@pytest.mark.anyio
async def test_repeated_start_without_changes_is_idempotent(
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
        await client.put("/api/workflows", json=timer_workflow(interval_seconds=60))
        await client.post(
            "/api/workflows/workflow-timer/schedule/start",
            json={"input": "first"},
        )
        first = await wait_for_schedule(
            client,
            "workflow-timer",
            lambda value: value["last_result"] is not None,
        )
        second_response = await client.post(
            "/api/workflows/workflow-timer/schedule/start",
            json={"input": "first"},
        )
        second = second_response.json()
        await asyncio.sleep(0.1)
        final = (await client.get("/api/workflows/workflow-timer/schedule")).json()

    assert second_response.status_code == 200
    assert second["next_run_at"] == first["next_run_at"]
    assert final["last_run_at"] == first["last_run_at"]


def test_cron_step_finds_next_run_in_selected_timezone() -> None:
    timezone = ZoneInfo("Asia/Shanghai")
    now = datetime(2026, 7, 10, 10, 2, 30, tzinfo=timezone)

    result = next_cron_run_at("*/5 * * * *", now)

    assert result == datetime(2026, 7, 10, 10, 5, tzinfo=timezone)


def test_cron_range_list_and_weekday_seven_are_supported() -> None:
    timezone = ZoneInfo("UTC")
    friday = datetime(2026, 7, 10, 8, 59, tzinfo=timezone)
    sunday = datetime(2026, 7, 12, 8, 59, tzinfo=timezone)

    ranged = next_cron_run_at("0 9-10 * 7 5,7", friday)
    normalized_weekday = next_cron_run_at("0 9 * 7 7", sunday)

    assert ranged == datetime(2026, 7, 10, 9, 0, tzinfo=timezone)
    assert normalized_weekday == datetime(2026, 7, 12, 9, 0, tzinfo=timezone)


def test_cron_finds_a_leap_day_more_than_one_year_ahead() -> None:
    timezone = ZoneInfo("UTC")
    now = datetime(2026, 3, 1, tzinfo=timezone)

    result = next_cron_run_at("0 0 29 2 *", now)

    assert result == datetime(2028, 2, 29, tzinfo=timezone)


def test_cron_full_step_day_field_keeps_weekday_restriction() -> None:
    timezone = ZoneInfo("UTC")
    tuesday = datetime(2026, 7, 7, 10, 0, tzinfo=timezone)

    full_step = next_cron_run_at("0 9 */1 * 1", tuesday)
    restricted_step = next_cron_run_at("0 9 */2 * 1", tuesday)

    assert full_step == datetime(2026, 7, 13, 9, 0, tzinfo=timezone)
    assert restricted_step == datetime(2026, 7, 9, 9, 0, tzinfo=timezone)


@pytest.mark.parametrize(
    "expression",
    ["not-a-cron", "*/0 * * * *", "60 * * * *", "5-2 * * * *", "* * * * 8"],
)
def test_invalid_cron_expression_is_rejected(expression: str) -> None:
    with pytest.raises(ValueError, match="Timer cron expression is invalid"):
        next_cron_run_at(expression, datetime(2026, 7, 10, tzinfo=ZoneInfo("UTC")))


@pytest.mark.anyio
async def test_cron_schedule_requires_an_explicit_timezone(
    tmp_path: Path, monkeypatch
) -> None:
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path / "data"))
    workflow = timer_workflow()
    workflow["definition"]["nodes"][0]["data"] = {
        "cron": "*/5 * * * *",
        "mode": "cron",
        "payload": "tick",
    }
    app = create_app(serve_frontend=False)
    async with (
        app.router.lifespan_context(app),
        httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://testserver"
        ) as client,
    ):
        await client.put("/api/workflows", json=workflow)
        missing = await client.post(
            "/api/workflows/workflow-timer/schedule/start", json={}
        )
        started = await client.post(
            "/api/workflows/workflow-timer/schedule/start",
            json={"timezone": "Asia/Shanghai"},
        )

    assert missing.status_code == 400
    assert missing.json()["detail"] == "Timer timezone is required for cron schedules."
    assert started.status_code == 200
    assert started.json()["timezone"] == "Asia/Shanghai"


@pytest.mark.anyio
async def test_all_due_timers_run_without_resetting_each_other(
    tmp_path: Path, monkeypatch
) -> None:
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path / "data"))
    workflow = timer_workflow(interval_seconds=60)
    timer = workflow["definition"]["nodes"][0]
    second_timer = {
        **timer,
        "id": "timer-second",
        "name": "Second Timer",
        "data": {**timer["data"], "interval_seconds": 120, "payload": "second"},
    }
    workflow["definition"]["nodes"].insert(1, second_timer)
    workflow["definition"]["edges"].append(
        {
            "id": "edge-second-output",
            "label": "",
            "source": "timer-second",
            "source_handle": "out",
            "target": "output",
            "target_handle": "in",
        }
    )
    calls: list[str] = []
    app = create_app(serve_frontend=False)
    async with app.router.lifespan_context(app):
        service = app.state.workflow_service
        await service.save_workflow(StoredWorkflow.model_validate(workflow))
        original = service.run_workflow

        async def record_run(workflow_id: str, **kwargs):
            calls.append(kwargs["timer_node_id"])
            return await original(workflow_id, **kwargs)

        monkeypatch.setattr(service, "run_workflow", record_run)
        await service.scheduler.start_schedule("workflow-timer")
        await asyncio.wait_for(_wait_until(lambda: len(calls) == 2), timeout=2)
        schedule = service.scheduler.get("workflow-timer")

    assert calls == ["timer", "timer-second"]
    deadlines = {item.timer_node_id: item.next_run_at for item in schedule.timers}
    assert deadlines["timer-second"] - deadlines["timer"] >= 59


@pytest.mark.anyio
async def test_running_single_timer_has_no_next_run(
    tmp_path: Path, monkeypatch
) -> None:
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path / "data"))
    app = create_app(serve_frontend=False)
    started = asyncio.Event()
    finish = asyncio.Event()
    async with (
        app.router.lifespan_context(app),
        httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://testserver"
        ) as client,
    ):
        service = app.state.workflow_service
        await service.save_workflow(StoredWorkflow.model_validate(timer_workflow()))

        async def hold_run(*args, **kwargs):
            started.set()
            await finish.wait()
            return WorkflowRunResponse(
                workflow_id="workflow-timer",
                status="success",
                outputs={"result": "tick"},
                node_results=[
                    WorkflowNodeRunResult(
                        id="timer", status="success", output="tick", error=""
                    )
                ],
            )

        monkeypatch.setattr(service, "run_workflow", hold_run)
        await service.scheduler.start_schedule("workflow-timer")
        await started.wait()
        response = await client.get("/api/workflows/workflow-timer/schedule")
        finish.set()

    assert response.status_code == 200
    assert response.json()["status"] == "running"
    assert response.json()["next_run_at"] is None


@pytest.mark.anyio
async def test_running_timer_preserves_another_timer_deadline(
    tmp_path: Path, monkeypatch
) -> None:
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path / "data"))
    workflow = timer_workflow(interval_seconds=60)
    timer = workflow["definition"]["nodes"][0]
    workflow["definition"]["nodes"].insert(
        1,
        {
            **timer,
            "id": "timer-second",
            "name": "Second Timer",
            "data": {**timer["data"], "interval_seconds": 120, "payload": "second"},
        },
    )
    workflow["definition"]["edges"].append(
        {
            "id": "edge-second-output",
            "label": "",
            "source": "timer-second",
            "source_handle": "out",
            "target": "output",
            "target_handle": "in",
        }
    )
    app = create_app(serve_frontend=False)
    started = asyncio.Event()
    finish = asyncio.Event()
    async with (
        app.router.lifespan_context(app),
        httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://testserver"
        ) as client,
    ):
        service = app.state.workflow_service
        await service.save_workflow(StoredWorkflow.model_validate(workflow))

        async def hold_run(*args, **kwargs):
            started.set()
            await finish.wait()
            return WorkflowRunResponse(
                workflow_id="workflow-timer",
                status="success",
                outputs={"result": "tick"},
                node_results=[
                    WorkflowNodeRunResult(
                        id="timer", status="success", output="tick", error=""
                    )
                ],
            )

        monkeypatch.setattr(service, "run_workflow", hold_run)
        await service.scheduler.start_schedule("workflow-timer")
        stored = service.scheduler.get("workflow-timer")
        future_deadline = time.time() + 120
        stored.timers = [
            timer.model_copy(update={"next_run_at": future_deadline})
            if timer.timer_node_id == "timer-second"
            else timer
            for timer in stored.timers
        ]
        service.store.save_workflow_schedule(stored)
        await started.wait()
        response = await client.get("/api/workflows/workflow-timer/schedule")
        finish.set()

    assert response.status_code == 200
    assert response.json()["status"] == "running"
    assert response.json()["next_run_at"] == pytest.approx(future_deadline)


async def _wait_until(predicate) -> None:
    while not predicate():
        await asyncio.sleep(0.01)


@pytest.mark.anyio
async def test_active_schedule_reconciles_timer_configuration(
    tmp_path: Path, monkeypatch
) -> None:
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path / "data"))
    app = create_app(serve_frontend=False)
    async with app.router.lifespan_context(app):
        service = app.state.workflow_service
        initial = StoredWorkflow.model_validate(timer_workflow(interval_seconds=60))
        await service.save_workflow(initial)
        await service.scheduler.start_schedule("workflow-timer")
        await _wait_until(
            lambda: service.scheduler.get("workflow-timer").last_result is not None
        )
        before = service.scheduler.get("workflow-timer")
        layout = initial.model_copy(deep=True)
        layout.definition.nodes[0].position.x = 100
        await service.save_workflow(layout)
        await asyncio.sleep(0.05)
        unchanged = service.scheduler.get("workflow-timer")
        changed = layout.model_copy(deep=True)
        changed.definition.nodes[0].data["interval_seconds"] = 120
        await service.save_workflow(changed)
        await asyncio.sleep(0.05)
        updated = service.scheduler.get("workflow-timer")

    assert unchanged.timers[0].next_run_at == before.timers[0].next_run_at
    assert updated.generation > unchanged.generation
    assert updated.timers[0].next_run_at > unchanged.timers[0].next_run_at


@pytest.mark.anyio
async def test_rapid_timer_updates_keep_the_latest_interval(
    tmp_path: Path, monkeypatch
) -> None:
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path / "data"))
    app = create_app(serve_frontend=False)
    run_started = asyncio.Event()
    cancellation_started = asyncio.Event()
    finish_cancellation = asyncio.Event()
    async with app.router.lifespan_context(app):
        service = app.state.workflow_service
        initial = StoredWorkflow.model_validate(timer_workflow(interval_seconds=60))
        await service.save_workflow(initial)

        async def finish_after_cancellation(*args, **kwargs):
            run_started.set()
            try:
                await asyncio.Future()
            except asyncio.CancelledError:
                cancellation_started.set()
                await finish_cancellation.wait()
                return WorkflowRunResponse(
                    workflow_id="workflow-timer",
                    status="success",
                    outputs={"result": "tick"},
                    node_results=[
                        WorkflowNodeRunResult(
                            id="timer", status="success", output="tick", error=""
                        )
                    ],
                )

        monkeypatch.setattr(service, "run_workflow", finish_after_cancellation)
        await service.scheduler.start_schedule("workflow-timer")
        await asyncio.wait_for(run_started.wait(), timeout=1)

        intermediate = initial.model_copy(deep=True)
        intermediate.definition.nodes[0].data["interval_seconds"] = 120
        intermediate_save = asyncio.create_task(service.save_workflow(intermediate))
        await asyncio.wait_for(cancellation_started.wait(), timeout=1)

        latest = intermediate.model_copy(deep=True)
        latest.definition.nodes[0].data["interval_seconds"] = 180
        latest_save = asyncio.create_task(service.save_workflow(latest))
        finish_cancellation.set()
        await asyncio.wait_for(intermediate_save, timeout=2)
        await asyncio.wait_for(latest_save, timeout=2)
        schedule = service.scheduler.get("workflow-timer")

    assert schedule.status == "scheduled"
    assert schedule.timers[0].next_run_at is not None
    assert schedule.timers[0].next_run_at >= time.time() + 170


@pytest.mark.anyio
async def test_running_schedule_ignores_layout_only_saves(
    tmp_path: Path, monkeypatch
) -> None:
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path / "data"))
    app = create_app(serve_frontend=False)
    run_started = asyncio.Event()
    run_cancelled = asyncio.Event()
    finish_run = asyncio.Event()
    async with app.router.lifespan_context(app):
        service = app.state.workflow_service
        workflow = StoredWorkflow.model_validate(timer_workflow(interval_seconds=60))
        await service.save_workflow(workflow)

        async def hold_run(*args, **kwargs):
            run_started.set()
            try:
                await finish_run.wait()
            except asyncio.CancelledError:
                run_cancelled.set()
                raise
            return WorkflowRunResponse(
                workflow_id="workflow-timer",
                status="success",
                outputs={"result": "tick"},
                node_results=[
                    WorkflowNodeRunResult(
                        id="timer", status="success", output="tick", error=""
                    )
                ],
            )

        monkeypatch.setattr(service, "run_workflow", hold_run)
        await service.scheduler.start_schedule("workflow-timer")
        await run_started.wait()
        layout = workflow.model_copy(deep=True)
        layout.definition.nodes[0].position.x = 100
        await service.save_workflow(layout)
        await asyncio.sleep(0.05)
        schedule = service.scheduler.get("workflow-timer")
        was_cancelled = run_cancelled.is_set()
        finish_run.set()
        await _wait_until(
            lambda: service.scheduler.get("workflow-timer").status == "scheduled"
        )

    assert was_cancelled is False
    assert schedule.status == "running"


@pytest.mark.anyio
async def test_running_schedule_change_records_interrupted_trace_without_repeating(
    tmp_path: Path, monkeypatch
) -> None:
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path / "data"))
    app = create_app(serve_frontend=False)
    run_started = asyncio.Event()
    run_calls = 0
    async with app.router.lifespan_context(app):
        service = app.state.workflow_service
        workflow = StoredWorkflow.model_validate(timer_workflow(interval_seconds=60))
        await service.save_workflow(workflow)

        async def hold_run(*args, **kwargs):
            nonlocal run_calls
            run_calls += 1
            run_started.set()
            await asyncio.Future()

        monkeypatch.setattr(service, "run_workflow", hold_run)
        await service.scheduler.start_schedule("workflow-timer")
        await run_started.wait()
        changed = workflow.model_copy(deep=True)
        changed.definition.nodes[0].data["interval_seconds"] = 120
        await service.save_workflow(changed)
        schedule = service.scheduler.get("workflow-timer")
        await asyncio.sleep(0.05)

    assert schedule.status == "scheduled"
    assert "interrupted" in schedule.last_error.lower()
    assert schedule.last_result is not None
    assert schedule.last_result["status"] == "failed"
    assert schedule.last_result["node_results"][0]["id"] == "timer"
    assert schedule.timers[0].next_run_at is not None
    assert schedule.timers[0].next_run_at >= time.time() + 110
    assert run_calls == 1


@pytest.mark.anyio
async def test_schedule_change_preserves_a_run_completed_during_cancellation(
    tmp_path: Path, monkeypatch
) -> None:
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path / "data"))
    app = create_app(serve_frontend=False)
    run_started = asyncio.Event()
    async with app.router.lifespan_context(app):
        service = app.state.workflow_service
        workflow = StoredWorkflow.model_validate(timer_workflow(interval_seconds=60))
        await service.save_workflow(workflow)

        async def complete_when_cancelled(*args, **kwargs):
            run_started.set()
            try:
                await asyncio.Future()
            except asyncio.CancelledError:
                return WorkflowRunResponse(
                    workflow_id="workflow-timer",
                    status="success",
                    outputs={"result": "completed"},
                    node_results=[
                        WorkflowNodeRunResult(
                            id="timer",
                            status="success",
                            output="completed",
                            error="",
                        )
                    ],
                )

        monkeypatch.setattr(service, "run_workflow", complete_when_cancelled)
        await service.scheduler.start_schedule("workflow-timer")
        await run_started.wait()
        changed = workflow.model_copy(deep=True)
        changed.definition.nodes[0].data["interval_seconds"] = 120
        await service.save_workflow(changed)
        schedule = service.scheduler.get("workflow-timer")

    assert schedule.status == "scheduled"
    assert schedule.last_error == ""
    assert schedule.last_result is not None
    assert schedule.last_result["status"] == "success"
    assert schedule.last_result["outputs"] == {"result": "completed"}
    assert schedule.timers[0].next_run_at is not None
    assert schedule.timers[0].next_run_at >= time.time() + 110


@pytest.mark.anyio
async def test_recovery_marks_claimed_timer_interrupted_and_preserves_other_deadline(
    tmp_path: Path, monkeypatch
) -> None:
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path / "data"))
    workflow = timer_workflow(interval_seconds=60)
    timer = workflow["definition"]["nodes"][0]
    workflow["definition"]["nodes"].insert(
        1,
        {
            **timer,
            "id": "timer-second",
            "name": "Second Timer",
            "data": {**timer["data"], "interval_seconds": 120, "payload": "second"},
        },
    )
    workflow["definition"]["edges"].append(
        {
            "id": "edge-second-output",
            "label": "",
            "source": "timer-second",
            "source_handle": "out",
            "target": "output",
            "target_handle": "in",
        }
    )
    first_app = create_app(serve_frontend=False)
    run_started = asyncio.Event()
    async with first_app.router.lifespan_context(first_app):
        service = first_app.state.workflow_service
        await service.save_workflow(StoredWorkflow.model_validate(workflow))

        async def hold_run(*args, **kwargs):
            run_started.set()
            await asyncio.Future()

        monkeypatch.setattr(service, "run_workflow", hold_run)
        await service.scheduler.start_schedule("workflow-timer")
        stored = service.scheduler.get("workflow-timer")
        other_deadline = time.time() + 120
        stored.timers = [
            item.model_copy(update={"next_run_at": other_deadline})
            if item.timer_node_id == "timer-second"
            else item
            for item in stored.timers
        ]
        service.store.save_workflow_schedule(stored)
        await run_started.wait()

    second_app = create_app(serve_frontend=False)
    async with second_app.router.lifespan_context(second_app):
        recovered = second_app.state.workflow_service.scheduler.get("workflow-timer")

    deadlines = {item.timer_node_id: item.next_run_at for item in recovered.timers}
    assert recovered.status == "scheduled"
    assert "interrupted" in recovered.last_error.lower()
    assert recovered.last_result is not None
    assert recovered.last_result["status"] == "failed"
    assert recovered.last_result["node_results"][0]["id"] == "timer"
    assert deadlines["timer"] is not None
    assert deadlines["timer"] >= time.time() + 50
    assert deadlines["timer-second"] == pytest.approx(other_deadline)


@pytest.mark.anyio
async def test_unexpected_scheduler_exception_is_persisted(
    tmp_path: Path, monkeypatch
) -> None:
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path / "data"))
    app = create_app(serve_frontend=False)
    async with app.router.lifespan_context(app):
        service = app.state.workflow_service
        await service.save_workflow(StoredWorkflow.model_validate(timer_workflow()))

        async def fail(*args, **kwargs):
            raise RuntimeError("unexpected scheduler failure")

        monkeypatch.setattr(service, "run_workflow", fail)
        await service.scheduler.start_schedule("workflow-timer")
        await _wait_until(
            lambda: service.scheduler.get("workflow-timer").status == "error"
        )
        schedule = service.scheduler.get("workflow-timer")

    assert schedule.last_error == "unexpected scheduler failure"
    assert schedule.timers == []


@pytest.mark.anyio
async def test_stop_preserves_result_completed_during_cancellation(
    tmp_path: Path, monkeypatch
) -> None:
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path / "data"))
    app = create_app(serve_frontend=False)
    started = asyncio.Event()
    async with app.router.lifespan_context(app):
        service = app.state.workflow_service
        await service.save_workflow(StoredWorkflow.model_validate(timer_workflow()))

        async def finish_when_cancelled(*args, **kwargs):
            started.set()
            try:
                await asyncio.Future()
            except asyncio.CancelledError:
                return WorkflowRunResponse(
                    workflow_id="workflow-timer",
                    status="failed",
                    outputs={"result": "latest"},
                    node_results=[
                        WorkflowNodeRunResult(
                            id="timer",
                            status="failed",
                            output="latest",
                            error="finished during stop",
                        )
                    ],
                )

        monkeypatch.setattr(service, "run_workflow", finish_when_cancelled)
        await service.scheduler.start_schedule("workflow-timer")
        await started.wait()
        stopped = await service.scheduler.stop_schedule("workflow-timer")

    assert stopped.status == "stopped"
    assert stopped.last_result is not None
    assert stopped.last_result["outputs"] == {"result": "latest"}


@pytest.mark.anyio
async def test_invalid_timer_update_moves_active_schedule_to_error(
    tmp_path: Path, monkeypatch
) -> None:
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path / "data"))
    app = create_app(serve_frontend=False)
    async with app.router.lifespan_context(app):
        service = app.state.workflow_service
        workflow = StoredWorkflow.model_validate(timer_workflow(interval_seconds=60))
        await service.save_workflow(workflow)
        await service.scheduler.start_schedule("workflow-timer")
        invalid = workflow.model_copy(deep=True)
        invalid.definition.nodes[0].data["interval_seconds"] = float("inf")
        await service.save_workflow(invalid)
        await _wait_until(
            lambda: service.scheduler.get("workflow-timer").status == "error"
        )
        schedule = service.scheduler.get("workflow-timer")

    assert schedule.last_error == "Timer interval must be at least 1 second."
    assert schedule.timers == []


@pytest.mark.anyio
@pytest.mark.parametrize("change", ["interval", "remove"])
async def test_timer_save_survives_immediate_shutdown_and_restart(
    tmp_path: Path, monkeypatch, change: str
) -> None:
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path / "data"))
    initial = timer_workflow(interval_seconds=3600)
    first_app = create_app(serve_frontend=False)
    async with (
        first_app.router.lifespan_context(first_app),
        httpx.AsyncClient(
            transport=httpx.ASGITransport(app=first_app),
            base_url="http://testserver",
        ) as client,
    ):
        assert (await client.put("/api/workflows", json=initial)).is_success
        assert (
            await client.post("/api/workflows/workflow-timer/schedule/start", json={})
        ).is_success
        await wait_for_schedule(
            client,
            "workflow-timer",
            lambda value: value["last_result"] is not None,
        )
        service = first_app.state.workflow_service
        original_reconcile = service.scheduler._reconcile

        async def delayed_reconcile(old_workflow, workflow) -> None:
            await asyncio.sleep(0.1)
            await original_reconcile(old_workflow, workflow)

        monkeypatch.setattr(service.scheduler, "_reconcile", delayed_reconcile)
        changed = timer_workflow(interval_seconds=7200)
        if change == "remove":
            changed["definition"]["nodes"] = [changed["definition"]["nodes"][-1]]
            changed["definition"]["edges"] = []
        saved = await client.put("/api/workflows", json=changed)
        assert saved.is_success

    second_app = create_app(serve_frontend=False)
    async with second_app.router.lifespan_context(second_app):
        schedule = second_app.state.workflow_service.scheduler.get("workflow-timer")

    if change == "remove":
        assert schedule.status == "stopped"
        assert schedule.timers == []
    else:
        assert schedule.status == "scheduled"
        assert schedule.timers[0].timer_node_id == "timer"
        assert schedule.timers[0].next_run_at >= time.time() + 7100


@pytest.mark.anyio
@pytest.mark.parametrize("change", ["interval", "remove"])
async def test_timer_save_waits_for_scheduler_lock_before_replacing_definition(
    tmp_path: Path, monkeypatch, change: str
) -> None:
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path / "data"))
    app = create_app(serve_frontend=False)
    async with app.router.lifespan_context(app):
        service = app.state.workflow_service
        initial = StoredWorkflow.model_validate(timer_workflow(interval_seconds=3600))
        await service.save_workflow(initial)
        await service.scheduler.start_schedule("workflow-timer")
        await _wait_until(
            lambda: service.scheduler.get("workflow-timer").last_result is not None
        )
        worker = service.scheduler.tasks.pop("workflow-timer")
        worker.cancel()
        await asyncio.gather(worker, return_exceptions=True)
        schedule = service.scheduler.get("workflow-timer")
        schedule.timers[0].next_run_at = time.time() + 0.05
        service.store.save_workflow_schedule(schedule)
        service.scheduler._spawn("workflow-timer", schedule.generation)

        changed = initial.model_copy(deep=True)
        if change == "remove":
            changed.definition.nodes = [changed.definition.nodes[-1]]
            changed.definition.edges = []
        else:
            changed.definition.nodes[0].data["interval_seconds"] = 7200
        lock = service.scheduler._workflow_lock("workflow-timer")
        await lock.acquire()
        save_task = asyncio.create_task(service.save_workflow(changed))
        try:
            await asyncio.sleep(0.1)
            visible = service.get_workflow("workflow-timer")
            visible_timers = [
                node for node in visible.definition.nodes if node.type == "timer"
            ]
        finally:
            lock.release()
            await save_task
        final = service.scheduler.get("workflow-timer")

    assert len(visible_timers) == 1
    assert visible_timers[0].data["interval_seconds"] == 3600
    if change == "remove":
        assert final.status == "stopped"
        assert final.timers == []
    else:
        assert final.status == "scheduled"
        assert final.timers[0].next_run_at >= time.time() + 7100


@pytest.mark.anyio
async def test_failed_timer_save_restores_the_existing_schedule(
    tmp_path: Path, monkeypatch
) -> None:
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path / "data"))
    app = create_app(serve_frontend=False)
    async with app.router.lifespan_context(app):
        service = app.state.workflow_service
        initial = StoredWorkflow.model_validate(timer_workflow(interval_seconds=3600))
        await service.save_workflow(initial)
        await service.scheduler.start_schedule("workflow-timer")
        await _wait_until(
            lambda: service.scheduler.get("workflow-timer").last_result is not None
        )
        changed = initial.model_copy(deep=True)
        changed.definition.nodes[0].data["interval_seconds"] = 7200
        original_save = service.store.save_workflow

        def fail_changed_save(workflow):
            if workflow.definition.nodes[0].data["interval_seconds"] == 7200:
                raise RuntimeError("workflow save failed")
            return original_save(workflow)

        monkeypatch.setattr(service.store, "save_workflow", fail_changed_save)
        with pytest.raises(RuntimeError, match="workflow save failed"):
            await service.save_workflow(changed)
        stored = service.get_workflow("workflow-timer")
        schedule = service.scheduler.get("workflow-timer")
        worker = service.scheduler.tasks.get("workflow-timer")

    assert stored.definition.nodes[0].data["interval_seconds"] == 3600
    assert schedule.status == "scheduled"
    assert schedule.timers[0].next_run_at is not None
    assert worker is not None


@pytest.mark.anyio
async def test_failed_timer_save_recovers_a_claimed_run_with_an_accurate_trace(
    tmp_path: Path, monkeypatch
) -> None:
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path / "data"))
    app = create_app(serve_frontend=False)
    run_started = asyncio.Event()
    async with app.router.lifespan_context(app):
        service = app.state.workflow_service
        initial = StoredWorkflow.model_validate(timer_workflow(interval_seconds=3600))
        await service.save_workflow(initial)

        async def hold_run(*args, **kwargs):
            run_started.set()
            await asyncio.Future()

        monkeypatch.setattr(service, "run_workflow", hold_run)
        await service.scheduler.start_schedule("workflow-timer")
        await run_started.wait()
        changed = initial.model_copy(deep=True)
        changed.definition.nodes[0].data["interval_seconds"] = 7200
        original_save = service.store.save_workflow

        def fail_changed_save(workflow):
            if workflow.definition.nodes[0].data["interval_seconds"] == 7200:
                raise RuntimeError("workflow save failed")
            return original_save(workflow)

        monkeypatch.setattr(service.store, "save_workflow", fail_changed_save)
        with pytest.raises(RuntimeError, match="workflow save failed"):
            await service.save_workflow(changed)
        stored = service.get_workflow("workflow-timer")
        schedule = service.scheduler.get("workflow-timer")
        worker = service.scheduler.tasks.get("workflow-timer")

    assert stored.definition.nodes[0].data["interval_seconds"] == 3600
    assert schedule.status == "scheduled"
    assert schedule.timers[0].next_run_at >= time.time() + 3500
    assert schedule.last_result is not None
    assert schedule.last_result["status"] == "failed"
    assert "changes could not be saved" in schedule.last_error
    assert schedule.last_result["node_results"][0]["error"] == schedule.last_error
    assert worker is not None


@pytest.mark.anyio
async def test_concurrent_stale_timer_save_keeps_definition_and_schedule_aligned(
    tmp_path: Path, monkeypatch
) -> None:
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path / "data"))
    app = create_app(serve_frontend=False)
    reconcile_started = asyncio.Event()
    finish_reconcile = asyncio.Event()
    async with app.router.lifespan_context(app):
        service = app.state.workflow_service
        initial = StoredWorkflow.model_validate(timer_workflow(interval_seconds=3600))
        await service.save_workflow(initial)
        await service.scheduler.start_schedule("workflow-timer")
        await _wait_until(
            lambda: service.scheduler.get("workflow-timer").last_result is not None
        )
        original_reconcile = service.scheduler._reconcile

        async def hold_first_reconcile(old_workflow, workflow) -> None:
            if not reconcile_started.is_set():
                reconcile_started.set()
                await finish_reconcile.wait()
            await original_reconcile(old_workflow, workflow)

        monkeypatch.setattr(service.scheduler, "_reconcile", hold_first_reconcile)
        changed = initial.model_copy(deep=True)
        changed.definition.nodes[0].data["interval_seconds"] = 7200
        changed_save = asyncio.create_task(service.save_workflow(changed))
        await reconcile_started.wait()
        stale_save = asyncio.create_task(service.save_workflow(initial))
        await asyncio.sleep(0.05)
        finish_reconcile.set()
        await asyncio.gather(changed_save, stale_save)
        stored = service.get_workflow("workflow-timer")
        schedule = service.scheduler.get("workflow-timer")

    assert stored.definition.nodes[0].data["interval_seconds"] == 3600
    assert schedule.status == "scheduled"
    assert schedule.timers[0].next_run_at >= time.time() + 3500
    assert schedule.timers[0].next_run_at < time.time() + 3700
