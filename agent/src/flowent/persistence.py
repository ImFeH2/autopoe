from __future__ import annotations

import os
import sqlite3
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import Any

SCHEMA_VERSION = 3
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
            elif version == 1:
                self._migrate_version_one(connection)
            elif version == 2:
                self._migrate_version_two(connection)
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
        with connection:
            self._create_tables(connection)
            connection.execute(
                "INSERT INTO application_state (id, organization_saved) VALUES (1, 0)"
            )
            connection.execute(f"PRAGMA user_version = {SCHEMA_VERSION}")

    @staticmethod
    def _create_tables(connection: sqlite3.Connection) -> None:
        statements = (
            """
            CREATE TABLE application_state (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                organization_saved INTEGER NOT NULL DEFAULT 0
                    CHECK (organization_saved IN (0, 1))
            )
            """,
            """
            CREATE TABLE members (
                id INTEGER PRIMARY KEY,
                type TEXT NOT NULL CHECK (type IN ('human', 'agent')),
                name TEXT NOT NULL
            )
            """,
            """
            CREATE TABLE discussions (
                id INTEGER PRIMARY KEY,
                topic TEXT NOT NULL
            )
            """,
            """
            CREATE TABLE discussion_members (
                discussion_id INTEGER NOT NULL,
                position INTEGER NOT NULL,
                member_id INTEGER NOT NULL,
                PRIMARY KEY (discussion_id, position),
                UNIQUE (discussion_id, member_id),
                FOREIGN KEY (discussion_id) REFERENCES discussions (id)
                    ON DELETE CASCADE,
                FOREIGN KEY (member_id) REFERENCES members (id)
            )
            """,
            """
            CREATE TABLE messages (
                discussion_id INTEGER NOT NULL,
                id INTEGER NOT NULL,
                sender_id INTEGER NOT NULL,
                body TEXT NOT NULL,
                PRIMARY KEY (discussion_id, id),
                FOREIGN KEY (discussion_id) REFERENCES discussions (id)
                    ON DELETE CASCADE,
                FOREIGN KEY (sender_id) REFERENCES members (id)
            )
            """,
            """
            CREATE TABLE mentions (
                discussion_id INTEGER NOT NULL,
                message_id INTEGER NOT NULL,
                position INTEGER NOT NULL,
                member_id INTEGER NOT NULL,
                read INTEGER NOT NULL CHECK (read IN (0, 1)),
                acked INTEGER NOT NULL CHECK (acked IN (0, 1)),
                PRIMARY KEY (discussion_id, message_id, position),
                UNIQUE (discussion_id, message_id, member_id),
                FOREIGN KEY (discussion_id, message_id)
                    REFERENCES messages (discussion_id, id) ON DELETE CASCADE,
                FOREIGN KEY (member_id) REFERENCES members (id)
            )
            """,
            """
            CREATE TABLE model_settings (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                provider TEXT NOT NULL
                    CHECK (provider IN ('openai', 'anthropic', 'google')),
                base_url TEXT NOT NULL,
                api_key TEXT NOT NULL,
                model TEXT NOT NULL,
                FOREIGN KEY (id) REFERENCES application_state (id)
                    ON DELETE CASCADE
            )
            """,
            """
            CREATE TABLE observability_settings (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
                base_url TEXT NOT NULL,
                public_key TEXT NOT NULL,
                secret_key TEXT NOT NULL,
                environment TEXT NOT NULL,
                capture_content INTEGER NOT NULL
                    CHECK (capture_content IN (0, 1)),
                FOREIGN KEY (id) REFERENCES application_state (id)
                    ON DELETE CASCADE
            )
            """,
        )
        for statement in statements:
            connection.execute(statement)

    def _migrate_version_one(self, connection: sqlite3.Connection) -> None:
        organization_keys = [
            row["working_directory"]
            for row in connection.execute(
                """
                SELECT working_directory FROM instances
                WHERE organization_saved = 1
                ORDER BY working_directory
                """
            )
        ]
        organizations = [
            self._load_version_one_organization(connection, key)
            for key in organization_keys
        ]
        organization = self._unique_migration_value(
            organizations,
            "Organization",
        )
        model_configs = [
            {
                "provider": row["provider"],
                "base_url": row["base_url"],
                "api_key": row["api_key"],
                "model": row["model"],
            }
            for row in connection.execute(
                """
                SELECT provider, base_url, api_key, model FROM model_settings
                ORDER BY working_directory
                """
            )
        ]
        model_config = self._unique_migration_value(
            model_configs,
            "model settings",
        )

        with connection:
            for table in (
                "model_settings",
                "mentions",
                "messages",
                "discussion_members",
                "discussions",
                "members",
                "instances",
            ):
                connection.execute(f"DROP TABLE {table}")
            self._create_tables(connection)
            connection.execute(
                "INSERT INTO application_state (id, organization_saved) VALUES (1, ?)",
                (int(organization is not None),),
            )
            if organization is not None:
                self._write_organization(connection, organization)
            if model_config is not None:
                self._write_model_config(connection, model_config)
            connection.execute(f"PRAGMA user_version = {SCHEMA_VERSION}")

    def _migrate_version_two(self, connection: sqlite3.Connection) -> None:
        with connection:
            connection.execute(
                """
                CREATE TABLE observability_settings (
                    id INTEGER PRIMARY KEY CHECK (id = 1),
                    enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
                    base_url TEXT NOT NULL,
                    public_key TEXT NOT NULL,
                    secret_key TEXT NOT NULL,
                    environment TEXT NOT NULL,
                    capture_content INTEGER NOT NULL
                        CHECK (capture_content IN (0, 1)),
                    FOREIGN KEY (id) REFERENCES application_state (id)
                        ON DELETE CASCADE
                )
                """
            )
            connection.execute(f"PRAGMA user_version = {SCHEMA_VERSION}")

    @staticmethod
    def _unique_migration_value(
        values: list[dict[str, Any]],
        label: str,
    ) -> dict[str, Any] | None:
        if not values:
            return None
        first = values[0]
        if any(value != first for value in values[1:]):
            raise RuntimeError(
                f"Cannot migrate database with conflicting {label} partitions"
            )
        return first

    @staticmethod
    def _load_version_one_organization(
        connection: sqlite3.Connection,
        key: str,
    ) -> dict[str, Any]:
        members = [
            {"id": row["id"], "type": row["type"], "name": row["name"]}
            for row in connection.execute(
                """
                SELECT id, type, name FROM members
                WHERE working_directory = ? ORDER BY id
                """,
                (key,),
            )
        ]
        discussions: list[dict[str, Any]] = []
        for row in connection.execute(
            """
            SELECT id, topic FROM discussions
            WHERE working_directory = ? ORDER BY id
            """,
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
                        WHERE working_directory = ?
                            AND discussion_id = ? AND message_id = ?
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

    def load_organization(self) -> dict[str, Any] | None:
        with self._connect() as connection:
            row = connection.execute(
                "SELECT organization_saved FROM application_state WHERE id = 1"
            ).fetchone()
            if row is None or not row["organization_saved"]:
                return None
            members = [
                {"id": row["id"], "type": row["type"], "name": row["name"]}
                for row in connection.execute(
                    "SELECT id, type, name FROM members ORDER BY id"
                )
            ]
            discussions: list[dict[str, Any]] = []
            for row in connection.execute(
                "SELECT id, topic FROM discussions ORDER BY id"
            ):
                discussion_id = row["id"]
                member_ids = [
                    member["member_id"]
                    for member in connection.execute(
                        """
                        SELECT member_id FROM discussion_members
                        WHERE discussion_id = ? ORDER BY position
                        """,
                        (discussion_id,),
                    )
                ]
                messages: list[dict[str, Any]] = []
                for message in connection.execute(
                    """
                    SELECT id, sender_id, body FROM messages
                    WHERE discussion_id = ? ORDER BY id
                    """,
                    (discussion_id,),
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
                            WHERE discussion_id = ? AND message_id = ?
                            ORDER BY position
                            """,
                            (discussion_id, message["id"]),
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

    def save_organization(self, organization: dict[str, Any]) -> None:
        with self._connect() as connection, connection:
            connection.execute(
                "UPDATE application_state SET organization_saved = 1 WHERE id = 1"
            )
            connection.execute("DELETE FROM discussions")
            connection.execute("DELETE FROM members")
            self._write_organization(connection, organization)
        self.path.chmod(0o600)

    @staticmethod
    def _write_organization(
        connection: sqlite3.Connection,
        organization: dict[str, Any],
    ) -> None:
        for member in organization["members"]:
            connection.execute(
                "INSERT INTO members (id, type, name) VALUES (?, ?, ?)",
                (member["id"], member["type"], member["name"]),
            )
        for discussion in organization["discussions"]:
            discussion_id = discussion["id"]
            connection.execute(
                "INSERT INTO discussions (id, topic) VALUES (?, ?)",
                (discussion_id, discussion["topic"]),
            )
            for position, member_id in enumerate(discussion["member_ids"]):
                connection.execute(
                    """
                    INSERT INTO discussion_members
                        (discussion_id, position, member_id)
                    VALUES (?, ?, ?)
                    """,
                    (discussion_id, position, member_id),
                )
            for message in discussion["messages"]:
                connection.execute(
                    """
                    INSERT INTO messages
                        (discussion_id, id, sender_id, body)
                    VALUES (?, ?, ?, ?)
                    """,
                    (
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
                            (discussion_id, message_id, position, member_id, read, acked)
                        VALUES (?, ?, ?, ?, ?, ?)
                        """,
                        (
                            discussion_id,
                            message["id"],
                            position,
                            mention["member_id"],
                            int(mention["read"]),
                            int(mention["acked"]),
                        ),
                    )

    def load_model_config(self) -> dict[str, str] | None:
        with self._connect() as connection:
            row = connection.execute(
                """
                SELECT provider, base_url, api_key, model FROM model_settings
                WHERE id = 1
                """
            ).fetchone()
            if row is None:
                return None
            return {
                "provider": row["provider"],
                "base_url": row["base_url"],
                "api_key": row["api_key"],
                "model": row["model"],
            }

    def save_model_config(self, config: dict[str, str]) -> None:
        with self._connect() as connection, connection:
            self._write_model_config(connection, config)
        self.path.chmod(0o600)

    def load_observability_config(self) -> dict[str, Any] | None:
        with self._connect() as connection:
            row = connection.execute(
                """
                SELECT enabled, base_url, public_key, secret_key, environment,
                    capture_content
                FROM observability_settings WHERE id = 1
                """
            ).fetchone()
            if row is None:
                return None
            return {
                "enabled": bool(row["enabled"]),
                "base_url": row["base_url"],
                "public_key": row["public_key"],
                "secret_key": row["secret_key"],
                "environment": row["environment"],
                "capture_content": bool(row["capture_content"]),
            }

    def save_observability_config(self, config: dict[str, Any]) -> None:
        with self._connect() as connection, connection:
            connection.execute(
                """
                INSERT INTO observability_settings
                    (id, enabled, base_url, public_key, secret_key, environment,
                        capture_content)
                VALUES (1, ?, ?, ?, ?, ?, ?)
                ON CONFLICT (id) DO UPDATE SET
                    enabled = excluded.enabled,
                    base_url = excluded.base_url,
                    public_key = excluded.public_key,
                    secret_key = excluded.secret_key,
                    environment = excluded.environment,
                    capture_content = excluded.capture_content
                """,
                (
                    int(config["enabled"]),
                    config["base_url"],
                    config["public_key"],
                    config["secret_key"],
                    config["environment"],
                    int(config["capture_content"]),
                ),
            )
        self.path.chmod(0o600)

    @staticmethod
    def _write_model_config(
        connection: sqlite3.Connection,
        config: dict[str, str],
    ) -> None:
        connection.execute(
            """
            INSERT INTO model_settings
                (id, provider, base_url, api_key, model)
            VALUES (1, ?, ?, ?, ?)
            ON CONFLICT (id) DO UPDATE SET
                provider = excluded.provider,
                base_url = excluded.base_url,
                api_key = excluded.api_key,
                model = excluded.model
            """,
            (
                config["provider"],
                config["base_url"],
                config["api_key"],
                config["model"],
            ),
        )
