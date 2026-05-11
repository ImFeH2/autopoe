from __future__ import annotations

import time
from copy import deepcopy
from dataclasses import dataclass

from fastapi import APIRouter, HTTPException
from loguru import logger
from pydantic import BaseModel, ConfigDict

from flowent.access import initialize_live_access_signature, set_access_code
from flowent.events import event_bus
from flowent.settings import (
    TelegramApprovedChat,
    TelegramSettings,
    get_settings,
    save_settings,
    serialize_provider,
    serialize_role,
    serialize_settings,
    serialize_telegram_settings,
)
from flowent.settings_management import (
    MISSING,
    apply_resolved_settings_update,
    resolve_settings_update,
)

router = APIRouter()


@router.get("/api/settings/bootstrap")
async def get_settings_bootstrap() -> dict[str, object]:
    from flowent._version import __version__

    settings = get_settings()
    return {
        "settings": serialize_settings(settings),
        "providers": [serialize_provider(provider) for provider in settings.providers],
        "roles": [serialize_role(role) for role in settings.roles],
        "version": __version__,
    }


@router.get("/api/settings")
async def get_settings_api() -> dict[str, object]:
    settings = get_settings()
    return serialize_settings(settings)


class UpdateSettingsRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    access: dict[str, object] | None = None
    assistant: dict[str, object] | None = None
    event_log: dict[str, object] | None = None
    leader: dict[str, object] | None = None
    model: dict[str, object] | None = None
    working_dir: str | None = None


class UpdateTelegramSettingsRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    bot_token: str | None = None


@dataclass(frozen=True, slots=True)
class AssistantSettingsPatch:
    role_name: str | None = None
    allow_network: object = MISSING
    write_dirs: object = MISSING


@dataclass(frozen=True, slots=True)
class ModelSettingsPatch:
    active_provider_id: str | None = None
    active_model: str | None = None
    context_window_tokens: object = MISSING
    input_image: object = MISSING
    output_image: object = MISSING
    structured_output: object = MISSING
    timeout_ms: object = MISSING
    retry_policy: object = MISSING
    max_retries: object = MISSING
    retry_initial_delay_seconds: object = MISSING
    retry_max_delay_seconds: object = MISSING
    retry_backoff_cap_retries: object = MISSING
    auto_compact_token_limit: object = MISSING
    params: object = MISSING


def _extract_access_code_rotation(access: dict[str, object] | None) -> str | None:
    if access is None:
        return None

    raw_new_code = access.get("new_code", "")
    raw_confirm_code = access.get("confirm_code", "")
    if raw_new_code is not None and not isinstance(raw_new_code, str):
        raise HTTPException(status_code=400, detail="access.new_code must be a string")
    if raw_confirm_code is not None and not isinstance(raw_confirm_code, str):
        raise HTTPException(
            status_code=400,
            detail="access.confirm_code must be a string",
        )

    new_code = raw_new_code if isinstance(raw_new_code, str) else ""
    confirm_code = raw_confirm_code if isinstance(raw_confirm_code, str) else ""
    if not new_code and not confirm_code:
        return None
    if not new_code.strip():
        raise HTTPException(
            status_code=400,
            detail="access.new_code must not be empty",
        )
    if confirm_code != new_code:
        raise HTTPException(
            status_code=400,
            detail="access.confirm_code must match access.new_code",
        )
    return new_code


def _extract_assistant_settings_patch(
    assistant: dict[str, object] | None,
) -> AssistantSettingsPatch:
    if assistant is None:
        return AssistantSettingsPatch()

    unknown_fields = sorted(
        set(assistant) - {"role_name", "allow_network", "write_dirs"}
    )
    if unknown_fields:
        raise HTTPException(
            status_code=400,
            detail="Unknown assistant fields: " + ", ".join(unknown_fields),
        )

    raw_role_name = assistant.get("role_name")
    return AssistantSettingsPatch(
        role_name=(
            raw_role_name
            if isinstance(raw_role_name, str) and raw_role_name.strip()
            else None
        ),
        allow_network=(
            assistant.get("allow_network") if "allow_network" in assistant else MISSING
        ),
        write_dirs=assistant.get("write_dirs")
        if "write_dirs" in assistant
        else MISSING,
    )


def _extract_role_name(payload: dict[str, object] | None) -> str | None:
    if payload is None:
        return None
    raw_role_name = payload.get("role_name")
    if isinstance(raw_role_name, str) and raw_role_name.strip():
        return raw_role_name
    return None


def _extract_timestamp_format(payload: dict[str, object] | None) -> str | None:
    if payload is None:
        return None
    raw_timestamp_format = payload.get("timestamp_format")
    return raw_timestamp_format if isinstance(raw_timestamp_format, str) else None


def _extract_model_settings_patch(
    model: dict[str, object] | None,
) -> ModelSettingsPatch:
    if model is None:
        return ModelSettingsPatch()

    raw_active_provider_id = model.get("active_provider_id")
    raw_active_model = model.get("active_model")
    return ModelSettingsPatch(
        active_provider_id=(
            raw_active_provider_id if isinstance(raw_active_provider_id, str) else None
        ),
        active_model=raw_active_model if isinstance(raw_active_model, str) else None,
        context_window_tokens=(
            model.get("context_window_tokens")
            if "context_window_tokens" in model
            else MISSING
        ),
        input_image=model.get("input_image") if "input_image" in model else MISSING,
        output_image=model.get("output_image") if "output_image" in model else MISSING,
        structured_output=(
            model.get("structured_output") if "structured_output" in model else MISSING
        ),
        timeout_ms=model.get("timeout_ms") if "timeout_ms" in model else MISSING,
        retry_policy=model.get("retry_policy") if "retry_policy" in model else MISSING,
        max_retries=model.get("max_retries") if "max_retries" in model else MISSING,
        retry_initial_delay_seconds=(
            model.get("retry_initial_delay_seconds")
            if "retry_initial_delay_seconds" in model
            else MISSING
        ),
        retry_max_delay_seconds=(
            model.get("retry_max_delay_seconds")
            if "retry_max_delay_seconds" in model
            else MISSING
        ),
        retry_backoff_cap_retries=(
            model.get("retry_backoff_cap_retries")
            if "retry_backoff_cap_retries" in model
            else MISSING
        ),
        auto_compact_token_limit=(
            model.get("auto_compact_token_limit")
            if "auto_compact_token_limit" in model
            else MISSING
        ),
        params=model.get("params") if "params" in model else MISSING,
    )


@router.post("/api/settings")
async def update_settings(req: UpdateSettingsRequest) -> dict[str, object]:
    from flowent.graph_service import sync_assistant_role, sync_tab_leaders
    from flowent.providers.gateway import gateway

    source_settings = get_settings()
    current = deepcopy(source_settings)
    next_access_code = _extract_access_code_rotation(req.access)
    reauth_required = False
    assistant_patch = _extract_assistant_settings_patch(req.assistant)
    leader_role_name = _extract_role_name(req.leader)
    timestamp_format = _extract_timestamp_format(req.event_log)
    model_patch = _extract_model_settings_patch(req.model)

    try:
        resolved = resolve_settings_update(
            current,
            working_dir=req.working_dir,
            assistant_role_name=assistant_patch.role_name,
            assistant_allow_network=assistant_patch.allow_network,
            assistant_write_dirs=assistant_patch.write_dirs,
            leader_role_name=leader_role_name,
            active_provider_id=model_patch.active_provider_id,
            active_model=model_patch.active_model,
            context_window_tokens=model_patch.context_window_tokens,
            input_image=model_patch.input_image,
            output_image=model_patch.output_image,
            structured_output=model_patch.structured_output,
            max_retries=model_patch.max_retries,
            retry_policy=model_patch.retry_policy,
            timeout_ms=model_patch.timeout_ms,
            retry_initial_delay_seconds=model_patch.retry_initial_delay_seconds,
            retry_max_delay_seconds=model_patch.retry_max_delay_seconds,
            retry_backoff_cap_retries=model_patch.retry_backoff_cap_retries,
            auto_compact_token_limit=model_patch.auto_compact_token_limit,
            model_params=model_patch.params,
            timestamp_format=timestamp_format,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    apply_resolved_settings_update(current, resolved)

    if next_access_code is not None:
        set_access_code(current, next_access_code)
        reauth_required = True

    save_settings(current)
    source_settings.__dict__.clear()
    source_settings.__dict__.update(deepcopy(current).__dict__)
    initialize_live_access_signature()
    try:
        sync_assistant_role(reason="assistant settings updated")
        sync_tab_leaders(reason="leader settings updated")
        gateway.invalidate_cache()
    except Exception:
        logger.exception("Settings saved but runtime synchronization failed")
    if reauth_required:
        event_bus.close_all_connections(code=4001, reason="Access code rotated")
    logger.info("Settings updated")
    return {
        "status": "saved",
        "settings": serialize_settings(current),
        "reauth_required": reauth_required,
    }


@router.get("/api/settings/telegram")
async def get_telegram_settings() -> dict[str, object]:
    settings = get_settings()
    return serialize_telegram_settings(settings.telegram)


@router.patch("/api/settings/telegram")
async def update_telegram_settings(
    req: UpdateTelegramSettingsRequest,
) -> dict[str, object]:
    from flowent.runtime import restart_telegram_channel

    settings = get_settings()
    previous_token = settings.telegram.bot_token

    next_token = previous_token
    if req.bot_token is not None:
        next_token = req.bot_token.strip()

    settings.telegram = TelegramSettings(
        bot_token=next_token,
        pending_chats=list(settings.telegram.pending_chats),
        approved_chats=list(settings.telegram.approved_chats),
    )
    save_settings(settings)

    if next_token != previous_token:
        restart_telegram_channel()

    logger.info("Telegram settings updated")
    return {
        "status": "saved",
        "telegram": serialize_telegram_settings(settings.telegram),
    }


@router.post("/api/settings/telegram/approve/{chat_id}")
async def approve_telegram_chat(chat_id: int) -> dict[str, object]:
    settings = get_settings()
    pending_chat = next(
        (chat for chat in settings.telegram.pending_chats if chat.chat_id == chat_id),
        None,
    )
    if pending_chat is None:
        raise HTTPException(status_code=404, detail="Pending Telegram chat not found")

    settings.telegram.pending_chats = [
        chat for chat in settings.telegram.pending_chats if chat.chat_id != chat_id
    ]
    if not any(chat.chat_id == chat_id for chat in settings.telegram.approved_chats):
        settings.telegram.approved_chats.append(
            TelegramApprovedChat(
                chat_id=pending_chat.chat_id,
                username=pending_chat.username,
                display_name=pending_chat.display_name,
                approved_at=time.time(),
            )
        )
    save_settings(settings)
    logger.info("Telegram chat approved: {}", chat_id)
    return {
        "status": "approved",
        "telegram": serialize_telegram_settings(settings.telegram),
    }


@router.delete("/api/settings/telegram/pending/{chat_id}")
async def delete_pending_telegram_chat(chat_id: int) -> dict[str, object]:
    settings = get_settings()
    settings.telegram.pending_chats = [
        chat for chat in settings.telegram.pending_chats if chat.chat_id != chat_id
    ]
    save_settings(settings)
    logger.info("Pending Telegram chat removed: {}", chat_id)
    return {
        "status": "deleted",
        "telegram": serialize_telegram_settings(settings.telegram),
    }


@router.delete("/api/settings/telegram/chat/{chat_id}")
async def delete_telegram_chat(chat_id: int) -> dict[str, object]:
    settings = get_settings()
    settings.telegram.approved_chats = [
        existing_chat
        for existing_chat in settings.telegram.approved_chats
        if existing_chat.chat_id != chat_id
    ]
    save_settings(settings)
    logger.info("Telegram chat removed: {}", chat_id)
    return {
        "status": "deleted",
        "telegram": serialize_telegram_settings(settings.telegram),
    }
