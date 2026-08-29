from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest

from huddol.domain import DomainError
from huddol.library import LIBRARY_CONTENT_MAX_BYTES, Library
from huddol.persistence import SCHEMA_VERSION, SQLiteStore


def test_library_persists_shared_documents_and_rejects_stale_writes(
    tmp_path: Path,
) -> None:
    store = SQLiteStore(tmp_path / "data")
    library = Library(store)

    created = library.create("Operating notes", "# Notes\n\nShared context.")[
        "document"
    ]
    assert created["revision"] == 1
    assert library.list()["documents"] == [
        {key: value for key, value in created.items() if key != "content"}
    ]
    assert library.read(created["id"])["document"] == created

    updated = library.update(
        created["id"],
        created["revision"],
        "Operating notes",
        "# Notes\n\nUpdated context.",
    )["document"]
    assert updated["revision"] == 2
    assert Library(SQLiteStore(store.directory)).read(created["id"])["document"] == (
        updated
    )

    with pytest.raises(DomainError, match="changed; reload"):
        library.update(created["id"], 1, updated["title"], "stale")
    with pytest.raises(DomainError, match="changed; reload"):
        library.delete(created["id"], 1)

    assert library.delete(created["id"], 2) == {"deleted_document_id": created["id"]}
    with pytest.raises(DomainError, match="not found"):
        library.read(created["id"])


def test_library_validates_titles_content_and_normalized_duplicates(
    tmp_path: Path,
) -> None:
    library = Library(SQLiteStore(tmp_path / "data"))
    library.create("Ｆｉｅｌｄ notes", "")

    with pytest.raises(DomainError, match="already uses this title"):
        library.create("field notes", "duplicate")
    with pytest.raises(DomainError, match="cannot start or end"):
        library.create(" padded ", "")
    with pytest.raises(DomainError, match="control characters"):
        library.create("line\nbreak", "")
    with pytest.raises(DomainError, match="at most 1000000 bytes"):
        library.create("Large", "x" * (LIBRARY_CONTENT_MAX_BYTES + 1))


def test_schema_nineteen_migrates_to_library_without_changing_existing_data(
    tmp_path: Path,
) -> None:
    store = SQLiteStore(tmp_path / "data")
    with sqlite3.connect(store.path) as connection:
        connection.execute("DROP TABLE library_documents")
        connection.execute("PRAGMA user_version = 19")
        connection.execute("CREATE TABLE migration_fixture (value TEXT NOT NULL)")
        connection.execute("INSERT INTO migration_fixture VALUES ('preserved')")

    migrated = SQLiteStore(store.directory)
    with sqlite3.connect(migrated.path) as connection:
        assert connection.execute("PRAGMA user_version").fetchone()[0] == SCHEMA_VERSION
        assert connection.execute("SELECT value FROM migration_fixture").fetchone() == (
            "preserved",
        )
        assert connection.execute(
            "SELECT name FROM sqlite_master WHERE name = 'library_documents'"
        ).fetchone() == ("library_documents",)
