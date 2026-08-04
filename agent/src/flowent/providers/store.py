from __future__ import annotations

import time
from pathlib import Path
from uuid import uuid4

import aiosqlite
import httpx

from flowent.providers.domain import Provider, ProviderError, ProviderType


class ProviderStore:
    def __init__(self, data_dir: Path):
        self.database_path = data_dir / "flowent.db"

    async def initialize(self) -> None:
        self.database_path.parent.mkdir(parents=True, exist_ok=True)
        async with aiosqlite.connect(self.database_path) as database:
            await database.execute(
                """
                CREATE TABLE IF NOT EXISTS providers (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    type TEXT NOT NULL,
                    base_url TEXT NOT NULL,
                    created_at INTEGER NOT NULL,
                    updated_at INTEGER NOT NULL
                )
                """
            )
            await database.commit()

    async def list(self) -> list[Provider]:
        async with aiosqlite.connect(self.database_path) as database:
            database.row_factory = aiosqlite.Row
            async with database.execute(
                """
                SELECT id, name, type, base_url
                FROM providers
                ORDER BY name COLLATE NOCASE, id
                """
            ) as cursor:
                rows = await cursor.fetchall()
        return [self._provider(row) for row in rows]

    async def get(self, provider_id: str) -> Provider:
        async with aiosqlite.connect(self.database_path) as database:
            database.row_factory = aiosqlite.Row
            async with database.execute(
                """
                SELECT id, name, type, base_url
                FROM providers
                WHERE id = ?
                """,
                (provider_id,),
            ) as cursor:
                row = await cursor.fetchone()
        if row is None:
            raise ProviderError("provider not found")
        return self._provider(row)

    async def save(
        self,
        provider_id: str | None,
        name: str,
        provider_type: str,
        base_url: str,
    ) -> Provider:
        provider = self._validated(provider_id, name, provider_type, base_url)
        now = time.time_ns()
        async with aiosqlite.connect(self.database_path) as database:
            if provider_id:
                cursor = await database.execute(
                    """
                    UPDATE providers
                    SET name = ?, type = ?, base_url = ?, updated_at = ?
                    WHERE id = ?
                    """,
                    (
                        provider.name,
                        provider.type.value,
                        provider.base_url,
                        now,
                        provider.id,
                    ),
                )
                if cursor.rowcount == 0:
                    raise ProviderError("provider not found")
            else:
                await database.execute(
                    """
                    INSERT INTO providers (
                        id, name, type, base_url, created_at, updated_at
                    )
                    VALUES (?, ?, ?, ?, ?, ?)
                    """,
                    (
                        provider.id,
                        provider.name,
                        provider.type.value,
                        provider.base_url,
                        now,
                        now,
                    ),
                )
            await database.commit()
        return provider

    async def delete(self, provider_id: str) -> None:
        async with aiosqlite.connect(self.database_path) as database:
            cursor = await database.execute(
                "DELETE FROM providers WHERE id = ?",
                (provider_id,),
            )
            if cursor.rowcount == 0:
                raise ProviderError("provider not found")
            await database.commit()

    @staticmethod
    def _validated(
        provider_id: str | None,
        name: str,
        provider_type: str,
        base_url: str,
    ) -> Provider:
        name = name.strip()
        if not name:
            raise ProviderError("provider name is required")
        try:
            kind = ProviderType(provider_type)
        except ValueError as error:
            raise ProviderError("unsupported provider type") from error
        try:
            url = httpx.URL(base_url.strip())
        except httpx.InvalidURL as error:
            raise ProviderError("invalid base URL") from error
        if url.scheme not in {"http", "https"} or not url.host:
            raise ProviderError("base URL must use HTTP or HTTPS")
        return Provider(
            provider_id or uuid4().hex,
            name,
            kind,
            str(url).rstrip("/"),
        )

    @staticmethod
    def _provider(row: aiosqlite.Row) -> Provider:
        return Provider(
            row["id"],
            row["name"],
            ProviderType(row["type"]),
            row["base_url"],
        )
