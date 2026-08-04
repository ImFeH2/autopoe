from __future__ import annotations

import time
from pathlib import Path

import aiosqlite

from flowent.models.domain import ModelError, ModelSelection


class ModelStore:
    def __init__(self, data_dir: Path):
        self.database_path = data_dir / "flowent.db"

    async def initialize(self) -> None:
        self.database_path.parent.mkdir(parents=True, exist_ok=True)
        async with aiosqlite.connect(self.database_path) as database:
            await database.execute(
                """
                CREATE TABLE IF NOT EXISTS model_settings (
                    id INTEGER PRIMARY KEY CHECK (id = 1),
                    provider_id TEXT NOT NULL,
                    model_id TEXT NOT NULL,
                    updated_at INTEGER NOT NULL
                )
                """
            )
            await database.commit()

    async def get(self) -> ModelSelection | None:
        async with aiosqlite.connect(self.database_path) as database:
            database.row_factory = aiosqlite.Row
            async with database.execute(
                """
                SELECT provider_id, model_id
                FROM model_settings
                WHERE id = 1
                """
            ) as cursor:
                row = await cursor.fetchone()
        return self._selection(row) if row else None

    async def save(self, provider_id: str, model_id: str) -> ModelSelection:
        selection = self._validated(provider_id, model_id)
        async with aiosqlite.connect(self.database_path) as database:
            await database.execute(
                """
                INSERT INTO model_settings (id, provider_id, model_id, updated_at)
                VALUES (1, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    provider_id = excluded.provider_id,
                    model_id = excluded.model_id,
                    updated_at = excluded.updated_at
                """,
                (selection.provider_id, selection.model_id, time.time_ns()),
            )
            await database.commit()
        return selection

    async def clear_provider(self, provider_id: str) -> bool:
        async with aiosqlite.connect(self.database_path) as database:
            cursor = await database.execute(
                "DELETE FROM model_settings WHERE provider_id = ?",
                (provider_id,),
            )
            await database.commit()
        return cursor.rowcount > 0

    @staticmethod
    def _validated(provider_id: str, model_id: str) -> ModelSelection:
        provider_id = provider_id.strip()
        model_id = model_id.strip()
        if not provider_id:
            raise ModelError("provider is required")
        if not model_id:
            raise ModelError("model is required")
        return ModelSelection(provider_id, model_id)

    @staticmethod
    def _selection(row: aiosqlite.Row) -> ModelSelection:
        return ModelSelection(row["provider_id"], row["model_id"])
