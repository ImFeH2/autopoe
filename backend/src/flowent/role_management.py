from __future__ import annotations

from flowent.settings import (
    ModelParams,
    RoleConfig,
    RoleModelConfig,
    Settings,
    build_model_params_from_mapping,
    clear_role_references,
    find_provider,
    is_builtin_role_name,
    normalize_tool_names,
    rename_role_references,
    validate_role_tool_config,
)


class RoleConflictError(ValueError):
    pass


def find_role_by_name(roles: list[RoleConfig], role_name: str) -> RoleConfig | None:
    for role in roles:
        if role.name == role_name:
            return role
    return None


def require_role_name(value: str) -> str:
    name = value.strip()
    if not name:
        raise ValueError("Role name is required")
    return name


def require_role_description(value: str) -> str:
    description = value.strip()
    if not description:
        raise ValueError("Role description is required")
    return description


def normalize_optional_role_name(value: str | None) -> str | None:
    if value is None:
        return None
    return require_role_name(value)


def normalize_optional_role_description(value: str | None) -> str | None:
    if value is None:
        return None
    return require_role_description(value)


def ensure_role_name_available(
    roles: list[RoleConfig],
    role_name: str,
    *,
    current_name: str | None = None,
) -> None:
    if any(role.name == role_name and role.name != current_name for role in roles):
        raise RoleConflictError(f"Role '{role_name}' already exists")


def resolve_role_tool_config(
    current: RoleConfig | None,
    included_tools: list[str] | None,
    excluded_tools: list[str] | None,
) -> tuple[list[str], list[str]]:
    from flowent.tools import is_assistant_only_tool_name

    next_included = normalize_tool_names(
        included_tools
        if included_tools is not None
        else current.included_tools
        if current
        else []
    )
    if included_tools is not None:
        next_included = [
            tool_name
            for tool_name in next_included
            if not tool_name.startswith("mcp__")
            and not is_assistant_only_tool_name(tool_name)
        ]
    next_excluded = normalize_tool_names(
        excluded_tools
        if excluded_tools is not None
        else current.excluded_tools
        if current
        else []
    )
    if excluded_tools is not None:
        next_excluded = [
            tool_name
            for tool_name in next_excluded
            if not tool_name.startswith("mcp__")
        ]
    validate_role_tool_config(next_included, next_excluded)
    return next_included, next_excluded


def resolve_role_model(
    requested: object,
    *,
    settings: Settings,
    current: RoleModelConfig | None,
    provided: bool,
    invalid_type_error: str,
    missing_provider_id_error: str,
    missing_model_error: str,
) -> RoleModelConfig | None:
    if not provided:
        return current
    if requested is None:
        return None

    extracted = _extract_role_model_fields(requested)
    if extracted is None:
        raise ValueError(invalid_type_error)

    provider_id_value, model_value = extracted
    if not isinstance(provider_id_value, str) or not provider_id_value.strip():
        raise ValueError(missing_provider_id_error)
    if not isinstance(model_value, str) or not model_value.strip():
        raise ValueError(missing_model_error)

    provider_id = provider_id_value.strip()
    model = model_value.strip()
    if find_provider(settings, provider_id) is None:
        raise ValueError(f"Provider '{provider_id}' not found")

    return RoleModelConfig(provider_id=provider_id, model=model)


def resolve_role_model_params(
    requested: object,
    *,
    current: ModelParams | None,
    provided: bool,
) -> ModelParams | None:
    if not provided:
        return current
    return build_model_params_from_mapping(requested)


def validate_builtin_role_update(
    role: RoleConfig,
    *,
    next_name: str | None,
    next_description: str | None,
    next_system_prompt: str | None,
    next_included_tools: list[str],
    next_excluded_tools: list[str],
) -> None:
    if not is_builtin_role_name(role.name):
        return
    if next_name is not None and next_name != role.name:
        raise ValueError(f"Cannot rename built-in role '{role.name}'")
    if next_description is not None and next_description != role.description:
        raise ValueError(
            f"Cannot modify built-in role '{role.name}' fields other than "
            "model or model_params"
        )
    if next_system_prompt is not None and next_system_prompt != role.system_prompt:
        raise ValueError(
            f"Cannot modify built-in role '{role.name}' fields other than "
            "model or model_params"
        )
    if (
        next_included_tools != role.included_tools
        or next_excluded_tools != role.excluded_tools
    ):
        raise ValueError(
            f"Cannot modify built-in role '{role.name}' fields other than "
            "model or model_params"
        )


def build_role_config(
    *,
    name: str,
    description: str,
    system_prompt: str,
    model: RoleModelConfig | None,
    model_params: ModelParams | None,
    included_tools: list[str],
    excluded_tools: list[str],
) -> RoleConfig:
    return RoleConfig(
        name=name,
        description=description,
        system_prompt=system_prompt,
        model=model,
        model_params=model_params,
        included_tools=included_tools,
        excluded_tools=excluded_tools,
    )


def apply_role_update(
    *,
    settings: Settings,
    role: RoleConfig,
    next_name: str | None,
    next_description: str | None,
    next_system_prompt: str | None,
    next_model: RoleModelConfig | None,
    update_model: bool,
    next_model_params: ModelParams | None,
    update_model_params: bool,
    next_included_tools: list[str],
    next_excluded_tools: list[str],
) -> RoleConfig:
    previous_name = role.name
    if next_name is not None:
        role.name = next_name
        rename_role_references(settings, previous_name, role.name)
    if next_description is not None:
        role.description = next_description
    if next_system_prompt is not None:
        role.system_prompt = next_system_prompt
    if update_model:
        role.model = next_model
    if update_model_params:
        role.model_params = next_model_params
    role.included_tools = next_included_tools
    role.excluded_tools = next_excluded_tools
    return role


def remove_role(settings: Settings, role: RoleConfig) -> None:
    settings.roles = [existing for existing in settings.roles if existing is not role]
    clear_role_references(settings, role.name)


def sync_running_system_roles() -> None:
    from flowent.graph_service import sync_assistant_role, sync_tab_leaders

    sync_assistant_role(reason="assistant role updated")
    sync_tab_leaders(reason="leader role updated")


def _extract_role_model_fields(requested: object) -> tuple[object, object] | None:
    if isinstance(requested, dict):
        return requested.get("provider_id"), requested.get("model")
    provider_id = getattr(requested, "provider_id", None)
    model = getattr(requested, "model", None)
    if provider_id is None and model is None:
        return None
    return provider_id, model


__all__ = [
    "RoleConflictError",
    "apply_role_update",
    "build_role_config",
    "ensure_role_name_available",
    "find_role_by_name",
    "normalize_optional_role_description",
    "normalize_optional_role_name",
    "remove_role",
    "require_role_description",
    "require_role_name",
    "resolve_role_model",
    "resolve_role_model_params",
    "resolve_role_tool_config",
    "sync_running_system_roles",
    "validate_builtin_role_update",
]
