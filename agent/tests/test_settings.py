import asyncio
import json
from pathlib import Path
from typing import Any, cast

from flowent_agent.persistence import RuntimeServices
from flowent_agent.protocol import Envelope
from flowent_agent.runtime import Runtime


async def test_runtime_stores_credentials_outside_sqlite(
    tmp_path: Path,
    monkeypatch: Any,
) -> None:
    credentials: dict[tuple[str, str], str] = {}

    def get_password(service: str, username: str) -> str | None:
        return credentials.get((service, username))

    def set_password(service: str, username: str, secret: str) -> None:
        credentials[(service, username)] = secret

    monkeypatch.setattr(
        "flowent_agent.persistence.settings.keyring.get_password",
        get_password,
    )
    monkeypatch.setattr(
        "flowent_agent.persistence.settings.keyring.set_password",
        set_password,
    )
    services = await RuntimeServices.create(tmp_path)
    runtime = Runtime()
    runtime.services = services
    response: dict[str, Any] = {}

    async def capture_response(
        _: Envelope,
        payload: dict[str, Any],
        name: str | None = None,
    ) -> None:
        response.update({"name": name, "payload": payload})

    monkeypatch.setattr(runtime, "respond", capture_response)
    await runtime.save_settings(
        Envelope(
            id="settings-1",
            kind="request",
            name="settings.save",
            payload={
                "model": {
                    "provider": "openai",
                    "model": "gpt-5.1",
                    "api_mode": "responses",
                    "credential_id": "default",
                },
                "runtime": {"default_workspace_mode": "worktree"},
                "api_key": "secret-value",
            },
        )
    )

    row = await (
        await services.database.connection.execute(
            "SELECT value_json FROM settings WHERE key = 'model.default'"
        )
    ).fetchone()
    serialized_response = json.dumps(response)
    assert row is not None
    assert "secret-value" not in row["value_json"]
    assert "secret-value" not in serialized_response
    assert credentials[("im.feh2.flowent", "openai:default")] == "secret-value"
    assert response["payload"]["has_api_key"] is True
    await services.close()


async def test_credential_can_be_removed(
    tmp_path: Path,
    monkeypatch: Any,
) -> None:
    credentials = {("im.feh2.flowent", "openai:default"): "secret-value"}

    def get_password(service: str, username: str) -> str | None:
        return credentials.get((service, username))

    def delete_password(service: str, username: str) -> None:
        credentials.pop((service, username))

    monkeypatch.setattr(
        "flowent_agent.persistence.settings.keyring.get_password",
        get_password,
    )
    monkeypatch.setattr(
        "flowent_agent.persistence.settings.keyring.delete_password",
        delete_password,
    )
    services = await RuntimeServices.create(tmp_path)
    runtime = Runtime()
    runtime.services = services

    async def discard_response(
        _: Envelope,
        payload: dict[str, Any],
        name: str | None = None,
    ) -> None:
        return None

    monkeypatch.setattr(runtime, "respond", discard_response)
    await runtime.save_settings(
        Envelope(
            id="settings-2",
            kind="request",
            name="settings.save",
            payload={
                "model": {
                    "provider": "openai",
                    "model": "gpt-5.1",
                    "api_mode": "responses",
                    "credential_id": "default",
                },
                "clear_api_key": True,
            },
        )
    )

    assert credentials == {}
    await services.close()


async def test_chat_run_uses_the_default_model(
    tmp_path: Path, monkeypatch: Any
) -> None:
    services = await RuntimeServices.create(tmp_path)
    await services.settings.set(
        "model.default",
        {
            "provider": "openai",
            "model": "gpt-5.1",
            "api_mode": "responses",
            "credential_id": "default",
        },
    )
    runtime = Runtime()
    runtime.services = services
    runtime.initialized = True
    captured: dict[str, Any] = {}

    class Runner:
        async def run(self, request: Any, emit: Any) -> None:
            captured["request"] = request

    async def discard_response(
        _: Envelope,
        payload: dict[str, Any],
        name: str | None = None,
    ) -> None:
        return None

    runtime.agent_runner = cast(Any, Runner())
    monkeypatch.setattr(runtime, "respond", discard_response)
    await runtime.start_agent(
        Envelope(
            id="agent-1",
            kind="request",
            name="agent.run",
            payload={
                "run_id": "chat-1",
                "messages": [{"role": "user", "content": "Hello"}],
            },
        )
    )
    await asyncio.gather(*list(runtime.tasks.values()))

    request = captured["request"]
    assert request.agent.model.provider == "openai"
    assert request.agent.model.model == "gpt-5.1"
    assert request.agent.model.credential_id == "default"
    await services.close()
