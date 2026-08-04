from __future__ import annotations

from collections.abc import Awaitable, Callable

from pydantic_ai.models import Model

from flowent.models.domain import ModelError, ModelSelection
from flowent.providers import ProviderError, ProviderStore, build_model

ProviderSecret = Callable[[str], Awaitable[str | None]]


async def resolve_model(
    selection: ModelSelection,
    providers: ProviderStore,
    provider_secret: ProviderSecret,
) -> Model:
    try:
        provider = await providers.get(selection.provider_id)
        api_key = await provider_secret(provider.id) or ""
        return build_model(provider, api_key, selection.model_id)
    except ProviderError as error:
        raise ModelError(str(error)) from error
