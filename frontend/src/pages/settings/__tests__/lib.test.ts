import { describe, expect, it } from "vitest";
import {
  buildSettingsSavePayload,
  findProviderById,
  findRoleByName,
  getEffectiveContextWindowTokens,
  getEffectiveModelCapabilities,
  getKnownSafeInputTokens,
  getSelectedCatalogModel,
  nullableBoolFromTriState,
  normalizeWriteDirs,
  triStateFromNullableBool,
  validateAutoCompactTokenLimit,
  type UserSettings,
} from "@/pages/settings/lib";
import type { Provider, Role } from "@/types";

function buildSettings(overrides: Partial<UserSettings> = {}): UserSettings {
  return {
    app_data_dir: overrides.app_data_dir ?? "/home/test/.flowent",
    working_dir: overrides.working_dir ?? "/workspace/project",
    access: {
      configured: true,
      ...(overrides.access ?? {}),
    },
    assistant: {
      role_name: "Steward",
      allow_network: true,
      write_dirs: ["/workspace/project"],
      ...(overrides.assistant ?? {}),
    },
    leader: {
      role_name: "Conductor",
      ...(overrides.leader ?? {}),
    },
    model: {
      active_provider_id: "provider-1",
      active_model: "gpt-5.2",
      input_image: null,
      output_image: null,
      context_window_tokens: null,
      capabilities: { input_image: true, output_image: false },
      resolved_context_window_tokens: 128000,
      timeout_ms: 10000,
      retry_policy: "limited",
      max_retries: 5,
      retry_initial_delay_seconds: 0.5,
      retry_max_delay_seconds: 8,
      retry_backoff_cap_retries: 5,
      auto_compact_token_limit: null,
      params: {
        reasoning_effort: null,
        verbosity: null,
        max_output_tokens: null,
        temperature: null,
        top_p: null,
      },
      ...(overrides.model ?? {}),
    },
  };
}

function buildProvider(
  overrides: Partial<Provider> & Pick<Provider, "id" | "name">,
): Provider {
  return {
    id: overrides.id,
    name: overrides.name,
    type: overrides.type ?? "openai_compatible",
    base_url: overrides.base_url ?? "https://api.example.com/v1",
    api_key: overrides.api_key ?? "",
    headers: overrides.headers ?? {},
    retry_429_delay_seconds: overrides.retry_429_delay_seconds ?? 0,
    models: overrides.models ?? [],
  };
}

function buildRole(
  overrides: Partial<Role> & Pick<Role, "name" | "description">,
): Role {
  return {
    name: overrides.name,
    description: overrides.description,
    system_prompt: overrides.system_prompt ?? "",
    model: overrides.model ?? null,
    model_params: overrides.model_params ?? null,
    included_tools: overrides.included_tools ?? [],
    excluded_tools: overrides.excluded_tools ?? [],
    is_builtin: overrides.is_builtin ?? true,
  };
}

describe("settings lib", () => {
  it("converts between tri-state capability values and nullable booleans", () => {
    expect(triStateFromNullableBool(true)).toBe("enabled");
    expect(triStateFromNullableBool(false)).toBe("disabled");
    expect(triStateFromNullableBool(null)).toBe("auto");
    expect(nullableBoolFromTriState("enabled")).toBe(true);
    expect(nullableBoolFromTriState("disabled")).toBe(false);
    expect(nullableBoolFromTriState("auto")).toBeNull();
  });

  it("normalizes write dirs by trimming, deduplicating, and dropping empties", () => {
    expect(normalizeWriteDirs([" ./tmp ", "./tmp/", "", " / "])).toEqual([
      "./tmp",
      "/",
    ]);
  });

  it("finds active provider, role, selected catalog model, and effective metadata", () => {
    const settings = buildSettings({
      model: {
        active_provider_id: "provider-1",
        active_model: "gpt-5.2",
        input_image: null,
        output_image: true,
        context_window_tokens: null,
        capabilities: { input_image: false, output_image: false },
        resolved_context_window_tokens: 64000,
        timeout_ms: 10000,
        retry_policy: "limited",
        max_retries: 5,
        retry_initial_delay_seconds: 0.5,
        retry_max_delay_seconds: 8,
        retry_backoff_cap_retries: 5,
        auto_compact_token_limit: null,
        params: {
          reasoning_effort: null,
          verbosity: null,
          max_output_tokens: 4000,
          temperature: null,
          top_p: null,
        },
      },
    });
    const providers = [
      buildProvider({
        id: "provider-1",
        name: "Primary",
        models: [
          {
            model: "gpt-5.2",
            source: "discovered",
            context_window_tokens: 128000,
            input_image: true,
            output_image: false,
          },
        ],
      }),
    ];
    const roles = [
      buildRole({
        name: "Steward",
        description: "Human-facing assistant role",
      }),
    ];

    const provider = findProviderById(
      providers,
      settings.model.active_provider_id,
    );
    const role = findRoleByName(roles, settings.assistant.role_name);
    const selectedCatalogModel = getSelectedCatalogModel(
      provider?.models ?? [],
      settings.model.active_model,
    );

    expect(provider?.name).toBe("Primary");
    expect(role?.description).toBe("Human-facing assistant role");
    expect(selectedCatalogModel?.model).toBe("gpt-5.2");
    expect(
      getEffectiveContextWindowTokens(settings, selectedCatalogModel),
    ).toBe(128000);
    expect(
      getEffectiveModelCapabilities(settings, selectedCatalogModel),
    ).toEqual({
      input_image: true,
      output_image: true,
      structured_output: false,
    });
    expect(getKnownSafeInputTokens(128000, settings.model.params)).toBe(122976);
  });

  it("validates the automatic compact token limit against the known safe window", () => {
    expect(validateAutoCompactTokenLimit(126976, 126976)).toBe(
      "Automatic Compact token limit must stay below the known safe input window",
    );
    expect(validateAutoCompactTokenLimit(120000, 126976)).toBeNull();
  });

  it("builds the save payload with normalized write dirs", () => {
    const payload = buildSettingsSavePayload(
      buildSettings({
        assistant: {
          role_name: "Steward",
          allow_network: false,
          write_dirs: [" ./tmp ", "./tmp/", ""],
        },
        model: {
          active_provider_id: "provider-1",
          active_model: "gpt-5.2",
          input_image: true,
          output_image: false,
          context_window_tokens: 64000,
          capabilities: { input_image: true, output_image: false },
          resolved_context_window_tokens: 64000,
          timeout_ms: 15000,
          retry_policy: "limited",
          max_retries: 5,
          retry_initial_delay_seconds: 0.75,
          retry_max_delay_seconds: 8,
          retry_backoff_cap_retries: 5,
          auto_compact_token_limit: 48000,
          params: {
            reasoning_effort: null,
            verbosity: null,
            max_output_tokens: null,
            temperature: null,
            top_p: null,
          },
        },
      }),
    );

    expect(payload).toEqual({
      working_dir: "/workspace/project",
      assistant: {
        role_name: "Steward",
        allow_network: false,
        write_dirs: ["./tmp"],
      },
      leader: { role_name: "Conductor" },
      model: {
        active_provider_id: "provider-1",
        active_model: "gpt-5.2",
        input_image: true,
        output_image: false,
        context_window_tokens: 64000,
        timeout_ms: 15000,
        retry_policy: "limited",
        max_retries: 5,
        retry_initial_delay_seconds: 0.75,
        retry_max_delay_seconds: 8,
        retry_backoff_cap_retries: 5,
        auto_compact_token_limit: 48000,
        params: {
          reasoning_effort: null,
          verbosity: null,
          max_output_tokens: null,
          temperature: null,
          top_p: null,
        },
      },
    });
  });
});
