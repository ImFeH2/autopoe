from __future__ import annotations

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
    next_working_dir = (
        settings.working_dir
        if working_dir is None
        else build_working_dir(working_dir, field_name=working_dir_field_name)
    )
    next_assistant_role_name = _resolve_role_name(
        settings,
        current_role_name=settings.assistant.role_name,
        next_role_name=assistant_role_name,
        field_name=assistant_role_field_name,
    )
    next_assistant_allow_network = (
        settings.assistant.allow_network
        if assistant_allow_network is MISSING
        else build_assistant_allow_network(
            assistant_allow_network,
            field_name=assistant_allow_network_field_name,
        )
    )
    next_assistant_write_dirs = (
        list(settings.assistant.write_dirs)
        if assistant_write_dirs is MISSING
        else build_assistant_write_dirs(
            assistant_write_dirs,
            field_name=assistant_write_dirs_field_name,
            base_dir=next_working_dir,
        )
    )

    next_leader_role_name = _resolve_role_name(
        settings,
        current_role_name=settings.leader.role_name,
        next_role_name=leader_role_name,
        field_name=leader_role_field_name,
    )

    next_active_provider_id = (
        settings.model.active_provider_id
        if active_provider_id is None
        else active_provider_id
    )
    next_active_model = (
        settings.model.active_model if active_model is None else active_model
    )
    next_context_window_tokens = (
        settings.model.context_window_tokens
        if context_window_tokens is MISSING
        else build_model_context_window_tokens(
            context_window_tokens,
            field_name=context_window_tokens_field_name,
        )
    )
    next_input_image = (
        settings.model.input_image
        if input_image is MISSING
        else build_model_input_image(
            input_image,
            field_name=input_image_field_name,
        )
    )
    next_output_image = (
        settings.model.output_image
        if output_image is MISSING
        else build_model_output_image(
            output_image,
            field_name=output_image_field_name,
        )
    )
    next_structured_output = (
        settings.model.structured_output
        if structured_output is MISSING
        else build_model_structured_output(
            structured_output,
            field_name=structured_output_field_name,
        )
    )
    next_retry_policy = (
        settings.model.retry_policy
        if retry_policy is MISSING
        else build_model_retry_policy(
            retry_policy,
            field_name=retry_policy_field_name,
        )
    )
    next_timeout_ms = (
        settings.model.timeout_ms
        if timeout_ms is MISSING
        else build_model_timeout_ms(
            timeout_ms,
            field_name=timeout_ms_field_name,
        )
    )
    next_max_retries = (
        settings.model.max_retries
        if max_retries is MISSING
        else build_model_max_retries(
            max_retries,
            field_name=max_retries_field_name,
        )
    )
    next_retry_initial_delay_seconds = (
        settings.model.retry_initial_delay_seconds
        if retry_initial_delay_seconds is MISSING
        else build_model_retry_initial_delay_seconds(
            retry_initial_delay_seconds,
            field_name=retry_initial_delay_seconds_field_name,
        )
    )
    next_retry_max_delay_seconds = (
        settings.model.retry_max_delay_seconds
        if retry_max_delay_seconds is MISSING
        else build_model_retry_max_delay_seconds(
            retry_max_delay_seconds,
            field_name=retry_max_delay_seconds_field_name,
        )
    )
    next_retry_backoff_cap_retries = (
        settings.model.retry_backoff_cap_retries
        if retry_backoff_cap_retries is MISSING
        else build_model_retry_backoff_cap_retries(
            retry_backoff_cap_retries,
            field_name=retry_backoff_cap_retries_field_name,
        )
    )
    next_auto_compact_token_limit = (
        settings.model.auto_compact_token_limit
        if auto_compact_token_limit is MISSING
        else build_model_auto_compact_token_limit(
            auto_compact_token_limit,
            field_name=auto_compact_token_limit_field_name,
        )
    )
    validate_model_retry_backoff_settings(
        retry_initial_delay_seconds=next_retry_initial_delay_seconds,
        retry_max_delay_seconds=next_retry_max_delay_seconds,
    )
    next_model_params = (
        settings.model.params
        if model_params is MISSING
        else build_model_params_from_mapping(model_params)
        or build_default_model_params()
    )
    next_timestamp_format = (
        settings.event_log.timestamp_format
        if timestamp_format is None
        else timestamp_format
    )

    return ResolvedSettingsUpdate(
        working_dir=next_working_dir,
        assistant=AssistantSettings(
            role_name=next_assistant_role_name,
            allow_network=next_assistant_allow_network,
            write_dirs=next_assistant_write_dirs,
        ),
        leader=LeaderSettings(role_name=next_leader_role_name),
        model=ModelSettings(
            active_provider_id=next_active_provider_id,
            active_model=next_active_model,
            input_image=next_input_image,
            output_image=next_output_image,
            structured_output=next_structured_output,
            context_window_tokens=next_context_window_tokens,
            params=next_model_params,
            timeout_ms=next_timeout_ms,
            retry_policy=next_retry_policy,
            max_retries=next_max_retries,
            retry_initial_delay_seconds=next_retry_initial_delay_seconds,
            retry_max_delay_seconds=next_retry_max_delay_seconds,
            retry_backoff_cap_retries=next_retry_backoff_cap_retries,
            auto_compact_token_limit=next_auto_compact_token_limit,
        ),
        event_log=EventLogSettings(timestamp_format=next_timestamp_format),
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
