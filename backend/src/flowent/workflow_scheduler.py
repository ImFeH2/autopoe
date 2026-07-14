from __future__ import annotations

import asyncio
import logging
import math
import time
from collections.abc import Mapping
from datetime import datetime
from typing import TYPE_CHECKING, Literal, Protocol
from uuid import uuid4
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from flowent.state.models import WorkflowTimerNode
from flowent.storage import (
    StoredWorkflow,
    StoredWorkflowRevision,
    StoredWorkflowSchedule,
    StoredWorkflowScheduleTimer,
    StoredWorkflowSpec,
    WorkflowDraft,
    WorkflowRepository,
)
from flowent.workflow_schedule_rules import next_cron_run_at

if TYPE_CHECKING:
    from flowent.workflows import WorkflowRunResponse

logger = logging.getLogger("flowent.workflow_scheduler")


class WorkflowSchedulingService(Protocol):
    workflow_repository: WorkflowRepository

    def get_workflow(self, workflow_id: str) -> StoredWorkflow: ...

    def get_active_revision(self, workflow_id: str) -> StoredWorkflowRevision: ...

    def get_workflow_revision(
        self, workflow_id: str, revision: int
    ) -> StoredWorkflowRevision: ...

    async def run_workflow(
        self,
        workflow_id: str,
        *,
        default_input: str = "",
        input_values: Mapping[str, str] | None = None,
        timer_node_id: str = "",
        trigger: Literal["manual", "schedule"] = "manual",
        run_id: str | None = None,
        workflow_revision: int | None = None,
        workflow_depth: int = 0,
    ) -> WorkflowRunResponse: ...


class WorkflowScheduler:
    def __init__(self, service: WorkflowSchedulingService) -> None:
        self.service = service
        self.workflow_repository = service.workflow_repository
        self.tasks: dict[str, asyncio.Task[None]] = {}
        self.workflow_locks: dict[str, asyncio.Lock] = {}

    async def start(self) -> None:
        for schedule in self.workflow_repository.read_workflow_schedules():
            if schedule.status not in {"scheduled", "running"}:
                continue
            active_revision = self.service.get_active_revision(schedule.workflow_id)
            if (
                schedule.status == "running"
                or schedule.scheduled_revision != active_revision.revision
            ):
                schedule.generation += 1
                self._apply_revision(
                    schedule,
                    active_revision,
                    interrupt_message=(
                        "Workflow run was interrupted when Flowent restarted."
                        if schedule.status == "running"
                        else ""
                    ),
                )
                self.workflow_repository.save_workflow_schedule(schedule)
            if schedule.status == "scheduled":
                self._spawn(schedule.workflow_id, schedule.generation)

    async def shutdown(self) -> None:
        tasks = list(self.tasks.values())
        self.tasks.clear()
        for task in tasks:
            task.cancel()
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)

    def get(self, workflow_id: str) -> StoredWorkflowSchedule:
        self.service.get_workflow(workflow_id)
        return self.workflow_repository.read_workflow_schedule(
            workflow_id
        ) or StoredWorkflowSchedule(workflow_id=workflow_id)

    async def start_schedule(
        self,
        workflow_id: str,
        *,
        default_input: str | None = None,
        inputs: dict[str, str] | None = None,
        timezone: str | None = None,
        workflow_revision: int | None = None,
    ) -> StoredWorkflowSchedule:
        async with self._workflow_lock(workflow_id):
            return await self._start_schedule(
                workflow_id,
                default_input=default_input,
                inputs=inputs,
                timezone=timezone,
                workflow_revision=workflow_revision,
            )

    async def _start_schedule(
        self,
        workflow_id: str,
        *,
        default_input: str | None,
        inputs: dict[str, str] | None,
        timezone: str | None,
        workflow_revision: int | None,
    ) -> StoredWorkflowSchedule:
        revision = self.service.get_active_revision(workflow_id)
        if workflow_revision is not None and revision.revision != workflow_revision:
            self.service.get_workflow_revision(workflow_id, workflow_revision)
            raise ValueError(
                "This workflow changed elsewhere. Open the latest version before starting it."
            )
        existing = self.workflow_repository.read_workflow_schedule(workflow_id)
        has_cron = any(
            node.config.mode == "cron" for node in timer_nodes(revision.spec)
        )
        if timezone is None and existing is None and has_cron:
            raise ValueError("Timer timezone is required for cron schedules.")
        selected_timezone = timezone or (existing.timezone if existing else "UTC")
        self._timezone(selected_timezone)
        selected_input = (
            default_input
            if default_input is not None
            else (existing.default_input if existing else "")
        )
        selected_inputs = (
            inputs if inputs is not None else (existing.inputs if existing else {})
        )
        unchanged = (
            existing is not None
            and existing.status in {"scheduled", "running"}
            and selected_input == existing.default_input
            and selected_inputs == existing.inputs
            and selected_timezone == existing.timezone
            and existing.scheduled_revision == revision.revision
        )
        if unchanged:
            assert existing is not None
            return existing
        generation = existing.generation + 1 if existing else 1
        timers = self._immediate_timers(revision.spec)
        if not timers:
            raise ValueError("Workflow does not have a Timer node.")
        schedule = StoredWorkflowSchedule(
            workflow_id=workflow_id,
            status="scheduled",
            generation=generation,
            default_input=selected_input,
            inputs=selected_inputs,
            scheduled_revision=revision.revision,
            timezone=selected_timezone,
            timers=timers,
            last_result=existing.last_result if existing else None,
            last_run_at=existing.last_run_at if existing else None,
        )
        old = self.tasks.pop(workflow_id, None)
        if old:
            old.cancel()
            await asyncio.gather(old, return_exceptions=True)
            refreshed = self.workflow_repository.read_workflow_schedule(workflow_id)
            if refreshed is not None:
                schedule.last_result = refreshed.last_result
                schedule.last_run_at = refreshed.last_run_at
        self.workflow_repository.save_workflow_schedule(schedule)
        self._spawn(workflow_id, generation)
        return schedule

    async def stop_schedule(self, workflow_id: str) -> StoredWorkflowSchedule:
        async with self._workflow_lock(workflow_id):
            task = self.tasks.pop(workflow_id, None)
            if task:
                task.cancel()
                await asyncio.gather(task, return_exceptions=True)
            schedule = self.get(workflow_id)
            schedule.generation += 1
            schedule.status = "stopped"
            schedule.timers = []
            self._clear_running(schedule)
            self.workflow_repository.save_workflow_schedule(schedule)
            return schedule

    async def delete(self, workflow_id: str) -> None:
        async with self._workflow_lock(workflow_id):
            task = self.tasks.pop(workflow_id, None)
            if task:
                task.cancel()
                await asyncio.gather(task, return_exceptions=True)

    async def save_workflow(
        self,
        workflow: WorkflowDraft,
        *,
        base_revision: int | None,
        executable: bool,
    ):
        async with self._workflow_lock(workflow.id):
            old_revision = self.workflow_repository.read_active_workflow_revision(
                workflow.id
            )
            saved = self.workflow_repository.save_workflow(
                workflow,
                base_revision=base_revision,
                executable=executable,
            )
            new_revision = self.workflow_repository.read_active_workflow_revision(
                workflow.id
            )
            if timer_signatures(old_revision) == timer_signatures(new_revision):
                schedule = self.workflow_repository.read_workflow_schedule(workflow.id)
                if schedule is not None and new_revision is not None:
                    schedule.scheduled_revision = new_revision.revision
                    self.workflow_repository.save_workflow_schedule(schedule)
                return saved
            task = self.tasks.pop(workflow.id, None)
            if task:
                task.cancel()
                await asyncio.gather(task, return_exceptions=True)
            await self._reconcile_safely(
                workflow.id,
                old_revision,
                new_revision,
            )
            return saved

    async def _reconcile_safely(
        self,
        workflow_id: str,
        old_revision: StoredWorkflowRevision | None,
        new_revision: StoredWorkflowRevision | None,
    ) -> None:
        try:
            await self._reconcile(workflow_id, old_revision, new_revision)
        except asyncio.CancelledError:
            raise
        except Exception as error:
            schedule = self.workflow_repository.read_workflow_schedule(workflow_id)
            if schedule is not None:
                schedule.generation += 1
                schedule.status = "error"
                schedule.last_error = str(error) or "Workflow schedule failed."
                schedule.last_result = None
                schedule.timers = []
                self._clear_running(schedule)
                self.workflow_repository.save_workflow_schedule(schedule)

    async def _reconcile(
        self,
        workflow_id: str,
        old_revision: StoredWorkflowRevision | None,
        new_revision: StoredWorkflowRevision | None,
    ) -> None:
        schedule = self.workflow_repository.read_workflow_schedule(workflow_id)
        if schedule is None or schedule.status not in {"scheduled", "running"}:
            return
        schedule.generation += 1
        self._apply_revision(
            schedule,
            new_revision,
            interrupt_message=(
                "Workflow run was interrupted because the Timer schedule changed."
                if schedule.status == "running"
                else ""
            ),
        )
        self.workflow_repository.save_workflow_schedule(schedule)
        if schedule.status == "scheduled":
            self._spawn(workflow_id, schedule.generation)

    def _spawn(self, workflow_id: str, generation: int) -> None:
        task = asyncio.create_task(self._run(workflow_id, generation))
        self.tasks[workflow_id] = task
        task.add_done_callback(self._task_done)

    def _task_done(self, task: asyncio.Task[None]) -> None:
        if not task.cancelled():
            task.exception()

    async def _run(self, workflow_id: str, generation: int) -> None:
        persisted_run_id: str | None = None
        try:
            while True:
                schedule = self.workflow_repository.read_workflow_schedule(workflow_id)
                if (
                    schedule is None
                    or schedule.generation != generation
                    or schedule.status not in {"scheduled", "running"}
                ):
                    return
                due_timers = [
                    (timer.next_run_at, timer)
                    for timer in schedule.timers
                    if timer.next_run_at is not None
                ]
                if not due_timers:
                    return
                next_run_at, due = min(due_timers, key=lambda item: item[0])
                await asyncio.sleep(max(0, next_run_at - time.time()))
                async with self._workflow_lock(workflow_id):
                    schedule = self.workflow_repository.read_workflow_schedule(
                        workflow_id
                    )
                    if (
                        schedule is None
                        or schedule.generation != generation
                        or schedule.status not in {"scheduled", "running"}
                    ):
                        return
                    revision = self.service.get_active_revision(workflow_id)
                    run_id = str(uuid4())
                    persisted_run_id = None
                    schedule.status = "running"
                    schedule.running_revision = revision.revision
                    schedule.running_run_id = run_id
                    schedule.running_timer_node_id = due.timer_node_id
                    schedule.timers = [
                        item.model_copy(update={"next_run_at": None})
                        if item.timer_node_id == due.timer_node_id
                        else item
                        for item in schedule.timers
                    ]
                    if not self.workflow_repository.save_workflow_schedule(
                        schedule, expected_generation=generation
                    ):
                        return
                result = await self.service.run_workflow(
                    workflow_id,
                    default_input=schedule.default_input,
                    input_values=schedule.inputs,
                    run_id=run_id,
                    timer_node_id=due.timer_node_id,
                    trigger="schedule",
                    workflow_revision=revision.revision,
                )
                persisted_run_id = run_id
                current_task = asyncio.current_task()
                if current_task is not None and current_task.cancelling():
                    raise asyncio.CancelledError
                async with self._workflow_lock(workflow_id):
                    schedule = self.workflow_repository.read_workflow_schedule(
                        workflow_id
                    )
                    if (
                        schedule is None
                        or schedule.generation != generation
                        or schedule.running_run_id != run_id
                    ):
                        return
                    schedule.last_run_at = time.time()
                    schedule.last_result = result.model_dump(mode="json")
                    if result.status == "failed":
                        schedule.status = "error"
                        schedule.last_error = next(
                            (
                                item.error.message
                                for item in result.node_results
                                if item.error is not None
                            ),
                            "Workflow run failed.",
                        )
                        schedule.timers = []
                    else:
                        schedule.status = "scheduled"
                        schedule.last_error = ""
                        active_revision = self.service.get_active_revision(workflow_id)
                        next_run = next(
                            item.next_run_at
                            for item in self._future_timers(
                                active_revision.spec, schedule.timezone
                            )
                            if item.timer_node_id == due.timer_node_id
                        )
                        schedule.timers = [
                            item.model_copy(update={"next_run_at": next_run})
                            if item.timer_node_id == due.timer_node_id
                            else item
                            for item in schedule.timers
                        ]
                        schedule.scheduled_revision = active_revision.revision
                    self._clear_running(schedule)
                    self.workflow_repository.save_workflow_schedule(
                        schedule, expected_generation=generation
                    )
                if result.status == "failed":
                    return
        except asyncio.CancelledError:
            raise
        except Exception as error:
            logger.exception("Workflow schedule failed workflow_id=%s", workflow_id)
            async with self._workflow_lock(workflow_id):
                schedule = self.workflow_repository.read_workflow_schedule(workflow_id)
                if schedule is not None and schedule.generation == generation:
                    message = str(error) or "Workflow schedule failed."
                    if schedule.running_run_id == persisted_run_id:
                        schedule.running_run_id = ""
                    self._mark_schedule_failure(schedule, message)
                    schedule.status = "error"
                    schedule.last_error = message
                    schedule.timers = []
                    self._clear_running(schedule)
                    self.workflow_repository.save_workflow_schedule(
                        schedule, expected_generation=generation
                    )

    def _immediate_timers(
        self, spec: StoredWorkflowSpec
    ) -> list[StoredWorkflowScheduleTimer]:
        self._validate_timers(spec)
        now = time.time()
        return [
            StoredWorkflowScheduleTimer(timer_node_id=node.id, next_run_at=now)
            for node in timer_nodes(spec)
        ]

    def _future_timers(
        self, spec: StoredWorkflowSpec, timezone: str
    ) -> list[StoredWorkflowScheduleTimer]:
        self._validate_timers(spec)
        return [
            StoredWorkflowScheduleTimer(
                timer_node_id=node.id,
                next_run_at=self._next_run(node, timezone),
            )
            for node in timer_nodes(spec)
        ]

    def _apply_revision(
        self,
        schedule: StoredWorkflowSchedule,
        revision: StoredWorkflowRevision | None,
        *,
        interrupt_message: str,
    ) -> None:
        scheduled_revision = (
            self.workflow_repository.read_workflow_revision(
                schedule.workflow_id, schedule.scheduled_revision
            )
            if schedule.scheduled_revision is not None
            else None
        )
        claimed_timer_ids = {
            item.timer_node_id for item in schedule.timers if item.next_run_at is None
        }
        if schedule.running_timer_node_id:
            claimed_timer_ids.add(schedule.running_timer_node_id)
        if interrupt_message and claimed_timer_ids:
            self._mark_interrupted(
                schedule,
                claimed_timer_ids,
                scheduled_revision,
                interrupt_message,
            )
        existing = {item.timer_node_id: item for item in schedule.timers}
        old_signatures = timer_signatures(scheduled_revision)
        new_timers = timer_nodes(revision.spec) if revision is not None else []
        schedule.timers = [
            existing[node.id]
            if node.id in existing
            and node.id not in claimed_timer_ids
            and old_signatures.get(node.id) == timer_signature(node)
            else StoredWorkflowScheduleTimer(
                timer_node_id=node.id,
                next_run_at=self._next_run(node, schedule.timezone),
            )
            for node in new_timers
        ]
        schedule.scheduled_revision = revision.revision if revision else None
        schedule.status = "scheduled" if schedule.timers else "stopped"
        self._clear_running(schedule)

    def _mark_interrupted(
        self,
        schedule: StoredWorkflowSchedule,
        timer_node_ids: set[str],
        revision: StoredWorkflowRevision | None,
        message: str,
    ) -> None:
        if not timer_node_ids:
            return
        workflow_revision = schedule.running_revision or (
            revision.revision if revision is not None else None
        )
        run_id = schedule.running_run_id or str(uuid4())
        schedule.last_run_at = time.time()
        schedule.last_error = message
        trace = {
            "run_id": run_id,
            "workflow_revision": workflow_revision or 0,
            "workflow_id": schedule.workflow_id,
            "status": "failed",
            "trigger": "schedule",
            "outputs": {},
            "node_results": [
                {
                    "id": timer_node_id,
                    "status": "failed",
                    "inputs": [],
                    "output": "",
                    "error": {"code": "run_interrupted", "message": message},
                }
                for timer_node_id in sorted(timer_node_ids)
            ],
        }
        schedule.last_result = trace
        if workflow_revision is not None:
            self.workflow_repository.save_workflow_run(
                {
                    **trace,
                    "inputs": {
                        "default_input": schedule.default_input,
                        "values": schedule.inputs,
                    },
                }
            )

    def _mark_schedule_failure(
        self, schedule: StoredWorkflowSchedule, message: str
    ) -> None:
        timer_node_id = schedule.running_timer_node_id
        workflow_revision = schedule.running_revision
        if not timer_node_id or workflow_revision is None:
            schedule.last_result = None
            return
        run_id = schedule.running_run_id or str(uuid4())
        trace = {
            "run_id": run_id,
            "workflow_revision": workflow_revision,
            "workflow_id": schedule.workflow_id,
            "status": "failed",
            "trigger": "schedule",
            "outputs": {},
            "node_results": [
                {
                    "id": timer_node_id,
                    "status": "failed",
                    "inputs": [],
                    "output": "",
                    "error": {"code": "schedule_failed", "message": message},
                }
            ],
        }
        schedule.last_run_at = time.time()
        schedule.last_result = trace
        self.workflow_repository.save_workflow_run(
            {
                **trace,
                "inputs": {
                    "default_input": schedule.default_input,
                    "values": schedule.inputs,
                },
            }
        )

    def _clear_running(self, schedule: StoredWorkflowSchedule) -> None:
        schedule.running_revision = None
        schedule.running_run_id = ""
        schedule.running_timer_node_id = ""

    def _validate_timers(self, spec: StoredWorkflowSpec) -> None:
        for node in timer_nodes(spec):
            self._next_run(node, "UTC")

    def _next_run(self, node: WorkflowTimerNode, timezone: str) -> float:
        if node.config.mode == "cron":
            now = datetime.now(self._timezone(timezone))
            return next_cron_run_at(node.config.cron, now).timestamp()
        seconds = node.config.interval_seconds
        if not math.isfinite(seconds) or seconds < 1:
            raise ValueError("Timer interval must be at least 1 second.")
        return time.time() + seconds

    def _timezone(self, value: str) -> ZoneInfo:
        try:
            return ZoneInfo(value)
        except ZoneInfoNotFoundError as error:
            raise ValueError("Timer timezone is invalid.") from error

    def _workflow_lock(self, workflow_id: str) -> asyncio.Lock:
        return self.workflow_locks.setdefault(workflow_id, asyncio.Lock())


def timer_nodes(spec: StoredWorkflowSpec) -> list[WorkflowTimerNode]:
    return [node for node in spec.nodes if isinstance(node, WorkflowTimerNode)]


def timer_signature(node: WorkflowTimerNode) -> tuple[object, ...]:
    return (node.config.mode, node.config.interval_seconds, node.config.cron)


def timer_signatures(
    revision: StoredWorkflowRevision | None,
) -> dict[str, tuple[object, ...]]:
    if revision is None:
        return {}
    return {node.id: timer_signature(node) for node in timer_nodes(revision.spec)}
