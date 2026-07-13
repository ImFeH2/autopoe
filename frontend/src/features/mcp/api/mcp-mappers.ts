import type {
  ApiMcpServer,
  ApiMcpTool,
} from "@/features/mcp/api/mcp-api-types";
import type { McpServer, McpTool } from "@/features/mcp/model/mcp-types";
import { createClientId } from "@/lib/utils";

export const mcpCommandLine = (server: Pick<McpServer, "args" | "command">) =>
  [server.command, ...server.args].filter(Boolean).join(" ");

export const mcpToolFromApi = (tool: ApiMcpTool): McpTool => ({
  description: tool.description ?? "",
  inputSchema: tool.input_schema ?? {},
  name: tool.name,
  outputSchema: tool.output_schema ?? null,
});

export const mcpServerFromApi = (server: ApiMcpServer): McpServer => ({
  args: server.args ?? [],
  command: server.command ?? "",
  commandLine: mcpCommandLine({
    args: server.args ?? [],
    command: server.command ?? "",
  }),
  config: server.config ?? {},
  enabled: server.enabled,
  error: server.error ?? "",
  id: server.id,
  name: server.name,
  status: server.status ?? "disabled",
  tools: (server.tools ?? []).map(mcpToolFromApi),
  type: server.type,
  url: server.url ?? "",
});

export const mcpServerToApi = (server: McpServer): ApiMcpServer => ({
  args: server.args,
  command: server.command,
  config: server.config,
  enabled: server.enabled,
  error: server.error,
  id: server.id,
  name: server.name,
  status: server.status,
  tools: server.tools.map((tool) => ({
    description: tool.description,
    input_schema: tool.inputSchema,
    name: tool.name,
    output_schema: tool.outputSchema,
  })),
  type: server.type,
  url: server.url,
});

export const createEmptyMcpServer = (): McpServer => ({
  args: [],
  command: "",
  commandLine: "",
  config: {},
  enabled: true,
  error: "",
  id: "new",
  name: "",
  status: "disabled",
  tools: [],
  type: "command",
  url: "",
});

export const parseCommandLine = (commandLine: string) => {
  const parts: string[] = [];
  let current = "";
  let quote: "'" | '"' | "" = "";
  let isEscaped = false;

  for (const character of commandLine) {
    if (isEscaped) {
      current += character;
      isEscaped = false;
      continue;
    }
    if (character === "\\") {
      isEscaped = true;
      continue;
    }
    if (quote) {
      if (character === quote) {
        quote = "";
      } else {
        current += character;
      }
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }
    if (/\s/.test(character)) {
      if (current) {
        parts.push(current);
        current = "";
      }
      continue;
    }
    current += character;
  }

  if (current) {
    parts.push(current);
  }

  return {
    args: parts.slice(1),
    command: parts[0] ?? "",
  };
};

export const mcpServerId = (name: string) => {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug ? `mcp-${slug}` : createClientId("mcp");
};
