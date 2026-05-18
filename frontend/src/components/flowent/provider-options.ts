import type { Provider, ProviderOption } from "@/components/flowent/types";

export const providerOptions: ProviderOption[] = [
  { id: "openai", label: "OpenAI" },
  { id: "openai_responses", label: "OpenAI Responses" },
  { id: "anthropic", label: "Anthropic" },
  { id: "gemini", label: "Gemini" },
];

export const createEmptyProvider = (): Provider => ({
  apiKey: "",
  baseUrl: "",
  id: "new",
  models: [],
  name: "",
  type: "openai",
});
