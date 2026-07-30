import json
from typing import Any
from uuid import uuid4

from flowent_agent.persistence.database import Database, utc_now
from flowent_agent.workflows.models import (
    WorkflowDefinition,
    WorkflowRunRecord,
    WorkflowSummary,
    WorkflowVersion,
)


class WorkflowStore:
    def __init__(self, database: Database) -> None:
        self.database = database

    async def save_draft(self, definition: WorkflowDefinition) -> WorkflowDefinition:
        timestamp = utc_now()
        content = definition.model_dump_json()
        async with self.database.write_lock:
            await self.database.connection.execute(
                "INSERT INTO workflow_definitions(id, name, description, draft_json, created_at, updated_at) "
                "VALUES (?, ?, ?, ?, ?, ?) "
                "ON CONFLICT(id) DO UPDATE SET name = excluded.name, description = excluded.description, "
                "draft_json = excluded.draft_json, updated_at = excluded.updated_at",
                (
                    definition.id,
                    definition.name,
                    definition.description,
                    content,
                    timestamp,
                    timestamp,
                ),
            )
            await self.database.connection.commit()
        return definition

    async def get_draft(self, workflow_id: str) -> WorkflowDefinition | None:
        cursor = await self.database.connection.execute(
            "SELECT draft_json FROM workflow_definitions WHERE id = ?",
            (workflow_id,),
        )
        row = await cursor.fetchone()
        if row is None:
            return None
        return WorkflowDefinition.model_validate_json(row["draft_json"])

    async def list_definitions(self) -> list[WorkflowSummary]:
        cursor = await self.database.connection.execute(
            "SELECT d.id, d.name, d.description, d.updated_at, MAX(v.version) AS latest_version "
            "FROM workflow_definitions d LEFT JOIN workflow_versions v ON v.workflow_id = d.id "
            "GROUP BY d.id ORDER BY d.updated_at DESC"
        )
        rows = await cursor.fetchall()
        return [
            WorkflowSummary(
                id=row["id"],
                name=row["name"],
                description=row["description"],
                latest_version=row["latest_version"],
                updated_at=row["updated_at"],
            )
            for row in rows
        ]

    async def publish(self, workflow_id: str) -> WorkflowVersion:
        definition = await self.get_draft(workflow_id)
        if definition is None:
            raise ValueError(f"Workflow not found: {workflow_id}")
        timestamp = utc_now()
        version_id = uuid4().hex
        async with self.database.write_lock:
            await self.database.connection.execute("BEGIN IMMEDIATE")
            try:
                cursor = await self.database.connection.execute(
                    "SELECT COALESCE(MAX(version), 0) + 1 AS version FROM workflow_versions WHERE workflow_id = ?",
                    (workflow_id,),
                )
                row = await cursor.fetchone()
                version = int(row["version"])
                await self.database.connection.execute(
                    "INSERT INTO workflow_versions(id, workflow_id, version, definition_json, created_at) "
                    "VALUES (?, ?, ?, ?, ?)",
                    (
                        version_id,
                        workflow_id,
                        version,
                        definition.model_dump_json(),
                        timestamp,
                    ),
                )
                await self.database.connection.commit()
            except Exception:
                await self.database.connection.rollback()
                raise
        return WorkflowVersion(
            id=version_id,
            workflow_id=workflow_id,
            version=version,
            definition=definition,
            created_at=timestamp,
        )

    async def get_version(
        self,
        workflow_id: str,
        version: int | None = None,
    ) -> WorkflowVersion | None:
        if version is None:
            cursor = await self.database.connection.execute(
                "SELECT id, workflow_id, version, definition_json, created_at FROM workflow_versions "
                "WHERE workflow_id = ? ORDER BY version DESC LIMIT 1",
                (workflow_id,),
            )
        else:
            cursor = await self.database.connection.execute(
                "SELECT id, workflow_id, version, definition_json, created_at FROM workflow_versions "
                "WHERE workflow_id = ? AND version = ?",
                (workflow_id, version),
            )
        row = await cursor.fetchone()
        if row is None:
            return None
        return WorkflowVersion(
            id=row["id"],
            workflow_id=row["workflow_id"],
            version=row["version"],
            definition=WorkflowDefinition.model_validate_json(row["definition_json"]),
            created_at=row["created_at"],
        )

    async def start_run(
        self,
        run_id: str,
        version_id: str,
        input_value: dict[str, Any],
        workspace: dict[str, Any] | None = None,
    ) -> None:
        timestamp = utc_now()
        async with self.database.write_lock:
            await self.database.connection.execute(
                "INSERT INTO workflow_runs(id, workflow_version_id, status, input_json, workspace_json, created_at, updated_at, started_at) "
                "VALUES (?, ?, 'running', ?, ?, ?, ?, ?)",
                (
                    run_id,
                    version_id,
                    json.dumps(input_value, ensure_ascii=False, separators=(",", ":")),
                    (
                        json.dumps(
                            workspace,
                            ensure_ascii=False,
                            separators=(",", ":"),
                        )
                        if workspace is not None
                        else None
                    ),
                    timestamp,
                    timestamp,
                    timestamp,
                ),
            )
            await self.database.connection.commit()

    async def finish_run(
        self,
        run_id: str,
        status: str,
        output: dict[str, Any] | None = None,
        error: str | None = None,
    ) -> None:
        timestamp = utc_now()
        output_json = (
            json.dumps(output, ensure_ascii=False, separators=(",", ":"))
            if output is not None
            else None
        )
        async with self.database.write_lock:
            await self.database.connection.execute(
                "UPDATE workflow_runs SET status = ?, output_json = ?, error = ?, updated_at = ?, completed_at = ? WHERE id = ?",
                (status, output_json, error, timestamp, timestamp, run_id),
            )
            await self.database.connection.commit()

    async def list_runs(
        self,
        limit: int = 50,
        workflow_id: str | None = None,
    ) -> list[WorkflowRunRecord]:
        parameters: list[Any] = []
        condition = ""
        if workflow_id is not None:
            condition = "WHERE v.workflow_id = ?"
            parameters.append(workflow_id)
        parameters.append(limit)
        cursor = await self.database.connection.execute(
            "SELECT r.id, v.workflow_id, v.definition_json, v.version, "
            "r.status, r.input_json, r.output_json, r.error, r.workspace_json, "
            "r.created_at, r.started_at, r.completed_at "
            "FROM workflow_runs r "
            "LEFT JOIN workflow_versions v ON v.id = r.workflow_version_id "
            f"{condition} ORDER BY r.created_at DESC LIMIT ?",
            parameters,
        )
        rows = await cursor.fetchall()
        return [
            WorkflowRunRecord(
                id=row["id"],
                workflow_id=row["workflow_id"],
                workflow_name=(
                    json.loads(row["definition_json"])["name"]
                    if row["definition_json"] is not None
                    else "Unknown workflow"
                ),
                version=row["version"],
                status=row["status"],
                input=json.loads(row["input_json"]),
                output=(
                    json.loads(row["output_json"])
                    if row["output_json"] is not None
                    else None
                ),
                error=row["error"],
                workspace=(
                    json.loads(row["workspace_json"])
                    if row["workspace_json"] is not None
                    else None
                ),
                created_at=row["created_at"],
                started_at=row["started_at"],
                completed_at=row["completed_at"],
            )
            for row in rows
        ]

    async def start_work_item(
        self,
        workflow_run_id: str,
        node_id: str,
        input_value: dict[str, Any],
        attempt: int,
        max_attempts: int,
        status: str = "running",
    ) -> str:
        work_item_id = uuid4().hex
        timestamp = utc_now()
        async with self.database.write_lock:
            await self.database.connection.execute(
                "INSERT INTO work_items(id, workflow_run_id, node_id, status, input_json, attempt, max_attempts, created_at, updated_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    work_item_id,
                    workflow_run_id,
                    node_id,
                    status,
                    json.dumps(input_value, ensure_ascii=False, separators=(",", ":")),
                    attempt,
                    max_attempts,
                    timestamp,
                    timestamp,
                ),
            )
            await self.database.connection.commit()
        return work_item_id

    async def finish_work_item(
        self,
        work_item_id: str,
        status: str,
        output: Any = None,
    ) -> None:
        timestamp = utc_now()
        output_json = (
            json.dumps(output, ensure_ascii=False, separators=(",", ":"))
            if output is not None
            else None
        )
        async with self.database.write_lock:
            await self.database.connection.execute(
                "UPDATE work_items SET status = ?, output_json = ?, updated_at = ? WHERE id = ?",
                (status, output_json, timestamp, work_item_id),
            )
            await self.database.connection.commit()
