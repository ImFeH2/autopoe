import type { ApiAbout, ApiState } from "@/app/api-types";
import type { RuntimeSettings } from "@/components/flowent/types";

export const fetchAppState = async () => {
  const response = await fetch("/api/state");
  if (!response.ok) {
    return null;
  }
  return (await response.json()) as ApiState;
};

export const fetchAbout = async () => {
  const response = await fetch("/api/about");
  if (!response.ok) {
    return {};
  }
  return (await response.json()) as ApiAbout;
};

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
