import json
import sqlite3
from pathlib import Path

from pydantic import BaseModel, ConfigDict, Field

from flowent.llm import ProviderFormat
from flowent.paths import data_directory


class StoredProvider(BaseModel):
    model_config = ConfigDict(extra="forbid")

    api_key: str
    base_url: str
    id: str
    models: list[str]
    name: str
    type: ProviderFormat


class StoredSettings(BaseModel):
    model_config = ConfigDict(extra="forbid")

    selected_model: str
    selected_provider_id: str


class StoredToolItem(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    name: str
    status: str
    title: str
    arguments: dict[str, object] | None = None
    content: str | None = None
    data: dict[str, object] | None = None


class StoredMessage(BaseModel):
    model_config = ConfigDict(extra="forbid")

    author: str
    content: str
    id: str
    tools: list[StoredToolItem] = Field(default_factory=list)


class StoredState(BaseModel):
    model_config = ConfigDict(extra="forbid")

    messages: list[StoredMessage]
    providers: list[StoredProvider]
    settings: StoredSettings


class StateStore:
    def __init__(self, directory: Path | None = None) -> None:
        self.directory = directory or data_directory()
        self.database_path = self.directory / "flowent.db"

    def connect(self) -> sqlite3.Connection:
        self.directory.mkdir(mode=0o700, parents=True, exist_ok=True)
        connection = sqlite3.connect(self.database_path)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute("PRAGMA journal_mode = WAL")
        connection.execute("PRAGMA busy_timeout = 5000")
        self._migrate(connection)
        return connection

    def read_state(self) -> StoredState:
        with self.connect() as connection:
            providers = [
                StoredProvider(
                    api_key=row["api_key"],
                    base_url=row["base_url"],
                    id=row["id"],
                    models=self._provider_models(connection, row["id"]),
                    name=row["name"],
                    type=row["type"],
                )
                for row in connection.execute(
                    """
                    SELECT id, name, type, base_url, api_key
                    FROM providers
                    ORDER BY created_at, id
                    """
                )
            ]
            settings_row = connection.execute(
                """
                SELECT selected_provider_id, selected_model
                FROM settings
                WHERE id = 1
                """
            ).fetchone()
            messages = [
                StoredMessage(
                    author=row["author"],
                    content=row["content"],
                    id=row["id"],
                    tools=[
                        StoredToolItem.model_validate(tool)
                        for tool in json.loads(row["tools"] or "[]")
                    ],
                )
                for row in connection.execute(
                    """
                    SELECT id, author, content, tools
                    FROM messages
                    ORDER BY position, id
                    """
                )
            ]

        return StoredState(
            messages=messages,
            providers=providers,
            settings=StoredSettings(
                selected_model=settings_row["selected_model"] if settings_row else "",
                selected_provider_id=settings_row["selected_provider_id"]
                if settings_row
                else "",
            ),
        )

    def save_provider(self, provider: StoredProvider) -> StoredProvider:
        with self.connect() as connection:
            connection.execute(
                """
                INSERT INTO providers (id, name, type, base_url, api_key)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    name = excluded.name,
                    type = excluded.type,
                    base_url = excluded.base_url,
                    api_key = excluded.api_key,
                    updated_at = unixepoch()
                """,
                (
                    provider.id,
                    provider.name,
                    provider.type.value,
                    provider.base_url,
                    provider.api_key,
                ),
            )
            connection.execute(
                "DELETE FROM provider_models WHERE provider_id = ?", (provider.id,)
            )
            connection.executemany(
                """
                INSERT INTO provider_models (provider_id, model, position)
                VALUES (?, ?, ?)
                """,
                [
                    (provider.id, model, position)
                    for position, model in enumerate(provider.models)
                ],
            )
        return provider

    def save_settings(self, settings: StoredSettings) -> StoredSettings:
        with self.connect() as connection:
            connection.execute(
                """
                INSERT INTO settings (id, selected_provider_id, selected_model)
                VALUES (1, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    selected_provider_id = excluded.selected_provider_id,
                    selected_model = excluded.selected_model,
                    updated_at = unixepoch()
                """,
                (settings.selected_provider_id, settings.selected_model),
            )
        return settings

    def save_messages(self, messages: list[StoredMessage]) -> list[StoredMessage]:
        with self.connect() as connection:
            connection.execute("DELETE FROM messages")
            connection.executemany(
                """
                INSERT INTO messages (id, author, content, tools, position)
                VALUES (?, ?, ?, ?, ?)
                """,
                [
                    (
                        message.id,
                        message.author,
                        message.content,
                        json.dumps(
                            [
                                tool.model_dump(exclude_none=True)
                                for tool in message.tools
                            ]
                        ),
                        position,
                    )
                    for position, message in enumerate(messages)
                ],
            )
            if not messages:
                connection.execute("DELETE FROM workspace_context WHERE id = 1")
        return messages

    def read_compacted_context(self) -> str:
        with self.connect() as connection:
            row = connection.execute(
                """
                SELECT compacted_summary
                FROM workspace_context
                WHERE id = 1
                """
            ).fetchone()
        return row["compacted_summary"] if row else ""

    def save_compacted_context(self, summary: str) -> str:
        with self.connect() as connection:
            connection.execute(
                """
                INSERT INTO workspace_context (id, compacted_summary)
                VALUES (1, ?)
                ON CONFLICT(id) DO UPDATE SET
                    compacted_summary = excluded.compacted_summary,
                    updated_at = unixepoch()
                """,
                (summary,),
            )
        return summary

    def _provider_models(
        self, connection: sqlite3.Connection, provider_id: str
    ) -> list[str]:
        return [
            row["model"]
            for row in connection.execute(
                """
                SELECT model
                FROM provider_models
                WHERE provider_id = ?
                ORDER BY position, model
                """,
                (provider_id,),
            )
        ]

    def _migrate(self, connection: sqlite3.Connection) -> None:
        connection.executescript(
            """
            CREATE TABLE IF NOT EXISTS providers (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                type TEXT NOT NULL,
                base_url TEXT NOT NULL,
                api_key TEXT NOT NULL,
                created_at INTEGER NOT NULL DEFAULT (unixepoch()),
                updated_at INTEGER NOT NULL DEFAULT (unixepoch())
            );

            CREATE TABLE IF NOT EXISTS provider_models (
                provider_id TEXT NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
                model TEXT NOT NULL,
                position INTEGER NOT NULL,
                PRIMARY KEY (provider_id, model)
            );

            CREATE TABLE IF NOT EXISTS settings (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                selected_provider_id TEXT NOT NULL DEFAULT '',
                selected_model TEXT NOT NULL DEFAULT '',
                updated_at INTEGER NOT NULL DEFAULT (unixepoch())
            );

            CREATE TABLE IF NOT EXISTS messages (
                id TEXT PRIMARY KEY,
                author TEXT NOT NULL,
                content TEXT NOT NULL,
                position INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS workspace_context (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                compacted_summary TEXT NOT NULL DEFAULT '',
                updated_at INTEGER NOT NULL DEFAULT (unixepoch())
            );

            CREATE TABLE IF NOT EXISTS schema_migrations (
                version INTEGER PRIMARY KEY
            );

            INSERT OR IGNORE INTO schema_migrations (version) VALUES (1);
            """
        )
        columns = {
            row["name"] for row in connection.execute("PRAGMA table_info(messages)")
        }
        if "tools" not in columns:
            connection.execute(
                "ALTER TABLE messages ADD COLUMN tools TEXT NOT NULL DEFAULT '[]'"
            )
