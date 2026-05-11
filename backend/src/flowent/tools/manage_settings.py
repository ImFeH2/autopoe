from __future__ import annotations

import json
from collections.abc import Callable
from typing import TYPE_CHECKING, Any, ClassVar

if TYPE_CHECKING:
    from flowent.agent import Agent

from flowent.settings_management import (
    MISSING,
    apply_resolved_settings_update,
    resolve_settings_update,
    serialize_manage_settings,
)
from flowent.tools import Tool


def _error(message: str) -> str:
    return json.dumps({"error": message})


def _validate_optional_string(value: object, field_name: str) -> str | None:
    if value is not None and not isinstance(value, str):
        return f"{field_name} must be a string"
    return None


def _validate_manage_settings_args(args: dict[str, Any]) -> str | None:
    from flowent.settings import (
        build_model_auto_compact_token_limit,
        build_model_context_window_tokens,
        build_model_input_image,
        build_model_max_retries,
        build_model_output_image,
        build_model_retry_backoff_cap_retries,
        build_model_retry_initial_delay_seconds,
        build_model_retry_max_delay_seconds,
        build_model_retry_policy,
        build_model_structured_output,
        build_model_timeout_ms,
    )

    action = args.get("action")
    if not isinstance(action, str):
        return "action must be a string"

    for field_name in (
        "assistant_role_name",
        "working_dir",
        "leader_role_name",
        "active_provider_id",
        "active_model",
        "timestamp_format",
    ):
        error = _validate_optional_string(args.get(field_name), field_name)
        if error is not None:
            return error

    assistant_allow_network = args.get("assistant_allow_network")
    if assistant_allow_network is not None and not isinstance(
        assistant_allow_network, bool
    ):
        return "assistant_allow_network must be a boolean"

    assistant_write_dirs = args.get("assistant_write_dirs")
    if assistant_write_dirs is not None and not isinstance(assistant_write_dirs, list):
        return "assistant_write_dirs must be an array of strings"

    builders: tuple[tuple[str, Callable[..., object]], ...] = (
        ("retry_policy", build_model_retry_policy),
        ("timeout_ms", build_model_timeout_ms),
        ("max_retries", build_model_max_retries),
        ("retry_initial_delay_seconds", build_model_retry_initial_delay_seconds),
        ("retry_max_delay_seconds", build_model_retry_max_delay_seconds),
        ("retry_backoff_cap_retries", build_model_retry_backoff_cap_retries),
    )
    for field_name, builder in builders:
        if args.get(field_name) is None:
            continue
        try:
            builder(args.get(field_name), field_name=field_name)
        except ValueError as exc:
            return str(exc)

    optional_builders: tuple[tuple[str, Callable[..., object]], ...] = (
        ("input_image", build_model_input_image),
        ("output_image", build_model_output_image),
        ("structured_output", build_model_structured_output),
        ("context_window_tokens", build_model_context_window_tokens),
        ("auto_compact_token_limit", build_model_auto_compact_token_limit),
    )
    for field_name, builder in optional_builders:
        if field_name not in args:
            continue
        try:
            builder(args.get(field_name), field_name=field_name)
        except ValueError as exc:
            return str(exc)

    model_params = args.get("model_params")
    if model_params is not None and not isinstance(model_params, (dict, type(None))):
        return "model_params must be an object or null"

    return None


def _provided(args: dict[str, Any], field_name: str) -> object:
    return args.get(field_name, MISSING)


class ManageSettingsTool(Tool):
    name = "manage_settings"
    description = (
        "Read and update system settings, including the Assistant role, Leader "
        "role, active provider and model, default model params, event log "
        "timestamp format, and other runtime defaults."
    )
    parameters: ClassVar[dict[str, Any]] = {
        "type": "object",
        "properties": {
            "action": {
                "type": "string",
                "enum": ["get", "update"],
                "description": "Settings action",
            },
            "active_provider_id": {
                "type": "string",
                "description": "Active provider ID for update",
            },
            "assistant_role_name": {
                "type": "string",
                "description": "Role name used by the Assistant",
            },
            "assistant_allow_network": {
                "type": "boolean",
                "description": "Whether the Assistant may use networked tools or paths",
            },
            "assistant_write_dirs": {
                "type": "array",
                "description": "Writable directory boundaries for the Assistant",
                "items": {"type": "string"},
            },
            "working_dir": {
                "type": "string",
                "description": "System working directory used as the default cwd and relative path base",
            },
            "leader_role_name": {
                "type": "string",
                "description": "Role name used by workflow Leaders",
            },
            "active_model": {
                "type": "string",
                "description": "Active model name for update",
            },
            "context_window_tokens": {
                "type": ["integer", "null"],
                "description": "Explicit context window override for the active system model",
            },
            "input_image": {
                "type": ["boolean", "null"],
                "description": "Explicit input_image override for the active system model",
            },
            "output_image": {
                "type": ["boolean", "null"],
                "description": "Explicit output_image override for the active system model",
            },
            "structured_output": {
                "type": ["boolean", "null"],
                "description": "Explicit structured_output override for the active system model",
            },
            "max_retries": {
                "type": "integer",
                "description": "Maximum retries for transient LLM call failures when retry_policy is limited",
            },
            "retry_initial_delay_seconds": {
                "type": "number",
                "description": "Initial exponential backoff delay in seconds",
            },
            "retry_max_delay_seconds": {
                "type": "number",
                "description": "Maximum exponential backoff delay in seconds",
            },
            "retry_backoff_cap_retries": {
                "type": "integer",
                "description": "Retry count where exponential growth stops doubling",
            },
            "auto_compact_token_limit": {
                "type": ["integer", "null"],
                "description": "Token-usage threshold where the runtime should auto compact before the next formal LLM call",
            },
            "retry_policy": {
                "type": "string",
                "enum": ["no_retry", "limited", "unlimited"],
                "description": "System-wide retry policy for transient LLM call failures",
            },
            "timeout_ms": {
                "type": "integer",
                "description": "Single LLM request timeout in milliseconds",
            },
            "model_params": {
                "type": ["object", "null"],
                "description": "Default canonical model parameter overrides",
                "properties": {
                    "reasoning_effort": {
                        "type": "string",
                        "enum": ["none", "low", "medium", "high", "xhigh"],
                    },
                    "verbosity": {
                        "type": "string",
                        "enum": ["low", "medium", "high"],
                    },
                    "max_output_tokens": {"type": "integer"},
                    "temperature": {"type": "number"},
                    "top_p": {"type": "number"},
                },
                "additionalProperties": False,
            },
            "timestamp_format": {
                "type": "string",
                "description": "Event log timestamp format for update",
            },
        },
        "required": ["action"],
    }

    def execute(self, agent: Agent, args: dict[str, Any], **_kwargs: Any) -> str:
        from flowent.graph_service import sync_assistant_role, sync_tab_leaders
        from flowent.providers.gateway import gateway
        from flowent.settings import get_settings, save_settings

        action = args.get("action")
        validation_error = _validate_manage_settings_args(args)
        if validation_error is not None:
            return _error(validation_error)

        settings = get_settings()

        if action == "get":
            return json.dumps(serialize_manage_settings(settings))

        if action != "update":
            return _error(f"Unsupported action: {action}")

        try:
            resolved = resolve_settings_update(
                settings,
                working_dir=args.get("working_dir"),
                assistant_role_name=args.get("assistant_role_name"),
                assistant_allow_network=(
                    args.get("assistant_allow_network")
                    if args.get("assistant_allow_network") is not None
                    else MISSING
                ),
                assistant_write_dirs=(
                    args.get("assistant_write_dirs")
                    if args.get("assistant_write_dirs") is not None
                    else MISSING
                ),
                leader_role_name=args.get("leader_role_name"),
                active_provider_id=args.get("active_provider_id"),
                active_model=args.get("active_model"),
                context_window_tokens=_provided(args, "context_window_tokens"),
                input_image=_provided(args, "input_image"),
                output_image=_provided(args, "output_image"),
                structured_output=_provided(args, "structured_output"),
                max_retries=(
                    args.get("max_retries")
                    if args.get("max_retries") is not None
                    else MISSING
                ),
                retry_policy=(
                    args.get("retry_policy")
                    if args.get("retry_policy") is not None
                    else MISSING
                ),
                timeout_ms=(
                    args.get("timeout_ms")
                    if args.get("timeout_ms") is not None
                    else MISSING
                ),
                retry_initial_delay_seconds=(
                    args.get("retry_initial_delay_seconds")
                    if args.get("retry_initial_delay_seconds") is not None
                    else MISSING
                ),
                retry_max_delay_seconds=(
                    args.get("retry_max_delay_seconds")
                    if args.get("retry_max_delay_seconds") is not None
                    else MISSING
                ),
                retry_backoff_cap_retries=(
                    args.get("retry_backoff_cap_retries")
                    if args.get("retry_backoff_cap_retries") is not None
                    else MISSING
                ),
                auto_compact_token_limit=_provided(args, "auto_compact_token_limit"),
                model_params=_provided(args, "model_params"),
                timestamp_format=args.get("timestamp_format"),
                assistant_role_field_name="assistant_role_name",
                assistant_allow_network_field_name="assistant_allow_network",
                assistant_write_dirs_field_name="assistant_write_dirs",
                leader_role_field_name="leader_role_name",
                working_dir_field_name="working_dir",
                retry_policy_field_name="retry_policy",
                timeout_ms_field_name="timeout_ms",
                max_retries_field_name="max_retries",
                retry_initial_delay_seconds_field_name="retry_initial_delay_seconds",
                retry_max_delay_seconds_field_name="retry_max_delay_seconds",
                retry_backoff_cap_retries_field_name="retry_backoff_cap_retries",
                input_image_field_name="input_image",
                output_image_field_name="output_image",
                structured_output_field_name="structured_output",
                context_window_tokens_field_name="context_window_tokens",
                auto_compact_token_limit_field_name="auto_compact_token_limit",
            )
        except ValueError as exc:
            return _error(str(exc))

        apply_resolved_settings_update(settings, resolved)

        save_settings(settings)
        sync_assistant_role(reason="assistant settings updated")
        sync_tab_leaders(reason="leader settings updated")
        gateway.invalidate_cache()
        return json.dumps(serialize_manage_settings(settings))
