from __future__ import annotations

import json
import sqlite3
import time
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any
from uuid import uuid4

import aiosqlite
from pydantic_ai import ModelMessagesTypeAdapter
from pydantic_ai.messages import ModelMessage
from pydantic_core import to_json

from flowent.collaboration.domain import (
    AgentRecord,
    Chat,
    ChatMessage,
    CollaborationSnapshot,
    TurnStart,
)

INTERRUPTED = "Runtime interrupted"


class CollaborationStore:
    def __init__(self, data_dir: Path):
        self.database_path = data_dir / "flowent.db"

    @asynccontextmanager
    async def _database(self) -> AsyncIterator[aiosqlite.Connection]:
        async with aiosqlite.connect(self.database_path) as database:
            database.row_factory = aiosqlite.Row
            await database.execute("PRAGMA foreign_keys = ON")
            yield database

    async def initialize(self) -> None:
        self.database_path.parent.mkdir(parents=True, exist_ok=True)
        async with self._database() as database:
            await database.execute("PRAGMA journal_mode = WAL")
            await database.executescript(
                """
                CREATE TABLE IF NOT EXISTS agents (
                    project_id TEXT NOT NULL,
                    id TEXT NOT NULL,
                    kind TEXT NOT NULL CHECK (kind IN ('leader', 'worker')),
                    name TEXT NOT NULL,
                    role TEXT NOT NULL,
                    archived_at INTEGER,
                    created_at INTEGER NOT NULL,
                    updated_at INTEGER NOT NULL,
                    PRIMARY KEY (project_id, id),
                    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
                );

                CREATE UNIQUE INDEX IF NOT EXISTS agents_project_leader
                ON agents(project_id)
                WHERE kind = 'leader';

                CREATE TABLE IF NOT EXISTS chats (
                    id TEXT PRIMARY KEY,
                    project_id TEXT NOT NULL,
                    kind TEXT NOT NULL CHECK (kind IN ('general', 'custom')),
                    title TEXT NOT NULL,
                    purpose TEXT NOT NULL,
                    created_by TEXT NOT NULL,
                    created_at INTEGER NOT NULL,
                    closed_at INTEGER,
                    UNIQUE (project_id, id),
                    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
                );

                CREATE UNIQUE INDEX IF NOT EXISTS chats_project_general
                ON chats(project_id)
                WHERE kind = 'general';

                CREATE TABLE IF NOT EXISTS chat_members (
                    project_id TEXT NOT NULL,
                    chat_id TEXT NOT NULL,
                    agent_id TEXT NOT NULL,
                    joined_at INTEGER NOT NULL,
                    PRIMARY KEY (chat_id, agent_id),
                    FOREIGN KEY (project_id, chat_id)
                        REFERENCES chats(project_id, id) ON DELETE CASCADE,
                    FOREIGN KEY (project_id, agent_id)
                        REFERENCES agents(project_id, id) ON DELETE CASCADE
                );

                CREATE TABLE IF NOT EXISTS turns (
                    id TEXT PRIMARY KEY,
                    project_id TEXT NOT NULL,
                    agent_id TEXT NOT NULL,
                    chat_id TEXT NOT NULL,
                    input_message_id TEXT NOT NULL,
                    output_message_id TEXT NOT NULL,
                    status TEXT NOT NULL CHECK (
                        status IN ('running', 'completed', 'failed', 'interrupted')
                    ),
                    context_json TEXT NOT NULL,
                    events_json TEXT NOT NULL,
                    usage_json TEXT NOT NULL,
                    error TEXT,
                    started_at INTEGER NOT NULL,
                    finished_at INTEGER,
                    FOREIGN KEY (project_id, agent_id)
                        REFERENCES agents(project_id, id) ON DELETE CASCADE,
                    FOREIGN KEY (project_id, chat_id)
                        REFERENCES chats(project_id, id) ON DELETE CASCADE
                );

                CREATE INDEX IF NOT EXISTS turns_agent_started
                ON turns(project_id, agent_id, started_at);

                CREATE TABLE IF NOT EXISTS chat_messages (
                    id TEXT PRIMARY KEY,
                    project_id TEXT NOT NULL,
                    chat_id TEXT NOT NULL,
                    turn_id TEXT,
                    author_type TEXT NOT NULL CHECK (
                        author_type IN ('user', 'agent', 'system')
                    ),
                    author_id TEXT,
                    content TEXT NOT NULL,
                    status TEXT NOT NULL CHECK (
                        status IN ('streaming', 'complete', 'failed', 'interrupted')
                    ),
                    created_at INTEGER NOT NULL,
                    updated_at INTEGER NOT NULL,
                    UNIQUE (project_id, id),
                    FOREIGN KEY (project_id, chat_id)
                        REFERENCES chats(project_id, id) ON DELETE CASCADE,
                    FOREIGN KEY (project_id, author_id)
                        REFERENCES agents(project_id, id) ON DELETE CASCADE,
                    FOREIGN KEY (turn_id) REFERENCES turns(id) ON DELETE SET NULL
                );

                CREATE INDEX IF NOT EXISTS chat_messages_chat_created
                ON chat_messages(chat_id, created_at);

                CREATE TABLE IF NOT EXISTS message_processing (
                    project_id TEXT NOT NULL,
                    message_id TEXT NOT NULL,
                    agent_id TEXT NOT NULL,
                    status TEXT NOT NULL CHECK (status IN ('pending', 'processed')),
                    processed_at INTEGER,
                    PRIMARY KEY (message_id, agent_id),
                    FOREIGN KEY (project_id, message_id)
                        REFERENCES chat_messages(project_id, id) ON DELETE CASCADE,
                    FOREIGN KEY (project_id, agent_id)
                        REFERENCES agents(project_id, id) ON DELETE CASCADE
                );

                CREATE INDEX IF NOT EXISTS message_processing_agent_status
                ON message_processing(project_id, agent_id, status);

                CREATE TABLE IF NOT EXISTS agent_contexts (
                    project_id TEXT NOT NULL,
                    agent_id TEXT NOT NULL,
                    model_messages_json TEXT NOT NULL,
                    updated_at INTEGER NOT NULL,
                    PRIMARY KEY (project_id, agent_id),
                    FOREIGN KEY (project_id, agent_id)
                        REFERENCES agents(project_id, id) ON DELETE CASCADE
                );
                """
            )
            await self._migrate(database)
            await database.execute(
                """
                CREATE UNIQUE INDEX IF NOT EXISTS agents_project_active_name
                ON agents(project_id, name COLLATE NOCASE)
                WHERE archived_at IS NULL
                """
            )
            await self._recover(database)
            await database.commit()

    async def open_project(self, project_id: str) -> CollaborationSnapshot:
        await self._ensure_project(project_id)
        return await self.snapshot(project_id)

    async def snapshot(
        self,
        project_id: str,
        agent_id: str = "leader",
    ) -> CollaborationSnapshot:
        async with self._database() as database:
            async with database.execute(
                """
                SELECT id, project_id, name, role, kind, archived_at
                FROM agents
                WHERE project_id = ? AND id = ? AND archived_at IS NULL
                """,
                (project_id, agent_id),
            ) as cursor:
                agent_row = await cursor.fetchone()
            async with database.execute(
                """
                SELECT id, project_id, title, purpose
                FROM chats
                WHERE project_id = ? AND kind = 'general'
                """,
                (project_id,),
            ) as cursor:
                chat_row = await cursor.fetchone()
            if agent_row is None or chat_row is None:
                raise RuntimeError("project collaboration state is missing")

            async with database.execute(
                """
                SELECT id, chat_id, turn_id, author_type, author_id, content, status
                FROM chat_messages
                WHERE chat_id = ?
                ORDER BY created_at, id
                """,
                (chat_row["id"],),
            ) as cursor:
                message_rows = await cursor.fetchall()
            async with database.execute(
                """
                SELECT status, context_json, events_json, usage_json, error, id
                FROM turns
                WHERE project_id = ? AND agent_id = ?
                ORDER BY started_at DESC
                LIMIT 1
                """,
                (project_id, agent_row["id"]),
            ) as cursor:
                turn_row = await cursor.fetchone()
            async with database.execute(
                """
                SELECT model_messages_json
                FROM agent_contexts
                WHERE project_id = ? AND agent_id = ?
                """,
                (project_id, agent_row["id"]),
            ) as cursor:
                context_row = await cursor.fetchone()

        history = (
            ModelMessagesTypeAdapter.validate_json(context_row["model_messages_json"])
            if context_row
            else []
        )
        return CollaborationSnapshot(
            self._agent(agent_row),
            self._chat(chat_row),
            [self._message(row) for row in message_rows],
            self._turn(turn_row) if turn_row else None,
            history,
        )

    async def list_agents(
        self,
        project_id: str,
        include_archived: bool = False,
    ) -> list[AgentRecord]:
        archived = "" if include_archived else "AND archived_at IS NULL"
        async with (
            self._database() as database,
            database.execute(
                f"""
            SELECT id, project_id, name, role, kind, archived_at
            FROM agents
            WHERE project_id = ? {archived}
            ORDER BY kind, name COLLATE NOCASE, id
            """,
                (project_id,),
            ) as cursor,
        ):
            rows = await cursor.fetchall()
        return [self._agent(row) for row in rows]

    async def start_turn(
        self,
        project_id: str,
        agent_id: str,
        chat_id: str,
        content: str,
        instructions: str,
        messages: list[dict[str, Any]],
        tools: list[str],
    ) -> TurnStart:
        turn_id = uuid4().hex
        user_message = ChatMessage(
            f"{turn_id}-user",
            chat_id,
            turn_id,
            "user",
            content,
            "complete",
        )
        agent_message = ChatMessage(
            f"{turn_id}-agent",
            chat_id,
            turn_id,
            agent_id,
            "",
            "streaming",
        )
        turn = {
            "id": turn_id,
            "status": "running",
            "context": {
                "instructions": instructions,
                "input": content,
                "messages": messages,
                "tools": tools,
            },
            "events": [{"kind": "started"}],
            "usage": None,
            "error": None,
        }
        now = time.time_ns()
        async with self._database() as database:
            await database.execute(
                """
                INSERT INTO turns (
                    id, project_id, agent_id, chat_id, input_message_id,
                    output_message_id, status, context_json, events_json,
                    usage_json, error, started_at, finished_at
                )
                VALUES (?, ?, ?, ?, ?, ?, 'running', ?, ?, ?, NULL, ?, NULL)
                """,
                (
                    turn_id,
                    project_id,
                    agent_id,
                    chat_id,
                    user_message.id,
                    agent_message.id,
                    self._dump(turn["context"]),
                    self._dump(turn["events"]),
                    self._dump(None),
                    now,
                ),
            )
            await self._insert_message(database, project_id, user_message, now)
            await self._insert_message(database, project_id, agent_message, now + 1)
            await database.commit()
        return TurnStart(turn_id, user_message, agent_message, turn)

    async def create_worker(
        self,
        project_id: str,
        name: str,
        role: str,
    ) -> AgentRecord:
        await self._ensure_project(project_id)
        name = self._identity(name, "name", 80)
        role = self._identity(role, "role", 160)
        agent_id = uuid4().hex
        now = time.time_ns()
        async with self._database() as database:
            try:
                await database.execute(
                    """
                    INSERT INTO agents (
                        project_id, id, kind, name, role, archived_at,
                        created_at, updated_at
                    )
                    VALUES (?, ?, 'worker', ?, ?, NULL, ?, ?)
                    """,
                    (project_id, agent_id, name, role, now, now),
                )
            except sqlite3.IntegrityError as error:
                raise ValueError("agent name already exists") from error
            async with database.execute(
                """
                SELECT id
                FROM chats
                WHERE project_id = ? AND kind = 'general'
                """,
                (project_id,),
            ) as cursor:
                chat = await cursor.fetchone()
            if chat is None:
                raise RuntimeError("project general chat is missing")
            await database.execute(
                """
                INSERT INTO chat_members (
                    project_id, chat_id, agent_id, joined_at
                )
                VALUES (?, ?, ?, ?)
                """,
                (project_id, chat["id"], agent_id, now),
            )
            await database.execute(
                """
                INSERT INTO agent_contexts (
                    project_id, agent_id, model_messages_json, updated_at
                )
                VALUES (?, ?, '[]', ?)
                """,
                (project_id, agent_id, now),
            )
            await database.commit()
        return AgentRecord(agent_id, project_id, name, role, "worker", False)

    async def update_worker(
        self,
        project_id: str,
        agent_id: str,
        name: str,
        role: str,
    ) -> AgentRecord:
        name = self._identity(name, "name", 80)
        role = self._identity(role, "role", 160)
        now = time.time_ns()
        async with self._database() as database:
            try:
                cursor = await database.execute(
                    """
                    UPDATE agents
                    SET name = ?, role = ?, updated_at = ?
                    WHERE project_id = ? AND id = ? AND kind = 'worker'
                        AND archived_at IS NULL
                    """,
                    (name, role, now, project_id, agent_id),
                )
            except sqlite3.IntegrityError as error:
                raise ValueError("agent name already exists") from error
            if cursor.rowcount != 1:
                raise ValueError("worker not found")
            await database.commit()
        return AgentRecord(agent_id, project_id, name, role, "worker", False)

    async def archive_worker(self, project_id: str, agent_id: str) -> None:
        now = time.time_ns()
        async with self._database() as database:
            cursor = await database.execute(
                """
                UPDATE agents
                SET archived_at = ?, updated_at = ?
                WHERE project_id = ? AND id = ? AND kind = 'worker'
                    AND archived_at IS NULL
                """,
                (now, now, project_id, agent_id),
            )
            if cursor.rowcount != 1:
                raise ValueError("worker not found")
            await database.commit()

    async def complete_turn(
        self,
        project_id: str,
        agent_id: str,
        output_message_id: str,
        content: str,
        turn: dict[str, Any],
        history: list[ModelMessage],
    ) -> None:
        now = time.time_ns()
        async with self._database() as database:
            cursor = await database.execute(
                """
                UPDATE chat_messages
                SET content = ?, status = 'complete', updated_at = ?
                WHERE id = ?
                """,
                (content, now, output_message_id),
            )
            if cursor.rowcount != 1:
                raise RuntimeError("turn output message is missing")
            await self._update_turn(database, turn, now)
            await database.execute(
                """
                INSERT INTO agent_contexts (
                    project_id, agent_id, model_messages_json, updated_at
                )
                VALUES (?, ?, ?, ?)
                ON CONFLICT(project_id, agent_id) DO UPDATE SET
                    model_messages_json = excluded.model_messages_json,
                    updated_at = excluded.updated_at
                """,
                (project_id, agent_id, to_json(history).decode(), now),
            )
            await database.commit()

    async def fail_turn(
        self,
        output_message_id: str,
        content: str,
        turn: dict[str, Any],
    ) -> None:
        now = time.time_ns()
        async with self._database() as database:
            cursor = await database.execute(
                """
                UPDATE chat_messages
                SET content = ?, status = 'failed', updated_at = ?
                WHERE id = ?
                """,
                (content, now, output_message_id),
            )
            if cursor.rowcount != 1:
                raise RuntimeError("turn output message is missing")
            await self._update_turn(database, turn, now)
            await database.commit()

    async def _ensure_project(self, project_id: str) -> None:
        now = time.time_ns()
        async with self._database() as database:
            await database.execute(
                """
                INSERT OR IGNORE INTO agents (
                    project_id, id, kind, name, role, created_at, updated_at
                )
                VALUES (?, 'leader', 'leader', 'Leader', 'Leader', ?, ?)
                """,
                (project_id, now, now),
            )
            async with database.execute(
                """
                SELECT id
                FROM agents
                WHERE project_id = ? AND kind = 'leader' AND archived_at IS NULL
                """,
                (project_id,),
            ) as cursor:
                agent_row = await cursor.fetchone()
            if agent_row is None:
                raise RuntimeError("project leader is missing")

            chat_id = uuid4().hex
            await database.execute(
                """
                INSERT OR IGNORE INTO chats (
                    id, project_id, kind, title, purpose, created_by,
                    created_at, closed_at
                )
                VALUES (?, ?, 'general', 'General', '', 'user', ?, NULL)
                """,
                (chat_id, project_id, now),
            )
            async with database.execute(
                """
                SELECT id
                FROM chats
                WHERE project_id = ? AND kind = 'general'
                """,
                (project_id,),
            ) as cursor:
                chat_row = await cursor.fetchone()
            if chat_row is None:
                raise RuntimeError("project general chat is missing")

            await database.execute(
                """
                INSERT OR IGNORE INTO chat_members (
                    project_id, chat_id, agent_id, joined_at
                )
                VALUES (?, ?, ?, ?)
                """,
                (project_id, chat_row["id"], agent_row["id"], now),
            )
            await database.execute(
                """
                INSERT OR IGNORE INTO agent_contexts (
                    project_id, agent_id, model_messages_json, updated_at
                )
                VALUES (?, ?, '[]', ?)
                """,
                (project_id, agent_row["id"], now),
            )
            await database.commit()

    @staticmethod
    async def _migrate(database: aiosqlite.Connection) -> None:
        async with database.execute("PRAGMA table_info(agents)") as cursor:
            columns = {row["name"] for row in await cursor.fetchall()}
        if "archived_at" not in columns:
            await database.execute("ALTER TABLE agents ADD COLUMN archived_at INTEGER")

    async def _recover(self, database: aiosqlite.Connection) -> None:
        async with database.execute(
            """
            SELECT id, output_message_id, events_json
            FROM turns
            WHERE status = 'running'
            """
        ) as cursor:
            rows = await cursor.fetchall()
        now = time.time_ns()
        for row in rows:
            events = self._load(row["events_json"])
            events.append({"kind": "interrupted", "message": INTERRUPTED})
            await database.execute(
                """
                UPDATE turns
                SET status = 'interrupted', events_json = ?, error = ?, finished_at = ?
                WHERE id = ?
                """,
                (self._dump(events), INTERRUPTED, now, row["id"]),
            )
            await database.execute(
                """
                UPDATE chat_messages
                SET content = CASE WHEN content = '' THEN ? ELSE content END,
                    status = 'interrupted', updated_at = ?
                WHERE id = ?
                """,
                (INTERRUPTED, now, row["output_message_id"]),
            )

    @staticmethod
    async def _insert_message(
        database: aiosqlite.Connection,
        project_id: str,
        message: ChatMessage,
        created_at: int,
    ) -> None:
        author_type = "user" if message.author == "user" else "agent"
        author_id = None if message.author == "user" else message.author
        await database.execute(
            """
            INSERT INTO chat_messages (
                id, project_id, chat_id, turn_id, author_type, author_id,
                content, status, created_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                message.id,
                project_id,
                message.chat_id,
                message.turn_id,
                author_type,
                author_id,
                message.content,
                message.status,
                created_at,
                created_at,
            ),
        )

    @classmethod
    async def _update_turn(
        cls,
        database: aiosqlite.Connection,
        turn: dict[str, Any],
        finished_at: int,
    ) -> None:
        cursor = await database.execute(
            """
            UPDATE turns
            SET status = ?, context_json = ?, events_json = ?, usage_json = ?,
                error = ?, finished_at = ?
            WHERE id = ?
            """,
            (
                turn["status"],
                cls._dump(turn["context"]),
                cls._dump(turn["events"]),
                cls._dump(turn["usage"]),
                turn["error"],
                finished_at,
                turn["id"],
            ),
        )
        if cursor.rowcount != 1:
            raise RuntimeError("turn is missing")

    @staticmethod
    def _agent(row: aiosqlite.Row) -> AgentRecord:
        return AgentRecord(
            row["id"],
            row["project_id"],
            row["name"],
            row["role"],
            row["kind"],
            row["archived_at"] is not None,
        )

    @staticmethod
    def _chat(row: aiosqlite.Row) -> Chat:
        return Chat(row["id"], row["project_id"], row["title"], row["purpose"])

    @staticmethod
    def _message(row: aiosqlite.Row) -> ChatMessage:
        author = (
            row["author_id"] if row["author_type"] == "agent" else row["author_type"]
        )
        return ChatMessage(
            row["id"],
            row["chat_id"],
            row["turn_id"],
            author,
            row["content"],
            row["status"],
        )

    @classmethod
    def _turn(cls, row: aiosqlite.Row) -> dict[str, Any]:
        return {
            "id": row["id"],
            "status": row["status"],
            "context": cls._load(row["context_json"]),
            "events": cls._load(row["events_json"]),
            "usage": cls._load(row["usage_json"]),
            "error": row["error"],
        }

    @staticmethod
    def _dump(value: Any) -> str:
        return json.dumps(value, separators=(",", ":"))

    @staticmethod
    def _load(value: str) -> Any:
        return json.loads(value)

    @staticmethod
    def _identity(value: str, field: str, limit: int) -> str:
        value = value.strip()
        if not value:
            raise ValueError(f"agent {field} is required")
        if len(value) > limit:
            raise ValueError(f"agent {field} is too long")
        return value
