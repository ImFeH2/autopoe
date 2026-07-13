export type McpServerStatus = "disabled" | "error" | "ready" | "starting";

export type McpServerType = "command" | "url";

export type McpImportSource = "claude_code" | "codex";

export type McpTool = {
  description: string;
  inputSchema: Record<string, unknown>;
  name: string;
  outputSchema?: Record<string, unknown> | null;
};

export type McpServer = {
  args: string[];
  command: string;
  commandLine: string;
  config: Record<string, unknown>;
  enabled: boolean;
  error: string;
  id: string;
  name: string;
  status: McpServerStatus;
  tools: McpTool[];
  type: McpServerType;
  url: string;
};
