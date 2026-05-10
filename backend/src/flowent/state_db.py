from __future__ import annotations

import sqlite3
from pathlib import Path

STATE_DB_FILENAME = "state.sqlite"


def get_state_db_path() -> Path:
    from flowent import settings as settings_module

    return settings_module.get_app_data_dir_path() / STATE_DB_FILENAME


def get_images_dir() -> Path:
    from flowent import settings as settings_module

    return settings_module.get_app_data_dir_path() / "assets" / "images"


def get_legacy_workspace_file_path() -> Path:
    from flowent import settings as settings_module

    return settings_module.get_app_data_dir_path() / "workspace.json"


def get_legacy_image_assets_dir() -> Path:
    from flowent import settings as settings_module

    return settings_module.get_app_data_dir_path() / "image-assets"


def open_state_db(*, create: bool) -> sqlite3.Connection | None:
    db_path = get_state_db_path()
    if not create and not db_path.exists():
        return None
    if create:
        db_path.parent.mkdir(parents=True, exist_ok=True)
    try:
        connection = sqlite3.connect(db_path, timeout=30.0)
    except sqlite3.Error as exc:
        raise RuntimeError(f"Failed to open state store `{db_path}`: {exc}") from exc
    connection.row_factory = sqlite3.Row
    try:
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute("PRAGMA journal_mode = WAL")
        _ensure_schema(connection)
    except sqlite3.Error as exc:
        connection.close()
        raise RuntimeError(
            f"Failed to initialize state store `{db_path}`: {exc}"
        ) from exc
    return connection


def _ensure_schema(connection: sqlite3.Connection) -> None:
    connection.executescript(
        """
        DROP TABLE IF EXISTS mcp_snapshots;
        DROP TABLE IF EXISTS mcp_activities;
        CREATE TABLE IF NOT EXISTS tabs (
            id TEXT PRIMARY KEY,
            payload TEXT NOT NULL,
            updated_at REAL NOT NULL
        );
        CREATE TABLE IF NOT EXISTS nodes (
            id TEXT PRIMARY KEY,
            payload TEXT NOT NULL,
            tab_id TEXT,
            node_type TEXT NOT NULL,
            updated_at REAL NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_nodes_tab_id ON nodes(tab_id);
        CREATE TABLE IF NOT EXISTS edges (
            id TEXT PRIMARY KEY,
            payload TEXT NOT NULL,
            tab_id TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_edges_tab_id ON edges(tab_id);
        CREATE TABLE IF NOT EXISTS blueprints (
            id TEXT PRIMARY KEY,
            payload TEXT NOT NULL,
            updated_at REAL NOT NULL
        );
        CREATE TABLE IF NOT EXISTS image_assets (
            id TEXT PRIMARY KEY,
            stored_name TEXT NOT NULL,
            mime_type TEXT NOT NULL,
            width INTEGER,
            height INTEGER,
            original_name TEXT
        );
        CREATE TABLE IF NOT EXISTS llm_request_records (
            id TEXT PRIMARY KEY,
            ended_at REAL NOT NULL,
            payload TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_llm_request_records_ended_at
            ON llm_request_records(ended_at);
        CREATE TABLE IF NOT EXISTS compact_records (
            id TEXT PRIMARY KEY,
            ended_at REAL NOT NULL,
            payload TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_compact_records_ended_at
            ON compact_records(ended_at);
        """
    )
