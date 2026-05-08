from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from flowent.role_management import (
    RoleConflictError,
    apply_role_update,
    build_role_config,
    ensure_role_name_available,
    find_role_by_name,
    normalize_optional_role_description,
    normalize_optional_role_name,
    remove_role,
    require_role_description,
    require_role_name,
    resolve_role_model,
    resolve_role_model_params,
    resolve_role_tool_config,
    sync_running_system_roles,
    validate_builtin_role_update,
)
from flowent.settings import (
    get_settings,
    is_builtin_role_name,
    save_settings,
    serialize_provider,
    serialize_role,
)

router = APIRouter()


class RoleModelRequest(BaseModel):
    provider_id: str
    model: str


class CreateRoleRequest(BaseModel):
    name: str
    description: str
    system_prompt: str
    model: RoleModelRequest | None = None
    model_params: dict[str, object] | None = None
    included_tools: list[str] = Field(default_factory=list)
    excluded_tools: list[str] = Field(default_factory=list)


class UpdateRoleRequest(BaseModel):
    name: str | None = None
    description: str | None = None
    system_prompt: str | None = None
    model: RoleModelRequest | None = None
    model_params: dict[str, object] | None = None
    included_tools: list[str] | None = None
    excluded_tools: list[str] | None = None


@router.get("/api/roles")
async def list_roles() -> dict:
    settings = get_settings()
    return {"roles": [serialize_role(role) for role in settings.roles]}


@router.get("/api/roles/bootstrap")
async def get_roles_bootstrap() -> dict[str, object]:
    from flowent.tools import list_agent_visible_tool_descriptors

    settings = get_settings()
    return {
        "roles": [serialize_role(role) for role in settings.roles],
        "providers": [serialize_provider(provider) for provider in settings.providers],
        "tools": list_agent_visible_tool_descriptors(include_assistant_only=False),
    }


@router.post("/api/roles")
async def create_role(req: CreateRoleRequest) -> dict:
    from flowent.providers.gateway import gateway

    settings = get_settings()
    try:
        name = require_role_name(req.name)
        description = require_role_description(req.description)
        ensure_role_name_available(settings.roles, name)
        included_tools, excluded_tools = resolve_role_tool_config(
            None,
            req.included_tools,
            req.excluded_tools,
        )
        role = build_role_config(
            name=name,
            description=description,
            system_prompt=req.system_prompt,
            model=resolve_role_model(
                req.model,
                settings=settings,
                current=None,
                provided="model" in req.model_fields_set,
                invalid_type_error="Role model must be an object or null",
                missing_provider_id_error="Role model provider_id is required",
                missing_model_error="Role model is required",
            ),
            model_params=resolve_role_model_params(
                req.model_params,
                current=None,
                provided="model_params" in req.model_fields_set,
            ),
            included_tools=included_tools,
            excluded_tools=excluded_tools,
        )
    except RoleConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    settings.roles.append(role)
    save_settings(settings)
    gateway.invalidate_cache()
    return serialize_role(role)


@router.put("/api/roles/{role_name:path}")
async def update_role(role_name: str, req: UpdateRoleRequest) -> dict:
    from flowent.providers.gateway import gateway

    settings = get_settings()
    role = find_role_by_name(settings.roles, role_name)
    if role is None:
        raise HTTPException(status_code=404, detail="Role not found")

    try:
        included_tools, excluded_tools = resolve_role_tool_config(
            role,
            req.included_tools,
            req.excluded_tools,
        )
        next_name = normalize_optional_role_name(req.name)
        next_description = normalize_optional_role_description(req.description)
        if next_name is not None:
            ensure_role_name_available(
                settings.roles,
                next_name,
                current_name=role.name,
            )
        validate_builtin_role_update(
            role,
            next_name=next_name,
            next_description=next_description,
            next_system_prompt=req.system_prompt,
            next_included_tools=included_tools,
            next_excluded_tools=excluded_tools,
        )
        role = apply_role_update(
            settings=settings,
            role=role,
            next_name=next_name,
            next_description=next_description,
            next_system_prompt=req.system_prompt,
            next_model=resolve_role_model(
                req.model,
                settings=settings,
                current=role.model,
                provided="model" in req.model_fields_set,
                invalid_type_error="Role model must be an object or null",
                missing_provider_id_error="Role model provider_id is required",
                missing_model_error="Role model is required",
            ),
            update_model="model" in req.model_fields_set,
            next_model_params=resolve_role_model_params(
                req.model_params,
                current=role.model_params,
                provided="model_params" in req.model_fields_set,
            ),
            update_model_params="model_params" in req.model_fields_set,
            next_included_tools=included_tools,
            next_excluded_tools=excluded_tools,
        )
    except RoleConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    save_settings(settings)
    sync_running_system_roles()
    gateway.invalidate_cache()
    return serialize_role(role)


@router.delete("/api/roles/{role_name:path}")
async def delete_role(role_name: str) -> dict:
    from flowent.providers.gateway import gateway

    if is_builtin_role_name(role_name):
        raise HTTPException(
            status_code=400,
            detail=f"Cannot delete built-in role '{role_name}'",
        )

    settings = get_settings()
    role = find_role_by_name(settings.roles, role_name)
    if role is None:
        raise HTTPException(status_code=404, detail="Role not found")
    remove_role(settings, role)
    save_settings(settings)
    sync_running_system_roles()
    gateway.invalidate_cache()
    return {"status": "deleted"}
