import sqlite3
from pathlib import Path

from flowent.paths import data_directory
from flowent.state.schema import migrate


class SQLiteDatabase:
    def __init__(self, directory: Path | None = None) -> None:
        self.directory = directory or data_directory()
        self.path = self.directory / "flowent.db"

    def connect(self) -> sqlite3.Connection:
        self.directory.mkdir(mode=0o700, parents=True, exist_ok=True)
        connection = sqlite3.connect(self.path)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute("PRAGMA journal_mode = WAL")
        connection.execute("PRAGMA busy_timeout = 5000")
        migrate(connection)
        return connection
