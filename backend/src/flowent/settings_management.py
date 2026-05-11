from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from typing import Final

from flowent.settings import (
    AssistantSettings,
    EventLogSettings,
    LeaderSettings,
    ModelSettings,
    Settings,
    build_assistant_allow_network,
    build_assistant_write_dirs,
    build_default_model_params,
    build_model_auto_compact_token_limit,
    build_model_context_window_tokens,
    build_model_input_image,
    build_model_max_retries,
    build_model_output_image,
    build_model_params_from_mapping,
    build_model_retry_backoff_cap_retries,
    build_model_retry_initial_delay_seconds,
    build_model_retry_max_delay_seconds,
    build_model_retry_policy,
    build_model_structured_output,
    build_model_timeout_ms,
    build_working_dir,
    find_role,
    serialize_settings,
    validate_model_retry_backoff_settings,
)

MISSING: Final = object()


@dataclass(frozen=True, slots=True)
class ResolvedSettingsUpdate:
    working_dir: str
    assistant: AssistantSettings
    leader: LeaderSettings
    model: ModelSettings
    event_log: EventLogSettings


@dataclass(frozen=True, slots=True)
class SettingsUpdateFieldNames:
    assistant_role: str = "assistant.role_name"
    assistant_allow_network: str = "assistant.allow_network"
    assistant_write_dirs: str = "assistant.write_dirs"
    leader_role: str = "leader.role_name"
    working_dir: str = "working_dir"
    retry_policy: str = "model.retry_policy"
    timeout_ms: str = "model.timeout_ms"
    max_retries: str = "model.max_retries"
    retry_initial_delay_seconds: str = "model.retry_initial_delay_seconds"
    retry_max_delay_seconds: str = "model.retry_max_delay_seconds"
    retry_backoff_cap_retries: str = "model.retry_backoff_cap_retries"
    input_image: str = "model.input_image"
    output_image: str = "model.output_image"
    structured_output: str = "model.structured_output"
    context_window_tokens: str = "model.context_window_tokens"
    auto_compact_token_limit: str = "model.auto_compact_token_limit"


def serialize_manage_settings(settings: Settings) -> dict[str, object]:
    serialized = serialize_settings(settings)
    return {
        "app_data_dir": serialized["app_data_dir"],
        "working_dir": serialized["working_dir"],
        "assistant": serialized["assistant"],
        "leader": serialized["leader"],
        "model": serialized["model"],
        "event_log": serialized["event_log"],
    }


def _resolve_role_name(
    settings: Settings,
    *,
    current_role_name: str,
    next_role_name: str | None,
    field_name: str,
) -> str:
    if next_role_name is None:
        return current_role_name
    normalized_role_name = next_role_name.strip()
    if not normalized_role_name:
        raise ValueError(f"{field_name} must not be empty")
    if find_role(settings, normalized_role_name) is None:
        raise ValueError(f"Role '{normalized_role_name}' not found")
    return normalized_role_name


def _resolve_value[T](
    current_value: T,
    raw_value: object,
    builder: Callable[..., T],
    *,
    field_name: str,
) -> T:
    if raw_value is MISSING:
        return current_value
    return builder(raw_value, field_name=field_name)


def _resolve_assistant_settings(
    settings: Settings,
    *,
    next_working_dir: str,
    assistant_role_name: str | None,
    assistant_allow_network: object,
    assistant_write_dirs: object,
    field_names: SettingsUpdateFieldNames,
) -> AssistantSettings:
    return AssistantSettings(
        role_name=_resolve_role_name(
            settings,
            current_role_name=settings.assistant.role_name,
            next_role_name=assistant_role_name,
            field_name=field_names.assistant_role,
        ),
        allow_network=_resolve_value(
            settings.assistant.allow_network,
            assistant_allow_network,
            build_assistant_allow_network,
            field_name=field_names.assistant_allow_network,
        ),
        write_dirs=(
            list(settings.assistant.write_dirs)
            if assistant_write_dirs is MISSING
            else build_assistant_write_dirs(
                assistant_write_dirs,
                field_name=field_names.assistant_write_dirs,
                base_dir=next_working_dir,
            )
        ),
    )


def _resolve_leader_settings(
    settings: Settings,
    *,
    leader_role_name: str | None,
    field_names: SettingsUpdateFieldNames,
) -> LeaderSettings:
    return LeaderSettings(
        role_name=_resolve_role_name(
            settings,
            current_role_name=settings.leader.role_name,
            next_role_name=leader_role_name,
            field_name=field_names.leader_role,
        )
    )


def _resolve_model_params(settings: Settings, model_params: object):
    if model_params is MISSING:
        return settings.model.params
    return build_model_params_from_mapping(model_params) or build_default_model_params()


def _resolve_model_settings(
    settings: Settings,
    *,
    active_provider_id: str | None,
    active_model: str | None,
    context_window_tokens: object,
    input_image: object,
    output_image: object,
    structured_output: object,
    max_retries: object,
    retry_policy: object,
    timeout_ms: object,
    retry_initial_delay_seconds: object,
    retry_max_delay_seconds: object,
    retry_backoff_cap_retries: object,
    auto_compact_token_limit: object,
    model_params: object,
    field_names: SettingsUpdateFieldNames,
) -> ModelSettings:
    retry_initial_delay = _resolve_value(
        settings.model.retry_initial_delay_seconds,
        retry_initial_delay_seconds,
        build_model_retry_initial_delay_seconds,
        field_name=field_names.retry_initial_delay_seconds,
    )
    retry_max_delay = _resolve_value(
        settings.model.retry_max_delay_seconds,
        retry_max_delay_seconds,
        build_model_retry_max_delay_seconds,
        field_name=field_names.retry_max_delay_seconds,
    )
    validate_model_retry_backoff_settings(
        retry_initial_delay_seconds=retry_initial_delay,
        retry_max_delay_seconds=retry_max_delay,
    )

    return ModelSettings(
        active_provider_id=(
            settings.model.active_provider_id
            if active_provider_id is None
            else active_provider_id
        ),
        active_model=(
            settings.model.active_model if active_model is None else active_model
        ),
        input_image=_resolve_value(
            settings.model.input_image,
            input_image,
            build_model_input_image,
            field_name=field_names.input_image,
        ),
        output_image=_resolve_value(
            settings.model.output_image,
            output_image,
            build_model_output_image,
            field_name=field_names.output_image,
        ),
        structured_output=_resolve_value(
            settings.model.structured_output,
            structured_output,
            build_model_structured_output,
            field_name=field_names.structured_output,
        ),
        context_window_tokens=_resolve_value(
            settings.model.context_window_tokens,
            context_window_tokens,
            build_model_context_window_tokens,
            field_name=field_names.context_window_tokens,
        ),
        params=_resolve_model_params(settings, model_params),
        timeout_ms=_resolve_value(
            settings.model.timeout_ms,
            timeout_ms,
            build_model_timeout_ms,
            field_name=field_names.timeout_ms,
        ),
        retry_policy=_resolve_value(
            settings.model.retry_policy,
            retry_policy,
            build_model_retry_policy,
            field_name=field_names.retry_policy,
        ),
        max_retries=_resolve_value(
            settings.model.max_retries,
            max_retries,
            build_model_max_retries,
            field_name=field_names.max_retries,
        ),
        retry_initial_delay_seconds=retry_initial_delay,
        retry_max_delay_seconds=retry_max_delay,
        retry_backoff_cap_retries=_resolve_value(
            settings.model.retry_backoff_cap_retries,
            retry_backoff_cap_retries,
            build_model_retry_backoff_cap_retries,
            field_name=field_names.retry_backoff_cap_retries,
        ),
        auto_compact_token_limit=_resolve_value(
            settings.model.auto_compact_token_limit,
            auto_compact_token_limit,
            build_model_auto_compact_token_limit,
            field_name=field_names.auto_compact_token_limit,
        ),
    )


def _resolve_event_log_settings(
    settings: Settings,
    *,
    timestamp_format: str | None,
) -> EventLogSettings:
    return EventLogSettings(
        timestamp_format=(
            settings.event_log.timestamp_format
            if timestamp_format is None
            else timestamp_format
        )
    )


def resolve_settings_update(
    settings: Settings,
    *,
    working_dir: str | None = None,
    assistant_role_name: str | None = None,
    assistant_allow_network: object = MISSING,
    assistant_write_dirs: object = MISSING,
    leader_role_name: str | None = None,
    active_provider_id: str | None = None,
    active_model: str | None = None,
    context_window_tokens: object = MISSING,
    input_image: object = MISSING,
    output_image: object = MISSING,
    structured_output: object = MISSING,
    max_retries: object = MISSING,
    retry_policy: object = MISSING,
    timeout_ms: object = MISSING,
    retry_initial_delay_seconds: object = MISSING,
    retry_max_delay_seconds: object = MISSING,
    retry_backoff_cap_retries: object = MISSING,
    auto_compact_token_limit: object = MISSING,
    model_params: object = MISSING,
    timestamp_format: str | None = None,
    assistant_role_field_name: str = "assistant.role_name",
    assistant_allow_network_field_name: str = "assistant.allow_network",
    assistant_write_dirs_field_name: str = "assistant.write_dirs",
    leader_role_field_name: str = "leader.role_name",
    working_dir_field_name: str = "working_dir",
    retry_policy_field_name: str = "model.retry_policy",
    timeout_ms_field_name: str = "model.timeout_ms",
    max_retries_field_name: str = "model.max_retries",
    retry_initial_delay_seconds_field_name: str = "model.retry_initial_delay_seconds",
    retry_max_delay_seconds_field_name: str = "model.retry_max_delay_seconds",
    retry_backoff_cap_retries_field_name: str = "model.retry_backoff_cap_retries",
    input_image_field_name: str = "model.input_image",
    output_image_field_name: str = "model.output_image",
    structured_output_field_name: str = "model.structured_output",
    context_window_tokens_field_name: str = "model.context_window_tokens",
    auto_compact_token_limit_field_name: str = "model.auto_compact_token_limit",
) -> ResolvedSettingsUpdate:
    field_names = SettingsUpdateFieldNames(
        assistant_role=assistant_role_field_name,
        assistant_allow_network=assistant_allow_network_field_name,
        assistant_write_dirs=assistant_write_dirs_field_name,
        leader_role=leader_role_field_name,
        working_dir=working_dir_field_name,
        retry_policy=retry_policy_field_name,
        timeout_ms=timeout_ms_field_name,
        max_retries=max_retries_field_name,
        retry_initial_delay_seconds=retry_initial_delay_seconds_field_name,
        retry_max_delay_seconds=retry_max_delay_seconds_field_name,
        retry_backoff_cap_retries=retry_backoff_cap_retries_field_name,
        input_image=input_image_field_name,
        output_image=output_image_field_name,
        structured_output=structured_output_field_name,
        context_window_tokens=context_window_tokens_field_name,
        auto_compact_token_limit=auto_compact_token_limit_field_name,
    )
    next_working_dir = (
        settings.working_dir
        if working_dir is None
        else build_working_dir(working_dir, field_name=field_names.working_dir)
    )

    return ResolvedSettingsUpdate(
        working_dir=next_working_dir,
        assistant=_resolve_assistant_settings(
            settings,
            next_working_dir=next_working_dir,
            assistant_role_name=assistant_role_name,
            assistant_allow_network=assistant_allow_network,
            assistant_write_dirs=assistant_write_dirs,
            field_names=field_names,
        ),
        leader=_resolve_leader_settings(
            settings,
            leader_role_name=leader_role_name,
            field_names=field_names,
        ),
        model=_resolve_model_settings(
            settings,
            active_provider_id=active_provider_id,
            active_model=active_model,
            context_window_tokens=context_window_tokens,
            input_image=input_image,
            output_image=output_image,
            structured_output=structured_output,
            max_retries=max_retries,
            retry_policy=retry_policy,
            timeout_ms=timeout_ms,
            retry_initial_delay_seconds=retry_initial_delay_seconds,
            retry_max_delay_seconds=retry_max_delay_seconds,
            retry_backoff_cap_retries=retry_backoff_cap_retries,
            auto_compact_token_limit=auto_compact_token_limit,
            model_params=model_params,
            field_names=field_names,
        ),
        event_log=_resolve_event_log_settings(
            settings,
            timestamp_format=timestamp_format,
        ),
    )


def apply_resolved_settings_update(
    settings: Settings,
    resolved: ResolvedSettingsUpdate,
) -> None:
    settings.working_dir = resolved.working_dir
    settings.assistant = resolved.assistant
    settings.leader = resolved.leader
    settings.model = resolved.model
    settings.event_log = resolved.event_log
