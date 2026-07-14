from __future__ import annotations

import asyncio
import copy
from collections.abc import Callable
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import httpx
import pytest

from flowent.main import create_app
from flowent.sandbox import CommandResult
from flowent.storage import WorkflowDraft
from flowent.workflow_schedule_rules import next_cron_run_at
from flowent.workflow_tools import WorkflowAgentTools, workflow_tool_specs


def timer_workflow(
    *,
    cron: str = "",
    interval_seconds: object = 60,
    mode: str = "interval",
    payload: str = "tick",
    with_failure: bool = False,
    workflow_id: str = "workflow-timer",
) -> dict[str, object]:
    nodes: list[dict[str, object]] = [
        {
            "id": "timer",
            "kind": "timer",
            "config": {
                "cron": cron,
                "interval_seconds": interval_seconds,
                "mode": mode,
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
    previous_id = "timer"
    if with_failure:
        nodes.append(
            {
                "id": "code",
                "kind": "code",
                "config": {"code": "raise RuntimeError('scheduled failure')"},
            }
        )
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
        previous_id = "code"
    nodes.append(
        {
            "id": "output",
            "kind": "output",
            "config": {"output_key": "result", "transform": ""},
        }
    )
    presentation_nodes["output"] = {
        "name": "Output",
        "description": "",
        "position": {"x": 520 if with_failure else 260, "y": 0},
    }
    connection_id = f"{previous_id}-output"
    connections.append(
        {
            "id": connection_id,
            "from": {"node_id": previous_id, "port": "output"},
            "to": {"node_id": "output", "port": "input"},
        }
    )
    presentation_connections[connection_id] = {"label": ""}
    return {
        "id": workflow_id,
        "name": "Timer Workflow",
        "spec": {"nodes": nodes, "connections": connections},
        "presentation": {
            "nodes": presentation_nodes,
            "connections": presentation_connections,
        },
    }


def two_timer_workflow() -> dict[str, object]:
    workflow = timer_workflow(interval_seconds=60)
    workflow["spec"]["nodes"].extend(
        [
            {
                "id": "timer-b",
                "kind": "timer",
                "config": {
                    "cron": "",
                    "interval_seconds": 60,
                    "mode": "interval",
                    "payload": "beta",
                },
            },
            {
                "id": "output-b",
                "kind": "output",
                "config": {"output_key": "beta", "transform": ""},
            },
        ]
    )
    workflow["spec"]["connections"].append(
        {
            "id": "timer-b-output-b",
            "from": {"node_id": "timer-b", "port": "output"},
            "to": {"node_id": "output-b", "port": "input"},
        }
    )
    workflow["presentation"]["nodes"].update(
        {
            "timer-b": {
                "name": "Timer B",
                "description": "",
                "position": {"x": 0, "y": 120},
            },
            "output-b": {
                "name": "Output B",
                "description": "",
                "position": {"x": 260, "y": 120},
            },
        }
    )
    workflow["presentation"]["connections"]["timer-b-output-b"] = {"label": ""}
    return workflow


async def save_workflow(
    client: httpx.AsyncClient,
    workflow: dict[str, object],
    *,
    base_revision: int | None = None,
) -> dict[str, object]:
    response = await client.put(
        "/api/workflows",
        json={"base_revision": base_revision, "workflow": workflow},
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
        await save_workflow(client, timer_workflow())
        started = await client.post(
            "/api/workflows/workflow-timer/schedule/start", json={}
        )
        completed = await wait_for_schedule(
            client,
            "workflow-timer",
            lambda value: isinstance(value.get("last_result"), dict),
        )

    assert started.status_code == 200
    assert completed["status"] == "scheduled"
    assert completed["last_result"]["outputs"] == {"result": "tick"}
    assert completed["last_result"]["trigger"] == "schedule"
    assert completed["last_result"]["workflow_revision"] == 1


@pytest.mark.anyio
async def test_schedule_failure_persists_structured_trace_and_pauses(
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
        await save_workflow(client, timer_workflow(with_failure=True))
        await client.post("/api/workflows/workflow-timer/schedule/start", json={})
        failed = await wait_for_schedule(
            client,
            "workflow-timer",
            lambda value: value.get("status") == "error",
        )

    trace = failed["last_result"]
    code_result = next(
        result for result in trace["node_results"] if result["id"] == "code"
    )
    assert failed["last_error"] == "RuntimeError: scheduled failure"
    assert code_result["inputs"] == ["tick"]
    assert code_result["error"] == {
        "code": "node_execution_failed",
        "message": "RuntimeError: scheduled failure",
    }


@pytest.mark.anyio
async def test_invalid_interval_is_saved_as_draft_without_replacing_active(
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
        created = await save_workflow(client, timer_workflow())
        invalid = timer_workflow(interval_seconds=0)
        saved = await save_workflow(
            client, invalid, base_revision=int(created["revision"])
        )
        started = await client.post(
            "/api/workflows/workflow-timer/schedule/start", json={}
        )

    assert saved["revision"] == 2
    assert saved["active_revision"] == 1
    assert started.status_code == 200


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
        await save_workflow(client, timer_workflow())
        await client.post("/api/workflows/workflow-timer/schedule/start", json={})
        first = await wait_for_schedule(
            client,
            "workflow-timer",
            lambda value: value.get("last_run_at") is not None,
        )
        stopped = await client.post("/api/workflows/workflow-timer/schedule/stop")
        await asyncio.sleep(1.05)
        final = (await client.get("/api/workflows/workflow-timer/schedule")).json()

    assert stopped.json()["status"] == "stopped"
    assert final["last_run_at"] == first["last_run_at"]


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
            transport=httpx.ASGITransport(app=first_app),
            base_url="http://testserver",
        ) as client,
    ):
        await save_workflow(client, timer_workflow())
        await client.post("/api/workflows/workflow-timer/schedule/start", json={})
        before = await wait_for_schedule(
            client,
            "workflow-timer",
            lambda value: value.get("last_result") is not None,
        )

    second_app = create_app(serve_frontend=False)
    async with (
        second_app.router.lifespan_context(second_app),
        httpx.AsyncClient(
            transport=httpx.ASGITransport(app=second_app),
            base_url="http://testserver",
        ) as client,
    ):
        recovered = (await client.get("/api/workflows/workflow-timer/schedule")).json()

    assert recovered["status"] == "scheduled"
    assert recovered["last_result"]["run_id"] == before["last_result"]["run_id"]
    assert recovered["next_run_at"] is not None


@pytest.mark.anyio
async def test_agent_schedule_tools_start_stop_and_get(
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
        tools = WorkflowAgentTools(service)
        started = await tools.run_tool(
            "start_workflow_schedule", {"workflow_id": "workflow-timer"}
        )
        read = await tools.run_tool(
            "get_workflow_schedule", {"workflow_id": "workflow-timer"}
        )
        stopped = await tools.run_tool(
            "stop_workflow_schedule", {"workflow_id": "workflow-timer"}
        )

    tool_names = {item["function"]["name"] for item in workflow_tool_specs()}
    assert started is not None and started.ok is True
    assert read is not None and read.result["status"] in {"scheduled", "running"}
    assert stopped is not None and stopped.result["status"] == "stopped"
    assert {
        "get_workflow_schedule",
        "start_workflow_schedule",
        "stop_workflow_schedule",
    }.issubset(tool_names)


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
        await save_workflow(client, timer_workflow())
        await client.post(
            "/api/workflows/workflow-timer/schedule/start", json={"input": "first"}
        )
        first = await wait_for_schedule(
            client,
            "workflow-timer",
            lambda value: value.get("last_result") is not None,
        )
        second = await client.post(
            "/api/workflows/workflow-timer/schedule/start", json={"input": "first"}
        )

    assert second.status_code == 200
    assert second.json()["next_run_at"] == first["next_run_at"]
    assert second.json()["last_run_at"] == first["last_run_at"]


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
    app = create_app(serve_frontend=False)
    async with (
        app.router.lifespan_context(app),
        httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://testserver"
        ) as client,
    ):
        await save_workflow(
            client,
            timer_workflow(cron="*/5 * * * *", mode="cron"),
        )
        missing = await client.post(
            "/api/workflows/workflow-timer/schedule/start", json={}
        )
        started = await client.post(
            "/api/workflows/workflow-timer/schedule/start",
            json={"timezone": "Asia/Shanghai"},
        )

    assert missing.status_code == 400
    assert missing.json()["detail"] == (
        "Timer timezone is required for cron schedules."
    )
    assert started.status_code == 200
    assert started.json()["timezone"] == "Asia/Shanghai"


@pytest.mark.anyio
async def test_all_due_timers_run_without_resetting_each_other(
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
        await save_workflow(client, two_timer_workflow())
        service = app.state.workflow_service
        original = service.run_workflow
        timer_ids: list[str] = []

        async def record_run(workflow_id: str, **kwargs):
            timer_ids.append(str(kwargs.get("timer_node_id")))
            return await original(workflow_id, **kwargs)

        monkeypatch.setattr(service, "run_workflow", record_run)
        await client.post("/api/workflows/workflow-timer/schedule/start", json={})
        await asyncio.wait_for(wait_until(lambda: len(timer_ids) >= 2), timeout=3)

    assert set(timer_ids[:2]) == {"timer", "timer-b"}


@pytest.mark.anyio
async def test_active_schedule_reconciles_timer_configuration(
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
        created = await save_workflow(client, timer_workflow(interval_seconds=60))
        await client.post("/api/workflows/workflow-timer/schedule/start", json={})
        before = await wait_for_schedule(
            client,
            "workflow-timer",
            lambda value: value.get("last_result") is not None,
        )
        changed = timer_workflow(interval_seconds=120)
        saved = await save_workflow(
            client, changed, base_revision=int(created["revision"])
        )
        after = (await client.get("/api/workflows/workflow-timer/schedule")).json()

    assert saved["active_revision"] == 2
    assert after["status"] == "scheduled"
    assert after["next_run_at"] > before["next_run_at"]


@pytest.mark.anyio
async def test_running_schedule_ignores_presentation_only_saves(
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
        created = await save_workflow(client, workflow)
        await client.post("/api/workflows/workflow-timer/schedule/start", json={})
        before = await wait_for_schedule(
            client,
            "workflow-timer",
            lambda value: value.get("last_result") is not None,
        )
        moved = copy.deepcopy(workflow)
        moved["presentation"]["nodes"]["timer"]["position"] = {
            "x": 420,
            "y": 180,
        }
        saved = await save_workflow(
            client, moved, base_revision=int(created["revision"])
        )
        after = (await client.get("/api/workflows/workflow-timer/schedule")).json()

    assert saved["revision"] == 2
    assert saved["active_revision"] == 1
    assert after["next_run_at"] == before["next_run_at"]


@pytest.mark.anyio
async def test_timer_change_interrupts_claimed_run_with_structured_trace(
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
        created = await save_workflow(client, timer_workflow())
        service = app.state.workflow_service
        claimed = asyncio.Event()

        async def hold_run(*args, **kwargs):
            claimed.set()
            await asyncio.Event().wait()

        monkeypatch.setattr(service, "run_workflow", hold_run)
        await client.post("/api/workflows/workflow-timer/schedule/start", json={})
        await asyncio.wait_for(claimed.wait(), timeout=2)
        changed = timer_workflow(interval_seconds=120)
        await save_workflow(client, changed, base_revision=int(created["revision"]))
        interrupted = (
            await client.get("/api/workflows/workflow-timer/schedule")
        ).json()

    assert interrupted["status"] == "scheduled"
    assert interrupted["last_result"]["workflow_revision"] == 1
    assert interrupted["last_result"]["node_results"][0]["error"]["code"] == (
        "run_interrupted"
    )


@pytest.mark.anyio
async def test_unexpected_scheduler_exception_is_persisted(
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
        await save_workflow(client, timer_workflow())
        service = app.state.workflow_service

        async def fail(*args, **kwargs):
            raise RuntimeError("scheduler exploded")

        monkeypatch.setattr(service, "run_workflow", fail)
        await client.post("/api/workflows/workflow-timer/schedule/start", json={})
        failed = await wait_for_schedule(
            client,
            "workflow-timer",
            lambda value: value.get("status") == "error",
        )

    assert failed["last_error"] == "scheduler exploded"
    assert failed["next_run_at"] is None


async def wait_until(predicate: Callable[[], bool]) -> None:
    while not predicate():
        await asyncio.sleep(0.01)
