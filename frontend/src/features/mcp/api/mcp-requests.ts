import type {
  ApiMcpImportPreview,
  ApiMcpServer,
} from "@/features/mcp/api/mcp-api-types";
import {
  mcpServerFromApi,
  mcpServerToApi,
} from "@/features/mcp/api/mcp-mappers";
import type {
  McpImportSource,
  McpServer,
} from "@/features/mcp/model/mcp-types";

export const previewMcpImportRequest = async (source: McpImportSource) => {
  const response = await fetch("/api/mcp/import/preview", {
    body: JSON.stringify({ source }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
  if (!response.ok) {
    throw new Error("MCP import preview failed");
  }
  const result = (await response.json()) as ApiMcpImportPreview;
  return (result.servers ?? []).map((server) => mcpServerFromApi(server));
};

export const importMcpServerRequest = async ({
  serverId,
  source,
}: {
  serverId: string;
  source: McpImportSource;
}) => {
  const response = await fetch("/api/mcp/import", {
    body: JSON.stringify({ server_id: serverId, source }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
  if (!response.ok) {
    throw new Error("MCP import failed");
  }
  const result = (await response.json()) as ApiMcpServer[];
  return result.map((server) => mcpServerFromApi(server));
};

export const saveMcpServerRequest = async (server: McpServer) => {
  const response = await fetch("/api/mcp/servers", {
    body: JSON.stringify(mcpServerToApi(server)),
    headers: { "Content-Type": "application/json" },
    method: "PUT",
  });

  if (!response.ok) {
    return null;
  }
  return mcpServerFromApi((await response.json()) as ApiMcpServer);
};

export const reconnectMcpServerRequest = async (serverId: string) => {
  const response = await fetch(`/api/mcp/servers/${serverId}/reconnect`, {
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });

  if (!response.ok) {
    return null;
  }
  return mcpServerFromApi((await response.json()) as ApiMcpServer);
};

export const removeMcpServerRequest = async (serverId: string) => {
  const response = await fetch(`/api/mcp/servers/${serverId}`, {
    headers: { "Content-Type": "application/json" },
    method: "DELETE",
  });
  return response.ok;
};
