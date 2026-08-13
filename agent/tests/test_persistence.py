from __future__ import annotations

import stat
from pathlib import Path

from flowent.domain import OrganizationState
from flowent.model_runner import ModelRuntime
from flowent.persistence import DATA_DIRECTORY_ENV, SQLiteStore, data_directory


def persisted_state(store: SQLiteStore, working_directory: Path) -> OrganizationState:
    return OrganizationState(
        working_directory,
        persisted=store.load_organization(working_directory),
        on_persist=store.save_organization,
    )


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
    state.read_discussion(2, 1, [1])

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
    assert activation.items[0].message_ids == (1,)
    restored.complete_activation(2, "Stopped for test")
    assert restored.create_agent("Lin")["members"][-1]["id"] == 3
    assert restored.create_discussion("Next", 1, [3])["discussions"][-1]["id"] == 2


def test_keeps_launch_directories_isolated(tmp_path: Path) -> None:
    first_directory = tmp_path / "first"
    second_directory = tmp_path / "second"
    first_directory.mkdir()
    second_directory.mkdir()
    store = SQLiteStore(tmp_path / "data")

    persisted_state(store, first_directory).create_agent("Ada")
    second = persisted_state(store, second_directory)

    assert second.snapshot()["members"] == [{"id": 1, "type": "human", "name": "You"}]
    assert store.load_organization(first_directory) is not None
    assert store.load_organization(second_directory) is None


def test_persists_model_config_without_exposing_its_secret(tmp_path: Path) -> None:
    working_directory = tmp_path / "project"
    working_directory.mkdir()
    store = SQLiteStore(tmp_path / "data")
    runtime = ModelRuntime(
        deterministic=True,
        on_configure=lambda config: store.save_model_config(
            working_directory,
            config,
        ),
    )

    settings = runtime.configure(
        provider="anthropic",
        base_url="https://example.invalid",
        api_key="local-secret",
        model="test-model",
    )

    assert settings == {
        "provider": "anthropic",
        "base_url": "https://example.invalid",
        "model": "test-model",
        "has_api_key": True,
    }
    assert "local-secret" not in str(settings)
    assert store.load_model_config(working_directory) == {
        "provider": "anthropic",
        "base_url": "https://example.invalid",
        "api_key": "local-secret",
        "model": "test-model",
    }
    assert store.load_organization(working_directory) is None


def test_restricts_data_directory_and_database_permissions(tmp_path: Path) -> None:
    data = tmp_path / "data"
    store = SQLiteStore(data)

    assert stat.S_IMODE(data.stat().st_mode) == 0o700
    assert stat.S_IMODE(store.path.stat().st_mode) == 0o600
