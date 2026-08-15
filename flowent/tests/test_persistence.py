from __future__ import annotations

import sqlite3
import stat
from pathlib import Path

import pytest

from flowent.domain import OrganizationState
from flowent.model_runner import ModelRuntime
from flowent.persistence import DATA_DIRECTORY_ENV, SQLiteStore, data_directory


def persisted_state(store: SQLiteStore, working_directory: Path) -> OrganizationState:
    return OrganizationState(
        working_directory,
        persisted=store.load_organization(),
        on_persist=store.save_organization,
    )


def create_version_one_database(
    data: Path,
    *,
    conflicting_model: bool = False,
) -> Path:
    data.mkdir()
    path = data / "flowent.sqlite3"
    connection = sqlite3.connect(path)
    connection.executescript(
        """
        CREATE TABLE instances (
            working_directory TEXT PRIMARY KEY,
            organization_saved INTEGER NOT NULL
        );
        CREATE TABLE members (
            working_directory TEXT NOT NULL,
            id INTEGER NOT NULL,
            type TEXT NOT NULL,
            name TEXT NOT NULL
        );
        CREATE TABLE discussions (
            working_directory TEXT NOT NULL,
            id INTEGER NOT NULL,
            topic TEXT NOT NULL
        );
        CREATE TABLE discussion_members (
            working_directory TEXT NOT NULL,
            discussion_id INTEGER NOT NULL,
            position INTEGER NOT NULL,
            member_id INTEGER NOT NULL
        );
        CREATE TABLE messages (
            working_directory TEXT NOT NULL,
            discussion_id INTEGER NOT NULL,
            id INTEGER NOT NULL,
            sender_id INTEGER NOT NULL,
            body TEXT NOT NULL
        );
        CREATE TABLE mentions (
            working_directory TEXT NOT NULL,
            discussion_id INTEGER NOT NULL,
            message_id INTEGER NOT NULL,
            position INTEGER NOT NULL,
            member_id INTEGER NOT NULL,
            read INTEGER NOT NULL,
            acked INTEGER NOT NULL
        );
        CREATE TABLE model_settings (
            working_directory TEXT PRIMARY KEY,
            provider TEXT NOT NULL,
            base_url TEXT NOT NULL,
            api_key TEXT NOT NULL,
            model TEXT NOT NULL
        );
        PRAGMA user_version = 1;
        """
    )
    organization_key = "/legacy/organization"
    settings_key = "/legacy/settings"
    connection.executemany(
        "INSERT INTO instances (working_directory, organization_saved) VALUES (?, ?)",
        [(organization_key, 1), (settings_key, 0)],
    )
    connection.executemany(
        "INSERT INTO members (working_directory, id, type, name) VALUES (?, ?, ?, ?)",
        [
            (organization_key, 1, "human", "You"),
            (organization_key, 2, "agent", "Ada"),
        ],
    )
    connection.execute(
        "INSERT INTO discussions (working_directory, id, topic) VALUES (?, ?, ?)",
        (organization_key, 1, "Migrated work"),
    )
    connection.executemany(
        """
        INSERT INTO discussion_members
            (working_directory, discussion_id, position, member_id)
        VALUES (?, ?, ?, ?)
        """,
        [
            (organization_key, 1, 0, 1),
            (organization_key, 1, 1, 2),
        ],
    )
    connection.execute(
        """
        INSERT INTO messages
            (working_directory, discussion_id, id, sender_id, body)
        VALUES (?, ?, ?, ?, ?)
        """,
        (organization_key, 1, 1, 1, "Continue globally"),
    )
    connection.execute(
        """
        INSERT INTO mentions
            (working_directory, discussion_id, message_id, position, member_id, read, acked)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
        (organization_key, 1, 1, 0, 2, 1, 0),
    )
    connection.execute(
        """
        INSERT INTO model_settings
            (working_directory, provider, base_url, api_key, model)
        VALUES (?, ?, ?, ?, ?)
        """,
        (
            settings_key,
            "anthropic",
            "https://example.invalid",
            "legacy-secret",
            "legacy-model",
        ),
    )
    if conflicting_model:
        connection.execute(
            "INSERT INTO instances (working_directory, organization_saved) VALUES (?, 0)",
            ("/legacy/conflict",),
        )
        connection.execute(
            """
            INSERT INTO model_settings
                (working_directory, provider, base_url, api_key, model)
            VALUES (?, ?, ?, ?, ?)
            """,
            (
                "/legacy/conflict",
                "openai",
                "https://other.invalid",
                "other-secret",
                "other-model",
            ),
        )
    connection.commit()
    connection.close()
    return path


def downgrade_model_settings_schema(connection: sqlite3.Connection) -> None:
    connection.execute("ALTER TABLE model_settings RENAME TO current_model_settings")
    connection.execute(
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
        """
    )
    connection.execute(
        """
        INSERT INTO model_settings (id, provider, base_url, api_key, model)
        SELECT id,
            CASE api_type WHEN 'openai-chat' THEN 'openai' ELSE api_type END,
            base_url, api_key, model
        FROM current_model_settings
        """
    )
    connection.execute("DROP TABLE current_model_settings")


def test_uses_flowent_directory_under_home(monkeypatch, tmp_path: Path) -> None:
    home = tmp_path / "home"
    monkeypatch.setenv("HOME", str(home))
    monkeypatch.delenv(DATA_DIRECTORY_ENV, raising=False)

    assert data_directory() == home / ".flowent"


def test_restores_discussions_mentions_and_next_ids(tmp_path: Path) -> None:
    working_directory = tmp_path / "project"
    working_directory.mkdir()
    store = SQLiteStore(tmp_path / "data")
    state = persisted_state(store, working_directory)
    state.create_agent("Ada")
    state.create_discussion("Persistent work", 1, [2])
    state.send_message(1, 1, "Continue after restart", [2])
    state.read_discussion(2, 1, end_message_id=1)

    restored = persisted_state(store, working_directory)

    assert restored.snapshot()["members"] == [
        {"id": 1, "type": "human", "name": "You"},
        {"id": 2, "type": "agent", "name": "Ada", "status": "idle"},
    ]
    assert restored.snapshot()["discussions"][0]["messages"] == [
        {
            "id": 1,
            "sender_id": 1,
            "body": "Continue after restart",
            "mentions": [{"member_id": 2, "status": "read"}],
        }
    ]
    activation, _ = restored.claim_next_activation()
    assert activation is not None
    assert activation.agent_id == 2
    assert activation.message_id == 1
    restored.complete_activation(2, "Stopped for test")
    assert restored.create_agent("Lin")["members"][-1]["id"] == 3
    assert restored.create_discussion("Next", 1, [3])["discussions"][-1]["id"] == 2


def test_shares_state_across_launch_directories(tmp_path: Path) -> None:
    first_directory = tmp_path / "first"
    second_directory = tmp_path / "second"
    first_directory.mkdir()
    second_directory.mkdir()
    store = SQLiteStore(tmp_path / "data")

    persisted_state(store, first_directory).create_agent("Ada")
    second = persisted_state(store, second_directory)

    assert second.snapshot()["working_directory"] == str(second_directory)
    assert second.snapshot()["members"] == [
        {"id": 1, "type": "human", "name": "You"},
        {"id": 2, "type": "agent", "name": "Ada", "status": "idle"},
    ]
    assert store.load_organization() is not None


def test_persists_model_config_without_exposing_its_secret(tmp_path: Path) -> None:
    store = SQLiteStore(tmp_path / "data")
    runtime = ModelRuntime(on_configure=store.save_model_config)

    settings = runtime.configure(
        api_type="anthropic",
        base_url="https://example.invalid",
        api_key="local-secret",
        model="test-model",
    )

    assert settings == {
        "api_type": "anthropic",
        "base_url": "https://example.invalid",
        "model": "test-model",
        "has_api_key": True,
    }
    assert "local-secret" not in str(settings)
    assert store.load_model_config() == {
        "api_type": "anthropic",
        "base_url": "https://example.invalid",
        "api_key": "local-secret",
        "model": "test-model",
    }
    assert store.load_organization() is None


def test_persists_observability_config_without_exposing_its_secret(
    tmp_path: Path,
) -> None:
    store = SQLiteStore(tmp_path / "data")
    secret = "langfuse-secret"

    store.save_observability_config(
        {
            "enabled": True,
            "base_url": "https://langfuse.invalid",
            "public_key": "langfuse-public",
            "secret_key": secret,
            "environment": "development",
            "capture_content": True,
        }
    )

    config = store.load_observability_config()
    assert config == {
        "enabled": True,
        "base_url": "https://langfuse.invalid",
        "public_key": "langfuse-public",
        "secret_key": secret,
        "environment": "development",
        "capture_content": True,
    }


def test_migrates_version_two_without_losing_existing_state(tmp_path: Path) -> None:
    data = tmp_path / "data"
    store = SQLiteStore(data)
    state = persisted_state(store, tmp_path)
    state.create_agent("Ada")
    store.save_model_config(
        {
            "api_type": "anthropic",
            "base_url": "https://example.invalid",
            "api_key": "legacy-secret",
            "model": "legacy-model",
        }
    )
    connection = sqlite3.connect(store.path)
    connection.execute("DROP TABLE observability_settings")
    downgrade_model_settings_schema(connection)
    connection.execute("PRAGMA user_version = 2")
    connection.commit()
    connection.close()

    migrated = SQLiteStore(data)

    assert migrated.load_organization()["members"][1]["name"] == "Ada"
    assert migrated.load_model_config() == {
        "api_type": "anthropic",
        "base_url": "https://example.invalid",
        "api_key": "legacy-secret",
        "model": "legacy-model",
    }
    assert migrated.load_observability_config() is None
    connection = sqlite3.connect(migrated.path)
    assert connection.execute("PRAGMA user_version").fetchone()[0] == 5
    assert connection.execute(
        "SELECT name FROM sqlite_master WHERE name = 'observability_settings'"
    ).fetchone() == ("observability_settings",)
    connection.close()


def test_migrates_version_three_openai_to_chat_without_losing_secrets(
    tmp_path: Path,
) -> None:
    data = tmp_path / "data"
    store = SQLiteStore(data)
    store.save_model_config(
        {
            "api_type": "openai-chat",
            "base_url": "https://example.invalid/v1",
            "api_key": "legacy-openai-secret",
            "model": "legacy-model",
        }
    )
    store.save_observability_config(
        {
            "enabled": True,
            "base_url": "https://langfuse.invalid",
            "public_key": "legacy-public",
            "secret_key": "legacy-tracing-secret",
            "environment": "migration",
            "capture_content": False,
        }
    )
    connection = sqlite3.connect(store.path)
    downgrade_model_settings_schema(connection)
    connection.execute("PRAGMA user_version = 3")
    connection.commit()
    connection.close()

    migrated = SQLiteStore(data)

    assert migrated.load_model_config() == {
        "api_type": "openai-chat",
        "base_url": "https://example.invalid/v1",
        "api_key": "legacy-openai-secret",
        "model": "legacy-model",
    }
    assert migrated.load_observability_config()["secret_key"] == (
        "legacy-tracing-secret"
    )
    connection = sqlite3.connect(migrated.path)
    assert connection.execute("PRAGMA user_version").fetchone()[0] == 5
    columns = {
        row[1] for row in connection.execute("PRAGMA table_info(model_settings)")
    }
    assert "api_type" in columns
    assert "provider" not in columns
    connection.close()


def test_migrates_single_version_one_state_to_global_schema(tmp_path: Path) -> None:
    data = tmp_path / "data"
    path = create_version_one_database(data)

    store = SQLiteStore(data)
    restored = persisted_state(store, tmp_path / "new-launch-root")

    assert restored.snapshot()["members"][1]["name"] == "Ada"
    assert restored.snapshot()["discussions"][0]["messages"] == [
        {
            "id": 1,
            "sender_id": 1,
            "body": "Continue globally",
            "mentions": [{"member_id": 2, "status": "read"}],
        }
    ]
    assert store.load_model_config() == {
        "api_type": "anthropic",
        "base_url": "https://example.invalid",
        "api_key": "legacy-secret",
        "model": "legacy-model",
    }
    connection = sqlite3.connect(path)
    assert connection.execute("PRAGMA user_version").fetchone()[0] == 5
    for table in ("members", "discussions", "model_settings"):
        columns = {row[1] for row in connection.execute(f"PRAGMA table_info({table})")}
        assert "working_directory" not in columns
    connection.close()


def test_rejects_conflicting_version_one_model_partitions(tmp_path: Path) -> None:
    data = tmp_path / "data"
    path = create_version_one_database(data, conflicting_model=True)

    with pytest.raises(RuntimeError, match="conflicting model settings"):
        SQLiteStore(data)

    connection = sqlite3.connect(path)
    assert connection.execute("PRAGMA user_version").fetchone()[0] == 1
    assert connection.execute("SELECT COUNT(*) FROM model_settings").fetchone()[0] == 2
    connection.close()


def test_migrates_version_four_with_an_empty_agent_history_table(
    tmp_path: Path,
) -> None:
    data = tmp_path / "data"
    store = SQLiteStore(data)
    connection = sqlite3.connect(store.path)
    connection.execute("DROP TABLE agent_runs")
    connection.execute("PRAGMA user_version = 4")
    connection.commit()
    connection.close()

    migrated = SQLiteStore(data)

    connection = sqlite3.connect(migrated.path)
    assert connection.execute("PRAGMA user_version").fetchone()[0] == 5
    assert connection.execute(
        "SELECT name FROM sqlite_master WHERE name = 'agent_runs'"
    ).fetchone() == ("agent_runs",)
    connection.close()


def test_organization_persistence_does_not_rewrite_agent_history(
    tmp_path: Path,
) -> None:
    store = SQLiteStore(tmp_path / "data")
    state = persisted_state(store, tmp_path)
    state.create_agent("Ada")
    store.begin_agent_run(2, "persistent-run", "2026-08-15T00:00:00+00:00", [])
    store.complete_agent_run(
        2,
        "persistent-run",
        "completed",
        "2026-08-15T00:01:00+00:00",
        "[]",
        None,
        None,
    )

    state.create_discussion("Later mutation", 1, [2])

    assert store.load_agent_runs(2)[0]["run_id"] == "persistent-run"


def test_restricts_data_directory_and_database_permissions(tmp_path: Path) -> None:
    data = tmp_path / "data"
    store = SQLiteStore(data)

    assert stat.S_IMODE(data.stat().st_mode) == 0o700
    assert stat.S_IMODE(store.path.stat().st_mode) == 0o600
