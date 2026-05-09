import { cloneModelParams, modelParamsToPayload } from "@/lib/modelParams";
import type { Provider, Role, RoleModelConfig } from "@/types";

export type RoleDraft = Omit<Role, "is_builtin">;
export type ToolState = "allowed" | "included" | "excluded";
export type RolePanelMode = "create" | "edit" | "view";

const MINIMUM_TOOLS = new Set(["idle", "sleep", "todo", "contacts"]);

export function createEmptyRoleDraft(): RoleDraft {
  return {
    name: "",
    description: "",
    system_prompt: "",
    model: null,
    model_params: null,
    included_tools: [],
    excluded_tools: [],
  };
}

export function createRoleDraft(role?: Role | null): RoleDraft {
  if (!role) {
    return createEmptyRoleDraft();
  }
  return {
    name: role.name,
    description: role.description,
    system_prompt: role.system_prompt,
    model: role.model
      ? {
          provider_id: role.model.provider_id,
          model: role.model.model,
        }
      : null,
    model_params: role.model_params
      ? cloneModelParams(role.model_params)
      : null,
    included_tools: [...role.included_tools],
    excluded_tools: [...role.excluded_tools],
  };
}

export function getRoleConfigurableTools<T extends { name: string }>(
  tools: T[],
) {
  return tools.filter((tool) => !MINIMUM_TOOLS.has(tool.name));
}

export function buildProvidersById(
  providers: Provider[],
): Record<string, Provider> {
  return Object.fromEntries(
    providers.map((provider) => [provider.id, provider]),
  );
}

export function getToolState(draft: RoleDraft, toolName: string): ToolState {
  if (draft.included_tools.includes(toolName)) {
    return "included";
  }
  if (draft.excluded_tools.includes(toolName)) {
    return "excluded";
  }
  return "allowed";
}

export function cycleToolState(draft: RoleDraft, toolName: string): RoleDraft {
  const currentState = getToolState(draft, toolName);

  if (currentState === "allowed") {
    return {
      ...draft,
      included_tools: [...draft.included_tools, toolName],
      excluded_tools: draft.excluded_tools.filter((name) => name !== toolName),
    };
  }

  if (currentState === "included") {
    return {
      ...draft,
      included_tools: draft.included_tools.filter((name) => name !== toolName),
      excluded_tools: [...draft.excluded_tools, toolName],
    };
  }

  return {
    ...draft,
    included_tools: draft.included_tools.filter((name) => name !== toolName),
    excluded_tools: draft.excluded_tools.filter((name) => name !== toolName),
  };
}

export function createDefaultRoleModel(
  providers: Provider[],
): RoleModelConfig | null {
  if (providers.length === 0) {
    return null;
  }
  return {
    provider_id: providers[0]?.id ?? "",
    model: "",
  };
}

export function validateRoleDraft(input: {
  activeRoleName: string | null;
  draft: RoleDraft;
  roles: Role[];
}) {
  const { activeRoleName, draft, roles } = input;
  const nextName = draft.name.trim();

  if (!nextName) {
    return "Role name is required";
  }
  if (!draft.description.trim()) {
    return "Role description is required";
  }
  if (!draft.system_prompt.trim()) {
    return "System prompt is required";
  }
  if (draft.model) {
    if (!draft.model.provider_id.trim()) {
      return "Provider is required for a role model override";
    }
    if (!draft.model.model.trim()) {
      return "Model is required for a role model override";
    }
  }

  const nameExists = roles.some(
    (role) => role.name === nextName && role.name !== activeRoleName,
  );
  if (nameExists) {
    return "Role name already exists";
  }

  return null;
}

export function buildRolePayload(draft: RoleDraft) {
  return {
    name: draft.name.trim(),
    description: draft.description.trim(),
    system_prompt: draft.system_prompt,
    model: draft.model
      ? {
          provider_id: draft.model.provider_id.trim(),
          model: draft.model.model.trim(),
        }
      : null,
    model_params: modelParamsToPayload(draft.model_params),
    included_tools: draft.included_tools,
    excluded_tools: draft.excluded_tools,
  };
}

export function isRolePanelReadOnly(panelMode: RolePanelMode | null) {
  return panelMode === "view";
}

export function shouldLockRoleIdentityFields(
  panelMode: RolePanelMode | null,
  activeRole: Role | null,
) {
  return (
    panelMode !== "create" &&
    panelMode !== null &&
    activeRole?.is_builtin === true
  );
}

export function getRolePanelBadgeLabel(
  panelMode: RolePanelMode | null,
  activeRole: Role | null,
) {
  if (panelMode === "create") {
    return "New Role";
  }
  return activeRole?.is_builtin ? "Built-in" : "Custom";
}

export function getRolePanelTitle(
  panelMode: RolePanelMode | null,
  activeRole: Role | null,
) {
  if (panelMode === "create") {
    return "Create Role";
  }
  return activeRole?.is_builtin
    ? "Role Details"
    : (activeRole?.name ?? "Role Details");
}

export function canSaveRoleChanges(draft: RoleDraft, saving: boolean) {
  return !(
    saving ||
    !draft.name.trim() ||
    !draft.description.trim() ||
    !draft.system_prompt.trim()
  );
}

export function getRoleModelSummary(
  role: Role,
  providersById: Record<string, Provider>,
) {
  if (!role.model) {
    return "Settings default";
  }
  const providerName =
    providersById[role.model.provider_id]?.name ?? role.model.provider_id;
  return `${providerName} / ${role.model.model}`;
}

export function getRoleToolSummary(role: Role) {
  const includedCount = role.included_tools.length;
  const excludedCount = role.excluded_tools.length;

  if (includedCount === 0 && excludedCount === 0) {
    return "Default";
  }

  return [
    includedCount > 0 ? `+${includedCount}` : null,
    excludedCount > 0 ? `-${excludedCount}` : null,
  ]
    .filter(Boolean)
    .join(" ");
}
