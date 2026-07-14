import json
import sqlite3
from collections.abc import Mapping

from flowent.state.database import SQLiteDatabase
from flowent.state.models import (
    StoredWorkflow,
    StoredWorkflowRevision,
    StoredWorkflowRun,
    StoredWorkflowSchedule,
    StoredWorkflowScheduleTimer,
    StoredWorkflowSpec,
    WorkflowDraft,
)


class WorkflowRevisionConflictError(Exception):
    def __init__(self, workflow: StoredWorkflow) -> None:
        super().__init__(
            "This workflow changed elsewhere. The latest version is now open."
        )
        self.workflow = workflow


class WorkflowRepository:
    def __init__(self, database: SQLiteDatabase) -> None:
        self.database = database

    def read_workflows(self) -> list[StoredWorkflow]:
        with self.database.connect() as connection:
            return self._read_workflows(connection)

    def read_workflow(self, workflow_id: str) -> StoredWorkflow | None:
        with self.database.connect() as connection:
            row = connection.execute(
                """
                SELECT id, name, spec, presentation, revision, active_revision,
                       created_at, updated_at
                FROM workflows
                WHERE id = ?
                """,
                (workflow_id,),
            ).fetchone()
        if row is None:
            return None
        return self._workflow_from_row(row)

    def read_workflow_agent_history(
        self, workflow_id: str, node_id: str
    ) -> list[dict[str, object]]:
        with self.database.connect() as connection:
            row = connection.execute(
                """
                SELECT messages
                FROM workflow_agent_histories
                WHERE workflow_id = ? AND node_id = ?
                """,
                (workflow_id, node_id),
            ).fetchone()
        if row is None:
            return []
        return workflow_agent_history_messages(row["messages"])

    def save_workflow_agent_history(
        self,
        workflow_id: str,
        node_id: str,
        messages: list[Mapping[str, object]],
    ) -> list[dict[str, object]]:
        stored_messages = [dict(message) for message in messages]
        with self.database.connect() as connection:
            connection.execute(
                """
                INSERT INTO workflow_agent_histories (
                    workflow_id,
                    node_id,
                    messages
                )
                VALUES (?, ?, ?)
                ON CONFLICT(workflow_id, node_id) DO UPDATE SET
                    messages = excluded.messages,
                    updated_at = unixepoch()
                """,
                (
                    workflow_id,
                    node_id,
                    json.dumps(stored_messages, ensure_ascii=False),
                ),
            )
        return stored_messages

    def read_workflow_revision(
        self, workflow_id: str, revision: int
    ) -> StoredWorkflowRevision | None:
        with self.database.connect() as connection:
            row = connection.execute(
                """
                SELECT workflow_id, revision, spec, created_at
                FROM workflow_revisions
                WHERE workflow_id = ? AND revision = ?
                """,
                (workflow_id, revision),
            ).fetchone()
        if row is None:
            return None
        return StoredWorkflowRevision(
            created_at=row["created_at"],
            revision=row["revision"],
            spec=StoredWorkflowSpec.model_validate_json(row["spec"]),
            workflow_id=row["workflow_id"],
        )

    def read_active_workflow_revision(
        self, workflow_id: str
    ) -> StoredWorkflowRevision | None:
        with self.database.connect() as connection:
            row = connection.execute(
                """
                SELECT revision.workflow_id,
                       revision.revision,
                       revision.spec,
                       revision.created_at
                FROM workflows workflow
                JOIN workflow_revisions revision
                  ON revision.workflow_id = workflow.id
                 AND revision.revision = workflow.active_revision
                WHERE workflow.id = ?
                """,
                (workflow_id,),
            ).fetchone()
        if row is None:
            return None
        return StoredWorkflowRevision(
            created_at=row["created_at"],
            revision=row["revision"],
            spec=StoredWorkflowSpec.model_validate_json(row["spec"]),
            workflow_id=row["workflow_id"],
        )

    def save_workflow(
        self,
        workflow: WorkflowDraft,
        *,
        base_revision: int | None,
        executable: bool,
    ) -> StoredWorkflow:
        with self.database.connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            current_row = connection.execute(
                """
                SELECT id, name, spec, presentation, revision, active_revision,
                       created_at, updated_at
                FROM workflows
                WHERE id = ?
                """,
                (workflow.id,),
            ).fetchone()
            if current_row is None:
                if base_revision is not None:
                    raise ValueError("Workflow not found.")
                next_revision = 1
                active_revision = next_revision if executable else None
                connection.execute(
                    """
                    INSERT INTO workflows (
                        id, name, spec, presentation, revision, active_revision
                    )
                    VALUES (?, ?, ?, ?, ?, ?)
                    """,
                    (
                        workflow.id,
                        workflow.name,
                        workflow.spec.model_dump_json(by_alias=True),
                        workflow.presentation.model_dump_json(),
                        next_revision,
                        active_revision,
                    ),
                )
            else:
                current = self._workflow_from_row(current_row)
                if base_revision != current.revision:
                    raise WorkflowRevisionConflictError(current)
                next_revision = current.revision + 1
                active_revision = current.active_revision
                if executable and not self._spec_matches_revision(
                    connection,
                    workflow.id,
                    current.active_revision,
                    workflow.spec,
                ):
                    active_revision = next_revision
                connection.execute(
                    """
                    UPDATE workflows
                    SET name = ?,
                        spec = ?,
                        presentation = ?,
                        revision = ?,
                        active_revision = ?,
                        updated_at = unixepoch()
                    WHERE id = ? AND revision = ?
                    """,
                    (
                        workflow.name,
                        workflow.spec.model_dump_json(by_alias=True),
                        workflow.presentation.model_dump_json(),
                        next_revision,
                        active_revision,
                        workflow.id,
                        current.revision,
                    ),
                )
            if active_revision == next_revision:
                connection.execute(
                    """
                    INSERT INTO workflow_revisions (workflow_id, revision, spec)
                    VALUES (?, ?, ?)
                    """,
                    (
                        workflow.id,
                        next_revision,
                        workflow.spec.model_dump_json(by_alias=True),
                    ),
                )
            row = connection.execute(
                """
                SELECT id, name, spec, presentation, revision, active_revision,
                       created_at, updated_at
                FROM workflows
                WHERE id = ?
                """,
                (workflow.id,),
            ).fetchone()
        return self._workflow_from_row(row)

    def save_workflow_run(self, run: Mapping[str, object]) -> None:
        with self.database.connect() as connection:
            connection.execute(
                """
                INSERT INTO workflow_runs (
                    run_id, workflow_id, workflow_revision, status, trigger,
                    inputs, node_results, outputs
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    run["run_id"],
                    run["workflow_id"],
                    run["workflow_revision"],
                    run["status"],
                    run["trigger"],
                    json.dumps(run.get("inputs", {}), ensure_ascii=False),
                    json.dumps(run.get("node_results", []), ensure_ascii=False),
                    json.dumps(run.get("outputs", {}), ensure_ascii=False),
                ),
            )

    def read_workflow_run(self, run_id: str) -> StoredWorkflowRun | None:
        with self.database.connect() as connection:
            row = connection.execute(
                """
                SELECT run_id, workflow_id, workflow_revision, status, trigger,
                       inputs, node_results, outputs, created_at, updated_at
                FROM workflow_runs
                WHERE run_id = ?
                """,
                (run_id,),
            ).fetchone()
        if row is None:
            return None
        return StoredWorkflowRun.model_validate(
            {
                "created_at": row["created_at"],
                "inputs": json.loads(row["inputs"]),
                "node_results": json.loads(row["node_results"]),
                "outputs": json.loads(row["outputs"]),
                "run_id": row["run_id"],
                "status": row["status"],
                "trigger": row["trigger"],
                "updated_at": row["updated_at"],
                "workflow_id": row["workflow_id"],
                "workflow_revision": row["workflow_revision"],
            }
        )

    def delete_workflow(self, workflow_id: str) -> None:
        with self.database.connect() as connection:
            connection.execute("DELETE FROM workflows WHERE id = ?", (workflow_id,))

    def read_workflow_schedule(self, workflow_id: str) -> StoredWorkflowSchedule | None:
        with self.database.connect() as connection:
            row = connection.execute(
                """
                SELECT workflow_id, status, generation, scheduled_revision,
                       running_revision, running_run_id, running_timer_node_id,
                       default_input, inputs, timezone, last_run_at, last_result,
                       last_error
                FROM workflow_schedules
                WHERE workflow_id = ?
                """,
                (workflow_id,),
            ).fetchone()
            if row is None:
                return None
            return self._workflow_schedule_from_row(connection, row)

    def read_workflow_schedules(self) -> list[StoredWorkflowSchedule]:
        with self.database.connect() as connection:
            return [
                self._workflow_schedule_from_row(connection, row)
                for row in connection.execute(
                    """
                    SELECT workflow_id, status, generation, scheduled_revision,
                           running_revision, running_run_id, running_timer_node_id,
                           default_input, inputs, timezone, last_run_at, last_result,
                           last_error
                    FROM workflow_schedules
                    ORDER BY workflow_id
                    """
                )
            ]

    def save_workflow_schedule(
        self,
        schedule: StoredWorkflowSchedule,
        *,
        expected_generation: int | None = None,
    ) -> bool:
        with self.database.connect() as connection:
            if expected_generation is not None:
                current = connection.execute(
                    "SELECT generation FROM workflow_schedules WHERE workflow_id = ?",
                    (schedule.workflow_id,),
                ).fetchone()
                if current is None or current["generation"] != expected_generation:
                    return False
            connection.execute(
                """
                INSERT INTO workflow_schedules (
                    workflow_id, status, generation, scheduled_revision,
                    running_revision, running_run_id, running_timer_node_id,
                    default_input, inputs, timezone, last_run_at, last_result,
                    last_error
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(workflow_id) DO UPDATE SET
                    status = excluded.status,
                    generation = excluded.generation,
                    scheduled_revision = excluded.scheduled_revision,
                    running_revision = excluded.running_revision,
                    running_run_id = excluded.running_run_id,
                    running_timer_node_id = excluded.running_timer_node_id,
                    default_input = excluded.default_input,
                    inputs = excluded.inputs,
                    timezone = excluded.timezone,
                    last_run_at = excluded.last_run_at,
                    last_result = excluded.last_result,
                    last_error = excluded.last_error,
                    updated_at = unixepoch()
                """,
                (
                    schedule.workflow_id,
                    schedule.status,
                    schedule.generation,
                    schedule.scheduled_revision,
                    schedule.running_revision,
                    schedule.running_run_id,
                    schedule.running_timer_node_id,
                    schedule.default_input,
                    json.dumps(schedule.inputs, ensure_ascii=False),
                    schedule.timezone,
                    schedule.last_run_at,
                    json.dumps(schedule.last_result, ensure_ascii=False)
                    if schedule.last_result is not None
                    else None,
                    schedule.last_error,
                ),
            )
            connection.execute(
                "DELETE FROM workflow_schedule_timers WHERE workflow_id = ?",
                (schedule.workflow_id,),
            )
            connection.executemany(
                """
                INSERT INTO workflow_schedule_timers (
                    workflow_id, timer_node_id, next_run_at
                )
                VALUES (?, ?, ?)
                """,
                [
                    (schedule.workflow_id, timer.timer_node_id, timer.next_run_at)
                    for timer in schedule.timers
                ],
            )
        return True

    def _spec_matches_revision(
        self,
        connection: sqlite3.Connection,
        workflow_id: str,
        revision: int | None,
        spec: StoredWorkflowSpec,
    ) -> bool:
        if revision is None:
            return False
        row = connection.execute(
            """
            SELECT spec
            FROM workflow_revisions
            WHERE workflow_id = ? AND revision = ?
            """,
            (workflow_id, revision),
        ).fetchone()
        if row is None:
            return False
        return json.loads(row["spec"]) == spec.model_dump(mode="json", by_alias=True)

    def _workflow_from_row(self, row: sqlite3.Row) -> StoredWorkflow:
        return StoredWorkflow(
            active_revision=row["active_revision"],
            created_at=row["created_at"],
            id=row["id"],
            name=row["name"],
            presentation=json.loads(row["presentation"]),
            revision=row["revision"],
            spec=json.loads(row["spec"]),
            updated_at=row["updated_at"],
        )

    def _read_workflows(self, connection: sqlite3.Connection) -> list[StoredWorkflow]:
        return [
            self._workflow_from_row(row)
            for row in connection.execute(
                """
                SELECT id, name, spec, presentation, revision, active_revision,
                       created_at, updated_at
                FROM workflows
                ORDER BY updated_at DESC, name, id
                """
            )
        ]

    def _workflow_schedule_from_row(
        self, connection: sqlite3.Connection, row: sqlite3.Row
    ) -> StoredWorkflowSchedule:
        return StoredWorkflowSchedule(
            default_input=row["default_input"],
            generation=row["generation"],
            inputs=json.loads(row["inputs"] or "{}"),
            last_error=row["last_error"],
            last_result=json.loads(row["last_result"]) if row["last_result"] else None,
            last_run_at=row["last_run_at"],
            running_revision=row["running_revision"],
            running_run_id=row["running_run_id"],
            running_timer_node_id=row["running_timer_node_id"],
            scheduled_revision=row["scheduled_revision"],
            status=row["status"],
            timers=[
                StoredWorkflowScheduleTimer(
                    next_run_at=timer_row["next_run_at"],
                    timer_node_id=timer_row["timer_node_id"],
                )
                for timer_row in connection.execute(
                    """
                    SELECT timer_node_id, next_run_at
                    FROM workflow_schedule_timers
                    WHERE workflow_id = ?
                    ORDER BY timer_node_id
                    """,
                    (row["workflow_id"],),
                )
            ],
            timezone=row["timezone"],
            workflow_id=row["workflow_id"],
        )


def workflow_agent_history_messages(value: str) -> list[dict[str, object]]:
    parsed = json.loads(value or "[]")
    if not isinstance(parsed, list):
        raise ValueError("Workflow agent history must be a list.")
    messages: list[dict[str, object]] = []
    for item in parsed:
        if not isinstance(item, dict):
            raise ValueError("Workflow agent history messages must be objects.")
        messages.append(dict(item))
    return messages
