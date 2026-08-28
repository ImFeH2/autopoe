from __future__ import annotations

import json
import sqlite3
import stat
from collections.abc import Sequence
from copy import deepcopy
from pathlib import Path

import pytest
from snapshot_helpers import without_delivery

from huddol.domain import OrganizationState
from huddol.model_runner import ModelRuntime
from huddol.persistence import (
    DATA_DIRECTORY_ENV,
    SCHEMA_VERSION,
    AuditUnavailableError,
    AuthorizationDataError,
    ManagementRevisionConflict,
    OrganizationAdminAssignment,
    OrganizationAuditEvent,
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
    path = data / "huddol.sqlite3"
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


def downgrade_authorization_schema_to_seventeen(path: Path) -> None:
    with sqlite3.connect(path) as connection:
        connection.execute("DROP TRIGGER organization_audit_events_no_update")
        connection.execute("DROP TRIGGER organization_audit_events_no_delete")
        connection.execute("DROP TABLE organization_admin_assignments")
        connection.execute("DROP TABLE organization_audit_events")
        connection.execute(
            "ALTER TABLE application_state DROP COLUMN management_revision"
        )
        connection.execute("PRAGMA user_version = 17")


def organization_audit_event(
    *,
    result: str = "success",
    action: str = "organization.role.grant",
    target_type: str = "member",
    target_id: int = 2,
    reason_code: str | None = None,
    metadata: dict[str, object] | None = None,
) -> OrganizationAuditEvent:
    return OrganizationAuditEvent(
        occurred_at="2026-08-26T12:00:00+00:00",
        actor_id=1,
        actor_type="human",
        actor_name="You",
        action=action,
        target_type=target_type,
        target_id=target_id,
        result=result,
        reason_code=reason_code,
        metadata=metadata,
    )


def authorization_database_snapshot(
    store: SQLiteStore,
) -> tuple[object, object, object]:
    return (
        store.load_organization(),
        store.load_authorization_state(),
        store.load_audit_events(),
    )


def test_uses_huddol_directory_under_home(monkeypatch, tmp_path: Path) -> None:
    home = tmp_path / "home"
    monkeypatch.setenv("HOME", str(home))
    monkeypatch.delenv(DATA_DIRECTORY_ENV, raising=False)

    assert data_directory() == home / ".huddol"


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
    assert without_delivery(restored.snapshot()["discussions"][0]["messages"]) == [
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
    assert without_delivery(restored.snapshot()["discussions"]) == [
        {
            "id": 1,
            "topic": "Work",
            "member_ids": [1],
            "human_read_states": [
                {
                    "member_id": 1,
                    "joined_after_message_id": 0,
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


def test_discussion_keeps_its_human_after_all_agents_are_deleted_and_restart(
    tmp_path: Path,
) -> None:
    store = SQLiteStore(tmp_path / "data")
    state = persisted_state(store, tmp_path)
    state.create_agent("Ada")
    state.create_agent("Lin")
    state.create_discussion("Agent archive", 2, [3])
    state.send_message(1, 2, "Keep this history")
    created_at = state.snapshot()["discussions"][0]["messages"][0]["created_at"]

    state.delete_agent(2)
    state.delete_agent(3)
    restored = persisted_state(store, tmp_path)

    assert without_delivery(restored.snapshot()["discussions"]) == [
        {
            "id": 1,
            "topic": "Agent archive",
            "member_ids": [1],
            "human_read_states": [
                {
                    "member_id": 1,
                    "joined_after_message_id": 0,
                    "read_through_message_id": None,
                    "seen_message_ids": [],
                }
            ],
            "messages": [
                {
                    "id": 1,
                    "sender_id": 2,
                    "sender_name": "Ada",
                    "body": "Keep this history",
                    "created_at": created_at,
                    "references": [],
                    "mentions": [],
                }
            ],
        }
    ]


def test_persists_execution_backend(tmp_path: Path) -> None:
    store = SQLiteStore(tmp_path / "data")

    assert store.load_execution_backend() == "native"
    store.save_execution_backend("wsl")

    assert SQLiteStore(tmp_path / "data").load_execution_backend() == "wsl"
    with pytest.raises(ValueError, match="backend must be native or wsl"):
        store.save_execution_backend("invalid")


def test_schema_sixteen_adds_execution_settings_without_changing_state(
    tmp_path: Path,
) -> None:
    data = tmp_path / "data"
    store = SQLiteStore(data)
    state = persisted_state(store, tmp_path)
    state.create_agent("Ada")
    downgrade_authorization_schema_to_seventeen(store.path)
    with sqlite3.connect(store.path) as connection:
        connection.execute("DROP TABLE execution_settings")
        connection.execute("PRAGMA user_version = 16")

    migrated = SQLiteStore(data)

    assert migrated.load_execution_backend() == "native"
    assert migrated.load_organization()["members"][1]["name"] == "Ada"
    assert migrated.load_authorization_state().management_revision == 0
    with sqlite3.connect(migrated.path) as connection:
        assert connection.execute("PRAGMA user_version").fetchone()[0] == SCHEMA_VERSION
        assert connection.execute(
            "SELECT name FROM sqlite_master WHERE name = 'execution_settings'"
        ).fetchone() == ("execution_settings",)


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
    assert without_delivery(restored.snapshot()["discussions"][0]["messages"]) == [
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


def test_migrates_version_fourteen_memberships_with_stable_human_cutoffs(
    tmp_path: Path,
) -> None:
    data = tmp_path / "data"
    store = SQLiteStore(data)
    state = persisted_state(store, tmp_path)
    state.create_agent("Ada")
    state.create_discussion("Existing", 1, [2])
    state.send_message(1, 2, "Old one")
    state.send_message(1, 2, "Old two")
    state.see_human_messages(1, 1, [1])

    with sqlite3.connect(store.path) as connection:
        connection.execute(
            "INSERT INTO members (id, type, name, deleted, paused) VALUES (3, 'human', 'Guest', 0, 0)"
        )
        connection.execute("ALTER TABLE discussion_members DROP COLUMN active")
        connection.execute(
            "ALTER TABLE discussion_members DROP COLUMN joined_after_message_id"
        )
        connection.execute("PRAGMA user_version = 14")

    migrated = SQLiteStore(data)
    with sqlite3.connect(migrated.path) as connection:
        memberships = connection.execute(
            """
            SELECT member_id, active, joined_after_message_id
            FROM discussion_members WHERE discussion_id = 1 ORDER BY position
            """
        ).fetchall()
        read_states = connection.execute(
            """
            SELECT human_id, read_through_message_id
            FROM human_discussion_read_states
            WHERE discussion_id = 1 ORDER BY human_id
            """
        ).fetchall()
        assert connection.execute("PRAGMA user_version").fetchone()[0] == SCHEMA_VERSION
    assert memberships == [(1, 1, 0), (2, 1, 0), (3, 1, 2)]
    assert read_states == [(1, 1), (3, None)]

    restored = persisted_state(migrated, tmp_path).snapshot()
    assert restored["discussions"][0]["member_ids"] == [1, 2, 3]
    assert restored["discussions"][0]["human_read_states"] == [
        {
            "member_id": 1,
            "joined_after_message_id": 0,
            "read_through_message_id": 1,
            "seen_message_ids": [],
        },
        {
            "member_id": 3,
            "joined_after_message_id": 2,
            "read_through_message_id": None,
            "seen_message_ids": [],
        },
    ]

    reopened = SQLiteStore(data)
    with sqlite3.connect(reopened.path) as connection:
        assert (
            connection.execute(
                "SELECT COUNT(*) FROM discussion_members WHERE discussion_id = 1"
            ).fetchone()[0]
            == 3
        )
        assert (
            connection.execute(
                """
            SELECT joined_after_message_id FROM discussion_members
            WHERE discussion_id = 1 AND member_id = 3
            """
            ).fetchone()[0]
            == 2
        )


def test_version_fourteen_membership_migration_rolls_back_and_reopens(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    data = tmp_path / "data"
    store = SQLiteStore(data)
    state = persisted_state(store, tmp_path)
    state.create_agent("Ada")
    state.create_discussion("Work", 1, [2])

    with sqlite3.connect(store.path) as connection:
        connection.execute("ALTER TABLE discussion_members DROP COLUMN active")
        connection.execute(
            "ALTER TABLE discussion_members DROP COLUMN joined_after_message_id"
        )
        connection.execute("PRAGMA user_version = 14")

    def fail_after_adding_column(connection: sqlite3.Connection) -> None:
        connection.execute(
            "ALTER TABLE discussion_members ADD COLUMN active INTEGER NOT NULL DEFAULT 1"
        )
        raise sqlite3.OperationalError("injected membership migration failure")

    monkeypatch.setattr(
        SQLiteStore,
        "_add_discussion_membership_columns",
        staticmethod(fail_after_adding_column),
    )
    with pytest.raises(sqlite3.OperationalError, match="injected membership"):
        SQLiteStore(data)

    with sqlite3.connect(store.path) as connection:
        assert connection.execute("PRAGMA user_version").fetchone()[0] == 14
        columns = {
            row[1]
            for row in connection.execute("PRAGMA table_info(discussion_members)")
        }
        assert "active" not in columns
        assert "joined_after_message_id" not in columns

    monkeypatch.undo()
    reopened = SQLiteStore(data)
    with sqlite3.connect(reopened.path) as connection:
        assert connection.execute("PRAGMA user_version").fetchone()[0] == SCHEMA_VERSION
        columns = {
            row[1]
            for row in connection.execute("PRAGMA table_info(discussion_members)")
        }
        assert {"active", "joined_after_message_id"} <= columns


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
            "joined_after_message_id": 0,
            "read_through_message_id": 1,
            "seen_message_ids": [3],
        }
    ]


def test_self_mention_text_persists_without_structured_or_notification_rows(
    tmp_path: Path,
) -> None:
    store = SQLiteStore(tmp_path / "data")
    state = persisted_state(store, tmp_path)
    state.create_agent("Ada")
    state.create_discussion("Work", 1, [2])
    state.rename_member(1, "Owner")
    state.send_message(1, 1, "@Owner remains ordinary text")

    restored = persisted_state(store, tmp_path).snapshot()
    message = restored["discussions"][0]["messages"][0]
    assert message["references"] == []
    assert message["mentions"] == []
    assert "human_mentions" not in message

    connection = sqlite3.connect(store.path)
    assert connection.execute("SELECT COUNT(*) FROM mention_references").fetchone() == (
        0,
    )
    assert connection.execute("SELECT COUNT(*) FROM mentions").fetchone() == (0,)
    assert connection.execute(
        "SELECT COUNT(*) FROM human_mention_notifications"
    ).fetchone() == (0,)
    connection.close()


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


def downgrade_delivery_schema_to_fifteen(path: Path) -> None:
    with sqlite3.connect(path) as connection:
        connection.execute("DROP TABLE message_mention_acknowledgements")
        connection.execute("DROP TABLE message_read_receipts")
        connection.execute("DROP TABLE message_recipients")
        connection.execute("DROP TABLE discussion_activity_frontiers")
        connection.execute("ALTER TABLE messages DROP COLUMN recipient_snapshot_known")
        connection.execute("PRAGMA user_version = 15")


def test_schema_fifteen_to_sixteen_migrates_only_trusted_delivery_facts(
    tmp_path: Path,
) -> None:
    data = tmp_path / "data"
    store = SQLiteStore(data)
    state = persisted_state(store, tmp_path)
    state.create_agent("Ada")
    state.create_discussion("Legacy delivery", 1, [2])
    state.send_message(1, 2, "@You seen")
    state.see_human_messages(1, 1, [1])
    state.send_message(1, 1, "@Ada claimed")
    state.read_discussion(2, 1, start_message_id=2, limit=1)
    state.send_message(1, 1, "@Ada acked")
    state.read_discussion(2, 1, start_message_id=3, limit=1)
    state.ack_messages(2, 1, [3])

    with sqlite3.connect(store.path) as connection:
        connection.execute(
            "INSERT INTO members (id, type, name, deleted, paused) VALUES (3, 'human', 'Guest', 0, 0)"
        )
        connection.execute(
            """
            INSERT INTO discussion_members
                (discussion_id, position, member_id, active, joined_after_message_id)
            VALUES (1, 2, 3, 1, 2)
            """
        )
        connection.execute(
            """
            INSERT INTO human_discussion_read_states
                (human_id, discussion_id, read_through_message_id)
            VALUES (3, 1, NULL)
            """
        )
        connection.executemany(
            "INSERT INTO members (id, type, name, deleted, paused) VALUES (?, 'agent', ?, ?, 0)",
            [(4, "Inactive", 0), (5, "Deleted", 1)],
        )
        connection.executemany(
            """
            INSERT INTO discussion_members
                (discussion_id, position, member_id, active, joined_after_message_id)
            VALUES (1, ?, ?, ?, 0)
            """,
            [(3, 4, 0), (4, 5, 1)],
        )
    downgrade_delivery_schema_to_fifteen(store.path)

    migrated = SQLiteStore(data)
    restored = persisted_state(migrated, tmp_path).snapshot()["discussions"][0]
    assert all(
        message["delivery"]["recipients_known"] is False
        for message in restored["messages"]
    )
    assert restored["messages"][0]["delivery"]["recipients"][0]["read"] is True
    assert restored["messages"][1]["delivery"]["recipients"][0] == {
        "member_id": 2,
        "member_type_at_send": "agent",
        "member_name_at_send": "Ada",
        "available": True,
        "mentioned": True,
        "read": None,
        "ack": "unknown",
    }
    assert restored["messages"][2]["delivery"]["recipients"][0]["read"] is None
    assert restored["messages"][2]["delivery"]["recipients"][0]["ack"] == "acked"
    frontiers = {
        item["member_id"]: item["latest_activity_message_id"]
        for item in restored["activity_frontiers"]
    }
    assert frontiers == {1: 3, 2: 3, 3: 3}
    guest_state = next(
        state for state in restored["human_read_states"] if state["member_id"] == 3
    )
    assert guest_state["joined_after_message_id"] == 2
    assert frontiers[3] == 3  # migration-time latest baseline, not the cutoff
    with sqlite3.connect(migrated.path) as connection:
        assert connection.execute("PRAGMA user_version").fetchone()[0] == SCHEMA_VERSION
        assert (
            connection.execute("SELECT COUNT(*) FROM message_recipients").fetchone()[0]
            == 0
        )
        assert (
            connection.execute(
                "SELECT COUNT(*) FROM message_read_receipts WHERE member_id = 3"
            ).fetchone()[0]
            == 0
        )
        assert (
            connection.execute(
                "SELECT COUNT(*) FROM message_read_receipts WHERE member_id = 2"
            ).fetchone()[0]
            == 0
        )
        assert (
            connection.execute(
                "SELECT COUNT(*) FROM message_read_receipts WHERE member_id = 1"
            ).fetchone()[0]
            == 1
        )
        assert (
            connection.execute(
                "SELECT COUNT(*) FROM message_mention_acknowledgements WHERE member_id = 3"
            ).fetchone()[0]
            == 0
        )
        assert connection.execute(
            """
            SELECT discussion_id, message_id, member_id, source
            FROM message_mention_acknowledgements
            ORDER BY discussion_id, message_id, member_id
            """
        ).fetchall() == [(1, 3, 2, "legacy_agent_ack")]
        assert (
            connection.execute(
                """
            SELECT discussion_id, message_id, member_id, source
            FROM message_read_receipts
            WHERE member_id = 2
            """
            ).fetchall()
            == []
        )
        assert connection.execute(
            """
            SELECT latest_activity_message_id
            FROM discussion_activity_frontiers
            WHERE member_id = 3 AND discussion_id = 1
            """
        ).fetchone() == (3,)
        assert (
            connection.execute(
                """
            SELECT member_id FROM discussion_activity_frontiers
            WHERE member_id IN (4, 5)
            ORDER BY member_id
            """
            ).fetchall()
            == []
        )


def test_schema_sixteen_missing_frontier_remains_missing_across_restart(
    tmp_path: Path,
) -> None:
    store = SQLiteStore(tmp_path / "data")
    state = persisted_state(store, tmp_path)
    state.create_agent("Ada")
    state.create_discussion("No inferred frontier", 1, [2])

    assert state.snapshot()["discussions"][0]["activity_frontiers"] == []
    reopened = persisted_state(store, tmp_path)
    assert reopened.snapshot()["discussions"][0]["activity_frontiers"] == []
    with sqlite3.connect(store.path) as connection:
        assert (
            connection.execute(
                "SELECT COUNT(*) FROM discussion_activity_frontiers"
            ).fetchone()[0]
            == 0
        )


def test_human_frontier_and_receipts_survive_restart_without_implicit_ack(
    tmp_path: Path,
) -> None:
    store = SQLiteStore(tmp_path / "data")
    state = persisted_state(store, tmp_path)
    state.create_agent("Ada")
    state.create_discussion("Restart delivery", 1, [2])
    state.send_message(1, 2, "@You first")
    state.send_message(1, 2, "second")
    state.mark_all_human_messages_read(1, 1, 2)

    restored = persisted_state(store, tmp_path)
    discussion = restored.snapshot()["discussions"][0]
    assert discussion["activity_frontiers"] == [
        {"member_id": 1, "latest_activity_message_id": 2},
        {"member_id": 2, "latest_activity_message_id": 2},
    ]
    assert [
        message["delivery"]["recipients"][0]["read"]
        for message in discussion["messages"]
    ] == [True, True]
    assert discussion["messages"][0]["delivery"]["recipients"][0]["ack"] == "pending"

    restored.send_message(1, 2, "third")
    restored.see_human_messages(1, 1, [3])
    reopened = persisted_state(store, tmp_path).snapshot()["discussions"][0]
    assert reopened["activity_frontiers"][0] == {
        "member_id": 1,
        "latest_activity_message_id": 3,
    }
    assert reopened["messages"][2]["delivery"]["recipients"][0]["read"] is True
    with sqlite3.connect(store.path) as connection:
        assert (
            connection.execute(
                "SELECT COUNT(*) FROM message_mention_acknowledgements"
            ).fetchone()[0]
            == 0
        )


def test_schema_fifteen_delivery_migration_rolls_back_and_reopens(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    data = tmp_path / "data"
    store = SQLiteStore(data)
    downgrade_delivery_schema_to_fifteen(store.path)

    original = SQLiteStore._create_delivery_tables

    def fail_delivery_tables(connection: sqlite3.Connection) -> None:
        original(connection)
        raise sqlite3.OperationalError("injected delivery migration failure")

    monkeypatch.setattr(
        SQLiteStore, "_create_delivery_tables", staticmethod(fail_delivery_tables)
    )
    with pytest.raises(sqlite3.OperationalError, match="injected delivery"):
        SQLiteStore(data)
    with sqlite3.connect(store.path) as connection:
        assert connection.execute("PRAGMA user_version").fetchone()[0] == 15
        assert "recipient_snapshot_known" not in {
            row[1] for row in connection.execute("PRAGMA table_info(messages)")
        }
        assert (
            connection.execute(
                "SELECT name FROM sqlite_master WHERE name = 'message_recipients'"
            ).fetchone()
            is None
        )

    monkeypatch.undo()
    reopened = SQLiteStore(data)
    with sqlite3.connect(reopened.path) as connection:
        assert connection.execute("PRAGMA user_version").fetchone()[0] == SCHEMA_VERSION


def authorization_schema_objects(path: Path) -> dict[str, str]:
    names = (
        "organization_admin_assignments",
        "organization_audit_events",
        "organization_audit_events_no_update",
        "organization_audit_events_no_delete",
    )
    with sqlite3.connect(path) as connection:
        return {
            name: sql
            for name, sql in connection.execute(
                f"SELECT name, sql FROM sqlite_master WHERE name IN ({','.join('?' for _ in names)})",
                names,
            )
        }


def test_schema_seventeen_to_eighteen_matches_fresh_authorization_schema(
    tmp_path: Path,
) -> None:
    fresh = SQLiteStore(tmp_path / "fresh")
    expected_objects = authorization_schema_objects(fresh.path)

    data = tmp_path / "migrated"
    legacy = SQLiteStore(data)
    legacy.save_execution_backend("wsl")
    downgrade_authorization_schema_to_seventeen(legacy.path)

    migrated = SQLiteStore(data)

    assert authorization_schema_objects(migrated.path) == expected_objects
    assert migrated.load_execution_backend() == "wsl"
    assert migrated.load_authorization_state().management_revision == 0
    assert migrated.load_authorization_state().admin_assignments == ()
    assert migrated.load_audit_events() == ()
    with sqlite3.connect(migrated.path) as connection:
        assert connection.execute("PRAGMA user_version").fetchone()[0] == SCHEMA_VERSION
        revision_column = next(
            row
            for row in connection.execute("PRAGMA table_info(application_state)")
            if row[1] == "management_revision"
        )
        assert revision_column[2:6] == ("INTEGER", 1, "0", 0)


def test_schema_seventeen_authorization_migration_rolls_back_and_reopens(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    data = tmp_path / "data"
    store = SQLiteStore(data)
    downgrade_authorization_schema_to_seventeen(store.path)
    original = SQLiteStore._create_authorization_tables

    def fail_after_authorization_ddl(connection: sqlite3.Connection) -> None:
        original(connection)
        raise sqlite3.OperationalError("injected authorization migration failure")

    monkeypatch.setattr(
        SQLiteStore,
        "_create_authorization_tables",
        staticmethod(fail_after_authorization_ddl),
    )
    with pytest.raises(sqlite3.OperationalError, match="injected authorization"):
        SQLiteStore(data)

    with sqlite3.connect(store.path) as connection:
        assert connection.execute("PRAGMA user_version").fetchone()[0] == 17
        assert "management_revision" not in {
            row[1] for row in connection.execute("PRAGMA table_info(application_state)")
        }
        assert (
            connection.execute(
                "SELECT COUNT(*) FROM sqlite_master WHERE name LIKE 'organization_%'"
            ).fetchone()[0]
            == 0
        )

    monkeypatch.undo()
    reopened = SQLiteStore(data)
    assert reopened.load_authorization_state() == (
        reopened.load_authorization_state().__class__(0, ())
    )


def test_schema_seventeen_authorization_migration_rolls_back_base_exception(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    data = tmp_path / "data"
    store = SQLiteStore(data)
    downgrade_authorization_schema_to_seventeen(store.path)
    original = SQLiteStore._create_authorization_tables

    def interrupt_after_authorization_ddl(connection: sqlite3.Connection) -> None:
        original(connection)
        raise KeyboardInterrupt

    monkeypatch.setattr(
        SQLiteStore,
        "_create_authorization_tables",
        staticmethod(interrupt_after_authorization_ddl),
    )
    with pytest.raises(KeyboardInterrupt):
        SQLiteStore(data)

    with sqlite3.connect(store.path) as connection:
        assert connection.execute("PRAGMA user_version").fetchone()[0] == 17
        assert "management_revision" not in {
            row[1] for row in connection.execute("PRAGMA table_info(application_state)")
        }
        assert (
            connection.execute(
                "SELECT COUNT(*) FROM sqlite_master WHERE name LIKE 'organization_%'"
            ).fetchone()[0]
            == 0
        )


@pytest.mark.parametrize(
    ("assignment", "message"),
    [
        (
            OrganizationAdminAssignment(999, "2026-08-26T12:00:00+00:00", 1),
            "active Agent",
        ),
        (
            OrganizationAdminAssignment(1, "2026-08-26T12:00:00+00:00", 1),
            "active Agent",
        ),
        (
            OrganizationAdminAssignment(2, "not-a-timestamp", 1),
            "UTC timestamp",
        ),
        (
            OrganizationAdminAssignment(2, "2026-08-26T12:00:00+00:00", 999),
            "must be a Human",
        ),
    ],
)
def test_authorization_restore_rejects_corrupt_assignments(
    tmp_path: Path,
    assignment: OrganizationAdminAssignment,
    message: str,
) -> None:
    data = tmp_path / "data"
    store = SQLiteStore(data)
    state = persisted_state(store, tmp_path)
    state.create_agent("Ada")
    with sqlite3.connect(store.path) as connection:
        connection.execute(
            """
            INSERT INTO organization_admin_assignments
                (agent_id, granted_at, granted_by_human_id)
            VALUES (?, ?, ?)
            """,
            (
                assignment.agent_id,
                assignment.granted_at,
                assignment.granted_by_human_id,
            ),
        )

    with pytest.raises(AuthorizationDataError, match=message):
        SQLiteStore(data)


def test_authorization_restore_rejects_deleted_agent_assignment(
    tmp_path: Path,
) -> None:
    data = tmp_path / "data"
    store = SQLiteStore(data)
    state = persisted_state(store, tmp_path)
    state.create_agent("Ada")
    state.delete_agent(2)
    with sqlite3.connect(store.path) as connection:
        connection.execute(
            """
            INSERT INTO organization_admin_assignments
                (agent_id, granted_at, granted_by_human_id)
            VALUES (2, '2026-08-26T12:00:00+00:00', 1)
            """
        )

    with pytest.raises(AuthorizationDataError, match="active Agent"):
        SQLiteStore(data)


def test_authorization_restore_allows_soft_deleted_human_granter(
    tmp_path: Path,
) -> None:
    data = tmp_path / "data"
    store = SQLiteStore(data)
    state = persisted_state(store, tmp_path)
    state.create_agent("Ada")
    assignment = OrganizationAdminAssignment(2, "2026-08-26T12:00:00+00:00", 1)
    store.commit_management_mutation(
        expected_revision=0,
        organization=deepcopy(state._persistence_data()),
        admin_assignments=[assignment],
        audit_event=organization_audit_event(),
    )
    with sqlite3.connect(store.path) as connection:
        connection.execute("UPDATE members SET deleted = 1 WHERE id = 1")

    reopened = SQLiteStore(data)

    assert reopened.load_authorization_state().admin_assignments == (assignment,)


def test_authorization_restore_rejects_agent_granter(tmp_path: Path) -> None:
    data = tmp_path / "data"
    store = SQLiteStore(data)
    state = persisted_state(store, tmp_path)
    state.create_agent("Ada")
    state.create_agent("Grace")
    with sqlite3.connect(store.path) as connection:
        connection.execute(
            """
            INSERT INTO organization_admin_assignments
                (agent_id, granted_at, granted_by_human_id)
            VALUES (2, '2026-08-26T12:00:00+00:00', 3)
            """
        )

    with pytest.raises(AuthorizationDataError, match="must be a Human"):
        SQLiteStore(data)


@pytest.mark.parametrize(
    "metadata_json",
    [
        "not-json",
        '{"body":"secret"}',
        '{ "member_count":1}',
        '{"member_count":1,"member_count":2}',
    ],
)
def test_authorization_restore_rejects_corrupt_audit_metadata(
    tmp_path: Path,
    metadata_json: str,
) -> None:
    data = tmp_path / "data"
    store = SQLiteStore(data)
    with sqlite3.connect(store.path) as connection:
        connection.execute(
            """
            INSERT INTO organization_audit_events (
                occurred_at, actor_id, actor_type, actor_name, action,
                target_type, target_id, result, reason_code, metadata_json
            ) VALUES (
                '2026-08-26T12:00:00+00:00', 1, 'human', 'You',
                'discussion.delete', 'discussion', 1, 'failure',
                'invalid_request', ?
            )
            """,
            (metadata_json,),
        )

    with pytest.raises(AuthorizationDataError, match="audit metadata"):
        SQLiteStore(data)


@pytest.mark.parametrize(
    ("action", "actor_id", "actor_type", "actor_name", "message"),
    [
        ("invalid.action", 1, "human", "You", "action is invalid"),
        ("discussion.delete", None, "human", "You", "anonymous actor fields"),
    ],
)
def test_authorization_restore_rejects_corrupt_audit_enum_or_actor(
    tmp_path: Path,
    action: str,
    actor_id: int | None,
    actor_type: str | None,
    actor_name: str | None,
    message: str,
) -> None:
    data = tmp_path / "data"
    store = SQLiteStore(data)
    with sqlite3.connect(store.path) as connection:
        connection.execute("PRAGMA ignore_check_constraints = ON")
        connection.execute(
            """
            INSERT INTO organization_audit_events (
                occurred_at, actor_id, actor_type, actor_name, action,
                target_type, target_id, result, reason_code, metadata_json
            ) VALUES (
                '2026-08-26T12:00:00+00:00', ?, ?, ?, ?,
                'discussion', 1, 'success', NULL, '{}'
            )
            """,
            (actor_id, actor_type, actor_name, action),
        )

    with pytest.raises(AuthorizationDataError, match=message):
        SQLiteStore(data)


@pytest.mark.parametrize(
    "sensitive_key",
    ["body", "preview", "read", "ack", "recipients", "memory", "history", "secret"],
)
def test_audit_metadata_rejects_sensitive_or_unfrozen_fields(
    tmp_path: Path,
    sensitive_key: str,
) -> None:
    store = SQLiteStore(tmp_path / "data")
    event = organization_audit_event(
        result="failure",
        reason_code="invalid_request",
        metadata={sensitive_key: "not allowed"},
    )

    with pytest.raises(AuthorizationDataError, match="unsupported fields"):
        store.append_failure_audit(event)
    assert store.load_audit_events() == ()


@pytest.mark.parametrize(
    ("key", "value"),
    [
        ("discussion_topic", "Restricted"),
        ("member_ids", [1, 2]),
        ("member_count", 2),
        ("message_count", 3),
        ("latest_message_id", 3),
        ("last_activity_at", "2026-08-26T12:00:00+00:00"),
        ("before_admin_agent_ids", [2]),
        ("after_admin_agent_ids", [3]),
        ("before_agent_member_ids", [2]),
        ("after_agent_member_ids", [2, 3]),
    ],
)
def test_failure_audit_rejects_all_resource_metadata_before_insert(
    tmp_path: Path,
    key: str,
    value: object,
) -> None:
    store = SQLiteStore(tmp_path / "data")
    before = authorization_database_snapshot(store)

    with pytest.raises(AuthorizationDataError, match="metadata must be empty"):
        store.append_failure_audit(
            organization_audit_event(
                result="failure",
                reason_code="invalid_request",
                metadata={key: value},
            )
        )

    assert authorization_database_snapshot(store) == before


def test_success_audit_persists_all_metadata_as_canonical_json(tmp_path: Path) -> None:
    store = SQLiteStore(tmp_path / "data")
    state = persisted_state(store, tmp_path)
    state.create_agent("Ada")
    metadata = {
        "discussion_topic": "Allowed",
        "member_ids": [1, 2],
        "member_count": 2,
        "message_count": 3,
        "latest_message_id": 3,
        "last_activity_at": "2026-08-26T12:00:00+00:00",
        "before_admin_agent_ids": [],
        "after_admin_agent_ids": [2],
        "before_agent_member_ids": [],
        "after_agent_member_ids": [2],
    }

    store.commit_management_mutation(
        expected_revision=0,
        organization=deepcopy(state._persistence_data()),
        admin_assignments=[],
        audit_event=organization_audit_event(metadata=metadata),
    )

    with sqlite3.connect(store.path) as connection:
        stored = connection.execute(
            "SELECT metadata_json FROM organization_audit_events"
        ).fetchone()[0]
    assert stored == json.dumps(
        metadata,
        ensure_ascii=False,
        allow_nan=False,
        sort_keys=True,
        separators=(",", ":"),
    )
    assert store.load_audit_events()[0].event.metadata == metadata


def test_ordinary_organization_save_preserves_authorization_facts(
    tmp_path: Path,
) -> None:
    store = SQLiteStore(tmp_path / "data")
    state = persisted_state(store, tmp_path)
    state.create_agent("Ada")
    assignment = OrganizationAdminAssignment(2, "2026-08-26T12:00:00+00:00", 1)
    store.commit_management_mutation(
        expected_revision=0,
        organization=deepcopy(state._persistence_data()),
        admin_assignments=[assignment],
        audit_event=organization_audit_event(),
    )

    with sqlite3.connect(store.path) as connection:
        before = (
            connection.execute(
                "SELECT management_revision FROM application_state WHERE id = 1"
            ).fetchone(),
            connection.execute(
                "SELECT * FROM organization_admin_assignments ORDER BY agent_id"
            ).fetchall(),
            connection.execute(
                "SELECT * FROM organization_audit_events ORDER BY id"
            ).fetchall(),
        )

    state.rename_member(2, "Grace")

    with sqlite3.connect(store.path) as connection:
        after = (
            connection.execute(
                "SELECT management_revision FROM application_state WHERE id = 1"
            ).fetchone(),
            connection.execute(
                "SELECT * FROM organization_admin_assignments ORDER BY agent_id"
            ).fetchall(),
            connection.execute(
                "SELECT * FROM organization_audit_events ORDER BY id"
            ).fetchall(),
        )
    assert after == before


def test_ordinary_save_permission_preflight_failure_changes_nothing(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    store = SQLiteStore(tmp_path / "data")
    state = persisted_state(store, tmp_path)
    state.create_agent("Ada")
    store.commit_management_mutation(
        expected_revision=0,
        organization=deepcopy(state._persistence_data()),
        admin_assignments=[],
        audit_event=organization_audit_event(),
    )
    state = persisted_state(store, tmp_path)
    before_domain = state.snapshot()
    before_database = authorization_database_snapshot(store)

    def deny_permissions() -> None:
        raise PermissionError("injected permission failure")

    monkeypatch.setattr(store, "_preflight_database_permissions", deny_permissions)
    with pytest.raises(PermissionError, match="injected permission"):
        state.rename_member(2, "Must_not_persist")

    assert state.snapshot() == before_domain
    assert authorization_database_snapshot(store) == before_database


def test_failure_audit_permission_preflight_failure_changes_nothing(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    store = SQLiteStore(tmp_path / "data")
    before = authorization_database_snapshot(store)

    def deny_permissions() -> None:
        raise PermissionError("injected permission failure")

    monkeypatch.setattr(store, "_preflight_database_permissions", deny_permissions)
    with pytest.raises(PermissionError, match="injected permission"):
        store.append_failure_audit(
            organization_audit_event(
                result="failure",
                reason_code="invalid_request",
            )
        )

    assert authorization_database_snapshot(store) == before


def test_organization_writes_have_no_permission_step_after_commit(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    store = SQLiteStore(tmp_path / "data")
    state = persisted_state(store, tmp_path)
    state.create_agent("Ada")
    candidate = deepcopy(state._persistence_data())
    original_chmod = Path.chmod
    calls = 0

    def allow_only_preflight(path: Path, mode: int) -> None:
        nonlocal calls
        calls += 1
        if calls > 1:
            raise PermissionError("post-commit chmod must not run")
        original_chmod(path, mode)

    monkeypatch.setattr(Path, "chmod", allow_only_preflight)

    store.save_organization(candidate)
    assert calls == 1

    calls = 0
    store.append_failure_audit(
        organization_audit_event(
            result="failure",
            reason_code="invalid_request",
        )
    )
    assert calls == 1

    calls = 0
    store.commit_management_mutation(
        expected_revision=0,
        organization=candidate,
        admin_assignments=[],
        audit_event=organization_audit_event(),
    )
    assert calls == 1


def test_management_permission_preflight_failure_changes_nothing(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    store = SQLiteStore(tmp_path / "data")
    state = persisted_state(store, tmp_path)
    state.create_agent("Ada")
    candidate = deepcopy(state._persistence_data())
    candidate["members"][1]["name"] = "Must not persist"
    before = authorization_database_snapshot(store)

    def deny_permissions() -> None:
        raise PermissionError("injected permission failure")

    monkeypatch.setattr(store, "_preflight_database_permissions", deny_permissions)
    with pytest.raises(PermissionError, match="injected permission"):
        store.commit_management_mutation(
            expected_revision=0,
            organization=candidate,
            admin_assignments=[],
            audit_event=organization_audit_event(),
        )

    assert authorization_database_snapshot(store) == before


def test_management_cas_success_and_stale_revision_are_atomic(tmp_path: Path) -> None:
    store = SQLiteStore(tmp_path / "data")
    state = persisted_state(store, tmp_path)
    state.create_agent("Ada")
    state.create_discussion("Work", 1, [2])
    assignment = OrganizationAdminAssignment(2, "2026-08-26T12:00:00+00:00", 1)
    candidate = deepcopy(state._persistence_data())

    revision = store.commit_management_mutation(
        expected_revision=0,
        organization=candidate,
        admin_assignments=[assignment],
        audit_event=organization_audit_event(),
    )

    assert revision == 1
    assert store.load_authorization_state().management_revision == 1
    assert store.load_authorization_state().admin_assignments == (assignment,)
    assert len(store.load_audit_events()) == 1
    before_organization = store.load_organization()
    stale_candidate = deepcopy(candidate)
    stale_candidate["discussions"][0]["topic"] = "Must not persist"

    with pytest.raises(ManagementRevisionConflict, match="stale"):
        store.commit_management_mutation(
            expected_revision=0,
            organization=stale_candidate,
            admin_assignments=[],
            audit_event=organization_audit_event(
                action="discussion.delete",
                target_type="discussion",
                target_id=1,
            ),
        )

    assert store.load_organization() == before_organization
    assert store.load_authorization_state().management_revision == 1
    assert store.load_authorization_state().admin_assignments == (assignment,)
    assert len(store.load_audit_events()) == 1


def test_organization_write_failure_rolls_back_management_transaction(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    store = SQLiteStore(tmp_path / "data")
    state = persisted_state(store, tmp_path)
    state.create_agent("Ada")
    assignment = OrganizationAdminAssignment(2, "2026-08-26T12:00:00+00:00", 1)
    store.commit_management_mutation(
        expected_revision=0,
        organization=deepcopy(state._persistence_data()),
        admin_assignments=[assignment],
        audit_event=organization_audit_event(),
    )
    before = authorization_database_snapshot(store)
    candidate = deepcopy(before[0])
    candidate["members"][1]["name"] = "Must roll back"
    original = SQLiteStore._write_organization

    def fail_after_organization_write(
        connection: sqlite3.Connection,
        organization: dict[str, object],
    ) -> None:
        original(connection, organization)
        raise sqlite3.OperationalError("injected Organization write failure")

    monkeypatch.setattr(
        SQLiteStore,
        "_write_organization",
        staticmethod(fail_after_organization_write),
    )
    with pytest.raises(sqlite3.OperationalError, match="Organization write"):
        store.commit_management_mutation(
            expected_revision=1,
            organization=candidate,
            admin_assignments=[],
            audit_event=organization_audit_event(),
        )

    assert authorization_database_snapshot(store) == before


def test_assignment_rewrite_failure_rolls_back_management_transaction(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    store = SQLiteStore(tmp_path / "data")
    state = persisted_state(store, tmp_path)
    state.create_agent("Ada")
    assignment = OrganizationAdminAssignment(2, "2026-08-26T12:00:00+00:00", 1)
    store.commit_management_mutation(
        expected_revision=0,
        organization=deepcopy(state._persistence_data()),
        admin_assignments=[assignment],
        audit_event=organization_audit_event(),
    )
    before = authorization_database_snapshot(store)
    candidate = deepcopy(before[0])
    candidate["members"][1]["name"] = "Must roll back"
    original = SQLiteStore._replace_admin_assignments

    def fail_after_assignment_rewrite(
        connection: sqlite3.Connection,
        assignments: Sequence[OrganizationAdminAssignment],
    ) -> None:
        original(connection, assignments)
        raise sqlite3.OperationalError("injected assignment rewrite failure")

    monkeypatch.setattr(
        SQLiteStore,
        "_replace_admin_assignments",
        staticmethod(fail_after_assignment_rewrite),
    )
    with pytest.raises(sqlite3.OperationalError, match="assignment rewrite"):
        store.commit_management_mutation(
            expected_revision=1,
            organization=candidate,
            admin_assignments=[],
            audit_event=organization_audit_event(),
        )

    assert authorization_database_snapshot(store) == before


def test_success_audit_failure_rolls_back_management_transaction(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    store = SQLiteStore(tmp_path / "data")
    state = persisted_state(store, tmp_path)
    state.create_agent("Ada")
    state.create_discussion("Work", 1, [2])
    assignment = OrganizationAdminAssignment(2, "2026-08-26T12:00:00+00:00", 1)
    store.commit_management_mutation(
        expected_revision=0,
        organization=deepcopy(state._persistence_data()),
        admin_assignments=[assignment],
        audit_event=organization_audit_event(),
    )
    before_organization = store.load_organization()
    before_authorization = store.load_authorization_state()
    before_audit = store.load_audit_events()
    candidate = deepcopy(before_organization)
    candidate["discussions"][0]["topic"] = "Must roll back"

    def fail_audit_insert(
        _connection: sqlite3.Connection,
        _event: OrganizationAuditEvent,
    ) -> int:
        raise sqlite3.OperationalError("injected audit failure")

    monkeypatch.setattr(
        SQLiteStore, "_insert_audit_event", staticmethod(fail_audit_insert)
    )
    with pytest.raises(AuditUnavailableError, match="unavailable"):
        store.commit_management_mutation(
            expected_revision=1,
            organization=candidate,
            admin_assignments=[],
            audit_event=organization_audit_event(
                action="discussion.delete",
                target_type="discussion",
                target_id=1,
            ),
        )

    assert store.load_organization() == before_organization
    assert store.load_authorization_state() == before_authorization
    assert store.load_audit_events() == before_audit


def test_failure_audit_is_independent_and_append_only(tmp_path: Path) -> None:
    store = SQLiteStore(tmp_path / "data")
    before_revision = store.load_authorization_state().management_revision
    event_id = store.append_failure_audit(
        organization_audit_event(
            result="failure",
            reason_code="revision_conflict",
        )
    )

    assert event_id == 1
    assert store.load_authorization_state().management_revision == before_revision
    with sqlite3.connect(store.path) as connection:
        with pytest.raises(sqlite3.IntegrityError, match="append-only"):
            connection.execute(
                "UPDATE organization_audit_events SET actor_name = 'Changed' WHERE id = 1"
            )
        with pytest.raises(sqlite3.IntegrityError, match="append-only"):
            connection.execute("DELETE FROM organization_audit_events WHERE id = 1")
    assert len(store.load_audit_events()) == 1


def test_failure_audit_insert_error_reports_unavailable_without_revision_change(
    tmp_path: Path,
) -> None:
    store = SQLiteStore(tmp_path / "data")
    before_revision = store.load_authorization_state().management_revision
    with sqlite3.connect(store.path) as connection:
        connection.execute(
            """
            CREATE TRIGGER reject_organization_audit_insert
            BEFORE INSERT ON organization_audit_events
            BEGIN
                SELECT RAISE(ABORT, 'injected audit unavailable');
            END
            """
        )

    with pytest.raises(AuditUnavailableError, match="unavailable"):
        store.append_failure_audit(
            organization_audit_event(
                result="failure",
                reason_code="invalid_request",
            )
        )
    assert store.load_authorization_state().management_revision == before_revision
    assert store.load_audit_events() == ()


def test_management_agent_delete_explicitly_revokes_admin_assignment(
    tmp_path: Path,
) -> None:
    store = SQLiteStore(tmp_path / "data")
    state = persisted_state(store, tmp_path)
    state.create_agent("Ada")
    assignment = OrganizationAdminAssignment(2, "2026-08-26T12:00:00+00:00", 1)
    store.commit_management_mutation(
        expected_revision=0,
        organization=deepcopy(state._persistence_data()),
        admin_assignments=[assignment],
        audit_event=organization_audit_event(),
    )
    candidate = OrganizationState(persisted=store.load_organization())
    candidate.delete_agent(2)

    store.commit_management_mutation(
        expected_revision=1,
        organization=deepcopy(candidate._persistence_data()),
        admin_assignments=[],
        audit_event=organization_audit_event(
            action="organization.agent.delete",
            target_type="member",
            target_id=2,
        ),
    )

    assert store.load_authorization_state().management_revision == 2
    assert store.load_authorization_state().admin_assignments == ()
    assert store.load_organization()["members"][1]["deleted"] is True


def test_discussion_management_delete_cascades_content_but_preserves_audit(
    tmp_path: Path,
) -> None:
    store = SQLiteStore(tmp_path / "data")
    state = persisted_state(store, tmp_path)
    state.create_agent("Ada")
    state.create_discussion("Delete", 1, [2])
    state.create_discussion("Keep", 1, [2])
    state.send_message(1, 1, "@Ada review")
    state.read_discussion(2, 1)
    state.ack_messages(2, 1, [1])
    state.send_message(2, 1, "@Ada keep")
    state.read_discussion(2, 2)
    state.ack_messages(2, 2, [1])
    assignment = OrganizationAdminAssignment(2, "2026-08-26T12:00:00+00:00", 1)
    store.commit_management_mutation(
        expected_revision=0,
        organization=deepcopy(state._persistence_data()),
        admin_assignments=[assignment],
        audit_event=organization_audit_event(),
    )
    candidate = OrganizationState(persisted=store.load_organization())
    candidate.delete_discussion(1)

    store.commit_management_mutation(
        expected_revision=1,
        organization=deepcopy(candidate._persistence_data()),
        admin_assignments=[assignment],
        audit_event=organization_audit_event(
            action="discussion.delete",
            target_type="discussion",
            target_id=1,
            metadata={
                "discussion_topic": "Delete",
                "member_ids": [1, 2],
                "member_count": 2,
                "message_count": 1,
                "latest_message_id": 1,
                "last_activity_at": None,
            },
        ),
    )

    discussion_tables = (
        "discussion_members",
        "messages",
        "mentions",
        "mention_references",
        "human_mention_notifications",
        "human_discussion_read_states",
        "human_discussion_seen_messages",
        "discussion_activity_frontiers",
        "message_recipients",
        "message_read_receipts",
        "message_mention_acknowledgements",
    )
    with sqlite3.connect(store.path) as connection:
        assert (
            connection.execute(
                "SELECT COUNT(*) FROM discussions WHERE id = 1"
            ).fetchone()[0]
            == 0
        )
        for table in discussion_tables:
            assert (
                connection.execute(
                    f"SELECT COUNT(*) FROM {table} WHERE discussion_id = 1"
                ).fetchone()[0]
                == 0
            )
        expected_kept_counts = {
            "discussion_members": 2,
            "messages": 1,
            "mentions": 1,
            "mention_references": 1,
            "discussion_activity_frontiers": 2,
            "message_recipients": 1,
            "message_read_receipts": 1,
            "message_mention_acknowledgements": 1,
        }
        for table, expected_count in expected_kept_counts.items():
            assert (
                connection.execute(
                    f"SELECT COUNT(*) FROM {table} WHERE discussion_id = 2"
                ).fetchone()[0]
                == expected_count
            )
        assert (
            connection.execute(
                "SELECT COUNT(*) FROM organization_audit_events"
            ).fetchone()[0]
            == 2
        )
