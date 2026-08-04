from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from pathlib import Path

import httpx
import pytest

from flowent.providers import (
    Provider,
    ProviderError,
    ProviderModel,
    ProviderStore,
    ProviderType,
    build_model,
    fetch_models,
)


def test_provider_store_persists_metadata(tmp_path: Path) -> None:
    async def run() -> None:
        store = ProviderStore(tmp_path)
        await store.initialize()
        provider = await store.save(
            None,
            "OpenAI",
            "openai",
            "https://api.openai.com/v1/",
        )

        assert provider.base_url == "https://api.openai.com/v1"
        restored = ProviderStore(tmp_path)
        assert await restored.list() == [provider]
        assert await restored.get(provider.id) == provider

        updated = await store.save(
            provider.id,
            "OpenAI Production",
            "openai",
            provider.base_url,
        )
        assert updated.id == provider.id
        assert updated.name == "OpenAI Production"

        await store.delete(provider.id)
        assert await store.list() == []

    asyncio.run(run())


def test_provider_store_validates_input(tmp_path: Path) -> None:
    async def run() -> None:
        store = ProviderStore(tmp_path)
        await store.initialize()
        with pytest.raises(ProviderError, match="unsupported provider type"):
            await store.save(None, "Provider", "unknown", "https://example.com")
        with pytest.raises(ProviderError, match="HTTP or HTTPS"):
            await store.save(None, "Provider", "openai", "file:///tmp/api")

    asyncio.run(run())


def test_openai_protocol_lists_models() -> None:
    async def handler(request: httpx.Request) -> httpx.Response:
        assert request.url == "https://api.example.com/v1/models"
        assert request.headers["Authorization"] == "Bearer secret"
        return httpx.Response(
            200,
            json={"data": [{"id": "gpt-b"}, {"id": "gpt-a"}]},
        )

    models = _fetch(
        Provider(
            "openai",
            "OpenAI",
            ProviderType.OPENAI,
            "https://api.example.com/v1",
        ),
        "secret",
        handler,
    )

    assert [model.id for model in models] == ["gpt-a", "gpt-b"]


def test_openai_compatible_protocol_allows_an_empty_key() -> None:
    async def handler(request: httpx.Request) -> httpx.Response:
        assert request.url == "http://localhost:11434/v1/models"
        assert "Authorization" not in request.headers
        return httpx.Response(200, json={"data": [{"id": "local-model"}]})

    models = _fetch(
        Provider(
            "local",
            "Local",
            ProviderType.OPENAI_COMPATIBLE,
            "http://localhost:11434/v1",
        ),
        "",
        handler,
    )

    assert [model.id for model in models] == ["local-model"]


def test_anthropic_protocol_paginates_models() -> None:
    calls = 0

    async def handler(request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        assert request.headers["x-api-key"] == "secret"
        assert request.headers["anthropic-version"] == "2023-06-01"
        if calls == 1:
            assert "after_id" not in request.url.params
            return httpx.Response(
                200,
                json={
                    "data": [{"id": "claude-b", "display_name": "Claude B"}],
                    "has_more": True,
                    "last_id": "claude-b",
                },
            )
        assert request.url.params["after_id"] == "claude-b"
        return httpx.Response(
            200,
            json={
                "data": [{"id": "claude-a", "display_name": "Claude A"}],
                "has_more": False,
            },
        )

    models = _fetch(
        Provider(
            "anthropic",
            "Anthropic",
            ProviderType.ANTHROPIC,
            "https://api.anthropic.com",
        ),
        "secret",
        handler,
    )

    assert [model.id for model in models] == ["claude-a", "claude-b"]


def test_google_protocol_filters_and_paginates_models() -> None:
    calls = 0

    async def handler(request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        assert request.headers["x-goog-api-key"] == "secret"
        if calls == 1:
            assert "pageToken" not in request.url.params
            return httpx.Response(
                200,
                json={
                    "models": [
                        {
                            "baseModelId": "gemini-b",
                            "displayName": "Gemini B",
                            "supportedGenerationMethods": ["generateContent"],
                        },
                        {
                            "baseModelId": "embedding",
                            "displayName": "Embedding",
                            "supportedGenerationMethods": ["embedContent"],
                        },
                    ],
                    "nextPageToken": "next",
                },
            )
        assert request.url.params["pageToken"] == "next"
        return httpx.Response(
            200,
            json={
                "models": [
                    {
                        "baseModelId": "gemini-a",
                        "displayName": "Gemini A",
                        "supportedGenerationMethods": ["generateContent"],
                    }
                ]
            },
        )

    models = _fetch(
        Provider(
            "google",
            "Google",
            ProviderType.GOOGLE,
            "https://generativelanguage.googleapis.com",
        ),
        "secret",
        handler,
    )

    assert [model.id for model in models] == ["gemini-a", "gemini-b"]


@pytest.mark.parametrize(
    ("provider_type", "api_key", "expected_type"),
    [
        (ProviderType.OPENAI, "secret", "OpenAIResponsesModel"),
        (ProviderType.OPENAI_COMPATIBLE, "", "OpenAIChatModel"),
        (ProviderType.ANTHROPIC, "secret", "AnthropicModel"),
        (ProviderType.GOOGLE, "secret", "GoogleModel"),
    ],
)
def test_build_model_uses_the_selected_protocol(
    provider_type: ProviderType,
    api_key: str,
    expected_type: str,
) -> None:
    provider = Provider(
        "provider",
        "Provider",
        provider_type,
        "https://api.example.com/v1",
    )

    model = build_model(provider, api_key, "model")

    assert type(model).__name__ == expected_type


def _fetch(
    provider: Provider,
    api_key: str,
    handler: Callable[[httpx.Request], Awaitable[httpx.Response]],
) -> list[ProviderModel]:
    async def run() -> list[ProviderModel]:
        transport = httpx.MockTransport(handler)
        async with httpx.AsyncClient(transport=transport) as client:
            return await fetch_models(provider, api_key, client)

    return asyncio.run(run())
