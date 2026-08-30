from __future__ import annotations

import sqlite3
from collections.abc import Iterator, Mapping, Sequence
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path

from huddol.core.discussion import Discussion, Message
from huddol.core.member import AgentState, Member, MemberType, name_key
from huddol.core.mention import Mention, build_mentions

SCHEMA = """
CREATE TABLE IF NOT EXISTS members (
    id INTEGER PRIMARY KEY,
    type TEXT NOT NULL,
    name TEXT NOT NULL,
    name_key TEXT NOT NULL UNIQUE,
    deleted INTEGER NOT NULL DEFAULT 0,
    state TEXT NOT NULL DEFAULT 'idle'
);
CREATE TABLE IF NOT EXISTS discussions (
    id INTEGER PRIMARY KEY,
    topic TEXT NOT NULL,
    archived INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS discussion_members (
    discussion_id INTEGER NOT NULL,
    member_id INTEGER NOT NULL,
    PRIMARY KEY (discussion_id, member_id)
);
CREATE TABLE IF NOT EXISTS messages (
    discussion_id INTEGER NOT NULL,
    id INTEGER NOT NULL,
    sender_id INTEGER NOT NULL,
    sender_name TEXT NOT NULL,
    body TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (discussion_id, id)
);
CREATE TABLE IF NOT EXISTS mentions (
    discussion_id INTEGER NOT NULL,
    message_id INTEGER NOT NULL,
    member_id INTEGER NOT NULL,
    position INTEGER NOT NULL,
    PRIMARY KEY (discussion_id, message_id, member_id)
);
CREATE INDEX IF NOT EXISTS mentions_by_member ON mentions (member_id);
CREATE TABLE IF NOT EXISTS acks (
    discussion_id INTEGER NOT NULL,
    message_id INTEGER NOT NULL,
    member_id INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (discussion_id, message_id, member_id)
);
CREATE TABLE IF NOT EXISTS watermarks (
    discussion_id INTEGER NOT NULL,
    member_id INTEGER NOT NULL,
    message_id INTEGER NOT NULL,
    PRIMARY KEY (discussion_id, member_id)
);
CREATE TABLE IF NOT EXISTS agent_runs (
    agent_id INTEGER NOT NULL,
    sequence INTEGER NOT NULL,
    run_id TEXT NOT NULL,
    status TEXT NOT NULL,
    started_at TEXT NOT NULL,
    completed_at TEXT,
    messages_json TEXT NOT NULL DEFAULT '[]',
    usage_json TEXT,
    error TEXT,
    PRIMARY KEY (agent_id, sequence)
);
"""


def now() -> str:
    return datetime.now(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")


class SqliteStore:
    def __init__(self, path: Path | str) -> None:
        self._path = Path(path)
        self._path.parent.mkdir(parents=True, exist_ok=True)
        self._db = sqlite3.connect(self._path, check_same_thread=False)
        self._db.row_factory = sqlite3.Row
        self._db.execute("PRAGMA journal_mode=WAL")
        self._db.execute("PRAGMA foreign_keys=ON")
        self._db.executescript(SCHEMA)
        self._db.commit()

    def close(self) -> None:
        self._db.close()

    @contextmanager
    def _write(self) -> Iterator[sqlite3.Connection]:
        with self._db:
            yield self._db

    def _next_id(self, table: str) -> int:
        row = self._db.execute(f"SELECT COALESCE(MAX(id), 0) + 1 AS v FROM {table}")
        return int(row.fetchone()["v"])

    def _member(self, row: sqlite3.Row) -> Member:
        return Member(
            id=int(row["id"]),
            type=str(row["type"]),  # type: ignore[arg-type]
            name=str(row["name"]),
            deleted=bool(row["deleted"]),
            state=str(row["state"]),  # type: ignore[arg-type]
        )

    def list_members(self, *, include_deleted: bool = False) -> tuple[Member, ...]:
        sql = "SELECT * FROM members"
        if not include_deleted:
            sql += " WHERE deleted = 0"
        sql += " ORDER BY id"
        return tuple(self._member(row) for row in self._db.execute(sql))

    def get_member(self, member_id: int) -> Member | None:
        row = self._db.execute(
            "SELECT * FROM members WHERE id = ?", (member_id,)
        ).fetchone()
        return self._member(row) if row else None

    def name_taken(self, name: str) -> bool:
        row = self._db.execute(
            "SELECT 1 FROM members WHERE name_key = ?", (name_key(name),)
        ).fetchone()
        return row is not None

    def create_member(self, member_type: MemberType, name: str) -> Member:
        member_id = self._next_id("members")
        with self._write() as db:
            db.execute(
                "INSERT INTO members (id, type, name, name_key) VALUES (?, ?, ?, ?)",
                (member_id, member_type, name, name_key(name)),
            )
        member = self.get_member(member_id)
        assert member is not None
        return member

    def rename_member(self, member_id: int, name: str) -> Member:
        with self._write() as db:
            db.execute(
                "UPDATE members SET name = ?, name_key = ? WHERE id = ?",
                (name, name_key(name), member_id),
            )
        member = self.get_member(member_id)
        assert member is not None
        return member

    def set_agent_state(self, agent_id: int, state: AgentState) -> None:
        with self._write() as db:
            db.execute("UPDATE members SET state = ? WHERE id = ?", (state, agent_id))

    def delete_member(self, member_id: int) -> None:
        with self._write() as db:
            db.execute("UPDATE members SET deleted = 1 WHERE id = ?", (member_id,))
            db.execute(
                "DELETE FROM discussion_members WHERE member_id = ?", (member_id,)
            )

    def _discussion(self, row: sqlite3.Row) -> Discussion:
        members = self._db.execute(
            "SELECT member_id FROM discussion_members WHERE discussion_id = ?",
            (row["id"],),
        )
        return Discussion(
            id=int(row["id"]),
            topic=str(row["topic"]),
            member_ids=frozenset(int(item["member_id"]) for item in members),
            archived=bool(row["archived"]),
        )

    def list_discussions(
        self, *, member_id: int | None = None, include_archived: bool = False
    ) -> tuple[Discussion, ...]:
        sql = "SELECT d.* FROM discussions d"
        params: list[object] = []
        clauses: list[str] = []
        if member_id is not None:
            sql += " JOIN discussion_members dm ON dm.discussion_id = d.id"
            clauses.append("dm.member_id = ?")
            params.append(member_id)
        if not include_archived:
            clauses.append("d.archived = 0")
        if clauses:
            sql += " WHERE " + " AND ".join(clauses)
        sql += " ORDER BY d.id"
        return tuple(self._discussion(row) for row in self._db.execute(sql, params))

    def get_discussion(self, discussion_id: int) -> Discussion | None:
        row = self._db.execute(
            "SELECT * FROM discussions WHERE id = ?", (discussion_id,)
        ).fetchone()
        return self._discussion(row) if row else None

    def create_discussion(self, topic: str, member_ids: Sequence[int]) -> Discussion:
        discussion_id = self._next_id("discussions")
        with self._write() as db:
            db.execute(
                "INSERT INTO discussions (id, topic) VALUES (?, ?)",
                (discussion_id, topic),
            )
            db.executemany(
                "INSERT INTO discussion_members (discussion_id, member_id) VALUES (?, ?)",
                [(discussion_id, member_id) for member_id in dict.fromkeys(member_ids)],
            )
        discussion = self.get_discussion(discussion_id)
        assert discussion is not None
        return discussion

    def set_discussion_members(
        self, discussion_id: int, member_ids: Sequence[int]
    ) -> Discussion:
        with self._write() as db:
            db.execute(
                "DELETE FROM discussion_members WHERE discussion_id = ?",
                (discussion_id,),
            )
            db.executemany(
                "INSERT INTO discussion_members (discussion_id, member_id) VALUES (?, ?)",
                [(discussion_id, member_id) for member_id in dict.fromkeys(member_ids)],
            )
        discussion = self.get_discussion(discussion_id)
        assert discussion is not None
        return discussion

    def set_archived(self, discussion_id: int, archived: bool) -> None:
        with self._write() as db:
            db.execute(
                "UPDATE discussions SET archived = ? WHERE id = ?",
                (1 if archived else 0, discussion_id),
            )

    def delete_discussion(self, discussion_id: int) -> None:
        with self._write() as db:
            for table in (
                "discussion_members",
                "messages",
                "mentions",
                "acks",
                "watermarks",
            ):
                db.execute(
                    f"DELETE FROM {table} WHERE discussion_id = ?", (discussion_id,)
                )
            db.execute("DELETE FROM discussions WHERE id = ?", (discussion_id,))

    def _message(self, row: sqlite3.Row) -> Message:
        return Message(
            discussion_id=int(row["discussion_id"]),
            id=int(row["id"]),
            sender_id=int(row["sender_id"]),
            sender_name=str(row["sender_name"]),
            body=str(row["body"]),
            created_at=str(row["created_at"]),
        )

    def append_message(
        self, discussion_id: int, sender_id: int, body: str
    ) -> tuple[Message, tuple[Mention, ...]]:
        sender = self.get_member(sender_id)
        assert sender is not None
        discussion = self.get_discussion(discussion_id)
        assert discussion is not None
        members = [
            member
            for member in self.list_members()
            if member.id in discussion.member_ids
        ]
        row = self._db.execute(
            "SELECT COALESCE(MAX(id), 0) + 1 AS v FROM messages WHERE discussion_id = ?",
            (discussion_id,),
        ).fetchone()
        message_id = int(row["v"])
        mentions = build_mentions(discussion_id, message_id, body, members)
        message = Message(
            discussion_id=discussion_id,
            id=message_id,
            sender_id=sender_id,
            sender_name=sender.name,
            body=body,
            created_at=now(),
        )
        with self._write() as db:
            db.execute(
                "INSERT INTO messages (discussion_id, id, sender_id, sender_name, body,"
                " created_at) VALUES (?, ?, ?, ?, ?, ?)",
                (
                    message.discussion_id,
                    message.id,
                    message.sender_id,
                    message.sender_name,
                    message.body,
                    message.created_at,
                ),
            )
            db.executemany(
                "INSERT INTO mentions (discussion_id, message_id, member_id, position)"
                " VALUES (?, ?, ?, ?)",
                [
                    (item.discussion_id, item.message_id, item.member_id, item.position)
                    for item in mentions
                ],
            )
        return message, mentions

    def messages(
        self,
        discussion_id: int,
        *,
        after: int | None = None,
        before: int | None = None,
        limit: int | None = None,
    ) -> tuple[Message, ...]:
        sql = "SELECT * FROM messages WHERE discussion_id = ?"
        params: list[object] = [discussion_id]
        if after is not None:
            sql += " AND id > ?"
            params.append(after)
        if before is not None:
            sql += " AND id < ?"
            params.append(before)
        sql += " ORDER BY id"
        if limit is not None:
            sql += " LIMIT ?"
            params.append(limit)
        return tuple(self._message(row) for row in self._db.execute(sql, params))

    def message_count(self, discussion_id: int) -> int:
        row = self._db.execute(
            "SELECT COUNT(*) AS v FROM messages WHERE discussion_id = ?",
            (discussion_id,),
        ).fetchone()
        return int(row["v"])

    def mentions_by_message(self, discussion_id: int) -> Mapping[int, frozenset[int]]:
        found: dict[int, set[int]] = {}
        for row in self._db.execute(
            "SELECT message_id, member_id FROM mentions WHERE discussion_id = ?",
            (discussion_id,),
        ):
            found.setdefault(int(row["message_id"]), set()).add(int(row["member_id"]))
        return {key: frozenset(value) for key, value in found.items()}

    def search_messages(
        self,
        query: str,
        *,
        sender_id: int | None = None,
        discussion_id: int | None = None,
        limit: int = 50,
    ) -> tuple[Message, ...]:
        sql = "SELECT * FROM messages WHERE body LIKE ? ESCAPE '\\'"
        escaped = query.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        params: list[object] = [f"%{escaped}%"]
        if sender_id is not None:
            sql += " AND sender_id = ?"
            params.append(sender_id)
        if discussion_id is not None:
            sql += " AND discussion_id = ?"
            params.append(discussion_id)
        sql += " ORDER BY discussion_id, id LIMIT ?"
        params.append(limit)
        return tuple(self._message(row) for row in self._db.execute(sql, params))

    def pending(self, member_id: int) -> tuple[Mention, ...]:
        rows = self._db.execute(
            """
            SELECT m.discussion_id, m.message_id, m.member_id, m.position
            FROM mentions m
            JOIN discussion_members dm
              ON dm.discussion_id = m.discussion_id AND dm.member_id = m.member_id
            JOIN discussions d
              ON d.id = m.discussion_id AND d.archived = 0
            LEFT JOIN acks a
              ON a.discussion_id = m.discussion_id
             AND a.message_id = m.message_id
             AND a.member_id = m.member_id
            WHERE m.member_id = ? AND a.member_id IS NULL
            ORDER BY m.discussion_id, m.message_id
            """,
            (member_id,),
        )
        return tuple(
            Mention(
                int(row["discussion_id"]),
                int(row["message_id"]),
                int(row["member_id"]),
                int(row["position"]),
            )
            for row in rows
        )

    def previously_reminded(
        self, member_id: int, mentions: Sequence[Mention]
    ) -> frozenset[int]:
        row = self._db.execute(
            "SELECT MAX(started_at) AS v FROM agent_runs WHERE agent_id = ?",
            (member_id,),
        ).fetchone()
        last = row["v"] if row else None
        if not last:
            return frozenset()
        found: set[int] = set()
        for mention in mentions:
            item = self._db.execute(
                "SELECT created_at FROM messages WHERE discussion_id = ? AND id = ?",
                (mention.discussion_id, mention.message_id),
            ).fetchone()
            if item and str(item["created_at"]) < str(last):
                found.add(mention.message_id)
        return frozenset(found)

    def ack(
        self, discussion_id: int, message_ids: Sequence[int], member_id: int
    ) -> int:
        stamp = now()
        with self._write() as db:
            cursor = db.executemany(
                "INSERT OR IGNORE INTO acks (discussion_id, message_id, member_id,"
                " created_at) VALUES (?, ?, ?, ?)",
                [
                    (discussion_id, message_id, member_id, stamp)
                    for message_id in message_ids
                ],
            )
            return cursor.rowcount

    def revoke_ack(
        self, discussion_id: int, message_ids: Sequence[int], member_id: int
    ) -> int:
        with self._write() as db:
            cursor = db.executemany(
                "DELETE FROM acks WHERE discussion_id = ? AND message_id = ?"
                " AND member_id = ?",
                [(discussion_id, message_id, member_id) for message_id in message_ids],
            )
            return cursor.rowcount

    def watermark(self, discussion_id: int, member_id: int) -> int:
        row = self._db.execute(
            "SELECT message_id FROM watermarks WHERE discussion_id = ? AND member_id = ?",
            (discussion_id, member_id),
        ).fetchone()
        return int(row["message_id"]) if row else 0

    def set_watermark(
        self, discussion_id: int, member_id: int, message_id: int
    ) -> None:
        with self._write() as db:
            db.execute(
                "INSERT INTO watermarks (discussion_id, member_id, message_id)"
                " VALUES (?, ?, ?) ON CONFLICT (discussion_id, member_id)"
                " DO UPDATE SET message_id = MAX(message_id, excluded.message_id)",
                (discussion_id, member_id, message_id),
            )

    def unread_counts(self, member_id: int) -> Mapping[int, int]:
        rows = self._db.execute(
            """
            SELECT dm.discussion_id AS discussion_id,
                   COUNT(m.id) AS unread
            FROM discussion_members dm
            LEFT JOIN watermarks w
              ON w.discussion_id = dm.discussion_id AND w.member_id = dm.member_id
            LEFT JOIN messages m
              ON m.discussion_id = dm.discussion_id
             AND m.id > COALESCE(w.message_id, 0)
             AND m.sender_id <> dm.member_id
            WHERE dm.member_id = ?
            GROUP BY dm.discussion_id
            """,
            (member_id,),
        )
        return {int(row["discussion_id"]): int(row["unread"]) for row in rows}
