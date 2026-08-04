from __future__ import annotations

from abc import ABC, abstractmethod
from collections.abc import Iterable
from typing import TYPE_CHECKING, Any

import httpx

if TYPE_CHECKING:
    from pydantic_ai.models import Model

from flowent.providers.domain import (
    Provider,
    ProviderError,
    ProviderModel,
    ProviderType,
)


class ProviderAdapter(ABC):
    @abstractmethod
    async def fetch_models(
        self,
        provider: Provider,
        api_key: str,
        client: httpx.AsyncClient,
    ) -> list[ProviderModel]: ...

    @abstractmethod
    def build_model(
        self,
        provider: Provider,
        api_key: str,
        model_id: str,
    ) -> Model: ...


class OpenAIAdapter(ProviderAdapter):
    def __init__(self, responses: bool):
        self.responses = responses

    async def fetch_models(
        self,
        provider: Provider,
        api_key: str,
        client: httpx.AsyncClient,
    ) -> list[ProviderModel]:
        if self.responses:
            _require_key(api_key)
        headers = {"Authorization": f"Bearer {api_key}"} if api_key else {}
        payload = await _get_json(client, f"{provider.base_url}/models", headers)
        data = payload.get("data")
        if not isinstance(data, list):
            raise ProviderError("provider returned an invalid model list")
        return _models(
            ProviderModel(item["id"], item["id"])
            for item in data
            if isinstance(item, dict) and isinstance(item.get("id"), str)
        )

    def build_model(
        self,
        provider: Provider,
        api_key: str,
        model_id: str,
    ) -> Model:
        from pydantic_ai.models.openai import OpenAIChatModel, OpenAIResponsesModel
        from pydantic_ai.providers.openai import OpenAIProvider

        if self.responses:
            _require_key(api_key)
        key = api_key or "api-key-not-set"
        model_provider = OpenAIProvider(base_url=provider.base_url, api_key=key)
        if self.responses:
            return OpenAIResponsesModel(model_id, provider=model_provider)
        return OpenAIChatModel(model_id, provider=model_provider)


class AnthropicAdapter(ProviderAdapter):
    async def fetch_models(
        self,
        provider: Provider,
        api_key: str,
        client: httpx.AsyncClient,
    ) -> list[ProviderModel]:
        _require_key(api_key)
        headers = {
            "anthropic-version": "2023-06-01",
            "x-api-key": api_key,
        }
        models: list[ProviderModel] = []
        cursor: str | None = None
        while True:
            params: dict[str, str | int] = {"limit": 1000}
            if cursor:
                params["after_id"] = cursor
            payload = await _get_json(
                client,
                f"{provider.base_url}/v1/models",
                headers,
                params,
            )
            data = payload.get("data")
            if not isinstance(data, list):
                raise ProviderError("provider returned an invalid model list")
            models.extend(
                ProviderModel(item["id"], item.get("display_name") or item["id"])
                for item in data
                if isinstance(item, dict) and isinstance(item.get("id"), str)
            )
            if payload.get("has_more") is not True:
                return _models(models)
            next_cursor = payload.get("last_id")
            if not isinstance(next_cursor, str) or next_cursor == cursor:
                raise ProviderError("provider returned invalid pagination")
            cursor = next_cursor

    def build_model(
        self,
        provider: Provider,
        api_key: str,
        model_id: str,
    ) -> Model:
        from pydantic_ai.models.anthropic import AnthropicModel
        from pydantic_ai.providers.anthropic import AnthropicProvider

        _require_key(api_key)
        return AnthropicModel(
            model_id,
            provider=AnthropicProvider(
                api_key=api_key,
                base_url=provider.base_url,
            ),
        )


class GoogleAdapter(ProviderAdapter):
    async def fetch_models(
        self,
        provider: Provider,
        api_key: str,
        client: httpx.AsyncClient,
    ) -> list[ProviderModel]:
        _require_key(api_key)
        headers = {"x-goog-api-key": api_key}
        models: list[ProviderModel] = []
        page_token: str | None = None
        while True:
            params: dict[str, str | int] = {"pageSize": 1000}
            if page_token:
                params["pageToken"] = page_token
            payload = await _get_json(
                client,
                f"{provider.base_url}/v1beta/models",
                headers,
                params,
            )
            data = payload.get("models")
            if not isinstance(data, list):
                raise ProviderError("provider returned an invalid model list")
            for item in data:
                if not isinstance(item, dict):
                    continue
                methods = item.get("supportedGenerationMethods")
                model_id = item.get("baseModelId")
                if (
                    isinstance(methods, list)
                    and "generateContent" in methods
                    and isinstance(model_id, str)
                ):
                    name = item.get("displayName")
                    models.append(
                        ProviderModel(
                            model_id,
                            name if isinstance(name, str) else model_id,
                        )
                    )
            next_page = payload.get("nextPageToken")
            if not next_page:
                return _models(models)
            if not isinstance(next_page, str) or next_page == page_token:
                raise ProviderError("provider returned invalid pagination")
            page_token = next_page

    def build_model(
        self,
        provider: Provider,
        api_key: str,
        model_id: str,
    ) -> Model:
        from pydantic_ai.models.google import GoogleModel
        from pydantic_ai.providers.google import GoogleProvider

        _require_key(api_key)
        return GoogleModel(
            model_id,
            provider=GoogleProvider(
                api_key=api_key,
                base_url=provider.base_url,
            ),
        )


ADAPTERS: dict[ProviderType, ProviderAdapter] = {
    ProviderType.OPENAI: OpenAIAdapter(responses=True),
    ProviderType.OPENAI_COMPATIBLE: OpenAIAdapter(responses=False),
    ProviderType.ANTHROPIC: AnthropicAdapter(),
    ProviderType.GOOGLE: GoogleAdapter(),
}


async def fetch_models(
    provider: Provider,
    api_key: str,
    client: httpx.AsyncClient | None = None,
) -> list[ProviderModel]:
    adapter = ADAPTERS[provider.type]
    if client:
        return await adapter.fetch_models(provider, api_key, client)
    async with httpx.AsyncClient(timeout=30, follow_redirects=True) as http_client:
        return await adapter.fetch_models(provider, api_key, http_client)


def build_model(provider: Provider, api_key: str, model_id: str) -> Model:
    model_id = model_id.strip()
    if not model_id:
        raise ProviderError("model is required")
    return ADAPTERS[provider.type].build_model(provider, api_key, model_id)


async def _get_json(
    client: httpx.AsyncClient,
    url: str,
    headers: dict[str, str],
    params: dict[str, str | int] | None = None,
) -> dict[str, Any]:
    try:
        response = await client.get(url, headers=headers, params=params)
        response.raise_for_status()
        payload = response.json()
    except httpx.HTTPStatusError as error:
        raise ProviderError(
            f"provider returned HTTP {error.response.status_code}"
        ) from error
    except (httpx.HTTPError, ValueError) as error:
        raise ProviderError("could not read provider models") from error
    if not isinstance(payload, dict):
        raise ProviderError("provider returned an invalid response")
    return payload


def _models(models: Iterable[ProviderModel]) -> list[ProviderModel]:
    unique = {model.id: model for model in models}
    return sorted(unique.values(), key=lambda model: model.name.casefold())


def _require_key(api_key: str) -> None:
    if not api_key:
        raise ProviderError("API key is required")
