export type ReasoningEffort = "default" | "low" | "medium" | "high" | "xhigh";

export type RuntimeSettings = {
  agentPrompt: string;
  contextWindowLimit: number | null;
  reasoningEffort: ReasoningEffort;
  selectedModel: string;
  selectedProviderId: string;
};
