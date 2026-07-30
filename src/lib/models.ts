import type { ModelConfiguration, ProviderKind } from "@/types/workflow";

export const defaultModelConfiguration: ModelConfiguration = {
  provider: "demo",
  model: "flowent-demo",
  api_mode: "responses",
  credential_id: "default",
};

export function changeModelProvider(
  model: ModelConfiguration,
  provider: ProviderKind,
): ModelConfiguration {
  return {
    ...model,
    provider,
    api_mode:
      provider === "openai_compatible"
        ? "chat"
        : provider === "anthropic" || provider === "demo"
          ? "responses"
          : model.api_mode,
    credential_id: model.credential_id ?? "default",
  };
}
