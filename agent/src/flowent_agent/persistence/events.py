import json
from typing import Any

from pydantic import BaseModel, ConfigDict

from flowent_agent.persistence.database import Database, utc_now


class EventRecord(BaseModel):
    model_config = ConfigDict(extra="forbid")

    event_id: str
    stream_id: str
    sequence: int
    name: str
    payload: dict[str, Any]
    workflow_run_id: str | None = None
    agent_run_id: str | None = None
    run_id: str | None = None
    created_at: str


class EventStore:
    def __init__(self, database: Database) -> None:
        self.database = database

    async def append(
        self,
        event_id: str,
        stream_id: str,
        name: str,
        payload: dict[str, Any],
        scope: dict[str, str | None] | None = None,
    ) -> EventRecord:
        scope = scope or {}
        created_at = utc_now()
        async with self.database.write_lock:
            await self.database.connection.execute("BEGIN IMMEDIATE")
            try:
                await self.database.connection.execute(
                    "INSERT INTO event_streams(stream_id, next_sequence) VALUES (?, 1) "
                    "ON CONFLICT(stream_id) DO UPDATE SET next_sequence = next_sequence + 1",
                    (stream_id,),
                )
                cursor = await self.database.connection.execute(
                    "SELECT next_sequence - 1 AS sequence FROM event_streams WHERE stream_id = ?",
                    (stream_id,),
                )
                row = await cursor.fetchone()
                sequence = int(row["sequence"])
                await self.database.connection.execute(
                    "INSERT INTO events(event_id, stream_id, sequence, name, payload_json, workflow_run_id, agent_run_id, run_id, created_at) "
                    "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    (
                        event_id,
                        stream_id,
                        sequence,
                        name,
                        json.dumps(payload, separators=(",", ":"), ensure_ascii=False),
                        scope.get("workflow_run_id"),
                        scope.get("agent_run_id"),
                        scope.get("run_id"),
                        created_at,
                    ),
                )
                await self.database.connection.commit()
            except Exception:
                await self.database.connection.rollback()
                raise

        return EventRecord(
            event_id=event_id,
            stream_id=stream_id,
            sequence=sequence,
            name=name,
            payload=payload,
            workflow_run_id=scope.get("workflow_run_id"),
            agent_run_id=scope.get("agent_run_id"),
            run_id=scope.get("run_id"),
            created_at=created_at,
        )

    async def list_stream(self, stream_id: str, after: int = -1) -> list[EventRecord]:
        cursor = await self.database.connection.execute(
            "SELECT event_id, stream_id, sequence, name, payload_json, workflow_run_id, agent_run_id, run_id, created_at "
            "FROM events WHERE stream_id = ? AND sequence > ? ORDER BY sequence",
            (stream_id, after),
        )
        rows = await cursor.fetchall()
        return [self.from_row(row) for row in rows]

    async def list_run(self, run_id: str, after: int = -1) -> list[EventRecord]:
        cursor = await self.database.connection.execute(
            "SELECT event_id, stream_id, sequence, name, payload_json, workflow_run_id, agent_run_id, run_id, created_at "
            "FROM events WHERE (workflow_run_id = ? OR (workflow_run_id IS NULL AND run_id = ?)) "
            "AND sequence > ? ORDER BY sequence",
            (run_id, run_id, after),
        )
        rows = await cursor.fetchall()
        return [self.from_row(row) for row in rows]

    @staticmethod
    def from_row(row: Any) -> EventRecord:
        return EventRecord(
            event_id=row["event_id"],
            stream_id=row["stream_id"],
            sequence=row["sequence"],
            name=row["name"],
            payload=json.loads(row["payload_json"]),
            workflow_run_id=row["workflow_run_id"],
            agent_run_id=row["agent_run_id"],
            run_id=row["run_id"],
            created_at=row["created_at"],
        )
