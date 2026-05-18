export type ViewId = "workspace" | "providers" | "settings";

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
  id: string;
  name: string;
  type: ProviderKind;
  baseUrl: string;
  apiKey: string;
  models: string[];
};

export type Message = {
  author: "assistant" | "user";
  content: string;
  id: string;
};
