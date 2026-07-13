export type ProviderKind =
  | "openai"
  | "openai_responses"
  | "anthropic"
  | "gemini";

export type ProviderOption = {
  id: ProviderKind;
  label: string;
};

export type Provider = {
  apiKey: string;
  id: string;
  name: string;
  type: ProviderKind;
  baseUrl: string;
  hasAccessKey: boolean;
  models: string[];
};
