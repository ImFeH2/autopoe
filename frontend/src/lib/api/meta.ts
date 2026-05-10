import { requestJson } from "./shared";

export interface AppMeta {
  provider_types?: string[];
  version?: string;
}

export interface ToolInfo {
  name: string;
  description: string;
  source?: "builtin";
  parameters?: Record<string, unknown>;
}

export async function fetchAppMeta(): Promise<AppMeta> {
  return requestJson<AppMeta>("/api/meta", {
    errorMessage: "Failed to fetch app metadata",
  });
}

export async function fetchTools(): Promise<ToolInfo[]> {
  return requestJson<{ tools?: ToolInfo[] }, ToolInfo[]>("/api/tools", {
    errorMessage: "Failed to fetch tools",
    fallback: [],
    map: (data) => data?.tools ?? [],
  });
}
