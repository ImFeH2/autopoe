from __future__ import annotations

import json
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
            get_settings,
            save_settings,
        )

        action = args.get("action")
        assistant_role_name = args.get("assistant_role_name")
        assistant_allow_network = args.get("assistant_allow_network")
        assistant_write_dirs = args.get("assistant_write_dirs")
        working_dir = args.get("working_dir")
        leader_role_name = args.get("leader_role_name")
        active_provider_id = args.get("active_provider_id")
        active_model = args.get("active_model")
        timeout_ms = args.get("timeout_ms")
        retry_policy = args.get("retry_policy")
        max_retries = args.get("max_retries")
        retry_initial_delay_seconds = args.get("retry_initial_delay_seconds")
        retry_max_delay_seconds = args.get("retry_max_delay_seconds")
        retry_backoff_cap_retries = args.get("retry_backoff_cap_retries")
        context_window_tokens = args.get("context_window_tokens")
        input_image = args.get("input_image")
        output_image = args.get("output_image")
        structured_output = args.get("structured_output")
        auto_compact_token_limit = args.get("auto_compact_token_limit")
        model_params = args.get("model_params")
        timestamp_format = args.get("timestamp_format")

        if not isinstance(action, str):
            return json.dumps({"error": "action must be a string"})

        if assistant_role_name is not None and not isinstance(assistant_role_name, str):
            return json.dumps({"error": "assistant_role_name must be a string"})
        if assistant_allow_network is not None and not isinstance(
            assistant_allow_network, bool
        ):
            return json.dumps({"error": "assistant_allow_network must be a boolean"})
        if assistant_write_dirs is not None and not isinstance(
            assistant_write_dirs, list
        ):
            return json.dumps(
                {"error": "assistant_write_dirs must be an array of strings"}
            )
        if working_dir is not None and not isinstance(working_dir, str):
            return json.dumps({"error": "working_dir must be a string"})
        if leader_role_name is not None and not isinstance(leader_role_name, str):
            return json.dumps({"error": "leader_role_name must be a string"})
        if active_provider_id is not None and not isinstance(active_provider_id, str):
            return json.dumps({"error": "active_provider_id must be a string"})
        if active_model is not None and not isinstance(active_model, str):
            return json.dumps({"error": "active_model must be a string"})
        if retry_policy is not None:
            try:
                build_model_retry_policy(retry_policy, field_name="retry_policy")
            except ValueError as exc:
                return json.dumps({"error": str(exc)})
        if timeout_ms is not None:
            try:
                build_model_timeout_ms(timeout_ms, field_name="timeout_ms")
            except ValueError as exc:
                return json.dumps({"error": str(exc)})
        if max_retries is not None:
            try:
                build_model_max_retries(max_retries, field_name="max_retries")
            except ValueError as exc:
                return json.dumps({"error": str(exc)})
        if retry_initial_delay_seconds is not None:
            try:
                build_model_retry_initial_delay_seconds(
                    retry_initial_delay_seconds,
                    field_name="retry_initial_delay_seconds",
                )
            except ValueError as exc:
                return json.dumps({"error": str(exc)})
        if retry_max_delay_seconds is not None:
            try:
                build_model_retry_max_delay_seconds(
                    retry_max_delay_seconds,
                    field_name="retry_max_delay_seconds",
                )
            except ValueError as exc:
                return json.dumps({"error": str(exc)})
        if retry_backoff_cap_retries is not None:
            try:
                build_model_retry_backoff_cap_retries(
                    retry_backoff_cap_retries,
                    field_name="retry_backoff_cap_retries",
                )
            except ValueError as exc:
                return json.dumps({"error": str(exc)})
        if "input_image" in args:
            try:
                build_model_input_image(input_image, field_name="input_image")
            except ValueError as exc:
                return json.dumps({"error": str(exc)})
        if "output_image" in args:
            try:
                build_model_output_image(output_image, field_name="output_image")
            except ValueError as exc:
                return json.dumps({"error": str(exc)})
        if "structured_output" in args:
            try:
                build_model_structured_output(
                    structured_output,
                    field_name="structured_output",
                )
            except ValueError as exc:
                return json.dumps({"error": str(exc)})
        if "context_window_tokens" in args:
            try:
                build_model_context_window_tokens(
                    context_window_tokens,
                    field_name="context_window_tokens",
                )
            except ValueError as exc:
                return json.dumps({"error": str(exc)})
        if "auto_compact_token_limit" in args:
            try:
                build_model_auto_compact_token_limit(
                    auto_compact_token_limit,
                    field_name="auto_compact_token_limit",
                )
            except ValueError as exc:
                return json.dumps({"error": str(exc)})
        if model_params is not None and not isinstance(
            model_params, (dict, type(None))
        ):
            return json.dumps({"error": "model_params must be an object or null"})
        if timestamp_format is not None and not isinstance(timestamp_format, str):
            return json.dumps({"error": "timestamp_format must be a string"})

        settings = get_settings()

        if action == "get":
            return json.dumps(serialize_manage_settings(settings))

        if action != "update":
            return json.dumps({"error": f"Unsupported action: {action}"})

        try:
            resolved = resolve_settings_update(
                settings,
                working_dir=working_dir,
                assistant_role_name=assistant_role_name,
                assistant_allow_network=(
                    assistant_allow_network
                    if assistant_allow_network is not None
                    else MISSING
                ),
                assistant_write_dirs=(
                    assistant_write_dirs
                    if assistant_write_dirs is not None
                    else MISSING
                ),
                leader_role_name=leader_role_name,
                active_provider_id=active_provider_id,
                active_model=active_model,
                context_window_tokens=(
                    context_window_tokens
                    if "context_window_tokens" in args
                    else MISSING
                ),
                input_image=input_image if "input_image" in args else MISSING,
                output_image=output_image if "output_image" in args else MISSING,
                structured_output=(
                    structured_output if "structured_output" in args else MISSING
                ),
                max_retries=max_retries if max_retries is not None else MISSING,
                retry_policy=retry_policy if retry_policy is not None else MISSING,
                timeout_ms=timeout_ms if timeout_ms is not None else MISSING,
                retry_initial_delay_seconds=(
                    retry_initial_delay_seconds
                    if retry_initial_delay_seconds is not None
                    else MISSING
                ),
                retry_max_delay_seconds=(
                    retry_max_delay_seconds
                    if retry_max_delay_seconds is not None
                    else MISSING
                ),
                retry_backoff_cap_retries=(
                    retry_backoff_cap_retries
                    if retry_backoff_cap_retries is not None
                    else MISSING
                ),
                auto_compact_token_limit=(
                    auto_compact_token_limit
                    if "auto_compact_token_limit" in args
                    else MISSING
                ),
                model_params=model_params if "model_params" in args else MISSING,
                timestamp_format=timestamp_format,
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
            return json.dumps({"error": str(exc)})

        apply_resolved_settings_update(settings, resolved)

        save_settings(settings)
        sync_assistant_role(reason="assistant settings updated")
        sync_tab_leaders(reason="leader settings updated")
        gateway.invalidate_cache()
        return json.dumps(serialize_manage_settings(settings))
