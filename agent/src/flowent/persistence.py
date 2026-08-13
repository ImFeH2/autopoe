from __future__ import annotations

import os
import sqlite3
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import Any

SCHEMA_VERSION = 1
DATA_DIRECTORY_ENV = "FLOWENT_DATA_DIR"


def data_directory() -> Path:
    override = os.environ.get(DATA_DIRECTORY_ENV)
    if override:
        return Path(override).expanduser().resolve()
    return Path.home() / ".flowent"


class SQLiteStore:
    def __init__(self, directory: Path) -> None:
        self.directory = directory
        self.path = directory / "flowent.sqlite3"
        self.directory.mkdir(mode=0o700, parents=True, exist_ok=True)
        self.directory.chmod(0o700)
        with self._connect() as connection:
            version = connection.execute("PRAGMA user_version").fetchone()[0]
            if version == 0:
                self._create_schema(connection)
            elif version != SCHEMA_VERSION:
                raise RuntimeError(f"Unsupported Flowent database version: {version}")
        self.path.chmod(0o600)

    @contextmanager
    def _connect(self) -> Iterator[sqlite3.Connection]:
        connection = sqlite3.connect(self.path, timeout=5)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute("PRAGMA secure_delete = ON")
        try:
            yield connection
        finally:
            connection.close()

    def _create_schema(self, connection: sqlite3.Connection) -> None:
        connection.executescript(
            """
            BEGIN;
            CREATE TABLE instances (
                working_directory TEXT PRIMARY KEY,
                organization_saved INTEGER NOT NULL DEFAULT 0 CHECK (organization_saved IN (0, 1))
            );
            CREATE TABLE members (
                working_directory TEXT NOT NULL,
                id INTEGER NOT NULL,
                type TEXT NOT NULL CHECK (type IN ('human', 'agent')),
                name TEXT NOT NULL,
                PRIMARY KEY (working_directory, id),
                FOREIGN KEY (working_directory) REFERENCES instances (working_directory) ON DELETE CASCADE
            );
            CREATE TABLE discussions (
                working_directory TEXT NOT NULL,
                id INTEGER NOT NULL,
                topic TEXT NOT NULL,
                PRIMARY KEY (working_directory, id),
                FOREIGN KEY (working_directory) REFERENCES instances (working_directory) ON DELETE CASCADE
            );
            CREATE TABLE discussion_members (
                working_directory TEXT NOT NULL,
                discussion_id INTEGER NOT NULL,
                position INTEGER NOT NULL,
                member_id INTEGER NOT NULL,
                PRIMARY KEY (working_directory, discussion_id, position),
                UNIQUE (working_directory, discussion_id, member_id),
                FOREIGN KEY (working_directory, discussion_id) REFERENCES discussions (working_directory, id) ON DELETE CASCADE,
                FOREIGN KEY (working_directory, member_id) REFERENCES members (working_directory, id)
            );
            CREATE TABLE messages (
                working_directory TEXT NOT NULL,
                discussion_id INTEGER NOT NULL,
                id INTEGER NOT NULL,
                sender_id INTEGER NOT NULL,
                body TEXT NOT NULL,
                PRIMARY KEY (working_directory, discussion_id, id),
                FOREIGN KEY (working_directory, discussion_id) REFERENCES discussions (working_directory, id) ON DELETE CASCADE,
                FOREIGN KEY (working_directory, sender_id) REFERENCES members (working_directory, id)
            );
            CREATE TABLE mentions (
                working_directory TEXT NOT NULL,
                discussion_id INTEGER NOT NULL,
                message_id INTEGER NOT NULL,
                position INTEGER NOT NULL,
                member_id INTEGER NOT NULL,
                read INTEGER NOT NULL CHECK (read IN (0, 1)),
                acked INTEGER NOT NULL CHECK (acked IN (0, 1)),
                PRIMARY KEY (working_directory, discussion_id, message_id, position),
                UNIQUE (working_directory, discussion_id, message_id, member_id),
                FOREIGN KEY (working_directory, discussion_id, message_id) REFERENCES messages (working_directory, discussion_id, id) ON DELETE CASCADE,
                FOREIGN KEY (working_directory, member_id) REFERENCES members (working_directory, id)
            );
            CREATE TABLE model_settings (
                working_directory TEXT PRIMARY KEY,
                provider TEXT NOT NULL CHECK (provider IN ('openai', 'anthropic', 'google')),
                base_url TEXT NOT NULL,
                api_key TEXT NOT NULL,
                model TEXT NOT NULL,
                FOREIGN KEY (working_directory) REFERENCES instances (working_directory) ON DELETE CASCADE
            );
            PRAGMA user_version = 1;
            COMMIT;
            """
        )

    def load_organization(self, working_directory: Path) -> dict[str, Any] | None:
        key = str(working_directory.resolve())
        with self._connect() as connection:
            row = connection.execute(
                "SELECT organization_saved FROM instances WHERE working_directory = ?",
                (key,),
            ).fetchone()
            if row is None or not row["organization_saved"]:
                return None
            members = [
                {"id": row["id"], "type": row["type"], "name": row["name"]}
                for row in connection.execute(
                    "SELECT id, type, name FROM members WHERE working_directory = ? ORDER BY id",
                    (key,),
                )
            ]
            discussions: list[dict[str, Any]] = []
            for row in connection.execute(
                "SELECT id, topic FROM discussions WHERE working_directory = ? ORDER BY id",
                (key,),
            ):
                discussion_id = row["id"]
                member_ids = [
                    member["member_id"]
                    for member in connection.execute(
                        """
                        SELECT member_id FROM discussion_members
                        WHERE working_directory = ? AND discussion_id = ?
                        ORDER BY position
                        """,
                        (key, discussion_id),
                    )
                ]
                messages: list[dict[str, Any]] = []
                for message in connection.execute(
                    """
                    SELECT id, sender_id, body FROM messages
                    WHERE working_directory = ? AND discussion_id = ?
                    ORDER BY id
                    """,
                    (key, discussion_id),
                ):
                    mentions = [
                        {
                            "member_id": mention["member_id"],
                            "read": bool(mention["read"]),
                            "acked": bool(mention["acked"]),
                        }
                        for mention in connection.execute(
                            """
                            SELECT member_id, read, acked FROM mentions
                            WHERE working_directory = ? AND discussion_id = ? AND message_id = ?
                            ORDER BY position
                            """,
                            (key, discussion_id, message["id"]),
                        )
                    ]
                    messages.append(
                        {
                            "id": message["id"],
                            "sender_id": message["sender_id"],
                            "body": message["body"],
                            "mentions": mentions,
                        }
                    )
                discussions.append(
                    {
                        "id": discussion_id,
                        "topic": row["topic"],
                        "member_ids": member_ids,
                        "messages": messages,
                    }
                )
            return {"members": members, "discussions": discussions}

    def save_organization(
        self,
        working_directory: Path,
        organization: dict[str, Any],
    ) -> None:
        key = str(working_directory.resolve())
        with self._connect() as connection, connection:
            connection.execute(
                "INSERT OR IGNORE INTO instances (working_directory) VALUES (?)",
                (key,),
            )
            connection.execute(
                "UPDATE instances SET organization_saved = 1 WHERE working_directory = ?",
                (key,),
            )
            connection.execute(
                "DELETE FROM discussions WHERE working_directory = ?", (key,)
            )
            connection.execute(
                "DELETE FROM members WHERE working_directory = ?", (key,)
            )
            for member in organization["members"]:
                connection.execute(
                    "INSERT INTO members (working_directory, id, type, name) VALUES (?, ?, ?, ?)",
                    (key, member["id"], member["type"], member["name"]),
                )
            for discussion in organization["discussions"]:
                discussion_id = discussion["id"]
                connection.execute(
                    "INSERT INTO discussions (working_directory, id, topic) VALUES (?, ?, ?)",
                    (key, discussion_id, discussion["topic"]),
                )
                for position, member_id in enumerate(discussion["member_ids"]):
                    connection.execute(
                        """
                        INSERT INTO discussion_members
                            (working_directory, discussion_id, position, member_id)
                        VALUES (?, ?, ?, ?)
                        """,
                        (key, discussion_id, position, member_id),
                    )
                for message in discussion["messages"]:
                    connection.execute(
                        """
                        INSERT INTO messages
                            (working_directory, discussion_id, id, sender_id, body)
                        VALUES (?, ?, ?, ?, ?)
                        """,
                        (
                            key,
                            discussion_id,
                            message["id"],
                            message["sender_id"],
                            message["body"],
                        ),
                    )
                    for position, mention in enumerate(message["mentions"]):
                        connection.execute(
                            """
                            INSERT INTO mentions
                                (working_directory, discussion_id, message_id, position, member_id, read, acked)
                            VALUES (?, ?, ?, ?, ?, ?, ?)
                            """,
                            (
                                key,
                                discussion_id,
                                message["id"],
                                position,
                                mention["member_id"],
                                int(mention["read"]),
                                int(mention["acked"]),
                            ),
                        )
        self.path.chmod(0o600)

    def load_model_config(self, working_directory: Path) -> dict[str, str] | None:
        key = str(working_directory.resolve())
        with self._connect() as connection:
            row = connection.execute(
                """
                SELECT provider, base_url, api_key, model FROM model_settings
                WHERE working_directory = ?
                """,
                (key,),
            ).fetchone()
            if row is None:
                return None
            return {
                "provider": row["provider"],
                "base_url": row["base_url"],
                "api_key": row["api_key"],
                "model": row["model"],
            }

    def save_model_config(
        self,
        working_directory: Path,
        config: dict[str, str],
    ) -> None:
        key = str(working_directory.resolve())
        with self._connect() as connection, connection:
            connection.execute(
                "INSERT OR IGNORE INTO instances (working_directory) VALUES (?)",
                (key,),
            )
            connection.execute(
                """
                INSERT INTO model_settings
                    (working_directory, provider, base_url, api_key, model)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT (working_directory) DO UPDATE SET
                    provider = excluded.provider,
                    base_url = excluded.base_url,
                    api_key = excluded.api_key,
                    model = excluded.model
                """,
                (
                    key,
                    config["provider"],
                    config["base_url"],
                    config["api_key"],
                    config["model"],
                ),
            )
        self.path.chmod(0o600)
