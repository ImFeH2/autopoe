import {
  nullableBoolFromTriState,
  triStateFromNullableBool,
  type TriStateCapability,
} from "@/lib/triState";
import type {
  MCPServerConfig,
  ModelCapabilities,
  ModelParams,
  Provider,
  RetryPolicy,
  Role,
} from "@/types";

export const DEFAULT_CONTEXT_OUTPUT_BUDGET_TOKENS = 1024;
export const DEFAULT_CONTEXT_PROVIDER_HEADROOM_TOKENS = 1024;

export {
  nullableBoolFromTriState,
  triStateFromNullableBool,
  type TriStateCapability,
};

export interface UserSettings {
  app_data_dir: string;
  working_dir: string;
  access: {
    configured: boolean;
  };
  assistant: {
    role_name: string;
    allow_network: boolean;
    write_dirs: string[];
  };
  leader: {
    role_name: string;
  };
  model: {
    active_provider_id: string;
    active_model: string;
    input_image: boolean | null;
    output_image: boolean | null;
    structured_output?: boolean | null;
    context_window_tokens: number | null;
    capabilities: ModelCapabilities | null;
    resolved_context_window_tokens: number | null;
    timeout_ms: number;
    retry_policy: RetryPolicy;
    max_retries: number;
    retry_initial_delay_seconds: number;
    retry_max_delay_seconds: number;
    retry_backoff_cap_retries: number;
    auto_compact_token_limit: number | null;
    params: ModelParams;
  };
  mcp_servers: MCPServerConfig[];
}

export interface SettingsBootstrapData {
  settings: UserSettings;
  providers: Provider[];
  roles: Role[];
  version: string | null;
}

export interface EffectiveModelCapabilities {
  input_image: boolean;
  output_image: boolean;
  structured_output: boolean;
}

export function normalizeWriteDirs(writeDirs: string[]): string[] {
  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const rawDir of writeDirs) {
    const trimmed = rawDir.trim();
    if (!trimmed) {
      continue;
    }
    const normalizedDir = trimmed.replace(/\/+$/u, "") || "/";
    if (seen.has(normalizedDir)) {
      continue;
    }
    seen.add(normalizedDir);
    normalized.push(normalizedDir);
  }
  return normalized;
}

export function findProviderById(
  providers: Provider[],
  providerId: string,
): Provider | null {
  return providers.find((provider) => provider.id === providerId) ?? null;
}

export function findRoleByName(roles: Role[], roleName: string): Role | null {
  return roles.find((role) => role.name === roleName) ?? null;
}

export function getActiveProviderModels(activeProvider: Provider | null) {
  return activeProvider?.models ?? [];
}

export function getSelectedCatalogModel(
  activeProviderModels: Provider["models"],
  activeModel: string,
) {
  if (!activeModel) {
    return null;
  }
  return (
    activeProviderModels.find((model) => model.model === activeModel) ?? null
  );
}

export function getEffectiveContextWindowTokens(
  settings: UserSettings,
  selectedCatalogModel: Provider["models"][number] | null,
) {
  return (
    settings.model.context_window_tokens ??
    selectedCatalogModel?.context_window_tokens ??
    settings.model.resolved_context_window_tokens ??
    null
  );
}

export function getEffectiveModelCapabilities(
  settings: UserSettings,
  selectedCatalogModel: Provider["models"][number] | null,
): EffectiveModelCapabilities {
  return {
    input_image:
      settings.model.input_image ??
      selectedCatalogModel?.input_image ??
      settings.model.capabilities?.input_image ??
      false,
    output_image:
      settings.model.output_image ??
      selectedCatalogModel?.output_image ??
      settings.model.capabilities?.output_image ??
      false,
    structured_output:
      settings.model.structured_output ??
      selectedCatalogModel?.structured_output ??
      settings.model.capabilities?.structured_output ??
      false,
  };
}

export function getKnownSafeInputTokens(
  effectiveContextWindowTokens: number | null,
  params: ModelParams,
) {
  if (!effectiveContextWindowTokens) {
    return null;
  }
  const outputBudget =
    params.max_output_tokens ?? DEFAULT_CONTEXT_OUTPUT_BUDGET_TOKENS;
  return Math.max(
    1,
    effectiveContextWindowTokens -
      outputBudget -
      DEFAULT_CONTEXT_PROVIDER_HEADROOM_TOKENS,
  );
}

export function validateAutoCompactTokenLimit(
  autoCompactTokenLimit: number | null,
  knownSafeInputTokens: number | null,
) {
  if (
    autoCompactTokenLimit !== null &&
    knownSafeInputTokens !== null &&
    autoCompactTokenLimit >= knownSafeInputTokens
  ) {
    return "Automatic Compact token limit must stay below the known safe input window";
  }
  return null;
}

export function buildSettingsSavePayload(
  settings: UserSettings,
  accessDraft?: {
    newCode: string;
    confirmCode: string;
  },
) {
  const accessPayload =
    accessDraft && (accessDraft.newCode || accessDraft.confirmCode)
      ? {
          new_code: accessDraft.newCode,
          confirm_code: accessDraft.confirmCode,
        }
      : undefined;

  return {
    ...(accessPayload ? { access: accessPayload } : {}),
    working_dir: settings.working_dir.trim(),
    assistant: {
      role_name: settings.assistant.role_name,
      allow_network: settings.assistant.allow_network,
      write_dirs: normalizeWriteDirs(settings.assistant.write_dirs),
    },
    leader: settings.leader,
    model: {
      active_provider_id: settings.model.active_provider_id,
      active_model: settings.model.active_model,
      input_image: settings.model.input_image,
      output_image: settings.model.output_image,
      structured_output: settings.model.structured_output,
      context_window_tokens: settings.model.context_window_tokens,
      timeout_ms: settings.model.timeout_ms,
      retry_policy: settings.model.retry_policy,
      max_retries: settings.model.max_retries,
      retry_initial_delay_seconds: settings.model.retry_initial_delay_seconds,
      retry_max_delay_seconds: settings.model.retry_max_delay_seconds,
      retry_backoff_cap_retries: settings.model.retry_backoff_cap_retries,
      auto_compact_token_limit: settings.model.auto_compact_token_limit,
      params: settings.model.params,
    },
  };
}
