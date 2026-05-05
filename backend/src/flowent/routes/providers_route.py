from __future__ import annotations

import time

from fastapi import APIRouter, HTTPException
from loguru import logger
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool

from flowent.models import ModelInfo
from flowent.network import truncate_text
from flowent.providers.configuration import (
    build_provider_config,
    coerce_provider_model_catalog,
    serialize_discovered_model_catalog_entry,
    serialize_provider,
)
from flowent.providers.management import (
    ProviderNotFoundError,
    create_provider_entry,
    delete_provider_entry,
    list_provider_payloads,
    update_provider_entry,
)
from flowent.providers.registry import create_provider as create_llm_provider
from flowent.settings import (
    ProviderConfig,
    find_provider,
    get_settings,
    save_settings,
)

router = APIRouter()


class ProviderModelRequest(BaseModel):
    model: str
    source: str = "manual"
    context_window_tokens: int | None = None
    input_image: bool | None = None
    output_image: bool | None = None
    structured_output: bool | None = None


class CreateProviderRequest(BaseModel):
    name: str
    type: str
    base_url: str
    api_key: str = ""
    headers: dict[str, object] | None = None
    retry_429_delay_seconds: int = 0
    models: list[ProviderModelRequest] = Field(default_factory=list)


class UpdateProviderRequest(BaseModel):
    name: str | None = None
    type: str | None = None
    base_url: str | None = None
    api_key: str | None = None
    headers: dict[str, object] | None = None
    retry_429_delay_seconds: int | None = None
    models: list[ProviderModelRequest] | None = None


class ProviderDraftRequest(BaseModel):
    provider_id: str | None = None
    name: str | None = None
    type: str | None = None
    base_url: str | None = None
    api_key: str | None = None
    headers: dict[str, object] | None = None


class ListModelsRequest(ProviderDraftRequest):
    pass


class ProviderModelTestRequest(ProviderDraftRequest):
    model: str


def _has_draft_provider_fields(req: ProviderDraftRequest) -> bool:
    return any(
        value is not None
        for value in (
            req.name,
            req.type,
            req.base_url,
            req.api_key,
            req.headers,
        )
    )


def _resolve_provider_from_request(req: ProviderDraftRequest) -> ProviderConfig:
    settings = get_settings()
    saved_provider = (
        find_provider(settings, req.provider_id)
        if req.provider_id is not None
        else None
    )
    if (
        req.provider_id is not None
        and saved_provider is None
        and not _has_draft_provider_fields(req)
    ):
        raise HTTPException(status_code=404, detail="Provider not found")

    provider_type = (
        req.type.strip()
        if isinstance(req.type, str) and req.type.strip()
        else saved_provider.type
        if saved_provider is not None
        else ""
    )
    if not provider_type:
        raise HTTPException(status_code=400, detail="provider type is required")

    base_url = (
        req.base_url.strip()
        if isinstance(req.base_url, str) and req.base_url.strip()
        else saved_provider.base_url
        if saved_provider is not None
        else ""
    )
    if not base_url:
        raise HTTPException(status_code=400, detail="provider base_url is required")

    try:
        return build_provider_config(
            provider_id=(
                saved_provider.id
                if saved_provider is not None
                else req.provider_id or ""
            ),
            name=(
                req.name
                if isinstance(req.name, str)
                else saved_provider.name
                if saved_provider is not None
                else ""
            ),
            provider_type=provider_type,
            base_url=base_url,
            api_key=(
                req.api_key
                if isinstance(req.api_key, str)
                else saved_provider.api_key
                if saved_provider is not None
                else ""
            ),
            raw_headers=(
                req.headers
                if req.headers is not None
                else saved_provider.headers
                if saved_provider is not None
                else {}
            ),
            raw_retry_429_delay_seconds=(
                saved_provider.retry_429_delay_seconds
                if saved_provider is not None
                else 0
            ),
            models=list(saved_provider.models) if saved_provider is not None else [],
            base_url_required_message="provider base_url is required",
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


def _list_models_with_provider(provider: ProviderConfig) -> list[ModelInfo]:
    llm_provider = create_llm_provider(
        provider_type=provider.type,
        base_url=provider.base_url,
        api_key=provider.api_key,
        headers=provider.headers,
        model="",
        provider_name=provider.name,
        request_timeout_seconds=120.0,
    )
    return llm_provider.list_models()


def _summarize_provider_error(error: Exception) -> str:
    detail = str(error).strip()
    if not detail:
        return "Provider test failed"

    for line in detail.splitlines():
        stripped = line.strip()
        if stripped.startswith("Detail:"):
            normalized = stripped.removeprefix("Detail:").strip()
            if normalized:
                return truncate_text(normalized, limit=240)

    first_line = next(
        (line.strip() for line in detail.splitlines() if line.strip()), ""
    )
    if not first_line or first_line.lower().startswith("traceback"):
        return "Provider returned an unexpected error response"
    return truncate_text(first_line, limit=240)


def _test_provider_model(provider: ProviderConfig, model: str) -> dict[str, object]:
    settings = get_settings()
    llm_provider = create_llm_provider(
        provider_type=provider.type,
        base_url=provider.base_url,
        api_key=provider.api_key,
        headers=provider.headers,
        model=model,
        provider_name=provider.name,
        request_timeout_seconds=max(settings.model.timeout_ms / 1000, 1.0),
    )
    started_at = time.perf_counter()
    llm_provider.chat(
        [{"role": "user", "content": "Reply with OK."}],
    )
    ended_at = time.perf_counter()
    return {
        "ok": True,
        "duration_ms": int((ended_at - started_at) * 1000),
    }


@router.get("/api/providers")
async def list_providers() -> dict[str, object]:
    settings = get_settings()
    return {"providers": list_provider_payloads(settings)}


@router.post("/api/providers")
async def create_provider(req: CreateProviderRequest) -> dict[str, object]:
    from flowent.providers.gateway import gateway

    settings = get_settings()
    try:
        provider = create_provider_entry(
            settings,
            name=req.name,
            provider_type=req.type,
            base_url=req.base_url,
            api_key=req.api_key,
            raw_headers=req.headers,
            raw_retry_429_delay_seconds=req.retry_429_delay_seconds,
            models=coerce_provider_model_catalog(req.models),
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    save_settings(settings)
    gateway.invalidate_cache()
    return serialize_provider(provider)


@router.put("/api/providers/{provider_id}")
async def update_provider(
    provider_id: str, req: UpdateProviderRequest
) -> dict[str, object]:
    from flowent.providers.gateway import gateway

    settings = get_settings()
    try:
        provider = update_provider_entry(
            settings,
            provider_id,
            name=req.name,
            provider_type=req.type,
            base_url=req.base_url,
            api_key=req.api_key,
            raw_headers=req.headers,
            raw_retry_429_delay_seconds=req.retry_429_delay_seconds,
            models=(
                coerce_provider_model_catalog(req.models)
                if req.models is not None
                else None
            ),
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except ProviderNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Provider not found") from exc
    save_settings(settings)
    gateway.invalidate_cache()
    return serialize_provider(provider)


@router.delete("/api/providers/{provider_id}")
async def delete_provider(provider_id: str) -> dict[str, object]:
    from flowent.providers.gateway import gateway

    settings = get_settings()
    try:
        delete_provider_entry(settings, provider_id)
    except ProviderNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Provider not found") from exc
    save_settings(settings)
    gateway.invalidate_cache()
    return {"status": "deleted"}


@router.post("/api/providers/models")
async def list_provider_models(req: ListModelsRequest) -> dict[str, object]:
    from flowent.providers.gateway import gateway

    if req.provider_id is not None and not _has_draft_provider_fields(req):
        try:
            models = await run_in_threadpool(gateway.list_models_for, req.provider_id)
            return {
                "models": [
                    serialize_discovered_model_catalog_entry(model) for model in models
                ]
            }
        except Exception as exc:
            logger.error(
                "Failed to list models for provider '{}': {}",
                req.provider_id,
                exc,
            )
            raise HTTPException(
                status_code=500,
                detail=_summarize_provider_error(exc),
            ) from exc

    provider = _resolve_provider_from_request(req)

    try:
        models = await run_in_threadpool(_list_models_with_provider, provider)
        return {
            "models": [
                serialize_discovered_model_catalog_entry(model) for model in models
            ]
        }
    except Exception as exc:
        logger.error(
            "Failed to list models for provider '{}': {}",
            provider.id or provider.name or provider.base_url,
            exc,
        )
        raise HTTPException(
            status_code=500, detail=_summarize_provider_error(exc)
        ) from exc


@router.post("/api/providers/models/test")
async def run_provider_model_test_route(
    req: ProviderModelTestRequest,
) -> dict[str, object]:
    model = req.model.strip()
    if not model:
        raise HTTPException(status_code=400, detail="model is required")

    provider = _resolve_provider_from_request(req)
    try:
        return await run_in_threadpool(_test_provider_model, provider, model)
    except Exception as exc:
        logger.error(
            "Failed to test model '{}' for provider '{}': {}",
            model,
            provider.id or provider.name or provider.base_url,
            exc,
        )
        return {
            "ok": False,
            "error_summary": _summarize_provider_error(exc),
        }
