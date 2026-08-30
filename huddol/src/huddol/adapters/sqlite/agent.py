from __future__ import annotations

import json
import sqlite3
import uuid
from collections.abc import Sequence

from huddol.core.errors import DomainError
from huddol.core.todo import Todo, TodoStatus
from huddol.ports.agent import AgentRun

SCHEMA = """
CREATE TABLE IF NOT EXISTS agent_todos (
    agent_id INTEGER NOT NULL,
    id INTEGER NOT NULL,
    title TEXT NOT NULL,
    detail TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL,
    PRIMARY KEY (agent_id, id)
);
CREATE TABLE IF NOT EXISTS settings (
    section TEXT PRIMARY KEY,
    values_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS write_directories (
    position INTEGER PRIMARY KEY,
    path TEXT NOT NULL
);
"""


class SqliteAgentStore:
    def __init__(self, db: sqlite3.Connection) -> None:
        self._db = db
        self._db.executescript(SCHEMA)
        self._db.commit()

    def _now(self) -> str:
        from huddol.adapters.sqlite.store import now

        return now()

    def list_todos(self, agent_id: int) -> tuple[Todo, ...]:
        rows = self._db.execute(
            "SELECT id, title, status, detail FROM agent_todos WHERE agent_id = ?"
            " ORDER BY id",
            (agent_id,),
        )
        return tuple(
            Todo(
                int(row["id"]),
                str(row["title"]),
                str(row["status"]),  # type: ignore[arg-type]
                str(row["detail"]),
            )
            for row in rows
        )

    def add_todo(self, agent_id: int, title: str, detail: str = "") -> Todo:
        row = self._db.execute(
            "SELECT COALESCE(MAX(id), 0) + 1 AS v FROM agent_todos WHERE agent_id = ?",
            (agent_id,),
        ).fetchone()
        todo_id = int(row["v"])
        with self._db:
            self._db.execute(
                "INSERT INTO agent_todos (agent_id, id, title, detail, status,"
                " created_at) VALUES (?, ?, ?, ?, 'pending', ?)",
                (agent_id, todo_id, title, detail, self._now()),
            )
        return Todo(todo_id, title, "pending", detail)

    def set_todo_status(self, agent_id: int, todo_id: int, status: TodoStatus) -> Todo:
        with self._db:
            cursor = self._db.execute(
                "UPDATE agent_todos SET status = ? WHERE agent_id = ? AND id = ?",
                (status, agent_id, todo_id),
            )
        if cursor.rowcount == 0:
            raise DomainError("not_found", f"Todo {todo_id} does not exist")
        row = self._db.execute(
            "SELECT id, title, status, detail FROM agent_todos WHERE agent_id = ?"
            " AND id = ?",
            (agent_id, todo_id),
        ).fetchone()
        return Todo(
            int(row["id"]),
            str(row["title"]),
            str(row["status"]),  # type: ignore[arg-type]
            str(row["detail"]),
        )

    def remove_todo(self, agent_id: int, todo_id: int) -> None:
        with self._db:
            cursor = self._db.execute(
                "DELETE FROM agent_todos WHERE agent_id = ? AND id = ?",
                (agent_id, todo_id),
            )
        if cursor.rowcount == 0:
            raise DomainError("not_found", f"Todo {todo_id} does not exist")

    def clear_todos(self, agent_id: int) -> None:
        with self._db:
            self._db.execute("DELETE FROM agent_todos WHERE agent_id = ?", (agent_id,))

    def _run(self, row: sqlite3.Row) -> AgentRun:
        return AgentRun(
            agent_id=int(row["agent_id"]),
            sequence=int(row["sequence"]),
            run_id=str(row["run_id"]),
            status=str(row["status"]),
            started_at=str(row["started_at"]),
            completed_at=row["completed_at"],
            messages_json=str(row["messages_json"]),
            usage_json=row["usage_json"],
            error=row["error"],
        )

    def start_run(self, agent_id: int, run_id: str | None = None) -> AgentRun:
        row = self._db.execute(
            "SELECT COALESCE(MAX(sequence), 0) + 1 AS v FROM agent_runs WHERE agent_id = ?",
            (agent_id,),
        ).fetchone()
        sequence = int(row["v"])
        identifier = run_id or uuid.uuid4().hex
        started = self._now()
        with self._db:
            self._db.execute(
                "INSERT INTO agent_runs (agent_id, sequence, run_id, status, started_at,"
                " messages_json) VALUES (?, ?, ?, 'running', ?, '[]')",
                (agent_id, sequence, identifier, started),
            )
        return AgentRun(
            agent_id, sequence, identifier, "running", started, None, "[]", None, None
        )

    def finish_run(
        self,
        agent_id: int,
        sequence: int,
        *,
        status: str,
        messages_json: str,
        usage_json: str | None = None,
        error: str | None = None,
    ) -> None:
        with self._db:
            self._db.execute(
                "UPDATE agent_runs SET status = ?, completed_at = ?, messages_json = ?,"
                " usage_json = ?, error = ? WHERE agent_id = ? AND sequence = ?",
                (
                    status,
                    self._now(),
                    messages_json,
                    usage_json,
                    error,
                    agent_id,
                    sequence,
                ),
            )

    def latest_messages(self, agent_id: int) -> str:
        row = self._db.execute(
            "SELECT messages_json FROM agent_runs WHERE agent_id = ?"
            " AND messages_json != '[]' ORDER BY sequence DESC LIMIT 1",
            (agent_id,),
        ).fetchone()
        return str(row["messages_json"]) if row else "[]"

    def runs(self, agent_id: int, *, limit: int = 50) -> tuple[AgentRun, ...]:
        rows = self._db.execute(
            "SELECT * FROM agent_runs WHERE agent_id = ? ORDER BY sequence DESC LIMIT ?",
            (agent_id, limit),
        )
        return tuple(self._run(row) for row in rows)

    def mark_interrupted(self) -> int:
        with self._db:
            cursor = self._db.execute(
                "UPDATE agent_runs SET status = 'interrupted', completed_at = ?"
                " WHERE status = 'running'",
                (self._now(),),
            )
        return cursor.rowcount

    def search_runs(
        self, agent_id: int, query: str, *, limit: int = 20
    ) -> tuple[AgentRun, ...]:
        escaped = query.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        rows = self._db.execute(
            "SELECT * FROM agent_runs WHERE agent_id = ? AND messages_json LIKE ?"
            " ESCAPE '\\' ORDER BY sequence DESC LIMIT ?",
            (agent_id, f"%{escaped}%", limit),
        )
        return tuple(self._run(row) for row in rows)

    def get_settings(self, section: str) -> dict[str, object] | None:
        row = self._db.execute(
            "SELECT values_json FROM settings WHERE section = ?", (section,)
        ).fetchone()
        if row is None:
            return None
        loaded = json.loads(str(row["values_json"]))
        return loaded if isinstance(loaded, dict) else None

    def set_settings(self, section: str, values: dict[str, object]) -> None:
        with self._db:
            self._db.execute(
                "INSERT INTO settings (section, values_json) VALUES (?, ?)"
                " ON CONFLICT (section) DO UPDATE SET values_json = excluded.values_json",
                (section, json.dumps(values, ensure_ascii=False, sort_keys=True)),
            )

    def write_directories(self) -> tuple[str, ...]:
        rows = self._db.execute("SELECT path FROM write_directories ORDER BY position")
        return tuple(str(row["path"]) for row in rows)

    def set_write_directories(self, values: Sequence[str]) -> None:
        with self._db:
            self._db.execute("DELETE FROM write_directories")
            self._db.executemany(
                "INSERT INTO write_directories (position, path) VALUES (?, ?)",
                list(enumerate(dict.fromkeys(values))),
            )
