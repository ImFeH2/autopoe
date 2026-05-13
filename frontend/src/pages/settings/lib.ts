import {
  nullableBoolFromTriState,
  triStateFromNullableBool,
  type TriStateCapability,
} from "@/lib/triState";
import type {
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

export type SettingsAutoSaveKey =
  | "assistant.allow_network"
  | "assistant.role_name"
  | "assistant.write_dirs"
  | "leader.role_name"
  | "model.active_model"
  | "model.active_provider"
  | "model.auto_compact_token_limit"
  | "model.context_window_tokens"
  | "model.input_image"
  | "model.max_retries"
  | "model.output_image"
  | "model.params"
  | "model.retry_backoff"
  | "model.retry_policy"
  | "model.structured_output"
  | "model.timeout_ms"
  | "working_dir";

export type SettingsSaveStateStatus = "idle" | "saving" | "saved" | "error";

export interface SettingsSaveState {
  message?: string;
  status: SettingsSaveStateStatus;
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

export function validateAutoSaveSettings(
  saveKey: SettingsAutoSaveKey,
  settings: UserSettings,
  knownSafeInputTokens: number | null,
) {
  if (saveKey === "working_dir" && !settings.working_dir.trim()) {
    return "Working Directory must not be empty.";
  }

  if (
    saveKey === "model.retry_backoff" &&
    settings.model.retry_max_delay_seconds <
      settings.model.retry_initial_delay_seconds
  ) {
    return "Max Delay must be greater than or equal to Initial Delay.";
  }

  if (saveKey === "model.auto_compact_token_limit") {
    return validateAutoCompactTokenLimit(
      settings.model.auto_compact_token_limit,
      knownSafeInputTokens,
    );
  }

  return null;
}

export function buildSettingsAutoSavePayload(
  saveKey: SettingsAutoSaveKey,
  settings: UserSettings,
) {
  switch (saveKey) {
    case "assistant.allow_network":
      return {
        assistant: {
          allow_network: settings.assistant.allow_network,
        },
      };
    case "assistant.role_name":
      return {
        assistant: {
          role_name: settings.assistant.role_name,
        },
      };
    case "assistant.write_dirs":
      return {
        assistant: {
          write_dirs: normalizeWriteDirs(settings.assistant.write_dirs),
        },
      };
    case "leader.role_name":
      return {
        leader: {
          role_name: settings.leader.role_name,
        },
      };
    case "model.active_model":
      return {
        model: {
          active_model: settings.model.active_model,
        },
      };
    case "model.active_provider":
      return {
        model: {
          active_provider_id: settings.model.active_provider_id,
          active_model: settings.model.active_model,
        },
      };
    case "model.auto_compact_token_limit":
      return {
        model: {
          auto_compact_token_limit: settings.model.auto_compact_token_limit,
        },
      };
    case "model.context_window_tokens":
      return {
        model: {
          context_window_tokens: settings.model.context_window_tokens,
        },
      };
    case "model.input_image":
      return {
        model: {
          input_image: settings.model.input_image,
        },
      };
    case "model.max_retries":
      return {
        model: {
          max_retries: settings.model.max_retries,
        },
      };
    case "model.output_image":
      return {
        model: {
          output_image: settings.model.output_image,
        },
      };
    case "model.params":
      return {
        model: {
          params: settings.model.params,
        },
      };
    case "model.retry_backoff":
      return {
        model: {
          retry_initial_delay_seconds:
            settings.model.retry_initial_delay_seconds,
          retry_max_delay_seconds: settings.model.retry_max_delay_seconds,
          retry_backoff_cap_retries: settings.model.retry_backoff_cap_retries,
        },
      };
    case "model.retry_policy":
      return {
        model: {
          retry_policy: settings.model.retry_policy,
        },
      };
    case "model.structured_output":
      return {
        model: {
          structured_output: settings.model.structured_output,
        },
      };
    case "model.timeout_ms":
      return {
        model: {
          timeout_ms: settings.model.timeout_ms,
        },
      };
    case "working_dir":
      return {
        working_dir: settings.working_dir.trim(),
      };
  }
}

export function buildAccessCodeUpdatePayload(accessDraft: {
  confirmCode: string;
  newCode: string;
}) {
  return {
    access: {
      new_code: accessDraft.newCode,
      confirm_code: accessDraft.confirmCode,
    },
  };
}
