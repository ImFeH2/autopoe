import base64
import sqlite3

import flowent.settings as settings_module
from flowent.image_assets import create_image_asset

_ONE_PIXEL_PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aF9sAAAAASUVORK5CYII="
)


def test_create_image_asset_persists_metadata_in_state_sqlite(monkeypatch, tmp_path):
    settings_file = tmp_path / "settings.json"
    settings_file.write_text("{}", encoding="utf-8")
    monkeypatch.setattr(settings_module, "_SETTINGS_FILE", settings_file)
    monkeypatch.setattr(settings_module, "_cached_settings", None)

    asset = create_image_asset(
        _ONE_PIXEL_PNG,
        mime_type="image/png",
        original_name="pixel.png",
    )

    assert asset.file_path == tmp_path / "assets" / "images" / asset.stored_name
    assert asset.file_path.is_file()
    connection = sqlite3.connect(tmp_path / "state.sqlite")
    connection.row_factory = sqlite3.Row
    try:
        row = connection.execute(
            """
            SELECT stored_name, mime_type, width, height, original_name
            FROM image_assets
            WHERE id = ?
            """,
            (asset.id,),
        ).fetchone()
    finally:
        connection.close()
    assert row is not None
    assert row["stored_name"] == asset.stored_name
    assert row["mime_type"] == "image/png"
    assert row["width"] == 1
    assert row["height"] == 1
    assert row["original_name"] == "pixel.png"


def test_state_schema_removes_retired_connection_tables(monkeypatch, tmp_path):
    settings_file = tmp_path / "settings.json"
    settings_file.write_text("{}", encoding="utf-8")
    monkeypatch.setattr(settings_module, "_SETTINGS_FILE", settings_file)
    monkeypatch.setattr(settings_module, "_cached_settings", None)

    db_path = tmp_path / "state.sqlite"
    connection = sqlite3.connect(db_path)
    try:
        connection.executescript(
            """
            CREATE TABLE mcp_snapshots (id TEXT PRIMARY KEY);
            CREATE TABLE mcp_activities (id TEXT PRIMARY KEY);
            """
        )
    finally:
        connection.close()

    create_image_asset(
        _ONE_PIXEL_PNG,
        mime_type="image/png",
        original_name="pixel.png",
    )

    connection = sqlite3.connect(db_path)
    try:
        existing_tables = {
            row[0]
            for row in connection.execute(
                """
                SELECT name
                FROM sqlite_master
                WHERE type = 'table'
                """
            ).fetchall()
        }
    finally:
        connection.close()

    assert "mcp_snapshots" not in existing_tables
    assert "mcp_activities" not in existing_tables
