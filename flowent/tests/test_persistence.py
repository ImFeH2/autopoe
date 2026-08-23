from __future__ import annotations

import sqlite3
import stat
from pathlib import Path

import pytest

from flowent.domain import OrganizationState
from flowent.model_runner import ModelRuntime
from flowent.persistence import (
    DATA_DIRECTORY_ENV,
    SCHEMA_VERSION,
    SQLiteStore,
    data_directory,
)


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


def test_restores_renamed_human_identity_and_historical_notification_facts(
    tmp_path: Path,
) -> None:
    working_directory = tmp_path / "project"
    working_directory.mkdir()
    store = SQLiteStore(tmp_path / "data")
    state = persisted_state(store, working_directory)
    state.create_agent("Ada")
    state.create_discussion("Human rename", 1, [2])
    state.send_message(1, 1, "@Ada review")
    state.rename_member(1, "Owner")

    restored = persisted_state(store, working_directory).snapshot()

    assert restored["members"][0] == {
        "id": 1,
        "type": "human",
        "name": "Owner",
    }
    message = restored["discussions"][0]["messages"][0]
    assert message["sender_id"] == 1
    assert message["body"] == "@Ada review"
    assert message["references"] == [
        {
            "member_id": 2,
            "name": "Ada",
            "start": 0,
            "end": 4,
            "in_discussion": True,
            "notified": True,
            "deleted": False,
        }
    ]
    assert message["mentions"] == [{"member_id": 2, "status": "pending"}]


def test_restores_renamed_agent_without_rewriting_reference_snapshot(
    tmp_path: Path,
) -> None:
    working_directory = tmp_path / "project"
    working_directory.mkdir()
    store = SQLiteStore(tmp_path / "data")
    state = persisted_state(store, working_directory)
    state.create_agent("Ada")
    state.create_discussion("Persistent rename", 1, [2])
    state.send_message(1, 1, "@Ada review")
    state.rename_member(2, "Grace")

    restored = persisted_state(store, working_directory).snapshot()

    assert restored["members"][1]["name"] == "Grace"
    message = restored["discussions"][0]["messages"][0]
    assert message["body"] == "@Ada review"
    assert message["references"][0]["member_id"] == 2
    assert message["references"][0]["name"] == "Ada"


def test_restores_discussions_mentions_and_next_ids(tmp_path: Path) -> None:
    working_directory = tmp_path / "project"
    working_directory.mkdir()
    store = SQLiteStore(tmp_path / "data")
    state = persisted_state(store, working_directory)
    state.create_agent("Ada")
    state.create_discussion("Persistent work", 1, [2])
    state.send_message(1, 1, "@Ada Continue after restart")
    created_at = state.snapshot()["discussions"][0]["messages"][0]["created_at"]
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
            "body": "@Ada Continue after restart",
            "created_at": created_at,
            "references": [
                {
                    "member_id": 2,
                    "name": "Ada",
                    "start": 0,
                    "end": 4,
                    "in_discussion": True,
                    "notified": True,
                    "deleted": False,
                }
            ],
            "mentions": [{"member_id": 2, "status": "read"}],
        }
    ]
    activation, _ = restored.claim_next_reminder()
    assert activation is not None
    assert activation.agent_id == 2
    assert activation.mentions[0].message_id == 1
    restored.complete_turn(2, "Stopped for test")
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


def test_paused_agent_stays_paused_across_restart(tmp_path: Path) -> None:
    store = SQLiteStore(tmp_path / "data")
    state = persisted_state(store, tmp_path)
    state.create_agent("Ada")
    state.create_discussion("Work", 1, [2])
    state.send_message(1, 1, "@Ada Wait for resume")
    state.pause_agent(2)

    restored = persisted_state(store, tmp_path)

    assert restored.snapshot()["members"][1]["status"] == "paused"
    assert restored.claim_next_reminder()[0] is None
    assert restored.resume_agent(2)["members"][1]["status"] == "idle"
    assert restored.claim_next_reminder()[0] is not None


def test_deleted_agent_stays_hidden_while_discussion_messages_survive_restart(
    tmp_path: Path,
) -> None:
    store = SQLiteStore(tmp_path / "data")
    state = persisted_state(store, tmp_path)
    state.create_agent("Ada")
    state.create_discussion("Work", 1, [2])
    state.send_message(1, 2, "Keep this")
    created_at = state.snapshot()["discussions"][0]["messages"][0]["created_at"]

    state.delete_agent(2)
    restored = persisted_state(store, tmp_path)

    assert restored.snapshot()["members"] == [{"id": 1, "type": "human", "name": "You"}]
    assert restored.snapshot()["discussions"] == [
        {
            "id": 1,
            "topic": "Work",
            "member_ids": [1],
            "human_read_states": [
                {
                    "member_id": 1,
                    "read_through_message_id": None,
                    "seen_message_ids": [],
                }
            ],
            "messages": [
                {
                    "id": 1,
                    "sender_id": 2,
                    "sender_name": "Ada",
                    "body": "Keep this",
                    "created_at": created_at,
                    "references": [],
                    "mentions": [],
                }
            ],
        }
    ]
    assert restored.create_agent("Lin")["members"][-1]["id"] == 3


def test_persists_model_config_without_exposing_its_secret(tmp_path: Path) -> None:
    store = SQLiteStore(tmp_path / "data")
    runtime = ModelRuntime(on_configure=store.save_model_config)

    settings = runtime.configure(
        api_type="anthropic",
        base_url="https://example.invalid",
        api_key="local-secret",
        model="test-model",
        context_window=200_000,
    )

    assert settings == {
        "api_type": "anthropic",
        "base_url": "https://example.invalid",
        "model": "test-model",
        "context_window": 200_000,
        "has_api_key": True,
    }
    assert "local-secret" not in str(settings)
    assert store.load_model_config() == {
        "api_type": "anthropic",
        "base_url": "https://example.invalid",
        "api_key": "local-secret",
        "model": "test-model",
        "context_window": 200_000,
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
        "context_window": None,
    }
    assert migrated.load_observability_config() is None
    connection = sqlite3.connect(migrated.path)
    assert connection.execute("PRAGMA user_version").fetchone()[0] == SCHEMA_VERSION
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
        "context_window": None,
    }
    assert migrated.load_observability_config()["secret_key"] == (
        "legacy-tracing-secret"
    )
    connection = sqlite3.connect(migrated.path)
    assert connection.execute("PRAGMA user_version").fetchone()[0] == SCHEMA_VERSION
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
            "created_at": None,
            "references": [
                {
                    "member_id": 2,
                    "name": "Ada",
                    "start": None,
                    "end": None,
                    "in_discussion": True,
                    "notified": True,
                    "deleted": False,
                }
            ],
            "mentions": [{"member_id": 2, "status": "read"}],
        }
    ]
    assert store.load_model_config() == {
        "api_type": "anthropic",
        "base_url": "https://example.invalid",
        "api_key": "legacy-secret",
        "model": "legacy-model",
        "context_window": None,
    }
    connection = sqlite3.connect(path)
    assert connection.execute("PRAGMA user_version").fetchone()[0] == SCHEMA_VERSION
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
    assert connection.execute("PRAGMA user_version").fetchone()[0] == SCHEMA_VERSION
    assert connection.execute(
        "SELECT name FROM sqlite_master WHERE name = 'agent_runs'"
    ).fetchone() == ("agent_runs",)
    connection.close()


def test_migrates_version_six_with_hidden_member_support(tmp_path: Path) -> None:
    data = tmp_path / "data"
    store = SQLiteStore(data)
    connection = sqlite3.connect(store.path)
    connection.execute("ALTER TABLE members DROP COLUMN deleted")
    connection.execute("PRAGMA user_version = 6")
    connection.commit()
    connection.close()

    migrated = SQLiteStore(data)

    connection = sqlite3.connect(migrated.path)
    assert connection.execute("PRAGMA user_version").fetchone()[0] == SCHEMA_VERSION
    columns = {row[1] for row in connection.execute("PRAGMA table_info(members)")}
    assert "deleted" in columns
    connection.close()


def test_migrates_version_eight_with_paused_agent_support(tmp_path: Path) -> None:
    data = tmp_path / "data"
    store = SQLiteStore(data)
    connection = sqlite3.connect(store.path)
    connection.execute("ALTER TABLE members DROP COLUMN paused")
    connection.execute("PRAGMA user_version = 8")
    connection.commit()
    connection.close()

    migrated = SQLiteStore(data)

    connection = sqlite3.connect(migrated.path)
    assert connection.execute("PRAGMA user_version").fetchone()[0] == SCHEMA_VERSION
    columns = {row[1] for row in connection.execute("PRAGMA table_info(members)")}
    assert "paused" in columns
    connection.close()


def test_migrates_version_nine_with_model_context_window_support(
    tmp_path: Path,
) -> None:
    data = tmp_path / "data"
    store = SQLiteStore(data)
    store.save_model_config(
        {
            "api_type": "openai-responses",
            "base_url": "https://example.invalid/v1",
            "api_key": "legacy-secret",
            "model": "legacy-model",
        }
    )
    connection = sqlite3.connect(store.path)
    connection.execute("ALTER TABLE model_settings DROP COLUMN context_window")
    connection.execute("PRAGMA user_version = 9")
    connection.commit()
    connection.close()

    migrated = SQLiteStore(data)

    assert migrated.load_model_config() == {
        "api_type": "openai-responses",
        "base_url": "https://example.invalid/v1",
        "api_key": "legacy-secret",
        "model": "legacy-model",
        "context_window": None,
    }
    connection = sqlite3.connect(migrated.path)
    assert connection.execute("PRAGMA user_version").fetchone()[0] == SCHEMA_VERSION
    columns = {
        row[1] for row in connection.execute("PRAGMA table_info(model_settings)")
    }
    assert "context_window" in columns
    connection.close()


def test_migrates_version_seven_with_agent_todo_support(tmp_path: Path) -> None:
    data = tmp_path / "data"
    store = SQLiteStore(data)
    connection = sqlite3.connect(store.path)
    connection.execute("DROP TABLE agent_todos")
    connection.execute("DROP TABLE agent_todo_sequences")
    connection.execute("PRAGMA user_version = 7")
    connection.commit()
    connection.close()

    migrated = SQLiteStore(data)

    connection = sqlite3.connect(migrated.path)
    assert connection.execute("PRAGMA user_version").fetchone()[0] == SCHEMA_VERSION
    assert connection.execute(
        "SELECT name FROM sqlite_master WHERE name = 'agent_todos'"
    ).fetchone() == ("agent_todos",)
    assert connection.execute(
        "SELECT name FROM sqlite_master WHERE name = 'agent_todo_sequences'"
    ).fetchone() == ("agent_todo_sequences",)
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


def test_reference_send_time_facts_survive_delete_and_restart(tmp_path: Path) -> None:
    store = SQLiteStore(tmp_path / "data")
    state = persisted_state(store, tmp_path)
    state.create_agent("Ada")
    state.create_agent("Lin")
    state.create_discussion("Work", 1, [2, 3])
    state.send_message(1, 1, "@Ada @Lin")
    state.read_discussion(2, 1)
    state.delete_agent(2)

    restored = persisted_state(store, tmp_path)
    message = restored.snapshot()["discussions"][0]["messages"][0]

    assert message["references"] == [
        {
            "member_id": 2,
            "name": "Ada",
            "start": 0,
            "end": 4,
            "in_discussion": True,
            "notified": True,
            "deleted": True,
        },
        {
            "member_id": 3,
            "name": "Lin",
            "start": 5,
            "end": 9,
            "in_discussion": True,
            "notified": True,
            "deleted": False,
        },
    ]
    assert message["mentions"] == [
        {"member_id": 2, "status": "read"},
        {"member_id": 3, "status": "pending"},
    ]


def test_fresh_schema_creates_final_reference_table_before_version(
    tmp_path: Path,
) -> None:
    store = SQLiteStore(tmp_path / "data")
    connection = sqlite3.connect(store.path)
    try:
        assert connection.execute("PRAGMA user_version").fetchone()[0] == SCHEMA_VERSION
        assert connection.execute(
            "SELECT name FROM sqlite_master WHERE name = 'mention_references'"
        ).fetchone() == ("mention_references",)
        assert connection.execute(
            "SELECT name FROM sqlite_master WHERE name = 'human_discussion_read_states'"
        ).fetchone() == ("human_discussion_read_states",)
        assert connection.execute(
            "SELECT name FROM sqlite_master WHERE name = 'human_discussion_seen_messages'"
        ).fetchone() == ("human_discussion_seen_messages",)
        assert connection.execute(
            "SELECT name FROM sqlite_master WHERE name = 'human_mention_notifications'"
        ).fetchone() == ("human_mention_notifications",)
    finally:
        connection.close()


def test_migrates_version_thirteen_without_fabricating_legacy_timestamps(
    tmp_path: Path,
) -> None:
    data = tmp_path / "data"
    store = SQLiteStore(data)
    state = persisted_state(store, tmp_path)
    state.create_agent("Ada")
    state.create_discussion("Work", 1, [2])
    state.send_message(1, 1, "Legacy")

    connection = sqlite3.connect(store.path)
    connection.execute("ALTER TABLE messages DROP COLUMN created_at")
    connection.execute("PRAGMA user_version = 13")
    connection.commit()
    connection.close()

    migrated = SQLiteStore(data)
    with sqlite3.connect(migrated.path) as connection:
        assert connection.execute("PRAGMA user_version").fetchone()[0] == SCHEMA_VERSION
        assert "created_at" in {
            row[1] for row in connection.execute("PRAGMA table_info(messages)")
        }
    restored = persisted_state(migrated, tmp_path)
    legacy = restored.snapshot()["discussions"][0]["messages"][0]
    assert legacy["created_at"] is None

    snapshot = restored.send_message(1, 2, "New")
    messages = snapshot["discussions"][0]["messages"]
    assert [message["id"] for message in messages] == [1, 2]
    assert messages[1]["created_at"].endswith("Z")

    reloaded = persisted_state(SQLiteStore(data), tmp_path).snapshot()
    assert reloaded["discussions"][0]["messages"] == messages


def test_version_thirteen_timestamp_migration_rolls_back_and_reopens(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    data = tmp_path / "data"
    store = SQLiteStore(data)
    state = persisted_state(store, tmp_path)
    state.create_agent("Ada")
    state.create_discussion("Work", 1, [2])
    state.send_message(1, 1, "Legacy")

    with sqlite3.connect(store.path) as connection:
        connection.execute("ALTER TABLE messages DROP COLUMN created_at")
        connection.execute("PRAGMA user_version = 13")

    def fail_after_adding_column(connection: sqlite3.Connection) -> None:
        connection.execute("ALTER TABLE messages ADD COLUMN created_at TEXT")
        raise sqlite3.OperationalError("injected timestamp migration failure")

    monkeypatch.setattr(
        SQLiteStore,
        "_add_message_created_at_column",
        staticmethod(fail_after_adding_column),
    )
    with pytest.raises(sqlite3.OperationalError, match="injected timestamp"):
        SQLiteStore(data)

    with sqlite3.connect(store.path) as connection:
        assert connection.execute("PRAGMA user_version").fetchone()[0] == 13
        assert "created_at" not in {
            row[1] for row in connection.execute("PRAGMA table_info(messages)")
        }

    monkeypatch.undo()
    reopened = SQLiteStore(data)
    restored = persisted_state(reopened, tmp_path).snapshot()
    assert restored["discussions"][0]["messages"][0]["created_at"] is None
    with sqlite3.connect(reopened.path) as connection:
        assert connection.execute("PRAGMA user_version").fetchone()[0] == SCHEMA_VERSION
        assert "created_at" in {
            row[1] for row in connection.execute("PRAGMA table_info(messages)")
        }


def test_migrates_version_ten_and_backfills_all_reference_occurrences(
    tmp_path: Path,
) -> None:
    data = tmp_path / "data"
    store = SQLiteStore(data)
    state = persisted_state(store, tmp_path)
    state.create_agent("Ada")
    state.create_agent("Lin")
    state.create_agent("Grace")
    state.create_discussion("Work", 1, [2, 3])
    state.send_message(1, 2, "@Ada @Lin @Grace")

    connection = sqlite3.connect(store.path)
    connection.execute("DROP TABLE mention_references")
    connection.execute("PRAGMA user_version = 10")
    connection.commit()
    connection.close()

    migrated = SQLiteStore(data)
    message = migrated.load_organization()["discussions"][0]["messages"][0]
    assert [
        (
            item["member_id"],
            item["name"],
            item["in_discussion"],
            item["notified"],
            item["deleted"],
        )
        for item in message["references"]
    ] == [
        (2, "Ada", True, False, False),
        (3, "Lin", True, True, False),
        (4, "Grace", False, False, False),
    ]


def test_version_ten_migration_rolls_back_table_and_version_atomically(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    data = tmp_path / "data"
    store = SQLiteStore(data)
    connection = sqlite3.connect(store.path)
    connection.execute("DROP TABLE mention_references")
    connection.execute("PRAGMA user_version = 10")
    connection.commit()
    connection.close()

    original = SQLiteStore._backfill_mention_references

    def fail_after_table_creation(connection: sqlite3.Connection) -> None:
        SQLiteStore._create_mention_references_table(connection)
        raise RuntimeError("simulated migration interruption")

    monkeypatch.setattr(
        SQLiteStore, "_backfill_mention_references", fail_after_table_creation
    )
    with pytest.raises(RuntimeError, match="simulated migration interruption"):
        SQLiteStore(data)
    monkeypatch.setattr(SQLiteStore, "_backfill_mention_references", original)

    connection = sqlite3.connect(store.path)
    try:
        assert connection.execute("PRAGMA user_version").fetchone()[0] == 10
        assert (
            connection.execute(
                "SELECT name FROM sqlite_master WHERE name = 'mention_references'"
            ).fetchone()
            is None
        )
    finally:
        connection.close()


def test_reference_table_rejects_notified_group_out_occurrence(tmp_path: Path) -> None:
    store = SQLiteStore(tmp_path / "data")
    state = persisted_state(store, tmp_path)
    state.create_agent("Ada")
    state.create_discussion("Work", 1, [2])
    state.send_message(1, 1, "plain")

    connection = sqlite3.connect(store.path)
    try:
        with pytest.raises(sqlite3.IntegrityError):
            connection.execute(
                """
                INSERT INTO mention_references
                    (discussion_id, message_id, position, member_id, name, start,
                     end, in_discussion, notified, deleted)
                VALUES (1, 1, 0, 2, 'Ada', 0, 4, 0, 1, 0)
                """
            )
        with pytest.raises(sqlite3.IntegrityError):
            connection.execute(
                """
                INSERT INTO mention_references
                    (discussion_id, message_id, position, member_id, name, start,
                     end, in_discussion, notified, deleted)
                VALUES (1, 1, 1, 2, 'Ada', NULL, 4, 1, 1, 0)
                """
            )
    finally:
        connection.close()


def test_legacy_name_issue_disables_reference_backfill(tmp_path: Path) -> None:
    data = tmp_path / "data"
    store = SQLiteStore(data)
    state = persisted_state(store, tmp_path)
    state.create_agent("Ada")
    state.create_agent("Lin")
    state.create_discussion("Work", 1, [2, 3])
    state.send_message(1, 1, "@Lin")

    connection = sqlite3.connect(store.path)
    connection.execute("UPDATE members SET name = 'Bad Name' WHERE id = 2")
    connection.execute("UPDATE members SET deleted = 1 WHERE id = 3")
    connection.execute(
        "DELETE FROM discussion_members WHERE discussion_id = 1 AND member_id = 3"
    )
    connection.execute("DROP TABLE mention_references")
    connection.execute("PRAGMA user_version = 10")
    connection.commit()
    connection.close()

    migrated = SQLiteStore(data)
    restored = persisted_state(migrated, tmp_path)
    snapshot = restored.snapshot()
    assert snapshot["mention_syntax"] == {
        "enabled": False,
        "issues": [
            {
                "code": "invalid_name",
                "member_ids": [2],
                "names": ["Bad Name"],
            }
        ],
    }
    assert snapshot["discussions"][0]["messages"][0]["references"] == [
        {
            "member_id": 3,
            "name": "Lin",
            "start": None,
            "end": None,
            "in_discussion": True,
            "notified": True,
            "deleted": True,
        }
    ]
    assert snapshot["discussions"][0]["messages"][0]["mentions"] == [
        {"member_id": 3, "status": "pending"}
    ]


def test_persists_human_prefix_and_sparse_seen_state(tmp_path: Path) -> None:
    store = SQLiteStore(tmp_path / "data")
    state = persisted_state(store, tmp_path)
    state.create_agent("Ada")
    state.create_discussion("Unread", 1, [2])
    state.send_message(1, 2, "First")
    state.send_message(1, 2, "Second")
    state.send_message(1, 2, "Third")
    state.see_human_messages(1, 1, [1, 3])

    restored = persisted_state(store, tmp_path)
    assert restored.snapshot()["discussions"][0]["human_read_states"] == [
        {
            "member_id": 1,
            "read_through_message_id": 1,
            "seen_message_ids": [3],
        }
    ]


def test_persists_member_rename_and_human_notification_read_state(
    tmp_path: Path,
) -> None:
    store = SQLiteStore(tmp_path / "data")
    state = persisted_state(store, tmp_path)
    state.create_agent("Ada")
    state.create_discussion("Work", 1, [2])
    state.send_message(1, 2, "@You review")
    state.rename_member(1, "Owner")
    state.read_human_mention(1, 1, 1)

    restored = persisted_state(store, tmp_path)
    snapshot = restored.snapshot()
    assert snapshot["members"][0]["name"] == "Owner"
    message = snapshot["discussions"][0]["messages"][0]
    assert message["references"][0]["name"] == "You"
    assert message["human_mentions"] == [{"member_id": 1, "status": "read"}]


def test_schema_twelve_to_thirteen_adds_human_read_state_without_losing_mentions(
    tmp_path: Path,
) -> None:
    data = tmp_path / "data"
    store = SQLiteStore(data)
    state = persisted_state(store, tmp_path)
    state.create_agent("Ada")
    state.create_discussion("Work", 1, [2])
    state.send_message(1, 2, "@You review")

    connection = sqlite3.connect(store.path)
    before = connection.execute(
        "SELECT human_id, discussion_id, message_id, read FROM human_mention_notifications"
    ).fetchall()
    connection.execute("DROP TABLE human_discussion_seen_messages")
    connection.execute("DROP TABLE human_discussion_read_states")
    connection.execute("PRAGMA user_version = 12")
    connection.commit()
    connection.close()

    migrated = SQLiteStore(data)
    connection = sqlite3.connect(migrated.path)
    after = connection.execute(
        "SELECT human_id, discussion_id, message_id, read FROM human_mention_notifications"
    ).fetchall()
    version = connection.execute("PRAGMA user_version").fetchone()[0]
    read_table = connection.execute(
        "SELECT name FROM sqlite_master WHERE name = 'human_discussion_read_states'"
    ).fetchone()
    seen_table = connection.execute(
        "SELECT name FROM sqlite_master WHERE name = 'human_discussion_seen_messages'"
    ).fetchone()
    connection.close()

    assert after == before
    assert version == SCHEMA_VERSION
    assert read_table == ("human_discussion_read_states",)
    assert seen_table == ("human_discussion_seen_messages",)


def test_schema_eleven_to_fourteen_preserves_occurrences_without_backfill(
    tmp_path: Path,
) -> None:
    data = tmp_path / "data"
    store = SQLiteStore(data)
    state = persisted_state(store, tmp_path)
    state.create_agent("Ada")
    state.create_discussion("Work", 1, [2])
    state.send_message(1, 1, "@Ada twice @Ada")

    connection = sqlite3.connect(store.path)
    before = connection.execute(
        "SELECT * FROM mention_references ORDER BY discussion_id, message_id, position"
    ).fetchall()
    connection.execute("PRAGMA foreign_keys = OFF")
    connection.execute("PRAGMA legacy_alter_table = ON")
    connection.execute("ALTER TABLE messages RENAME TO messages_schema_twelve")
    connection.execute(
        """
        CREATE TABLE messages (
            discussion_id INTEGER NOT NULL,
            id INTEGER NOT NULL,
            sender_id INTEGER NOT NULL,
            body TEXT NOT NULL,
            PRIMARY KEY (discussion_id, id),
            FOREIGN KEY (discussion_id) REFERENCES discussions (id)
                ON DELETE CASCADE,
            FOREIGN KEY (sender_id) REFERENCES members (id)
        )
        """
    )
    connection.execute(
        """
        INSERT INTO messages (discussion_id, id, sender_id, body)
        SELECT discussion_id, id, sender_id, body FROM messages_schema_twelve
        """
    )
    connection.execute("DROP TABLE messages_schema_twelve")
    connection.execute("DROP TABLE human_mention_notifications")
    connection.execute("PRAGMA user_version = 11")
    connection.commit()
    connection.close()

    SQLiteStore(data)
    connection = sqlite3.connect(store.path)
    after = connection.execute(
        "SELECT * FROM mention_references ORDER BY discussion_id, message_id, position"
    ).fetchall()
    version = connection.execute("PRAGMA user_version").fetchone()[0]
    sender_name, created_at = connection.execute(
        "SELECT sender_name, created_at FROM messages WHERE discussion_id = 1 AND id = 1"
    ).fetchone()
    table = connection.execute(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'human_mention_notifications'"
    ).fetchone()
    connection.close()

    assert after == before
    assert version == SCHEMA_VERSION
    assert sender_name == "You"
    assert created_at is None
    assert table is not None


def test_rename_restart_preserves_historical_author_snapshot(tmp_path: Path) -> None:
    store = SQLiteStore(tmp_path / "data")
    state = persisted_state(store, tmp_path)
    state.create_agent("Ada")
    state.create_discussion("Work", 1, [2])
    state.send_message(1, 1, "Before rename")
    state.rename_member(1, "Owner")

    restored = persisted_state(store, tmp_path).snapshot()
    message = restored["discussions"][0]["messages"][0]

    assert restored["members"][0]["name"] == "Owner"
    assert message["sender_name"] == "You"
