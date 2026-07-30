import asyncio
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

import aiosqlite

from flowent_agent.persistence.schema import MIGRATIONS


def utc_now() -> str:
    return datetime.now(UTC).isoformat()


@dataclass(frozen=True)
class RecoveryResult:
    workflow_runs: int
    agent_runs: int
    work_items: int


class Database:
    def __init__(self, path: Path, connection: aiosqlite.Connection) -> None:
        self.path = path
        self.connection = connection
        self.write_lock = asyncio.Lock()

    @classmethod
    async def open(cls, data_dir: Path) -> "Database":
        data_dir.mkdir(parents=True, exist_ok=True)
        path = data_dir / "flowent.db"
        connection = await aiosqlite.connect(path)
        connection.row_factory = aiosqlite.Row
        database = cls(path, connection)
        await database.configure()
        await database.migrate()
        return database

    async def configure(self) -> None:
        await self.connection.execute("PRAGMA journal_mode = WAL")
        await self.connection.execute("PRAGMA foreign_keys = ON")
        await self.connection.execute("PRAGMA busy_timeout = 5000")
        await self.connection.commit()

    async def migrate(self) -> None:
        await self.connection.execute(
            "CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)"
        )
        await self.connection.commit()
        cursor = await self.connection.execute(
            "SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations"
        )
        row = await cursor.fetchone()
        current_version = int(row["version"]) if row is not None else 0

        for version, script in MIGRATIONS:
            if version <= current_version:
                continue
            escaped_timestamp = utc_now().replace("'", "''")
            await self.connection.executescript(
                f"BEGIN IMMEDIATE;\n{script}\n"
                f"INSERT INTO schema_migrations(version, applied_at) VALUES ({version}, '{escaped_timestamp}');\n"
                "COMMIT;"
            )

    async def recover_interrupted_runs(self) -> RecoveryResult:
        timestamp = utc_now()
        async with self.write_lock:
            await self.connection.execute("BEGIN IMMEDIATE")
            try:
                workflow_cursor = await self.connection.execute(
                    "UPDATE workflow_runs SET status = 'interrupted', updated_at = ? WHERE status IN ('starting', 'running', 'cancelling')",
                    (timestamp,),
                )
                agent_cursor = await self.connection.execute(
                    "UPDATE agent_runs SET status = 'interrupted', updated_at = ? WHERE status IN ('starting', 'running', 'cancelling')",
                    (timestamp,),
                )
                work_cursor = await self.connection.execute(
                    "UPDATE work_items SET status = 'pending', attempt = attempt + 1, updated_at = ? WHERE status = 'running'",
                    (timestamp,),
                )
                await self.connection.commit()
            except Exception:
                await self.connection.rollback()
                raise

        return RecoveryResult(
            workflow_runs=workflow_cursor.rowcount,
            agent_runs=agent_cursor.rowcount,
            work_items=work_cursor.rowcount,
        )

    async def close(self) -> None:
        await self.connection.close()
