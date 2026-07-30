import json
from typing import Any
from uuid import uuid4

from flowent.persistence.database import Database, utc_now


class ApprovalStore:
    def __init__(self, database: Database) -> None:
        self.database = database

    async def create(
        self,
        kind: str,
        prompt: str,
        metadata: dict[str, Any],
        workflow_run_id: str | None = None,
        agent_run_id: str | None = None,
        run_id: str | None = None,
        tool_call_id: str | None = None,
    ) -> str:
        approval_id = uuid4().hex
        async with self.database.write_lock:
            await self.database.connection.execute(
                "INSERT INTO approvals(id, workflow_run_id, agent_run_id, run_id, tool_call_id, status, kind, prompt, metadata_json, created_at) "
                "VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)",
                (
                    approval_id,
                    workflow_run_id,
                    agent_run_id,
                    run_id,
                    tool_call_id,
                    kind,
                    prompt,
                    json.dumps(metadata, ensure_ascii=False, separators=(",", ":")),
                    utc_now(),
                ),
            )
            await self.database.connection.commit()
        return approval_id

    async def resolve(
        self,
        approval_id: str,
        approved: bool,
        data: dict[str, Any],
    ) -> bool:
        async with self.database.write_lock:
            cursor = await self.database.connection.execute(
                "UPDATE approvals SET status = ?, response_json = ?, resolved_at = ? "
                "WHERE id = ? AND status = 'pending'",
                (
                    "approved" if approved else "rejected",
                    json.dumps(data, ensure_ascii=False, separators=(",", ":")),
                    utc_now(),
                    approval_id,
                ),
            )
            await self.database.connection.commit()
        return cursor.rowcount == 1

    async def close(self, approval_id: str, status: str) -> bool:
        async with self.database.write_lock:
            cursor = await self.database.connection.execute(
                "UPDATE approvals SET status = ?, resolved_at = ? WHERE id = ? AND status = 'pending'",
                (status, utc_now(), approval_id),
            )
            await self.database.connection.commit()
        return cursor.rowcount == 1
