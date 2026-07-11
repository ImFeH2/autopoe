from __future__ import annotations

import asyncio
import logging
import math
import time
from dataclasses import dataclass
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from flowent.storage import StoredWorkflowSchedule, StoredWorkflowScheduleTimer

logger = logging.getLogger("flowent.workflow_scheduler")


@dataclass(frozen=True)
class CronField:
    values: frozenset[int]
    wildcard: bool


def parse_cron_field(
    field: str, minimum: int, maximum: int, *, weekday: bool = False
) -> CronField:
    values: set[int] = set()
    for part in field.split(","):
        pieces = part.split("/")
        if len(pieces) > 2:
            raise ValueError("Timer cron expression is invalid.")
        range_part = pieces[0]
        try:
            step = int(pieces[1]) if len(pieces) == 2 else 1
        except ValueError as error:
            raise ValueError("Timer cron expression is invalid.") from error
        if step < 1:
            raise ValueError("Timer cron expression is invalid.")
        if range_part == "*":
            start, end = minimum, maximum
        else:
            bounds = range_part.split("-")
            if len(bounds) > 2:
                raise ValueError("Timer cron expression is invalid.")
            try:
                start = int(bounds[0])
                end = int(bounds[1]) if len(bounds) == 2 else start
            except ValueError as error:
                raise ValueError("Timer cron expression is invalid.") from error
            if start < minimum or end > maximum or start > end:
                raise ValueError("Timer cron expression is invalid.")
        for value in range(start, end + 1, step):
            values.add(0 if weekday and value == 7 else value)
    if not values:
        raise ValueError("Timer cron expression is invalid.")
    complete_values = set(range(minimum, maximum + 1))
    if weekday:
        complete_values = {0 if value == 7 else value for value in complete_values}
    return CronField(frozenset(values), values == complete_values)


def next_cron_run_at(expression: str, now: datetime) -> datetime:
    parts = expression.strip().split()
    if len(parts) != 5:
        raise ValueError("Timer cron expression is invalid.")
    minute = parse_cron_field(parts[0], 0, 59)
    hour = parse_cron_field(parts[1], 0, 23)
    day = parse_cron_field(parts[2], 1, 31)
    month = parse_cron_field(parts[3], 1, 12)
    weekday = parse_cron_field(parts[4], 0, 7, weekday=True)
    allowed_times = [
        (hour_value, minute_value)
        for hour_value in sorted(hour.values)
        for minute_value in sorted(minute.values)
    ]
    for day_offset in range(146_097):
        candidate_date = now.date() + timedelta(days=day_offset)
        if candidate_date.month not in month.values:
            continue
        day_matches = candidate_date.day in day.values
        weekday_matches = (candidate_date.weekday() + 1) % 7 in weekday.values
        calendar_matches = (
            day_matches and weekday_matches
            if day.wildcard or weekday.wildcard
            else day_matches or weekday_matches
        )
        if not calendar_matches:
            continue
        for hour_value, minute_value in allowed_times:
            candidate = datetime(
                candidate_date.year,
                candidate_date.month,
                candidate_date.day,
                hour_value,
                minute_value,
                tzinfo=now.tzinfo,
            )
            if candidate > now:
                return candidate
    raise ValueError("Timer cron expression has no upcoming run.")


class WorkflowScheduler:
    def __init__(self, service) -> None:
        self.service = service
        self.store = service.store
        self.tasks: dict[str, asyncio.Task[None]] = {}
        self.workflow_locks: dict[str, asyncio.Lock] = {}

    async def start(self) -> None:
        for schedule in self.store.read_workflow_schedules():
            if schedule.status in {"scheduled", "running"}:
                if schedule.status == "running":
                    workflow = self.service.get_workflow(schedule.workflow_id)
                    schedule.generation += 1
                    self._recover_interrupted_schedule(schedule, workflow)
                    self.store.save_workflow_schedule(schedule)
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
        return self.store.read_workflow_schedule(workflow_id) or StoredWorkflowSchedule(
            workflow_id=workflow_id
        )

    async def start_schedule(
        self,
        workflow_id: str,
        *,
        default_input: str | None = None,
        inputs: dict[str, str] | None = None,
        timezone: str | None = None,
    ) -> StoredWorkflowSchedule:
        async with self._workflow_lock(workflow_id):
            return await self._start_schedule(
                workflow_id,
                default_input=default_input,
                inputs=inputs,
                timezone=timezone,
            )

    async def _start_schedule(
        self,
        workflow_id: str,
        *,
        default_input: str | None = None,
        inputs: dict[str, str] | None = None,
        timezone: str | None = None,
    ) -> StoredWorkflowSchedule:
        workflow = self.service.get_workflow(workflow_id)
        existing = self.store.read_workflow_schedule(workflow_id)
        has_cron = any(
            node.type == "timer" and str(node.data.get("mode", "interval")) == "cron"
            for node in workflow.definition.nodes
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
        )
        if unchanged:
            return existing
        generation = (existing.generation + 1) if existing else 1
        timers = self._immediate_timers(workflow)
        if not timers:
            raise ValueError("Workflow does not have a Timer node.")
        schedule = StoredWorkflowSchedule(
            workflow_id=workflow_id,
            status="scheduled",
            generation=generation,
            default_input=selected_input,
            inputs=selected_inputs,
            timezone=selected_timezone,
            timers=timers,
            last_result=existing.last_result if existing else None,
            last_run_at=existing.last_run_at if existing else None,
        )
        old = self.tasks.pop(workflow_id, None)
        if old:
            old.cancel()
            await asyncio.gather(old, return_exceptions=True)
            existing = self.store.read_workflow_schedule(workflow_id) or existing
            schedule.last_result = existing.last_result
            schedule.last_run_at = existing.last_run_at
        self.store.save_workflow_schedule(schedule)
        self._spawn(workflow_id, generation)
        return schedule

    async def stop_schedule(self, workflow_id: str) -> StoredWorkflowSchedule:
        async with self._workflow_lock(workflow_id):
            return await self._stop_schedule(workflow_id)

    async def _stop_schedule(self, workflow_id: str) -> StoredWorkflowSchedule:
        task = self.tasks.pop(workflow_id, None)
        if task:
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)
        schedule = self.get(workflow_id)
        schedule.generation += 1
        schedule.status = "stopped"
        schedule.timers = []
        self.store.save_workflow_schedule(schedule)
        return schedule

    async def delete(self, workflow_id: str) -> None:
        async with self._workflow_lock(workflow_id):
            await self._delete(workflow_id)

    async def _delete(self, workflow_id: str) -> None:
        task = self.tasks.pop(workflow_id, None)
        if task:
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)

    async def save_workflow(self, workflow):
        async with self._workflow_lock(workflow.id):
            old_workflow = self.service.get_workflow(workflow.id)
            if not self._timer_schedule_changed(old_workflow, workflow):
                return self.store.save_workflow(workflow)
            task = self.tasks.pop(workflow.id, None)
            if task:
                task.cancel()
                await asyncio.gather(task, return_exceptions=True)
            try:
                saved = self.store.save_workflow(workflow)
            except Exception:
                self._resume_after_failed_save(old_workflow)
                raise
            await self._reconcile_safely(old_workflow, saved)
            return saved

    async def _reconcile(self, old_workflow, workflow) -> None:
        schedule = self.store.read_workflow_schedule(workflow.id)
        if schedule is None or schedule.status not in {"scheduled", "running"}:
            return
        old_task = self.tasks.pop(workflow.id, None)
        if old_task:
            old_task.cancel()
            await asyncio.gather(old_task, return_exceptions=True)
        schedule = self.store.read_workflow_schedule(workflow.id)
        if schedule is None or schedule.status not in {"scheduled", "running"}:
            return
        was_running = schedule.status == "running"
        claimed_timer_ids = {
            item.timer_node_id for item in schedule.timers if item.next_run_at is None
        }
        old_nodes = {
            node.id: self._timer_signature(node)
            for node in old_workflow.definition.nodes
            if node.type == "timer"
        }
        new_nodes = {
            node.id: node for node in workflow.definition.nodes if node.type == "timer"
        }
        schedule.generation += 1
        if not new_nodes:
            schedule.status = "stopped"
            schedule.timers = []
            if was_running:
                self._mark_interrupted(
                    schedule,
                    claimed_timer_ids,
                    "Workflow run was interrupted because the Timer schedule changed.",
                )
            self.store.save_workflow_schedule(schedule)
            return
        existing = {item.timer_node_id: item for item in schedule.timers}
        timers: list[StoredWorkflowScheduleTimer] = []
        for node_id, node in new_nodes.items():
            if (
                node_id in existing
                and node_id not in claimed_timer_ids
                and old_nodes.get(node_id) == self._timer_signature(node)
            ):
                timers.append(existing[node_id])
            else:
                timers.append(
                    StoredWorkflowScheduleTimer(
                        timer_node_id=node_id,
                        next_run_at=self._next_run(node, schedule.timezone),
                    )
                )
        schedule.status = "scheduled"
        schedule.timers = timers
        if was_running:
            self._mark_interrupted(
                schedule,
                claimed_timer_ids,
                "Workflow run was interrupted because the Timer schedule changed.",
            )
        self.store.save_workflow_schedule(schedule)
        self._spawn(workflow.id, schedule.generation)

    async def _reconcile_safely(self, old_workflow, workflow) -> None:
        try:
            await self._reconcile(old_workflow, workflow)
        except asyncio.CancelledError:
            raise
        except Exception as error:
            schedule = self.store.read_workflow_schedule(workflow.id)
            if schedule is not None:
                schedule.generation += 1
                schedule.status = "error"
                schedule.last_error = str(error) or "Workflow schedule failed."
                schedule.timers = []
                self.store.save_workflow_schedule(schedule)

    def _resume_after_failed_save(self, workflow) -> None:
        schedule = self.store.read_workflow_schedule(workflow.id)
        if schedule is None or schedule.status not in {"scheduled", "running"}:
            return
        if schedule.status == "running":
            schedule.generation += 1
            self._recover_interrupted_schedule(
                schedule,
                workflow,
                message=(
                    "Workflow run was interrupted because workflow changes "
                    "could not be saved."
                ),
            )
            self.store.save_workflow_schedule(schedule)
        self._spawn(workflow.id, schedule.generation)

    def _timer_signature(self, node) -> tuple[object, ...]:
        return (
            str(node.data.get("mode", "interval")),
            node.data.get("interval_seconds"),
            node.data.get("cron"),
        )

    def _timer_schedule_changed(self, old_workflow, workflow) -> bool:
        return {
            node.id: self._timer_signature(node)
            for node in old_workflow.definition.nodes
            if node.type == "timer"
        } != {
            node.id: self._timer_signature(node)
            for node in workflow.definition.nodes
            if node.type == "timer"
        }

    def _spawn(self, workflow_id: str, generation: int) -> None:
        task = asyncio.create_task(self._run(workflow_id, generation))
        self.tasks[workflow_id] = task
        task.add_done_callback(self._task_done)

    def _task_done(self, task: asyncio.Task[None]) -> None:
        if not task.cancelled():
            task.exception()

    async def _run(self, workflow_id: str, generation: int) -> None:
        try:
            while True:
                schedule = self.store.read_workflow_schedule(workflow_id)
                if (
                    schedule is None
                    or schedule.generation != generation
                    or schedule.status not in {"scheduled", "running"}
                ):
                    return
                due = min(
                    (
                        timer
                        for timer in schedule.timers
                        if timer.next_run_at is not None
                    ),
                    key=lambda timer: timer.next_run_at,
                    default=None,
                )
                if due is None:
                    return
                await asyncio.sleep(max(0, due.next_run_at - time.time()))
                schedule = self.store.read_workflow_schedule(workflow_id)
                if schedule is None or schedule.generation != generation:
                    return
                schedule.status = "running"
                schedule.timers = [
                    item.model_copy(update={"next_run_at": None})
                    if item.timer_node_id == due.timer_node_id
                    else item
                    for item in schedule.timers
                ]
                self.store.save_workflow_schedule(
                    schedule, expected_generation=generation
                )
                result = await self.service.run_workflow(
                    workflow_id,
                    default_input=schedule.default_input,
                    input_values=schedule.inputs,
                    timer_node_id=due.timer_node_id,
                )
                current_task = asyncio.current_task()
                cancellation_requested = bool(
                    current_task is not None and current_task.cancelling()
                )
                schedule = self.store.read_workflow_schedule(workflow_id)
                if schedule is None or schedule.generation != generation:
                    return
                schedule.last_run_at = time.time()
                schedule.last_result = result.model_dump(mode="json")
                if result.status != "success":
                    schedule.status = "error"
                    schedule.last_error = next(
                        (item.error for item in result.node_results if item.error),
                        "Workflow run failed.",
                    )
                    schedule.timers = []
                else:
                    schedule.status = "scheduled"
                    schedule.last_error = ""
                    workflow = self.service.get_workflow(workflow_id)
                    next_run = next(
                        item.next_run_at
                        for item in self._future_timers(workflow, schedule.timezone)
                        if item.timer_node_id == due.timer_node_id
                    )
                    schedule.timers = [
                        item.model_copy(update={"next_run_at": next_run})
                        if item.timer_node_id == due.timer_node_id
                        else item
                        for item in schedule.timers
                    ]
                self.store.save_workflow_schedule(
                    schedule, expected_generation=generation
                )
                if schedule.status == "error":
                    return
                if cancellation_requested:
                    return
        except asyncio.CancelledError:
            raise
        except Exception as error:
            logger.exception("Workflow schedule failed workflow_id=%s", workflow_id)
            schedule = self.store.read_workflow_schedule(workflow_id)
            if schedule is not None and schedule.generation == generation:
                schedule.status = "error"
                schedule.last_error = str(error) or "Workflow schedule failed."
                schedule.timers = []
                self.store.save_workflow_schedule(
                    schedule, expected_generation=generation
                )

    def _immediate_timers(self, workflow) -> list[StoredWorkflowScheduleTimer]:
        self._validate_timers(workflow)
        now = time.time()
        return [
            StoredWorkflowScheduleTimer(timer_node_id=node.id, next_run_at=now)
            for node in workflow.definition.nodes
            if node.type == "timer"
        ]

    def _future_timers(
        self, workflow, timezone: str
    ) -> list[StoredWorkflowScheduleTimer]:
        self._validate_timers(workflow)
        return [
            StoredWorkflowScheduleTimer(
                timer_node_id=node.id, next_run_at=self._next_run(node, timezone)
            )
            for node in workflow.definition.nodes
            if node.type == "timer"
        ]

    def _recover_interrupted_schedule(
        self,
        schedule,
        workflow,
        *,
        message: str = "Workflow run was interrupted when Flowent restarted.",
    ) -> None:
        existing = {item.timer_node_id: item for item in schedule.timers}
        claimed_timer_ids = {
            item.timer_node_id for item in schedule.timers if item.next_run_at is None
        }
        schedule.status = "scheduled"
        schedule.timers = [
            existing[node.id]
            if node.id in existing and existing[node.id].next_run_at is not None
            else StoredWorkflowScheduleTimer(
                timer_node_id=node.id,
                next_run_at=self._next_run(node, schedule.timezone),
            )
            for node in workflow.definition.nodes
            if node.type == "timer"
        ]
        self._mark_interrupted(
            schedule,
            claimed_timer_ids,
            message,
        )

    def _mark_interrupted(
        self,
        schedule: StoredWorkflowSchedule,
        timer_node_ids: set[str],
        message: str,
    ) -> None:
        if not timer_node_ids:
            return
        schedule.last_run_at = time.time()
        schedule.last_error = message
        schedule.last_result = {
            "workflow_id": schedule.workflow_id,
            "status": "failed",
            "outputs": {},
            "node_results": [
                {
                    "id": timer_node_id,
                    "status": "failed",
                    "output": "",
                    "error": message,
                }
                for timer_node_id in sorted(timer_node_ids)
            ],
        }

    def _validate_timers(self, workflow) -> None:
        for node in workflow.definition.nodes:
            if node.type == "timer":
                self._next_run(node, "UTC")

    def _next_run(self, node, timezone: str) -> float:
        mode = str(node.data.get("mode", "interval"))
        if mode == "cron":
            expression = str(node.data.get("cron", ""))
            now = datetime.now(self._timezone(timezone))
            return next_cron_run_at(expression, now).timestamp()
        if mode != "interval":
            raise ValueError("Timer mode is invalid.")
        try:
            seconds = float(node.data.get("interval_seconds", 0))
        except (TypeError, ValueError):
            seconds = 0
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
