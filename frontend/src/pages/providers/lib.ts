import {
  nullableBoolFromTriState,
  triStateFromNullableBool,
  type TriStateCapability,
} from "@/lib/triState";
import { formatProviderHeaders } from "@/lib/providerHeaders";
import type { Provider, ProviderModelCatalogEntry } from "@/types";

export {
  nullableBoolFromTriState,
  triStateFromNullableBool,
  type TriStateCapability,
};

export type ProviderDraft = Omit<Provider, "id" | "headers"> & {
  headers_text: string;
};

export type ProviderModelEditorDraft = {
  model: string;
  context_window_tokens: string;
  input_image: TriStateCapability;
  output_image: TriStateCapability;
  structured_output?: TriStateCapability;
  source: "discovered" | "manual";
};

export type ProviderModelEditorState = {
  mode: "create" | "edit";
  originalModel: string | null;
} | null;

export type ProviderModelTestState =
  | {
      state: "running";
    }
  | {
      state: "success";
      duration_ms: number;
    }
  | {
      state: "error";
      error_summary: string;
    };

export type ProviderDraftRequestPayload = Omit<Provider, "id" | "models"> & {
  provider_id?: string;
};

export function createProviderDraft(provider?: Provider | null): ProviderDraft {
  if (!provider) {
    return {
      name: "",
      type: "openai_compatible",
      base_url: "",
      api_key: "",
      headers_text: "",
      retry_429_delay_seconds: 0,
      models: [],
    };
  }
  return {
    name: provider.name,
    type: provider.type,
    base_url: provider.base_url,
    api_key: provider.api_key,
    headers_text: formatProviderHeaders(provider.headers),
    retry_429_delay_seconds: provider.retry_429_delay_seconds,
    models: provider.models.map((entry) => ({ ...entry })),
  };
}

export function createProviderModelEditorDraft(
  entry?: ProviderModelCatalogEntry | null,
): ProviderModelEditorDraft {
  return {
    model: entry?.model ?? "",
    context_window_tokens:
      entry?.context_window_tokens === null ||
      entry?.context_window_tokens === undefined
        ? ""
        : String(entry.context_window_tokens),
    input_image: triStateFromNullableBool(entry?.input_image ?? null),
    output_image: triStateFromNullableBool(entry?.output_image ?? null),
    structured_output: triStateFromNullableBool(
      entry?.structured_output ?? null,
    ),
    source: entry?.source ?? "manual",
  };
}

export function serializeProviderDraft(draft: ProviderDraft): string {
  return JSON.stringify({
    name: draft.name,
    type: draft.type,
    base_url: draft.base_url,
    api_key: draft.api_key,
    headers_text: draft.headers_text,
    retry_429_delay_seconds: draft.retry_429_delay_seconds,
    models: draft.models,
  });
}

export function buildProviderPayload(
  draft: ProviderDraft,
  headers: Record<string, string>,
): Omit<Provider, "id"> {
  return {
    name: draft.name,
    type: draft.type,
    base_url: draft.base_url,
    api_key: draft.api_key,
    headers,
    retry_429_delay_seconds: draft.retry_429_delay_seconds,
    models: draft.models,
  };
}

export function buildProviderDraftRequestPayload(
  draft: ProviderDraft,
  headers: Record<string, string>,
  providerId?: string,
): ProviderDraftRequestPayload {
  return {
    provider_id: providerId,
    name: draft.name,
    type: draft.type,
    base_url: draft.base_url,
    api_key: draft.api_key,
    headers,
    retry_429_delay_seconds: draft.retry_429_delay_seconds,
  };
}

export function mergeFetchedModelsIntoDraft(
  existing: ProviderModelCatalogEntry[],
  fetched: ProviderModelCatalogEntry[],
): ProviderModelCatalogEntry[] {
  const existingByModel = new Map(
    existing.map((entry) => [entry.model, entry]),
  );
  const fetchedByModel = new Map(fetched.map((entry) => [entry.model, entry]));
  const merged: ProviderModelCatalogEntry[] = [];

  for (const entry of existing) {
    const discoveredEntry = fetchedByModel.get(entry.model);
    if (!discoveredEntry) {
      merged.push(entry);
      continue;
    }
    if (entry.source === "manual") {
      merged.push({
        ...entry,
        context_window_tokens:
          entry.context_window_tokens ?? discoveredEntry.context_window_tokens,
        input_image: entry.input_image ?? discoveredEntry.input_image,
        output_image: entry.output_image ?? discoveredEntry.output_image,
        structured_output:
          entry.structured_output ?? discoveredEntry.structured_output,
      });
      fetchedByModel.delete(entry.model);
      continue;
    }
    merged.push(discoveredEntry);
    fetchedByModel.delete(entry.model);
  }

  for (const entry of fetched) {
    if (existingByModel.has(entry.model)) {
      continue;
    }
    merged.push(entry);
  }

  return merged;
}

export function buildModelSummary(entry: ProviderModelCatalogEntry): string {
  const parts: string[] = [];
  if (entry.context_window_tokens !== null) {
    parts.push(`${entry.context_window_tokens.toLocaleString()} tokens`);
  }
  if (entry.input_image !== null) {
    parts.push(`input_image=${entry.input_image ? "true" : "false"}`);
  }
  if (entry.output_image !== null) {
    parts.push(`output_image=${entry.output_image ? "true" : "false"}`);
  }
  if (
    entry.structured_output !== null &&
    entry.structured_output !== undefined
  ) {
    parts.push(
      `structured_output=${entry.structured_output ? "true" : "false"}`,
    );
  }
  return parts.length > 0 ? parts.join(" · ") : "No capability metadata";
}

export function findDuplicateModelId(
  models: ProviderModelCatalogEntry[],
): string | null {
  const seenModelIds = new Set<string>();
  for (const entry of models) {
    const modelId = entry.model.trim();
    if (seenModelIds.has(modelId)) {
      return modelId;
    }
    seenModelIds.add(modelId);
  }
  return null;
}

export function validateProviderModelEditorDraft(
  draft: ProviderModelEditorDraft,
): string | null {
  if (!draft.model.trim()) {
    return "Model ID is required";
  }
  if (
    draft.context_window_tokens &&
    !/^\d+$/.test(draft.context_window_tokens)
  ) {
    return "Context Window must be a positive integer";
  }
  return null;
}

export function buildProviderModelEntry(
  draft: ProviderModelEditorDraft,
): ProviderModelCatalogEntry {
  const structuredOutput = nullableBoolFromTriState(
    draft.structured_output ?? "auto",
  );
  return {
    model: draft.model.trim(),
    source: draft.source,
    context_window_tokens: draft.context_window_tokens
      ? Number.parseInt(draft.context_window_tokens, 10)
      : null,
    input_image: nullableBoolFromTriState(draft.input_image),
    output_image: nullableBoolFromTriState(draft.output_image),
    ...(structuredOutput === null
      ? {}
      : { structured_output: structuredOutput }),
  };
}
