import type { McpServer } from "@/features/mcp/model/mcp-types";

export type ApiMcpTool = {
  description?: string;
  input_schema?: Record<string, unknown>;
  name: string;
  output_schema?: Record<string, unknown> | null;
};

export type ApiMcpServer = {
  args: string[];
  command: string;
  config?: Record<string, unknown>;
  enabled: boolean;
  error?: string;
  id: string;
  name: string;
  status?: McpServer["status"];
  tools?: ApiMcpTool[];
  type: McpServer["type"];
  url: string;
};

export type ApiMcpImportPreview = {
  servers?: ApiMcpServer[];
};
