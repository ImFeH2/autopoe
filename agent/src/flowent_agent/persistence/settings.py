import asyncio
import json
import re
from typing import Any

import keyring

from flowent_agent.persistence.database import Database, utc_now

CREDENTIAL_PATTERN = re.compile(r"^[A-Za-z0-9_.-]{1,120}$")


class SettingsStore:
    def __init__(self, database: Database) -> None:
        self.database = database

    async def get(self, key: str) -> Any | None:
        cursor = await self.database.connection.execute(
            "SELECT value_json FROM settings WHERE key = ?",
            (key,),
        )
        row = await cursor.fetchone()
        return json.loads(row["value_json"]) if row is not None else None

    async def set(self, key: str, value: Any) -> None:
        async with self.database.write_lock:
            await self.database.connection.execute(
                "INSERT INTO settings(key, value_json, updated_at) VALUES (?, ?, ?) "
                "ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at",
                (
                    key,
                    json.dumps(value, ensure_ascii=False, separators=(",", ":")),
                    utc_now(),
                ),
            )
            await self.database.connection.commit()


class CredentialStore:
    service_name = "im.feh2.flowent"

    @classmethod
    def username(cls, provider: str, credential_id: str) -> str:
        if not CREDENTIAL_PATTERN.fullmatch(provider):
            raise ValueError("Invalid credential provider")
        if not CREDENTIAL_PATTERN.fullmatch(credential_id):
            raise ValueError("Invalid credential ID")
        return f"{provider}:{credential_id}"

    async def get(self, provider: str, credential_id: str) -> str | None:
        username = self.username(provider, credential_id)
        try:
            return await asyncio.to_thread(
                keyring.get_password,
                self.service_name,
                username,
            )
        except Exception as error:
            raise RuntimeError(f"Credential store is unavailable: {error}") from error

    async def set(self, provider: str, credential_id: str, secret: str) -> None:
        if not secret:
            raise ValueError("Credential must not be empty")
        username = self.username(provider, credential_id)
        try:
            await asyncio.to_thread(
                keyring.set_password,
                self.service_name,
                username,
                secret,
            )
        except Exception as error:
            raise RuntimeError(f"Credential store is unavailable: {error}") from error

    async def delete(self, provider: str, credential_id: str) -> None:
        username = self.username(provider, credential_id)
        try:
            existing = await asyncio.to_thread(
                keyring.get_password,
                self.service_name,
                username,
            )
            if existing is not None:
                await asyncio.to_thread(
                    keyring.delete_password,
                    self.service_name,
                    username,
                )
        except Exception as error:
            raise RuntimeError(f"Credential store is unavailable: {error}") from error
