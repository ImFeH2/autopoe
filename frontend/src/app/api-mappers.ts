import type {
  ApiMcpServer,
  ApiMcpTool,
  ApiProvider,
  ApiTelegramBot,
  ApiTelegramSession,
  ApiWritablePath,
  ApiWorkflow,
  ApiWorkflowDefinition,
  ApiWorkflowEdge,
  ApiWorkflowNode,
  ApiWorkflowRunResult,
} from "@/app/api-types";
import type {
  ContextUsageInfo,
  McpServer,
  McpTool,
  Provider,
  Skill,
  TelegramBot,
  TelegramSession,
  Workflow,
  WorkflowDefinition,
  WorkflowEdge,
  WorkflowNode,
  WorkflowRunResult,
  WritablePath,
} from "@/components/flowent/types";
import { createClientId } from "@/lib/utils";

export const errorNotificationKeysFromState = (
  telegramBot: TelegramBot,
  mcpServers: McpServer[],
  skills: Skill[],
) => {
  const keys: string[] = [];
  if (telegramBot.status === "error" && telegramBot.error) {
    keys.push(`channel:telegram:${telegramBot.error}`);
  }
  for (const server of mcpServers) {
    if (server.status === "error" && server.error) {
      keys.push(`mcp:${server.id}:${server.error}`);
    }
  }
  for (const skill of skills) {
    if (skill.enabled && skill.error) {
      keys.push(`skill:${skill.id}:${skill.error}`);
    }
  }
  return keys;
};

export const contextWindowFromLimit = (
  usageInfo: ContextUsageInfo | null,
  contextWindowLimit: number | null,
) => {
  if (usageInfo === null || contextWindowLimit === null) {
    return usageInfo;
  }
  return {
    ...usageInfo,
    model_context_window: contextWindowLimit,
  };
};

export const providerFromApi = (provider: ApiProvider): Provider => ({
  apiKey: provider.api_key,
  baseUrl: provider.base_url,
  id: provider.id,
  models: provider.models,
  name: provider.name,
  type: provider.type,
});

export const providerToApi = (provider: Provider): ApiProvider => ({
  api_key: provider.apiKey,
  base_url: provider.baseUrl,
  id: provider.id,
  models: provider.models,
  name: provider.name,
  type: provider.type,
});

export const telegramSessionFromApi = (
  session: ApiTelegramSession,
): TelegramSession => ({
  chatId: session.chat_id,
  displayName: session.display_name,
  recentMessage: session.recent_message,
  status: session.status,
  updatedAt: session.updated_at ?? 0,
  userId: session.user_id,
  username: session.username,
});

export const telegramSessionToApi = (
  session: TelegramSession,
): ApiTelegramSession => ({
  chat_id: session.chatId,
  display_name: session.displayName,
  recent_message: session.recentMessage,
  status: session.status,
  updated_at: session.updatedAt,
  user_id: session.userId,
  username: session.username,
});

export const createEmptyTelegramBot = (): TelegramBot => ({
  botSecret: "",
  enabled: false,
  error: "",
  sessions: [],
  status: "disabled",
});

export const telegramBotFromApi = (
  telegramBot?: ApiTelegramBot,
): TelegramBot => ({
  botSecret: telegramBot?.bot_token ?? "",
  enabled: telegramBot?.enabled ?? false,
  error: telegramBot?.error ?? "",
  sessions: (telegramBot?.sessions ?? []).map(telegramSessionFromApi),
  status: telegramBot?.status ?? "disabled",
});

export const telegramBotToApi = (telegramBot: TelegramBot): ApiTelegramBot => ({
  bot_token: telegramBot.botSecret,
  enabled: telegramBot.enabled,
  error: telegramBot.error,
  sessions: telegramBot.sessions.map(telegramSessionToApi),
  status: telegramBot.status,
});

export const writablePathFromApi = (
  writablePath: ApiWritablePath,
): WritablePath => ({
  createdAt: writablePath.created_at,
  path: writablePath.path,
});

export const workflowNodeFromApi = (node: ApiWorkflowNode): WorkflowNode => ({
  data: node.data ?? {},
  description: node.description ?? "",
  id: node.id,
  name: node.name,
  position: node.position ?? { x: 0, y: 0 },
  type: node.type,
});

export const workflowNodeToApi = (node: WorkflowNode): ApiWorkflowNode => ({
  data: node.data,
  description: node.description,
  id: node.id,
  name: node.name,
  position: node.position,
  type: node.type,
});

export const workflowEdgeFromApi = (edge: ApiWorkflowEdge): WorkflowEdge => ({
  id: edge.id,
  label: edge.label ?? "",
  source: edge.source,
  sourceHandle: edge.source_handle ?? "",
  target: edge.target,
  targetHandle: edge.target_handle ?? "",
});

export const workflowEdgeToApi = (edge: WorkflowEdge): ApiWorkflowEdge => ({
  id: edge.id,
  label: edge.label,
  source: edge.source,
  source_handle: edge.sourceHandle,
  target: edge.target,
  target_handle: edge.targetHandle,
});

export const workflowDefinitionFromApi = (
  definition: ApiWorkflowDefinition,
): WorkflowDefinition => ({
  edges: (definition.edges ?? []).map(workflowEdgeFromApi),
  nodes: (definition.nodes ?? []).map(workflowNodeFromApi),
  version: definition.version ?? 1,
});

export const workflowDefinitionToApi = (
  definition: WorkflowDefinition,
): ApiWorkflowDefinition => ({
  edges: definition.edges.map(workflowEdgeToApi),
  nodes: definition.nodes.map(workflowNodeToApi),
  version: definition.version,
});

export const workflowFromApi = (workflow: ApiWorkflow): Workflow => ({
  createdAt: workflow.created_at,
  definition: workflowDefinitionFromApi(workflow.definition),
  id: workflow.id,
  name: workflow.name,
  updatedAt: workflow.updated_at,
});

export const workflowToApi = (workflow: Workflow): ApiWorkflow => ({
  created_at: workflow.createdAt,
  definition: workflowDefinitionToApi(workflow.definition),
  id: workflow.id,
  name: workflow.name,
  updated_at: workflow.updatedAt,
});

export const workflowRunResultFromApi = (
  result: ApiWorkflowRunResult,
): WorkflowRunResult => ({
  nodeResults: result.node_results.map((nodeResult) => ({
    error: nodeResult.error,
    id: nodeResult.id,
    output: nodeResult.output,
    status: nodeResult.status,
  })),
  outputs: result.outputs,
  status: result.status,
  workflowId: result.workflow_id,
});

export const errorMessageFromResponse = async (
  response: Response,
  fallback: string,
) => {
  try {
    const body = (await response.json()) as { detail?: unknown };
    if (typeof body.detail === "string" && body.detail.trim()) {
      return body.detail;
    }
  } catch {
    return fallback;
  }
  return fallback;
};

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
