import json
from typing import Any
from uuid import uuid4

from pydantic import BaseModel, ConfigDict

from flowent_agent.persistence.database import Database, utc_now


class AgentRunRecord(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    conversation_id: str | None = None
    status: str
    provider: str
    model: str
    usage: dict[str, Any]
    error: str | None = None
    created_at: str
    updated_at: str
    started_at: str | None = None
    completed_at: str | None = None


class AgentRunStore:
    def __init__(self, database: Database) -> None:
        self.database = database

    async def start(
        self,
        run_id: str,
        conversation_id: str | None,
        provider: str,
        model: str,
    ) -> AgentRunRecord:
        timestamp = utc_now()
        async with self.database.write_lock:
            await self.database.connection.execute(
                "INSERT INTO agent_runs(id, conversation_id, status, provider, model, created_at, updated_at, started_at) "
                "VALUES (?, ?, 'running', ?, ?, ?, ?, ?)",
                (
                    run_id,
                    conversation_id,
                    provider,
                    model,
                    timestamp,
                    timestamp,
                    timestamp,
                ),
            )
            await self.database.connection.commit()
        return AgentRunRecord(
            id=run_id,
            conversation_id=conversation_id,
            status="running",
            provider=provider,
            model=model,
            usage={},
            created_at=timestamp,
            updated_at=timestamp,
            started_at=timestamp,
        )

    async def add_message(
        self,
        run_id: str,
        role: str,
        content: str,
    ) -> None:
        async with self.database.write_lock:
            await self.database.connection.execute(
                "INSERT INTO messages(id, agent_run_id, role, content_json, created_at) VALUES (?, ?, ?, ?, ?)",
                (
                    uuid4().hex,
                    run_id,
                    role,
                    json.dumps(
                        {"text": content}, separators=(",", ":"), ensure_ascii=False
                    ),
                    utc_now(),
                ),
            )
            await self.database.connection.commit()

    async def finish(
        self,
        run_id: str,
        status: str,
        usage: dict[str, Any] | None = None,
        error: str | None = None,
    ) -> None:
        timestamp = utc_now()
        async with self.database.write_lock:
            await self.database.connection.execute(
                "UPDATE agent_runs SET status = ?, usage_json = ?, error = ?, updated_at = ?, completed_at = ? WHERE id = ?",
                (
                    status,
                    json.dumps(usage or {}, separators=(",", ":"), ensure_ascii=False),
                    error,
                    timestamp,
                    timestamp,
                    run_id,
                ),
            )
            await self.database.connection.commit()

    async def get(self, run_id: str) -> AgentRunRecord | None:
        cursor = await self.database.connection.execute(
            "SELECT id, conversation_id, status, provider, model, usage_json, error, created_at, updated_at, started_at, completed_at "
            "FROM agent_runs WHERE id = ?",
            (run_id,),
        )
        row = await cursor.fetchone()
        if row is None:
            return None
        return AgentRunRecord(
            id=row["id"],
            conversation_id=row["conversation_id"],
            status=row["status"],
            provider=row["provider"],
            model=row["model"],
            usage=json.loads(row["usage_json"]),
            error=row["error"],
            created_at=row["created_at"],
            updated_at=row["updated_at"],
            started_at=row["started_at"],
            completed_at=row["completed_at"],
        )
