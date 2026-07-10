import asyncio
from pathlib import Path

from fastapi.testclient import TestClient

from flowent.channels import TelegramBotManager
from flowent.main import create_app
from flowent.storage import StateStore, StoredTelegramBot


def provider_payload(*, api_key: str = "connection-primary") -> dict[str, object]:
    return {
        "api_key": api_key,
        "base_url": "https://api.example.test/v1",
        "id": "provider-openai",
        "models": ["gpt-5.1"],
        "name": "OpenAI",
        "type": "openai",
    }


def test_provider_responses_report_saved_secret_without_returning_it(
    tmp_path, monkeypatch
) -> None:
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path))
    client = TestClient(create_app(serve_frontend=False))

    saved_response = client.post("/api/providers", json=provider_payload())
    state_response = client.get("/api/state")

    assert saved_response.status_code == 200
    assert saved_response.json() == {
        "base_url": "https://api.example.test/v1",
        "has_api_key": True,
        "id": "provider-openai",
        "models": ["gpt-5.1"],
        "name": "OpenAI",
        "type": "openai",
    }
    assert state_response.status_code == 200
    assert state_response.json()["providers"] == [saved_response.json()]
    assert (
        StateStore(tmp_path).read_state().providers[0].api_key == "connection-primary"
    )


def test_provider_save_preserves_or_replaces_existing_secret(
    tmp_path, monkeypatch
) -> None:
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path))
    client = TestClient(create_app(serve_frontend=False))
    client.post("/api/providers", json=provider_payload())

    preserved_response = client.post(
        "/api/providers",
        json={
            key: value
            for key, value in {
                **provider_payload(api_key=""),
                "name": "Primary connection",
            }.items()
            if key != "api_key"
        },
    )

    assert preserved_response.status_code == 200
    assert preserved_response.json()["has_api_key"] is True
    assert (
        StateStore(tmp_path).read_state().providers[0].api_key == "connection-primary"
    )

    replaced_response = client.post(
        "/api/providers",
        json=provider_payload(api_key="connection-replacement"),
    )

    assert replaced_response.status_code == 200
    assert replaced_response.json()["has_api_key"] is True
    assert StateStore(tmp_path).read_state().providers[0].api_key == (
        "connection-replacement"
    )


def test_provider_model_fetch_uses_saved_secret_unless_a_new_one_is_supplied(
    tmp_path, monkeypatch
) -> None:
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path))
    captured_secrets: list[str] = []

    def list_models(**kwargs: object) -> list[str]:
        captured_secrets.append(str(kwargs["secret_reference"]))
        return ["gpt-5.1"]

    monkeypatch.setattr("flowent.routes.providers.list_provider_models", list_models)
    client = TestClient(create_app(serve_frontend=False))
    client.post("/api/providers", json=provider_payload())

    saved_secret_response = client.post(
        "/api/providers/models",
        json={
            "base_url": "https://api.example.test/v1",
            "provider": "openai",
            "provider_id": "provider-openai",
            "secret_reference": "",
        },
    )
    replacement_secret_response = client.post(
        "/api/providers/models",
        json={
            "base_url": "https://api.example.test/v1",
            "provider": "openai",
            "provider_id": "provider-openai",
            "secret_reference": "connection-draft",
        },
    )

    assert saved_secret_response.status_code == 200
    assert replacement_secret_response.status_code == 200
    assert captured_secrets == ["connection-primary", "connection-draft"]


def test_telegram_responses_preserve_saved_secret_without_returning_it(
    tmp_path, monkeypatch
) -> None:
    monkeypatch.setenv("FLOWENT_DATA_DIR", str(tmp_path))
    client = TestClient(create_app(serve_frontend=False))

    saved_response = client.put(
        "/api/telegram-bot",
        json={"bot_token": "telegram-primary", "enabled": False},
    )
    preserved_response = client.put(
        "/api/telegram-bot",
        json={"enabled": False},
    )
    state_response = client.get("/api/state")

    expected_public_bot = {
        "enabled": False,
        "error": "",
        "has_bot_token": True,
        "sessions": [],
        "status": "disabled",
    }
    assert saved_response.status_code == 200
    assert saved_response.json() == expected_public_bot
    assert preserved_response.status_code == 200
    assert preserved_response.json() == expected_public_bot
    assert state_response.status_code == 200
    assert state_response.json()["telegram_bot"] == expected_public_bot
    assert StateStore(tmp_path).read_telegram_bot().bot_token == "telegram-primary"

    replaced_response = client.put(
        "/api/telegram-bot",
        json={"bot_token": "telegram-replacement", "enabled": False},
    )

    assert replaced_response.status_code == 200
    assert replaced_response.json() == expected_public_bot
    assert StateStore(tmp_path).read_telegram_bot().bot_token == (
        "telegram-replacement"
    )


def test_running_telegram_bot_restarts_with_replacement_secret(
    tmp_path, monkeypatch
) -> None:
    started_secrets: list[str] = []
    wait_forever = asyncio.Event()

    async def run_bot(bot: StoredTelegramBot) -> None:
        started_secrets.append(bot.bot_token)
        await wait_forever.wait()

    async def exercise() -> None:
        manager = TelegramBotManager(
            message_handler=lambda _: asyncio.sleep(0, result="reply"),
            store=StateStore(tmp_path),
        )
        monkeypatch.setattr(manager, "_run_bot", run_bot)
        await manager.sync_bot(
            StoredTelegramBot(bot_token="telegram-primary", enabled=True)
        )
        await asyncio.sleep(0)
        first_task = manager.runtime.task

        await manager.sync_bot(
            StoredTelegramBot(bot_token="telegram-replacement", enabled=True)
        )
        await asyncio.sleep(0)

        assert first_task is not None
        assert first_task.cancelled()
        assert started_secrets == ["telegram-primary", "telegram-replacement"]
        await manager.stop_all()

    asyncio.run(exercise())


def test_concurrent_telegram_sync_keeps_the_last_requested_secret(
    tmp_path, monkeypatch
) -> None:
    first_stop_started = asyncio.Event()
    release_first_stop = asyncio.Event()
    release_later_stops = asyncio.Event()
    stop_bots = asyncio.Event()
    stop_calls = 0

    async def run_bot(_: StoredTelegramBot) -> None:
        await stop_bots.wait()

    async def controlled_stop() -> None:
        nonlocal stop_calls
        stop_calls += 1
        if stop_calls == 1:
            first_stop_started.set()
            await release_first_stop.wait()
            return
        await release_later_stops.wait()

    async def exercise() -> None:
        manager = TelegramBotManager(
            message_handler=lambda _: asyncio.sleep(0, result="reply"),
            store=StateStore(tmp_path),
        )
        monkeypatch.setattr(manager, "_run_bot", run_bot)
        await manager.sync_bot(StoredTelegramBot(bot_token="old", enabled=True))
        await asyncio.sleep(0)
        monkeypatch.setattr(manager, "_stop_runtime_task", controlled_stop)

        first_sync = asyncio.create_task(
            manager.sync_bot(StoredTelegramBot(bot_token="first", enabled=True))
        )
        await first_stop_started.wait()
        release_later_stops.set()
        last_sync = asyncio.create_task(
            manager.sync_bot(StoredTelegramBot(bot_token="last", enabled=True))
        )
        await asyncio.sleep(0)
        release_first_stop.set()
        await asyncio.gather(first_sync, last_sync)

        assert manager.runtime.bot_token == "last"
        stop_bots.set()
        await asyncio.sleep(0)

    asyncio.run(exercise())


def test_compose_ports_default_to_loopback() -> None:
    repository_root = Path(__file__).resolve().parents[4]
    production_compose = (repository_root / "docker-compose.yml").read_text()
    development_compose = (repository_root / "docker-compose.dev.yml").read_text()

    assert "FLOWENT_HOST: 0.0.0.0" in production_compose
    assert '- "127.0.0.1:${FLOWENT_PORT:-6873}:6873"' in production_compose
    assert '- "127.0.0.1:${FLOWENT_DEV_PORT:-6873}:6873"' in development_compose
