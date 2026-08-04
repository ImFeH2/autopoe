import { request } from "@/lib/agent";

export interface ModelSelection {
  providerId: string;
  modelId: string;
}

export async function getDefaultModel(): Promise<ModelSelection | null> {
  const result = await request("model/get");
  return result === null ? null : readSelection(result);
}

export async function setDefaultModel(
  selection: ModelSelection,
): Promise<ModelSelection> {
  const result = await request("model/set", {
    provider_id: selection.providerId,
    model_id: selection.modelId,
  });
  return readSelection(result);
}

function readSelection(value: unknown): ModelSelection {
  if (!isRecord(value)) {
    throw new Error("Invalid model selection");
  }
  const { provider_id: providerId, model_id: modelId } = value;
  if (typeof providerId !== "string" || typeof modelId !== "string") {
    throw new Error("Invalid model selection");
  }
  return { providerId, modelId };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
