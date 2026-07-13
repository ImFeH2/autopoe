import type {
  Provider,
  ProviderOption,
} from "@/features/providers/model/provider-types";

export const providerOptions: ProviderOption[] = [
  { id: "openai", label: "OpenAI" },
  { id: "openai_responses", label: "OpenAI Responses" },
  { id: "anthropic", label: "Anthropic" },
  { id: "gemini", label: "Gemini" },
];

export const createEmptyProvider = (): Provider => ({
  apiKey: "",
  baseUrl: "",
  hasAccessKey: false,
  id: "new",
  models: [],
  name: "",
  type: "openai",
});
