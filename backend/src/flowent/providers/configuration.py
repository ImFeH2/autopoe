from __future__ import annotations

from collections.abc import Iterable
from typing import Protocol

from flowent.models import ModelInfo
from flowent.providers.base_url import resolve_provider_base_url
from flowent.settings import (
    PROVIDER_MODEL_SOURCE_OPTIONS,
    ProviderConfig,
    ProviderModelCatalogEntry,
    build_model_context_window_tokens,
    build_model_input_image,
    build_model_output_image,
    build_model_structured_output,
    build_provider_headers,
    build_provider_retry_429_delay_seconds,
    serialize_provider_model_catalog_entry,
)
from flowent.settings import (
    serialize_provider as serialize_full_provider,
)


class ProviderModelCatalogPayload(Protocol):
    model: str
    source: str
    context_window_tokens: int | None
    input_image: bool | None
    output_image: bool | None
    structured_output: bool | None


def validate_provider_base_url_input(
    provider_type: str,
    base_url: str,
    *,
    required_message: str = "base_url is required",
) -> str:
    raw_base_url = base_url.strip()
    if not raw_base_url:
        raise ValueError(required_message)
    resolve_provider_base_url(provider_type, raw_base_url)
    return raw_base_url


def build_provider_model_catalog_entry(
    payload: ProviderModelCatalogPayload,
    *,
    field_name_prefix: str = "models[]",
) -> ProviderModelCatalogEntry:
    model = payload.model.strip()
    if not model:
        raise ValueError(f"{field_name_prefix}.model must not be empty")

    source = payload.source.strip().lower()
    if source not in PROVIDER_MODEL_SOURCE_OPTIONS:
        raise ValueError(
            f"{field_name_prefix}.source must be one of: discovered, manual"
        )

    return ProviderModelCatalogEntry(
        model=model,
        source=source,
        context_window_tokens=build_model_context_window_tokens(
            payload.context_window_tokens,
            field_name=f"{field_name_prefix}.context_window_tokens",
        ),
        input_image=build_model_input_image(
            payload.input_image,
            field_name=f"{field_name_prefix}.input_image",
        ),
        output_image=build_model_output_image(
            payload.output_image,
            field_name=f"{field_name_prefix}.output_image",
        ),
        structured_output=build_model_structured_output(
            payload.structured_output,
            field_name=f"{field_name_prefix}.structured_output",
        ),
    )


def coerce_provider_model_catalog(
    payloads: Iterable[ProviderModelCatalogPayload] | None,
    *,
    field_name_prefix: str = "models[]",
) -> list[ProviderModelCatalogEntry]:
    entries: list[ProviderModelCatalogEntry] = []
    seen_models: set[str] = set()
    for payload in payloads or ():
        entry = build_provider_model_catalog_entry(
            payload,
            field_name_prefix=field_name_prefix,
        )
        if entry.model in seen_models:
            raise ValueError(f"{field_name_prefix}.model '{entry.model}' is duplicated")
        seen_models.add(entry.model)
        entries.append(entry)
    return entries


def build_provider_config(
    *,
    provider_id: str,
    name: str,
    provider_type: str,
    base_url: str,
    api_key: str = "",
    raw_headers: object = None,
    raw_retry_429_delay_seconds: object = 0,
    models: list[ProviderModelCatalogEntry] | None = None,
    base_url_required_message: str = "base_url is required",
) -> ProviderConfig:
    return ProviderConfig(
        id=provider_id,
        name=name,
        type=provider_type,
        base_url=validate_provider_base_url_input(
            provider_type,
            base_url,
            required_message=base_url_required_message,
        ),
        api_key=api_key,
        headers=build_provider_headers(raw_headers),
        retry_429_delay_seconds=build_provider_retry_429_delay_seconds(
            raw_retry_429_delay_seconds
        ),
        models=list(models or []),
    )


def apply_provider_update(
    provider: ProviderConfig,
    *,
    name: str | None = None,
    provider_type: str | None = None,
    base_url: str | None = None,
    api_key: str | None = None,
    raw_headers: object | None = None,
    raw_retry_429_delay_seconds: object | None = None,
    models: list[ProviderModelCatalogEntry] | None = None,
) -> ProviderConfig:
    next_type = provider_type if provider_type is not None else provider.type
    next_base_url = base_url.strip() if base_url is not None else provider.base_url
    raw_base_url = validate_provider_base_url_input(next_type, next_base_url)

    if name is not None:
        provider.name = name
    if provider_type is not None:
        provider.type = provider_type
    if base_url is not None or provider_type is not None:
        provider.base_url = raw_base_url
    if api_key is not None:
        provider.api_key = api_key
    if raw_headers is not None:
        provider.headers = build_provider_headers(raw_headers)
    if raw_retry_429_delay_seconds is not None:
        provider.retry_429_delay_seconds = build_provider_retry_429_delay_seconds(
            raw_retry_429_delay_seconds
        )
    if models is not None:
        provider.models = list(models)

    return provider


def serialize_provider(
    provider: ProviderConfig,
    *,
    include_api_key: bool = True,
) -> dict[str, object]:
    data = serialize_full_provider(provider)
    if not include_api_key:
        data.pop("api_key", None)
    return data


def serialize_discovered_model_catalog_entry(model: ModelInfo) -> dict[str, object]:
    return serialize_provider_model_catalog_entry(
        ProviderModelCatalogEntry(
            model=model.id,
            source="discovered",
            context_window_tokens=model.context_window_tokens,
            input_image=model.capabilities.input_image,
            output_image=model.capabilities.output_image,
            structured_output=model.capabilities.structured_output,
        )
    )
