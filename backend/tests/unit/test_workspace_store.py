import json
import sqlite3

from flowent.settings import Settings
from flowent.state_db import open_state_db
from flowent.workspace_store import workspace_store


def test_workspace_store_normalizes_relative_write_dirs_on_load(
    monkeypatch,
    tmp_path,
):
    import flowent.settings as settings_module

    settings_file = tmp_path / "settings.json"
    workspace_file = tmp_path / "workspace.json"
    working_dir = tmp_path / "workspace-root"
    working_dir.mkdir()
    workspace_file.write_text(
        json.dumps(
            {
                "tabs": [],
                "nodes": [
                    {
                        "id": "node-1",
                        "config": {
                            "node_type": "agent",
                            "role_name": "Worker",
                            "tab_id": "tab-1",
                            "name": "Worker",
                            "tools": ["read"],
                            "write_dirs": ["./out"],
                            "allow_network": False,
                        },
                        "state": "idle",
                        "todos": [],
                        "history": [],
                    }
                ],
                "edges": [],
            }
        ),
        encoding="utf-8",
    )

    monkeypatch.setattr(settings_module, "_SETTINGS_FILE", settings_file)
    monkeypatch.setattr(
        settings_module,
        "get_settings",
        lambda: Settings(working_dir=str(working_dir)),
    )
    workspace_store.reset_cache()

    record = workspace_store.get_node_record("node-1")

    assert record is not None
    assert record.config.write_dirs == [str((working_dir / "out").resolve())]
    connection = open_state_db(create=False)
    assert connection is not None
    try:
        row = connection.execute(
            "SELECT payload FROM nodes WHERE id = ?",
            ("node-1",),
        ).fetchone()
    finally:
        connection.close()
    assert row is not None
    persisted = json.loads(row["payload"])
    assert persisted["config"]["write_dirs"] == [str((working_dir / "out").resolve())]
    workspace_store.reset_cache()


def test_workspace_store_prefers_legacy_workspace_data_when_state_db_is_still_empty(
    monkeypatch,
    tmp_path,
):
    import flowent.settings as settings_module

    settings_file = tmp_path / "settings.json"
    workspace_file = tmp_path / "workspace.json"
    state_db_file = tmp_path / "state.sqlite"
    settings_file.write_text("{}", encoding="utf-8")
    workspace_file.write_text(
        json.dumps(
            {
                "tabs": [],
                "nodes": [
                    {
                        "id": "node-legacy",
                        "config": {
                            "node_type": "agent",
                            "role_name": "Worker",
                            "tab_id": "tab-1",
                            "name": "Worker",
                            "tools": ["read"],
                            "write_dirs": [],
                            "allow_network": False,
                        },
                        "state": "idle",
                        "todos": [],
                        "history": [],
                    }
                ],
                "edges": [],
            }
        ),
        encoding="utf-8",
    )
    sqlite3.connect(state_db_file).close()

    monkeypatch.setattr(settings_module, "_SETTINGS_FILE", settings_file)
    monkeypatch.setattr(settings_module, "_cached_settings", None)
    monkeypatch.setattr(
        settings_module,
        "get_settings",
        lambda: Settings(working_dir=str(tmp_path)),
    )
    workspace_store.reset_cache()

    record = workspace_store.get_node_record("node-legacy")

    assert record is not None
    assert record.id == "node-legacy"
    workspace_store.reset_cache()


def test_workspace_store_does_not_overwrite_state_db_with_legacy_workspace_data(
    monkeypatch,
    tmp_path,
):
    import flowent.settings as settings_module

    settings_file = tmp_path / "settings.json"
    workspace_file = tmp_path / "workspace.json"
    settings_file.write_text("{}", encoding="utf-8")
    workspace_file.write_text(
        json.dumps(
            {
                "tabs": [],
                "nodes": [
                    {
                        "id": "node-legacy",
                        "config": {
                            "node_type": "agent",
                            "role_name": "Worker",
                            "tab_id": "tab-1",
                            "name": "Legacy",
                            "tools": ["read"],
                            "write_dirs": [],
                            "allow_network": False,
                        },
                        "state": "idle",
                        "todos": [],
                        "history": [],
                    }
                ],
                "edges": [],
            }
        ),
        encoding="utf-8",
    )

    monkeypatch.setattr(settings_module, "_SETTINGS_FILE", settings_file)
    monkeypatch.setattr(settings_module, "_cached_settings", None)
    monkeypatch.setattr(
        settings_module,
        "get_settings",
        lambda: Settings(working_dir=str(tmp_path)),
    )
    connection = open_state_db(create=True)
    assert connection is not None
    try:
        with connection:
            connection.execute(
                """
                INSERT INTO nodes (id, payload, tab_id, node_type, updated_at)
                VALUES (?, ?, ?, ?, ?)
                """,
                (
                    "node-sqlite",
                    json.dumps(
                        {
                            "id": "node-sqlite",
                            "config": {
                                "node_type": "agent",
                                "role_name": "Worker",
                                "tab_id": "tab-1",
                                "name": "SQLite",
                                "tools": ["read"],
                                "write_dirs": [],
                                "allow_network": False,
                            },
                            "state": "idle",
                            "todos": [],
                            "history": [],
                        }
                    ),
                    "tab-1",
                    "agent",
                    1.0,
                ),
            )
    finally:
        connection.close()

    workspace_store.reset_cache()

    sqlite_record = workspace_store.get_node_record("node-sqlite")
    legacy_record = workspace_store.get_node_record("node-legacy")

    assert sqlite_record is not None
    assert legacy_record is None
    connection = open_state_db(create=False)
    assert connection is not None
    try:
        sqlite_row = connection.execute(
            "SELECT id FROM nodes WHERE id = ?",
            ("node-sqlite",),
        ).fetchone()
        legacy_row = connection.execute(
            "SELECT id FROM nodes WHERE id = ?",
            ("node-legacy",),
        ).fetchone()
    finally:
        connection.close()
    assert sqlite_row is not None
    assert legacy_row is None
    workspace_store.reset_cache()
