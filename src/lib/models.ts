import type { ModelConfiguration, ProviderKind } from "@/types/workflow";

export const defaultModelConfiguration: ModelConfiguration = {
  provider: "demo",
  model: "flowent-demo",
  api_mode: "responses",
  credential_id: "default",
};

export const inheritedModelConfiguration: ModelConfiguration = {
  provider: "default",
  model: "default",
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
      provider === "default"
        ? "responses"
        : provider === "openai_compatible"
        ? "chat"
        : provider === "anthropic" || provider === "demo"
          ? "responses"
          : model.api_mode,
    credential_id: model.credential_id ?? "default",
    model:
      provider === "default"
        ? "default"
        : model.provider === "default"
          ? provider === "demo"
            ? "flowent-demo"
            : ""
          : model.model,
  };
}
