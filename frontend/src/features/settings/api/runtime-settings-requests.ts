import type { RuntimeSettings } from "@/features/settings/model/runtime-settings-types";

export const saveRuntimeSettingsRequest = async (settings: RuntimeSettings) => {
  await fetch("/api/settings", {
    body: JSON.stringify({
      agent_prompt: settings.agentPrompt,
      context_window_limit: settings.contextWindowLimit,
      reasoning_effort: settings.reasoningEffort,
      selected_model: settings.selectedModel,
      selected_provider_id: settings.selectedProviderId,
    }),
    headers: { "Content-Type": "application/json" },
    method: "PUT",
  });
};
