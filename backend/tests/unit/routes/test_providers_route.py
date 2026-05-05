import asyncio

import pytest
from fastapi import HTTPException

from flowent.models import ModelInfo
from flowent.routes.providers_route import (
    CreateProviderRequest,
    ListModelsRequest,
    ProviderModelTestRequest,
    UpdateProviderRequest,
    create_provider,
    list_provider_models,
    run_provider_model_test_route,
    update_provider,
)
from flowent.settings import ProviderConfig, Settings


def test_create_provider_preserves_raw_base_url(monkeypatch):
    settings = Settings()
    saved: list[Settings] = []
    invalidations: list[str] = []

    monkeypatch.setattr("flowent.routes.providers_route.get_settings", lambda: settings)
    monkeypatch.setattr(
        "flowent.routes.providers_route.save_settings",
        lambda current: saved.append(current),
    )
    monkeypatch.setattr(
        "flowent.providers.gateway.gateway.invalidate_cache",
        lambda: invalidations.append("invalidate"),
    )

    result = asyncio.run(
        create_provider(
            CreateProviderRequest(
                name="Primary",
                type="openai_responses",
                base_url="https://api.openai.com",
                api_key="secret",
                headers={"Authorization": "Bearer override"},
            )
        )
    )

    assert result["base_url"] == "https://api.openai.com"
    assert result["headers"] == {"Authorization": "Bearer override"}
    assert result["retry_429_delay_seconds"] == 0
    assert settings.providers[0].base_url == "https://api.openai.com"
    assert settings.providers[0].headers == {"Authorization": "Bearer override"}
    assert settings.providers[0].retry_429_delay_seconds == 0
    assert saved == [settings]
    assert invalidations == ["invalidate"]


def test_create_provider_rejects_mismatched_base_url_suffix(monkeypatch):
    monkeypatch.setattr(
        "flowent.routes.providers_route.get_settings", lambda: Settings()
    )

    with pytest.raises(HTTPException) as exc:
        asyncio.run(
            create_provider(
                CreateProviderRequest(
                    name="Gemini",
                    type="gemini",
                    base_url="https://api.example.com/v1",
                    api_key="secret",
                )
            )
        )

    assert exc.value.status_code == 400
    assert exc.value.detail == (
        "Provider base_url suffix '/v1' does not match type 'gemini' "
        "(expected '/v1beta')"
    )


def test_update_provider_rejects_type_change_with_mismatched_existing_suffix(
    monkeypatch,
):
    settings = Settings(
        providers=[
            ProviderConfig(
                id="provider-1",
                name="Primary",
                type="openai_compatible",
                base_url="https://api.example.com/v1",
                api_key="secret",
            )
        ]
    )

    monkeypatch.setattr("flowent.routes.providers_route.get_settings", lambda: settings)

    with pytest.raises(HTTPException) as exc:
        asyncio.run(
            update_provider(
                "provider-1",
                UpdateProviderRequest(type="gemini"),
            )
        )

    assert exc.value.status_code == 400
    assert exc.value.detail == (
        "Provider base_url suffix '/v1' does not match type 'gemini' "
        "(expected '/v1beta')"
    )


def test_update_provider_persists_headers(monkeypatch):
    settings = Settings(
        providers=[
            ProviderConfig(
                id="provider-1",
                name="Primary",
                type="openai_compatible",
                base_url="https://api.example.com/v1",
                api_key="secret",
                headers={"X-Old": "value"},
            )
        ]
    )
    saved: list[Settings] = []
    invalidations: list[str] = []

    monkeypatch.setattr("flowent.routes.providers_route.get_settings", lambda: settings)
    monkeypatch.setattr(
        "flowent.routes.providers_route.save_settings",
        lambda current: saved.append(current),
    )
    monkeypatch.setattr(
        "flowent.providers.gateway.gateway.invalidate_cache",
        lambda: invalidations.append("invalidate"),
    )

    result = asyncio.run(
        update_provider(
            "provider-1",
            UpdateProviderRequest(
                headers={"X-New": "next"},
                retry_429_delay_seconds=4,
            ),
        )
    )

    assert result["headers"] == {"X-New": "next"}
    assert result["retry_429_delay_seconds"] == 4
    assert settings.providers[0].headers == {"X-New": "next"}
    assert settings.providers[0].retry_429_delay_seconds == 4
    assert saved == [settings]
    assert invalidations == ["invalidate"]


def test_create_provider_rejects_non_string_header_values(monkeypatch):
    monkeypatch.setattr(
        "flowent.routes.providers_route.get_settings", lambda: Settings()
    )

    with pytest.raises(HTTPException) as exc:
        asyncio.run(
            create_provider(
                CreateProviderRequest(
                    name="Primary",
                    type="openai_compatible",
                    base_url="https://api.example.com",
                    api_key="secret",
                    headers={"X-Test": 123},
                )
            )
        )

    assert exc.value.status_code == 400
    assert exc.value.detail == "headers must be a JSON object of string values"


def test_create_provider_rejects_negative_retry_429_delay(monkeypatch):
    monkeypatch.setattr(
        "flowent.routes.providers_route.get_settings", lambda: Settings()
    )

    with pytest.raises(HTTPException) as exc:
        asyncio.run(
            create_provider(
                CreateProviderRequest(
                    name="Primary",
                    type="openai_compatible",
                    base_url="https://api.example.com",
                    api_key="secret",
                    retry_429_delay_seconds=-1,
                )
            )
        )

    assert exc.value.status_code == 400
    assert (
        exc.value.detail == "retry_429_delay_seconds must be greater than or equal to 0"
    )


def test_list_provider_models_runs_gateway_in_threadpool(monkeypatch):
    calls: list[tuple[str, tuple[object, ...]]] = []

    def fake_list_models_for(provider_id: str) -> list[ModelInfo]:
        calls.append(("gateway", (provider_id,)))
        return [ModelInfo(id="gpt-5")]

    async def fake_run_in_threadpool(func, *args):
        calls.append(("threadpool", args))
        return func(*args)

    monkeypatch.setattr(
        "flowent.providers.gateway.gateway.list_models_for",
        fake_list_models_for,
    )
    monkeypatch.setattr(
        "flowent.routes.providers_route.run_in_threadpool",
        fake_run_in_threadpool,
    )

    result = asyncio.run(
        list_provider_models(
            ListModelsRequest(provider_id="provider-1"),
        )
    )

    assert result == {
        "models": [
            {
                "model": "gpt-5",
                "source": "discovered",
                "context_window_tokens": None,
                "input_image": False,
                "output_image": False,
                "structured_output": False,
            }
        ]
    }
    assert calls == [
        ("threadpool", ("provider-1",)),
        ("gateway", ("provider-1",)),
    ]


def test_test_provider_model_runs_against_provider_draft(monkeypatch):
    calls: list[tuple[str, object]] = []
    captured: dict[str, object] = {}

    class FakeProvider:
        def chat(
            self,
            messages,
            tools=None,
            on_chunk=None,
            register_interrupt=None,
            model_params=None,
        ):
            calls.append(("chat", messages))
            return object()

    async def fake_run_in_threadpool(func, *args):
        calls.append(("threadpool", args))
        return func(*args)

    monkeypatch.setattr(
        "flowent.routes.providers_route.create_llm_provider",
        lambda **kwargs: captured.update(kwargs) or FakeProvider(),
    )
    monkeypatch.setattr(
        "flowent.routes.providers_route.run_in_threadpool",
        fake_run_in_threadpool,
    )

    result = asyncio.run(
        run_provider_model_test_route(
            ProviderModelTestRequest(
                type="openai_compatible",
                base_url="https://api.example.com",
                model="gpt-5",
            )
        )
    )

    assert result["ok"] is True
    assert isinstance(result["duration_ms"], int)
    assert calls[0][0] == "threadpool"
    assert calls[1][0] == "chat"
    assert captured["base_url"] == "https://api.example.com"


def test_list_provider_models_from_draft_passes_raw_base_url_to_provider(
    monkeypatch,
):
    captured: dict[str, object] = {}

    class FakeProvider:
        def list_models(self, register_interrupt=None):
            return [ModelInfo(id="gpt-5")]

    async def fake_run_in_threadpool(func, *args):
        return func(*args)

    monkeypatch.setattr(
        "flowent.routes.providers_route.create_llm_provider",
        lambda **kwargs: captured.update(kwargs) or FakeProvider(),
    )
    monkeypatch.setattr(
        "flowent.routes.providers_route.run_in_threadpool",
        fake_run_in_threadpool,
    )

    result = asyncio.run(
        list_provider_models(
            ListModelsRequest(
                type="openai_compatible",
                base_url="https://api.example.com",
            )
        )
    )

    assert result == {
        "models": [
            {
                "model": "gpt-5",
                "source": "discovered",
                "context_window_tokens": None,
                "input_image": False,
                "output_image": False,
                "structured_output": False,
            }
        ]
    }
    assert captured["base_url"] == "https://api.example.com"


def test_test_provider_model_returns_normalized_error_summary(monkeypatch):
    class FakeProvider:
        def chat(
            self,
            messages,
            tools=None,
            on_chunk=None,
            register_interrupt=None,
            model_params=None,
        ):
            raise RuntimeError(
                "LLM API access blocked\nDetail: Challenge or interstitial HTML response from upstream"
            )

    monkeypatch.setattr(
        "flowent.routes.providers_route.create_llm_provider",
        lambda **kwargs: FakeProvider(),
    )

    result = asyncio.run(
        run_provider_model_test_route(
            ProviderModelTestRequest(
                type="openai_compatible",
                base_url="https://api.example.com",
                model="gpt-5",
            )
        )
    )

    assert result == {
        "ok": False,
        "error_summary": "Challenge or interstitial HTML response from upstream",
    }
