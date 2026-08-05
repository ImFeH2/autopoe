from __future__ import annotations

import sqlite3
import time
from collections.abc import Awaitable, Callable
from contextlib import AbstractAsyncContextManager
from typing import Any
from uuid import uuid4

import aiosqlite

from flowent.collaboration.domain import Chat, ChatMessage

Database = Callable[[], AbstractAsyncContextManager[aiosqlite.Connection]]
EnsureProject = Callable[[str], Awaitable[None]]


class ChatStore:
    def __init__(self, database: Database, ensure_project: EnsureProject):
        self.database = database
        self.ensure_project = ensure_project

    async def list_chats(
        self,
        project_id: str,
        agent_id: str | None = None,
        include_closed: bool = False,
    ) -> list[Chat]:
        closed = "" if include_closed else "AND c.closed_at IS NULL"
        membership = (
            ""
            if agent_id is None
            else """
                AND EXISTS (
                    SELECT 1
                    FROM chat_members AS own_membership
                    WHERE own_membership.project_id = c.project_id
                        AND own_membership.chat_id = c.id
                        AND own_membership.agent_id = ?
                )
            """
        )
        params: tuple[str, ...] = (
            (project_id,) if agent_id is None else (project_id, agent_id)
        )
        async with (
            self.database() as database,
            database.execute(
                f"""
                SELECT c.id, c.project_id, c.title, c.purpose, c.kind,
                    c.created_by, c.closed_at, a.id AS member_id
                FROM chats AS c
                LEFT JOIN chat_members AS cm
                    ON cm.project_id = c.project_id AND cm.chat_id = c.id
                LEFT JOIN agents AS a
                    ON a.project_id = cm.project_id AND a.id = cm.agent_id
                        AND a.archived_at IS NULL
                WHERE c.project_id = ? {closed} {membership}
                ORDER BY CASE c.kind WHEN 'general' THEN 0 ELSE 1 END,
                    c.title COLLATE NOCASE, c.id, a.kind,
                    a.name COLLATE NOCASE, a.id
                """,
                params,
            ) as cursor,
        ):
            rows = await cursor.fetchall()

        records: dict[str, tuple[aiosqlite.Row, list[str]]] = {}
        for row in rows:
            if row["id"] not in records:
                records[row["id"]] = (row, [])
            if row["member_id"] is not None:
                records[row["id"]][1].append(row["member_id"])
        return [chat_from_row(row, tuple(members)) for row, members in records.values()]

    async def list_agent_chats(
        self,
        project_id: str,
        agent_id: str,
    ) -> list[dict[str, Any]]:
        chats = await self.list_chats(project_id, agent_id)
        async with (
            self.database() as database,
            database.execute(
                """
                SELECT m.chat_id, COUNT(*) AS pending
                FROM message_processing AS p
                JOIN chat_messages AS m
                    ON m.project_id = p.project_id AND m.id = p.message_id
                WHERE p.project_id = ? AND p.agent_id = ?
                    AND p.status = 'pending' AND m.status != 'streaming'
                GROUP BY m.chat_id
                """,
                (project_id, agent_id),
            ) as cursor,
        ):
            pending = {
                row["chat_id"]: row["pending"] for row in await cursor.fetchall()
            }
        return [
            {**chat.to_dict(), "pending": pending.get(chat.id, 0)} for chat in chats
        ]

    async def get_chat(
        self,
        project_id: str,
        chat_id: str,
        include_closed: bool = False,
    ) -> Chat:
        chats = await self.list_chats(project_id, include_closed=include_closed)
        try:
            return next(chat for chat in chats if chat.id == chat_id)
        except StopIteration as error:
            raise ValueError("chat not found") from error

    async def create_chat(
        self,
        project_id: str,
        title: str,
        purpose: str,
        members: list[str],
        created_by: str,
    ) -> Chat:
        await self.ensure_project(project_id)
        title = normalize_text(title, "chat title", 80)
        purpose = normalize_text(purpose, "chat purpose", 500, required=False)
        member_ids = normalize_member_ids(members)
        if created_by != "user" and created_by not in member_ids:
            member_ids.append(created_by)
        chat_id = uuid4().hex
        now = time.time_ns()
        async with self.database() as database:
            await require_agents(database, project_id, member_ids)
            try:
                await database.execute(
                    """
                    INSERT INTO chats (
                        id, project_id, kind, title, purpose, created_by,
                        created_at, closed_at
                    )
                    VALUES (?, ?, 'custom', ?, ?, ?, ?, NULL)
                    """,
                    (chat_id, project_id, title, purpose, created_by, now),
                )
            except sqlite3.IntegrityError as error:
                raise ValueError("chat title already exists") from error
            await database.executemany(
                """
                INSERT INTO chat_members (project_id, chat_id, agent_id, joined_at)
                VALUES (?, ?, ?, ?)
                """,
                [(project_id, chat_id, member_id, now) for member_id in member_ids],
            )
            await database.commit()
        return await self.get_chat(project_id, chat_id)

    async def update_chat(
        self,
        project_id: str,
        chat_id: str,
        title: str,
        purpose: str,
        members: list[str],
    ) -> Chat:
        title = normalize_text(title, "chat title", 80)
        purpose = normalize_text(purpose, "chat purpose", 500, required=False)
        member_ids = normalize_member_ids(members)
        now = time.time_ns()
        async with self.database() as database:
            async with database.execute(
                """
                SELECT kind, created_by
                FROM chats
                WHERE project_id = ? AND id = ? AND closed_at IS NULL
                """,
                (project_id, chat_id),
            ) as cursor:
                chat = await cursor.fetchone()
            if chat is None:
                raise ValueError("chat not found")
            if chat["kind"] == "general":
                raise ValueError("general chat cannot be edited")
            await require_agents(database, project_id, member_ids)
            try:
                await database.execute(
                    """
                    UPDATE chats
                    SET title = ?, purpose = ?
                    WHERE project_id = ? AND id = ?
                    """,
                    (title, purpose, project_id, chat_id),
                )
            except sqlite3.IntegrityError as error:
                raise ValueError("chat title already exists") from error

            async with database.execute(
                """
                SELECT agent_id
                FROM chat_members
                WHERE project_id = ? AND chat_id = ?
                """,
                (project_id, chat_id),
            ) as cursor:
                previous = {row["agent_id"] for row in await cursor.fetchall()}
            removed = previous.difference(member_ids)
            added = set(member_ids).difference(previous)
            if removed:
                await database.executemany(
                    """
                    DELETE FROM message_processing
                    WHERE project_id = ? AND agent_id = ? AND message_id IN (
                        SELECT id FROM chat_messages WHERE chat_id = ?
                    )
                    """,
                    [(project_id, agent_id, chat_id) for agent_id in removed],
                )
                await database.executemany(
                    """
                    DELETE FROM chat_members
                    WHERE project_id = ? AND chat_id = ? AND agent_id = ?
                    """,
                    [(project_id, chat_id, agent_id) for agent_id in removed],
                )
            if added:
                await database.executemany(
                    """
                    INSERT INTO chat_members (
                        project_id, chat_id, agent_id, joined_at
                    )
                    VALUES (?, ?, ?, ?)
                    """,
                    [
                        (project_id, chat_id, member_id, now)
                        for member_id in member_ids
                        if member_id in added
                    ],
                )
            await database.commit()
        return await self.get_chat(project_id, chat_id)

    async def close_chat(self, project_id: str, chat_id: str) -> None:
        now = time.time_ns()
        async with self.database() as database:
            async with database.execute(
                """
                SELECT kind
                FROM chats
                WHERE project_id = ? AND id = ? AND closed_at IS NULL
                """,
                (project_id, chat_id),
            ) as cursor:
                chat = await cursor.fetchone()
            if chat is None:
                raise ValueError("chat not found")
            if chat["kind"] == "general":
                raise ValueError("general chat cannot be closed")
            await database.execute(
                "UPDATE chats SET closed_at = ? WHERE project_id = ? AND id = ?",
                (now, project_id, chat_id),
            )
            await database.execute(
                """
                UPDATE message_processing
                SET status = 'processed', processed_at = ?
                WHERE project_id = ? AND status = 'pending' AND message_id IN (
                    SELECT id FROM chat_messages WHERE chat_id = ?
                )
                """,
                (now, project_id, chat_id),
            )
            await database.commit()

    async def list_messages(
        self,
        project_id: str,
        chat_id: str,
    ) -> list[ChatMessage]:
        await self.get_chat(project_id, chat_id, include_closed=True)
        async with (
            self.database() as database,
            database.execute(
                """
                SELECT id, chat_id, turn_id, author_type, author_id, content,
                    status, created_at
                FROM chat_messages
                WHERE project_id = ? AND chat_id = ?
                ORDER BY created_at, id
                """,
                (project_id, chat_id),
            ) as cursor,
        ):
            rows = await cursor.fetchall()
        return [message_from_row(row) for row in rows]

    async def read_chat(
        self,
        project_id: str,
        chat_id: str,
        agent_id: str,
    ) -> dict[str, Any]:
        chat = await self.get_chat(project_id, chat_id, include_closed=True)
        if agent_id not in chat.members:
            raise ValueError("chat not found")
        async with (
            self.database() as database,
            database.execute(
                """
                SELECT m.id, m.chat_id, m.turn_id, m.author_type, m.author_id,
                    m.content, m.status, m.created_at, p.status AS processing
                FROM chat_messages AS m
                LEFT JOIN message_processing AS p
                    ON p.project_id = m.project_id AND p.message_id = m.id
                        AND p.agent_id = ?
                WHERE m.project_id = ? AND m.chat_id = ?
                ORDER BY m.created_at, m.id
                """,
                (agent_id, project_id, chat_id),
            ) as cursor,
        ):
            rows = await cursor.fetchall()
        return {
            "chat": chat.to_dict(),
            "messages": [
                {**message_from_row(row).to_dict(), "processing": row["processing"]}
                for row in rows
            ],
        }

    async def send_message(
        self,
        project_id: str,
        chat_id: str,
        author: str,
        content: str,
    ) -> ChatMessage:
        content = normalize_text(content, "message", 20_000)
        now = time.time_ns()
        message = ChatMessage(
            uuid4().hex,
            chat_id,
            None,
            author,
            content,
            "complete",
            now,
        )
        async with self.database() as database:
            members = await active_chat_members(database, project_id, chat_id)
            if not members:
                raise ValueError("chat not found")
            if author != "user" and author not in members:
                raise ValueError("chat not found")
            await insert_chat_message(
                database,
                project_id,
                message,
                now,
                members,
                author if author != "user" else None,
            )
            await database.commit()
        return message

    async def mark_processed(
        self,
        project_id: str,
        chat_id: str,
        agent_id: str,
        through_message_id: str,
    ) -> int:
        now = time.time_ns()
        async with self.database() as database:
            members = await active_chat_members(
                database,
                project_id,
                chat_id,
                include_closed=True,
            )
            if agent_id not in members:
                raise ValueError("chat not found")
            async with database.execute(
                """
                SELECT created_at
                FROM chat_messages
                WHERE project_id = ? AND chat_id = ? AND id = ?
                """,
                (project_id, chat_id, through_message_id),
            ) as cursor:
                target = await cursor.fetchone()
            if target is None:
                raise ValueError("message not found")
            cursor = await database.execute(
                """
                UPDATE message_processing
                SET status = 'processed', processed_at = ?
                WHERE project_id = ? AND agent_id = ? AND status = 'pending'
                    AND message_id IN (
                        SELECT id
                        FROM chat_messages
                        WHERE project_id = ? AND chat_id = ?
                            AND (
                                created_at < ?
                                OR (created_at = ? AND id <= ?)
                            )
                    )
                """,
                (
                    now,
                    project_id,
                    agent_id,
                    project_id,
                    chat_id,
                    target["created_at"],
                    target["created_at"],
                    through_message_id,
                ),
            )
            await database.commit()
        return cursor.rowcount


def chat_from_row(row: aiosqlite.Row, members: tuple[str, ...]) -> Chat:
    return Chat(
        row["id"],
        row["project_id"],
        row["title"],
        row["purpose"],
        row["kind"],
        row["created_by"],
        members,
        row["closed_at"] is not None,
    )


def message_from_row(row: aiosqlite.Row) -> ChatMessage:
    author = row["author_id"] if row["author_type"] == "agent" else row["author_type"]
    return ChatMessage(
        row["id"],
        row["chat_id"],
        row["turn_id"],
        author,
        row["content"],
        row["status"],
        row["created_at"],
    )


def normalize_text(
    value: str,
    field: str,
    limit: int,
    required: bool = True,
) -> str:
    value = value.strip()
    if required and not value:
        raise ValueError(f"{field} is required")
    if len(value) > limit:
        raise ValueError(f"{field} is too long")
    return value


def normalize_member_ids(members: list[str]) -> list[str]:
    member_ids = list(dict.fromkeys(member.strip() for member in members))
    if not member_ids or any(not member_id for member_id in member_ids):
        raise ValueError("chat members are required")
    if len(member_ids) > 64:
        raise ValueError("chat has too many members")
    return member_ids


async def require_agents(
    database: aiosqlite.Connection,
    project_id: str,
    agent_ids: list[str],
) -> None:
    async with database.execute(
        """
        SELECT id
        FROM agents
        WHERE project_id = ? AND archived_at IS NULL
        """,
        (project_id,),
    ) as cursor:
        active = {row["id"] for row in await cursor.fetchall()}
    if not set(agent_ids).issubset(active):
        raise ValueError("chat member not found")


async def active_chat_members(
    database: aiosqlite.Connection,
    project_id: str,
    chat_id: str,
    include_closed: bool = False,
) -> list[str]:
    closed = "" if include_closed else "AND c.closed_at IS NULL"
    async with database.execute(
        f"""
        SELECT cm.agent_id
        FROM chat_members AS cm
        JOIN chats AS c
            ON c.project_id = cm.project_id AND c.id = cm.chat_id
        JOIN agents AS a
            ON a.project_id = cm.project_id AND a.id = cm.agent_id
        WHERE cm.project_id = ? AND cm.chat_id = ? {closed}
            AND a.archived_at IS NULL
        ORDER BY a.kind, a.name COLLATE NOCASE, a.id
        """,
        (project_id, chat_id),
    ) as cursor:
        return [row["agent_id"] for row in await cursor.fetchall()]


async def insert_chat_message(
    database: aiosqlite.Connection,
    project_id: str,
    message: ChatMessage,
    created_at: int,
    members: list[str],
    processed_by: str | None,
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
    await database.executemany(
        """
        INSERT INTO message_processing (
            project_id, message_id, agent_id, status, processed_at
        )
        VALUES (?, ?, ?, ?, ?)
        """,
        [
            (
                project_id,
                message.id,
                agent_id,
                "processed" if agent_id == processed_by else "pending",
                created_at if agent_id == processed_by else None,
            )
            for agent_id in members
        ],
    )
