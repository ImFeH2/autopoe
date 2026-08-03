from __future__ import annotations

import time
from dataclasses import dataclass
from pathlib import Path
from uuid import uuid4

import aiosqlite


@dataclass(frozen=True, slots=True)
class Project:
    id: str
    name: str
    workspace: Path

    def to_dict(self) -> dict[str, str]:
        return {
            "id": self.id,
            "name": self.name,
            "workspace": str(self.workspace),
        }


class ProjectStore:
    def __init__(self, data_dir: Path):
        self.database_path = data_dir / "flowent.db"

    async def initialize(self) -> None:
        self.database_path.parent.mkdir(parents=True, exist_ok=True)
        async with aiosqlite.connect(self.database_path) as database:
            await database.execute(
                """
                CREATE TABLE IF NOT EXISTS projects (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    workspace TEXT NOT NULL UNIQUE,
                    opened_at INTEGER NOT NULL
                )
                """
            )
            await database.commit()

    async def current(self) -> Project | None:
        async with aiosqlite.connect(self.database_path) as database:
            database.row_factory = aiosqlite.Row
            async with database.execute(
                """
                SELECT id, name, workspace
                FROM projects
                ORDER BY opened_at DESC
                LIMIT 1
                """
            ) as cursor:
                row = await cursor.fetchone()
        return self._project(row) if row else None

    async def open(self, workspace: str) -> Project:
        path = Path(workspace).expanduser().resolve(strict=True)
        if not path.is_dir():
            raise ValueError("workspace must be a directory")

        name = path.name or str(path)
        opened_at = time.time_ns()
        async with aiosqlite.connect(self.database_path) as database:
            database.row_factory = aiosqlite.Row
            async with database.execute(
                "SELECT id FROM projects WHERE workspace = ?",
                (str(path),),
            ) as cursor:
                row = await cursor.fetchone()
            project_id = row["id"] if row else uuid4().hex
            await database.execute(
                """
                INSERT INTO projects (id, name, workspace, opened_at)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(workspace) DO UPDATE SET
                    name = excluded.name,
                    opened_at = excluded.opened_at
                """,
                (project_id, name, str(path), opened_at),
            )
            await database.commit()

        return Project(project_id, name, path)

    @staticmethod
    def _project(row: aiosqlite.Row) -> Project:
        return Project(row["id"], row["name"], Path(row["workspace"]))
