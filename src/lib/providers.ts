import { request } from "@/lib/agent";

export type ProviderType =
  | "openai"
  | "openai-compatible"
  | "anthropic"
  | "google";

export interface Provider {
  id: string;
  name: string;
  type: ProviderType;
  baseUrl: string;
}

export interface ProviderModel {
  id: string;
  name: string;
}

export interface ProviderInput {
  id: string | null;
  name: string;
  type: ProviderType;
  baseUrl: string;
}

export const providerTypes: ReadonlyArray<{
  value: ProviderType;
  label: string;
  baseUrl: string;
  requiresApiKey: boolean;
}> = [
  {
    value: "openai",
    label: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    requiresApiKey: true,
  },
  {
    value: "openai-compatible",
    label: "OpenAI Compatible",
    baseUrl: "",
    requiresApiKey: false,
  },
  {
    value: "anthropic",
    label: "Anthropic",
    baseUrl: "https://api.anthropic.com",
    requiresApiKey: true,
  },
  {
    value: "google",
    label: "Google Gemini",
    baseUrl: "https://generativelanguage.googleapis.com",
    requiresApiKey: true,
  },
];

export async function listProviders(): Promise<Provider[]> {
  const result = await request("providers/list");
  if (!Array.isArray(result)) {
    throw new Error("Invalid provider list");
  }
  return result.map(readProvider);
}

export async function saveProvider(input: ProviderInput): Promise<Provider> {
  const result = await request("providers/save", {
    id: input.id,
    name: input.name,
    type: input.type,
    base_url: input.baseUrl,
  });
  return readProvider(result);
}

export async function deleteProvider(providerId: string): Promise<void> {
  await request("providers/delete", { id: providerId });
}

export async function fetchProviderModels(
  providerId: string,
): Promise<ProviderModel[]> {
  const result = await request("providers/models", {
    id: providerId,
  });
  if (!Array.isArray(result)) {
    throw new Error("Invalid model list");
  }
  return result.map(readModel);
}

export function providerType(type: ProviderType) {
  const option = providerTypes.find((item) => item.value === type);
  if (!option) {
    throw new Error(`Unsupported provider type: ${type}`);
  }
  return option;
}

function readProvider(value: unknown): Provider {
  if (!isRecord(value)) {
    throw new Error("Invalid provider");
  }
  const { id, name, type, base_url: baseUrl } = value;
  if (
    typeof id !== "string" ||
    typeof name !== "string" ||
    !providerTypes.some((item) => item.value === type) ||
    typeof baseUrl !== "string"
  ) {
    throw new Error("Invalid provider");
  }
  return { id, name, type: type as ProviderType, baseUrl };
}

function readModel(value: unknown): ProviderModel {
  if (!isRecord(value)) {
    throw new Error("Invalid model");
  }
  const { id, name } = value;
  if (typeof id !== "string" || typeof name !== "string") {
    throw new Error("Invalid model");
  }
  return { id, name };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
