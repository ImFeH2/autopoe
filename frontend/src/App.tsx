import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { AppShell } from "@/components/flowent/app-shell";
import { ChannelsView } from "@/components/flowent/channels-view";
import { McpView } from "@/components/flowent/mcp-view";
import {
  createEmptyProvider,
  providerOptions,
} from "@/components/flowent/provider-options";
import { PermissionsView } from "@/components/flowent/permissions-view";
import { ProvidersView } from "@/components/flowent/providers-view";
import { SettingsView } from "@/components/flowent/settings-view";
import { SkillsView } from "@/components/flowent/skills-view";
import { viewPanelClassName } from "@/components/flowent/styles";
import { FlowentToastProvider } from "@/components/flowent/toast";
import { useFlowentToast } from "@/components/flowent/toast-context";
import type {
  AssistantOutputGroup,
  AssistantOutputItem,
  McpImportSource,
  McpServer,
  McpTool,
  Message,
  ContextUsageInfo,
  MessageActionRequest,
  MessageErrorRetryRequest,
  Provider,
  ReasoningEffort,
  RuntimeSettings,
  Skill,
  TelegramBot,
  TelegramSession,
  ToolItem,
  ViewId,
  Workflow,
  WorkflowDefinition,
  WorkflowEdge,
  WorkflowNode,
  WorkflowNodeRunResult,
  WorkflowRunResult,
  WritablePath,
  WorkspaceCommand,
  WorkspaceCommandId,
} from "@/components/flowent/types";
import { WorkflowsView } from "@/components/flowent/workflows-view";
import { WorkspaceView } from "@/components/flowent/workspace-view";
import { TabsContent } from "@/components/ui/tabs";
import { createClientId } from "@/lib/utils";

type ApiProvider = {
  api_key: string;
  base_url: string;
  id: string;
  models: string[];
  name: string;
  type: Provider["type"];
};

type ApiTelegramSession = {
  chat_id: string;
  display_name: string;
  recent_message: string;
  status: TelegramSession["status"];
  updated_at?: number;
  user_id: string;
  username: string;
};

type ApiTelegramBot = {
  bot_token: string;
  enabled: boolean;
  error?: string;
  sessions?: ApiTelegramSession[];
  status?: TelegramBot["status"];
};

type ApiMcpTool = {
  description?: string;
  input_schema?: Record<string, unknown>;
  name: string;
  output_schema?: Record<string, unknown> | null;
};

type ApiMcpServer = {
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

type ApiMcpImportPreview = {
  servers?: ApiMcpServer[];
};

type ApiSkill = Skill;

type ApiWritablePath = {
  created_at: number;
  path: string;
};

type ApiWorkflowNode = {
  data: Record<string, unknown>;
  description: string;
  id: string;
  name: string;
  position: {
    x: number;
    y: number;
  };
  type: WorkflowNode["type"];
};

type ApiWorkflowEdge = {
  id: string;
  label: string;
  source: string;
  source_handle: string;
  target: string;
  target_handle: string;
};

type ApiWorkflowDefinition = {
  edges: ApiWorkflowEdge[];
  nodes: ApiWorkflowNode[];
  version: number;
};

type ApiWorkflow = {
  created_at: number;
  definition: ApiWorkflowDefinition;
  id: string;
  name: string;
  updated_at: number;
};

type ApiWorkflowNodeRunResult = {
  error: string;
  id: string;
  output: string;
  status: WorkflowNodeRunResult["status"];
};

type ApiWorkflowRunResult = {
  node_results: ApiWorkflowNodeRunResult[];
  outputs: Record<string, string>;
  status: WorkflowRunResult["status"];
  workflow_id: string;
};

type ApiMessage = Message;

type ApiState = {
  is_responding?: boolean;
  is_compacting?: boolean;
  mcp_servers?: ApiMcpServer[];
  messages: ApiMessage[];
  providers: ApiProvider[];
  settings: {
    agent_prompt?: string;
    context_window_limit?: number | null;
    reasoning_effort?: ReasoningEffort;
    selected_model: string;
    selected_provider_id: string;
  };
  skills?: ApiSkill[];
  telegram_bot?: ApiTelegramBot;
  usage_info?: ContextUsageInfo | null;
  response_event_index?: number;
  writable_paths?: ApiWritablePath[];
  workflows?: ApiWorkflow[];
};

type ApiAbout = {
  version?: string;
};

const errorNotificationKeysFromState = (
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

type RequestResult<T> =
  | {
      data: T;
      error: "";
    }
  | {
      data: null;
      error: string;
    };

type WorkspaceMessageEditResponse = {
  is_responding?: boolean;
  messages: ApiMessage[];
};

const contextWindowFromLimit = (
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

type WorkspaceStreamEvent =
  | {
      data: {
        id: string;
      };
      event: "start";
    }
  | {
      data: {
        index: number;
      };
      event: "output_start";
    }
  | {
      data: {
        index: number;
      };
      event: "output_done";
    }
  | {
      data: {
        content: string;
      };
      event: "delta";
    }
  | {
      data: {
        content: string;
      };
      event: "thinking_delta";
    }
  | {
      data: {
        message: ApiMessage;
      };
      event: "snapshot";
    }
  | {
      data: {
        message: ApiMessage;
      };
      event: "done";
    }
  | {
      data: {
        message: ApiMessage;
        usage_info?: ContextUsageInfo;
      };
      event: "context_optimized";
    }
  | {
      data: {
        usage_info: ContextUsageInfo;
      };
      event: "usage";
    }
  | {
      data: {
        tool: ToolItem;
      };
      event: "tool_start";
    }
  | {
      data: {
        id: string;
        result?: Record<string, unknown>;
        status: ToolItem["status"];
        title?: string;
      };
      event: "tool_done" | "tool_error";
    }
  | {
      data: {
        error?: Extract<AssistantOutputItem, { type: "error" }>;
        message: string;
      };
      event: "error";
    };

type WorkspaceStreamEventEnvelope = WorkspaceStreamEvent & {
  eventIndex?: number;
};

type WorkspaceStreamHandlers = {
  onEventIndex: (eventIndex: number) => void;
  onContextOptimized: (message: ApiMessage) => void;
  onDelta: (content: string) => void;
  onDone: (message: ApiMessage) => void;
  onError: (
    error: Extract<AssistantOutputItem, { type: "error" }>,
  ) => Message | null | void;
  onOutputDone: () => void;
  onOutputStart: (index: number) => void;
  onSnapshot: (message: ApiMessage) => void;
  onStart: (id: string) => void;
  onThinkingDelta: (content: string) => void;
  onToolDone: (
    tool: Pick<ToolItem, "id" | "status"> & Partial<ToolItem>,
  ) => void;
  onToolStart: (tool: ToolItem) => void;
  onUsage: (usageInfo: ContextUsageInfo) => void;
};

const providerFromApi = (provider: ApiProvider): Provider => ({
  apiKey: provider.api_key,
  baseUrl: provider.base_url,
  id: provider.id,
  models: provider.models,
  name: provider.name,
  type: provider.type,
});

const providerToApi = (provider: Provider): ApiProvider => ({
  api_key: provider.apiKey,
  base_url: provider.baseUrl,
  id: provider.id,
  models: provider.models,
  name: provider.name,
  type: provider.type,
});

const telegramSessionFromApi = (
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

const telegramSessionToApi = (
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

const createEmptyTelegramBot = (): TelegramBot => ({
  botSecret: "",
  enabled: false,
  error: "",
  sessions: [],
  status: "disabled",
});

const telegramBotFromApi = (telegramBot?: ApiTelegramBot): TelegramBot => ({
  botSecret: telegramBot?.bot_token ?? "",
  enabled: telegramBot?.enabled ?? false,
  error: telegramBot?.error ?? "",
  sessions: (telegramBot?.sessions ?? []).map(telegramSessionFromApi),
  status: telegramBot?.status ?? "disabled",
});

const telegramBotToApi = (telegramBot: TelegramBot): ApiTelegramBot => ({
  bot_token: telegramBot.botSecret,
  enabled: telegramBot.enabled,
  error: telegramBot.error,
  sessions: telegramBot.sessions.map(telegramSessionToApi),
  status: telegramBot.status,
});

const writablePathFromApi = (writablePath: ApiWritablePath): WritablePath => ({
  createdAt: writablePath.created_at,
  path: writablePath.path,
});

const workflowNodeFromApi = (node: ApiWorkflowNode): WorkflowNode => ({
  data: node.data ?? {},
  description: node.description ?? "",
  id: node.id,
  name: node.name,
  position: node.position ?? { x: 0, y: 0 },
  type: node.type,
});

const workflowNodeToApi = (node: WorkflowNode): ApiWorkflowNode => ({
  data: node.data,
  description: node.description,
  id: node.id,
  name: node.name,
  position: node.position,
  type: node.type,
});

const workflowEdgeFromApi = (edge: ApiWorkflowEdge): WorkflowEdge => ({
  id: edge.id,
  label: edge.label ?? "",
  source: edge.source,
  sourceHandle: edge.source_handle ?? "",
  target: edge.target,
  targetHandle: edge.target_handle ?? "",
});

const workflowEdgeToApi = (edge: WorkflowEdge): ApiWorkflowEdge => ({
  id: edge.id,
  label: edge.label,
  source: edge.source,
  source_handle: edge.sourceHandle,
  target: edge.target,
  target_handle: edge.targetHandle,
});

const workflowDefinitionFromApi = (
  definition: ApiWorkflowDefinition,
): WorkflowDefinition => ({
  edges: (definition.edges ?? []).map(workflowEdgeFromApi),
  nodes: (definition.nodes ?? []).map(workflowNodeFromApi),
  version: definition.version ?? 1,
});

const workflowDefinitionToApi = (
  definition: WorkflowDefinition,
): ApiWorkflowDefinition => ({
  edges: definition.edges.map(workflowEdgeToApi),
  nodes: definition.nodes.map(workflowNodeToApi),
  version: definition.version,
});

const workflowFromApi = (workflow: ApiWorkflow): Workflow => ({
  createdAt: workflow.created_at,
  definition: workflowDefinitionFromApi(workflow.definition),
  id: workflow.id,
  name: workflow.name,
  updatedAt: workflow.updated_at,
});

const workflowToApi = (workflow: Workflow): ApiWorkflow => ({
  created_at: workflow.createdAt,
  definition: workflowDefinitionToApi(workflow.definition),
  id: workflow.id,
  name: workflow.name,
  updated_at: workflow.updatedAt,
});

const workflowRunResultFromApi = (
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

const errorMessageFromResponse = async (
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

const mcpCommandLine = (server: Pick<McpServer, "args" | "command">) =>
  [server.command, ...server.args].filter(Boolean).join(" ");

const mcpToolFromApi = (tool: ApiMcpTool): McpTool => ({
  description: tool.description ?? "",
  inputSchema: tool.input_schema ?? {},
  name: tool.name,
  outputSchema: tool.output_schema ?? null,
});

const mcpServerFromApi = (server: ApiMcpServer): McpServer => ({
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

const mcpServerToApi = (server: McpServer): ApiMcpServer => ({
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

const createEmptyMcpServer = (): McpServer => ({
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

const parseCommandLine = (commandLine: string) => {
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

const mcpServerId = (name: string) => {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug ? `mcp-${slug}` : createClientId("mcp");
};

const assistantGroupsFromMessage = (
  message: Message,
): AssistantOutputGroup[] => {
  if (message.groups?.length) {
    return message.groups;
  }

  const thinkingItem: AssistantOutputItem | null = message.thinking
    ? {
        content: message.thinking,
        id: `${message.id}-thinking-existing`,
        isStreaming: false,
        type: "thinking",
      }
    : null;
  const toolItems: AssistantOutputItem[] = (message.tools ?? []).map(
    (tool) => ({
      id: `tool-${tool.id}`,
      tool,
      type: "tool",
    }),
  );
  const groups: AssistantOutputGroup[] = [];
  const processItems = [...(thinkingItem ? [thinkingItem] : []), ...toolItems];

  if (processItems.length) {
    groups.push({
      id: `${message.id}-process-existing`,
      items: processItems,
    });
  }
  if (message.content) {
    groups.push({
      id: `${message.id}-content-existing`,
      items: [
        {
          content: message.content,
          id: `${message.id}-text-existing`,
          type: "text",
        },
      ],
    });
  }

  return groups;
};

const countAssistantOutputItems = (
  groups: AssistantOutputGroup[],
  type: AssistantOutputItem["type"],
) =>
  groups.flatMap((group) => group.items).filter((item) => item.type === type)
    .length;

const latestAssistantOutputItem = (groups: AssistantOutputGroup[]) => {
  for (let groupIndex = groups.length - 1; groupIndex >= 0; groupIndex -= 1) {
    const items = groups[groupIndex]?.items ?? [];
    for (let itemIndex = items.length - 1; itemIndex >= 0; itemIndex -= 1) {
      const item = items[itemIndex];
      if (item) {
        return item;
      }
    }
  }

  return null;
};

const trimAssistantMessageAtError = (
  message: Message,
  errorId: string,
): Message | null => {
  const nextGroups: AssistantOutputGroup[] = [];
  let foundError = false;
  for (const group of assistantGroupsFromMessage(message)) {
    const nextItems: AssistantOutputItem[] = [];
    for (const item of group.items) {
      if (item.type === "error" && item.id === errorId) {
        foundError = true;
        break;
      }
      nextItems.push(item);
    }
    if (foundError) {
      if (nextItems.length > 0) {
        nextGroups.push({ ...group, items: nextItems });
      }
      break;
    }
    nextGroups.push(group);
  }

  if (!foundError) {
    return null;
  }

  return {
    ...message,
    content: nextGroups
      .flatMap((group) => group.items)
      .filter((item) => item.type === "text")
      .map((item) => item.content)
      .join(""),
    groups: nextGroups,
    isStreamingText: false,
    isStreamingThinking: false,
    status: "running",
    thinking: nextGroups
      .flatMap((group) => group.items)
      .filter((item) => item.type === "thinking")
      .map((item) => item.content)
      .join(""),
    tools: nextGroups
      .flatMap((group) => group.items)
      .filter((item) => item.type === "tool")
      .map((item) => item.tool),
  };
};

const streamErrorFromMessage = (
  message: string,
  assistantId: string,
): Extract<AssistantOutputItem, { type: "error" }> => ({
  id: `${assistantId || "assistant"}-error-1`,
  message,
  title: "Response interrupted",
  type: "error",
});

const requestFailedMessage =
  "Check the model connection settings and try again.";

const createWorkspaceErrorMessage = (
  detail: string,
  id = createClientId("message"),
): Message => ({
  author: "assistant",
  content: "",
  groups: [
    {
      id: `${id}-errors`,
      items: [
        {
          id: `${id}-error-1`,
          message: requestFailedMessage,
          title: "Request failed",
          type: "error",
          ...(detail &&
          detail !== requestFailedMessage &&
          detail !== "Request failed"
            ? { detail }
            : {}),
        },
      ],
    },
  ],
  id,
  status: "failed",
});

const createWorkspaceStreamErrorMessage = (
  outputError: Extract<AssistantOutputItem, { type: "error" }>,
  id = createClientId("message"),
): Message => ({
  author: "assistant",
  content: "",
  groups: [
    {
      id: `${id}-errors`,
      items: [
        {
          ...outputError,
          id: outputError.id || `${id}-error-1`,
        },
      ],
    },
  ],
  id,
  status: "failed",
});

const messageHasErrorBlock = (message: Message) =>
  (message.groups ?? [])
    .flatMap((group) => group.items)
    .some((item) => item.type === "error");

const messagesIncludeErrorBlockFrom = (
  messages: Message[],
  startIndex: number,
) =>
  messages
    .slice(startIndex)
    .some(
      (message) =>
        message.author === "assistant" && messageHasErrorBlock(message),
    );

const latestUsageInfoFromMessages = (
  messages: Message[],
): ContextUsageInfo | null => {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const currentUsageInfo = messages[index]?.usage_info;
    if (currentUsageInfo) {
      return currentUsageInfo;
    }
  }
  return null;
};

const isAbortError = (error: unknown) =>
  typeof error === "object" &&
  error !== null &&
  "name" in error &&
  error.name === "AbortError";

class WorkspaceRequestError extends Error {}

class WorkspaceStreamError extends Error {
  errorMessage: Message | null;
  outputError: Extract<AssistantOutputItem, { type: "error" }>;

  constructor(
    message: string,
    outputError: Extract<AssistantOutputItem, { type: "error" }>,
    errorMessage: Message | null,
  ) {
    super(message);
    this.errorMessage = errorMessage;
    this.outputError = outputError;
  }
}

const previousUserMessage = (messages: Message[], fromIndex: number) => {
  for (let index = fromIndex; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.author === "user") {
      return message;
    }
  }
  return null;
};

function FlowentApp() {
  const toast = useFlowentToast();
  const [activeView, setActiveView] = useState<ViewId>("workspace");
  const [draft, setDraft] = useState("");
  const [agentPrompt, setAgentPrompt] = useState("");
  const [selectedProviderId, setSelectedProviderId] = useState("");
  const [selectedModel, setSelectedModel] = useState("");
  const [contextWindowLimit, setContextWindowLimit] = useState<number | null>(
    null,
  );
  const [reasoningEffort, setReasoningEffort] =
    useState<ReasoningEffort>("default");
  const [appVersion, setAppVersion] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [usageInfo, setUsageInfo] = useState<ContextUsageInfo | null>(null);
  const usageInfoRef = useRef<ContextUsageInfo | null>(null);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [mcpServers, setMcpServers] = useState<McpServer[]>([]);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [activeSkillId, setActiveSkillId] = useState("");
  const [mcpEditorId, setMcpEditorId] = useState("new");
  const [mcpDraft, setMcpDraft] = useState<McpServer>(() =>
    createEmptyMcpServer(),
  );
  const [isMcpImportOpen, setIsMcpImportOpen] = useState(false);
  const [mcpImportPreview, setMcpImportPreview] = useState<McpServer[]>([]);
  const [mcpImportSource, setMcpImportSource] =
    useState<McpImportSource>("claude_code");
  const [isPreviewingMcpImport, setIsPreviewingMcpImport] = useState(false);
  const [importingMcpServerId, setImportingMcpServerId] = useState("");
  const [telegramBot, setTelegramBot] = useState<TelegramBot>(() =>
    createEmptyTelegramBot(),
  );
  const [providerEditorId, setProviderEditorId] = useState("new");
  const [providerDraft, setProviderDraft] = useState<Provider>(() =>
    createEmptyProvider(),
  );
  const [isFetchingModels, setIsFetchingModels] = useState(false);
  const [isResponding, setIsResponding] = useState(false);
  const [isRefiningContext, setIsRefiningContext] = useState(false);
  const [writablePaths, setWritablePaths] = useState<WritablePath[]>([]);
  const [responseError, setResponseError] = useState("");
  const responseAbortRef = useRef<AbortController | null>(null);
  const responseEventIndexRef = useRef(0);
  const messagesRef = useRef<Message[]>([]);
  const responseRunRef = useRef(0);
  const errorNotificationKeysRef = useRef<Set<string>>(new Set());
  const hasLoadedStateRef = useRef(false);
  const [streamReconnectKey, setStreamReconnectKey] = useState(0);
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [workflowRunResult, setWorkflowRunResult] =
    useState<WorkflowRunResult | null>(null);
  const [runningWorkflowId, setRunningWorkflowId] = useState("");
  const [activeWorkflowId, setActiveWorkflowId] = useState("");
  const [newWorkflowKey, setNewWorkflowKey] = useState(0);

  const activeProvider = useMemo(
    () => providers.find((provider) => provider.id === selectedProviderId),
    [providers, selectedProviderId],
  );
  const isCreatingProvider = providerEditorId === "new";
  const isCreatingMcpServer = mcpEditorId === "new";
  const activeSkill = useMemo(
    () => skills.find((skill) => skill.id === activeSkillId) ?? skills[0],
    [activeSkillId, skills],
  );
  const hasStartingMcpServer = useMemo(
    () => mcpServers.some((server) => server.status === "starting"),
    [mcpServers],
  );
  const activeWorkflow = useMemo(
    () =>
      workflows.find((workflow) => workflow.id === activeWorkflowId) ?? null,
    [activeWorkflowId, workflows],
  );

  const setTrackedUsageInfo = useCallback(
    (
      nextUsageInfo:
        | ContextUsageInfo
        | null
        | ((
            currentUsageInfo: ContextUsageInfo | null,
          ) => ContextUsageInfo | null),
    ) => {
      if (typeof nextUsageInfo !== "function") {
        usageInfoRef.current = nextUsageInfo;
        setUsageInfo(nextUsageInfo);
        return;
      }
      setUsageInfo((currentUsageInfo) => {
        const resolvedUsageInfo = nextUsageInfo(currentUsageInfo);
        usageInfoRef.current = resolvedUsageInfo;
        return resolvedUsageInfo;
      });
    },
    [],
  );

  useEffect(() => {
    const nextNotificationKeys = new Set<string>();

    const notifyOnce = (key: string, message: string) => {
      nextNotificationKeys.add(key);
      if (errorNotificationKeysRef.current.has(key)) {
        return;
      }
      toast.error(message);
    };

    if (telegramBot.status === "error" && telegramBot.error) {
      notifyOnce(`channel:telegram:${telegramBot.error}`, telegramBot.error);
    }

    for (const server of mcpServers) {
      if (server.status !== "error" || !server.error) {
        continue;
      }
      notifyOnce(`mcp:${server.id}:${server.error}`, server.error);
    }

    for (const skill of skills) {
      if (!skill.enabled || !skill.error) {
        continue;
      }
      notifyOnce(`skill:${skill.id}:${skill.error}`, skill.error);
    }

    errorNotificationKeysRef.current = nextNotificationKeys;
  }, [mcpServers, skills, telegramBot, toast]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  const applyLoadedState = useCallback(
    (state: ApiState) => {
      const loadedProviders = state.providers.map(providerFromApi);
      setProviders(loadedProviders);
      setMessages(state.messages);
      setTrackedUsageInfo(
        contextWindowFromLimit(
          state.usage_info ?? latestUsageInfoFromMessages(state.messages),
          state.settings.context_window_limit ?? null,
        ),
      );
      const loadedMcpServers = (state.mcp_servers ?? []).map(mcpServerFromApi);
      setMcpServers(loadedMcpServers);
      if (loadedMcpServers[0]) {
        setMcpEditorId(loadedMcpServers[0].id);
        setMcpDraft(loadedMcpServers[0]);
      }
      const loadedSkills = state.skills ?? [];
      setSkills(loadedSkills);
      setActiveSkillId(loadedSkills[0]?.id ?? "");
      setAgentPrompt(state.settings.agent_prompt ?? "");
      setSelectedProviderId(state.settings.selected_provider_id);
      setSelectedModel(state.settings.selected_model);
      setContextWindowLimit(state.settings.context_window_limit ?? null);
      setReasoningEffort(state.settings.reasoning_effort ?? "default");
      const loadedTelegramBot = telegramBotFromApi(state.telegram_bot);
      setTelegramBot(loadedTelegramBot);
      setWritablePaths((state.writable_paths ?? []).map(writablePathFromApi));
      setWorkflows((state.workflows ?? []).map(workflowFromApi));
      const shouldResumeResponse = Boolean(state.is_responding);
      responseEventIndexRef.current = state.response_event_index ?? 0;
      setIsResponding(shouldResumeResponse);
      setIsRefiningContext(Boolean(state.is_compacting));
      if (!hasLoadedStateRef.current) {
        if (shouldResumeResponse) {
          setStreamReconnectKey((current) => current + 1);
        }
        errorNotificationKeysRef.current = new Set(
          errorNotificationKeysFromState(
            loadedTelegramBot,
            loadedMcpServers,
            loadedSkills,
          ),
        );
        hasLoadedStateRef.current = true;
      }
    },
    [setTrackedUsageInfo],
  );

  const refreshAppState = useCallback(async () => {
    const response = await fetch("/api/state");
    if (!response.ok) {
      return null;
    }
    const state = (await response.json()) as ApiState;
    applyLoadedState(state);
    return state;
  }, [applyLoadedState]);

  useEffect(() => {
    let isMounted = true;

    const loadState = async () => {
      try {
        const [state, aboutResponse] = await Promise.all([
          refreshAppState(),
          fetch("/api/about"),
        ]);
        if (!state) {
          return;
        }
        const about = aboutResponse.ok
          ? ((await aboutResponse.json()) as ApiAbout)
          : {};
        if (!isMounted) {
          return;
        }

        setAppVersion(typeof about.version === "string" ? about.version : "");
      } catch {
        // Keep the local empty state when persistence is unavailable.
      }
    };

    void loadState();

    return () => {
      isMounted = false;
    };
  }, [refreshAppState]);

  useEffect(() => {
    if (!hasStartingMcpServer) {
      return;
    }

    let isMounted = true;
    const refreshMcpServers = async () => {
      try {
        const response = await fetch("/api/state");
        if (!response.ok || !isMounted) {
          return;
        }
        const state = (await response.json()) as ApiState;
        if (!isMounted) {
          return;
        }
        const loadedMcpServers = (state.mcp_servers ?? []).map(
          mcpServerFromApi,
        );
        setMcpServers(loadedMcpServers);
        setMcpDraft((currentDraft) => {
          const refreshedServer = loadedMcpServers.find(
            (server) => server.id === currentDraft.id,
          );
          if (!refreshedServer) {
            return currentDraft;
          }
          return {
            ...currentDraft,
            error: refreshedServer.error,
            status: refreshedServer.status,
            tools: refreshedServer.tools,
          };
        });
      } catch {
        // Keep showing the optimistic status until the next poll succeeds.
      }
    };

    void refreshMcpServers();
    const intervalId = window.setInterval(() => {
      void refreshMcpServers();
    }, 1000);

    return () => {
      isMounted = false;
      window.clearInterval(intervalId);
    };
  }, [hasStartingMcpServer]);

  useEffect(() => {
    if (!isRefiningContext) {
      return;
    }

    const intervalId = window.setInterval(() => {
      void refreshAppState().catch(() => undefined);
    }, 1000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [isRefiningContext, refreshAppState]);

  const loadProviderEditor = (provider: Provider) => {
    setProviderEditorId(provider.id);
    setProviderDraft(provider);
  };

  const openNewProviderEditor = () => {
    setProviderEditorId("new");
    setProviderDraft(createEmptyProvider());
  };

  const updateTelegramBot = (updates: Partial<TelegramBot>) => {
    setTelegramBot((current) => ({ ...current, ...updates }));
  };

  const loadMcpEditor = (server: McpServer) => {
    setIsMcpImportOpen(false);
    setMcpEditorId(server.id);
    setMcpDraft(server);
  };

  const openNewMcpEditor = () => {
    setIsMcpImportOpen(false);
    setMcpEditorId("new");
    setMcpDraft(createEmptyMcpServer());
  };

  const openMcpImport = () => {
    setIsMcpImportOpen(true);
    setMcpImportPreview([]);
    setMcpImportSource("claude_code");
    void previewMcpImport("claude_code");
  };

  const selectSkill = (skill: Skill) => {
    setActiveSkillId(skill.id);
  };

  const updateMcpDraft = (updates: Partial<McpServer>) => {
    setMcpDraft((current) => ({ ...current, ...updates }));
  };

  const previewMcpImport = async (source = mcpImportSource) => {
    setIsPreviewingMcpImport(true);
    try {
      const response = await fetch("/api/mcp/import/preview", {
        body: JSON.stringify({ source }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      if (!response.ok) {
        throw new Error("Scan could not be completed.");
      }
      const result = (await response.json()) as ApiMcpImportPreview;
      const servers = (result.servers ?? []).map((server) =>
        mcpServerFromApi(server),
      );
      setMcpImportPreview(servers);
    } catch {
      setMcpImportPreview([]);
      toast.error("Scan could not be completed.");
    } finally {
      setIsPreviewingMcpImport(false);
    }
  };

  const importMcpServer = async (serverId: string) => {
    if (!mcpImportPreview.some((server) => server.id === serverId)) {
      toast.error("No servers found.");
      return;
    }

    setImportingMcpServerId(serverId);
    try {
      const response = await fetch("/api/mcp/import", {
        body: JSON.stringify({
          server_id: serverId,
          source: mcpImportSource,
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      if (!response.ok) {
        throw new Error("Import could not be completed.");
      }
      const result = (await response.json()) as ApiMcpServer[];
      const importedServers = result.map((server) => mcpServerFromApi(server));
      setMcpServers(importedServers);
      const nextServer =
        importedServers.find((server) => server.id === serverId) ??
        importedServers[0];
      if (nextServer) {
        setIsMcpImportOpen(false);
        setMcpEditorId(nextServer.id);
        setMcpDraft(nextServer);
      }
    } catch {
      toast.error("Import could not be completed.");
    } finally {
      setImportingMcpServerId("");
    }
  };

  const updateMcpImportSource = (source: McpImportSource) => {
    setMcpImportSource(source);
    setMcpImportPreview([]);
    void previewMcpImport(source);
  };

  const updateProviderDraft = (updates: Partial<Provider>) => {
    setProviderDraft((current) => ({ ...current, ...updates }));
  };

  const persistSettings = async (settings: RuntimeSettings) => {
    await fetch("/api/settings", {
      body: JSON.stringify({
        agent_prompt: settings.agentPrompt,
        context_window_limit: settings.contextWindowLimit,
        reasoning_effort: settings.reasoningEffort,
        selected_model: settings.selectedModel,
        selected_provider_id: settings.selectedProviderId,
      }),
      headers: { "Content-Type": "application/json" },
      method: "PUT",
    });
  };

  const persistSettingsAndRefresh = async (settings: RuntimeSettings) => {
    await persistSettings(settings);
    await refreshAppState();
  };

  const handleActiveProviderChange = (value: string) => {
    const nextProvider = providers.find((provider) => provider.id === value);
    if (!nextProvider) {
      setSelectedProviderId("");
      setSelectedModel("");
      void persistSettingsAndRefresh({
        agentPrompt,
        contextWindowLimit,
        reasoningEffort,
        selectedModel: "",
        selectedProviderId: "",
      });
      return;
    }

    setSelectedProviderId(nextProvider.id);
    setSelectedModel("");
    void persistSettingsAndRefresh({
      agentPrompt,
      contextWindowLimit,
      reasoningEffort,
      selectedModel: "",
      selectedProviderId: nextProvider.id,
    });
  };

  const handleActiveModelChange = (value: string) => {
    setSelectedModel(value);
    void persistSettingsAndRefresh({
      agentPrompt,
      contextWindowLimit,
      reasoningEffort,
      selectedModel: value,
      selectedProviderId,
    });
  };

  const handleReasoningEffortChange = (value: ReasoningEffort) => {
    setReasoningEffort(value);
    void persistSettings({
      agentPrompt,
      contextWindowLimit,
      reasoningEffort: value,
      selectedModel,
      selectedProviderId,
    });
  };

  const saveRuntimeSettings = (settings: RuntimeSettings) => {
    setAgentPrompt(settings.agentPrompt);
    setContextWindowLimit(settings.contextWindowLimit);
    setTrackedUsageInfo((currentUsageInfo) =>
      contextWindowFromLimit(currentUsageInfo, settings.contextWindowLimit),
    );
    setReasoningEffort(settings.reasoningEffort);
    setSelectedModel(settings.selectedModel);
    setSelectedProviderId(settings.selectedProviderId);
    void persistSettingsAndRefresh(settings);
  };

  const providerModelFetchFailureMessages = {
    access_denied: {
      description: "Check the key and account access.",
      message: "Access denied.",
    },
    connection_failed: {
      description: "Check the address and try again.",
      message: "Connection failed.",
    },
    provider_unavailable: {
      description: "The service is currently unreachable.",
      message: "Provider unavailable.",
    },
    rate_limited: {
      description: "Please wait a moment and try again.",
      message: "Too many requests.",
    },
    request_failed: {
      description: "Check the connection settings and try again.",
      message: "Request failed.",
    },
  } as const;

  type ProviderModelFetchFailure =
    keyof typeof providerModelFetchFailureMessages;

  const isProviderModelFetchFailure = (
    value: unknown,
  ): value is ProviderModelFetchFailure =>
    typeof value === "string" && value in providerModelFetchFailureMessages;

  const providerModelFetchFailureFromResponse = async (
    response: Response,
  ): Promise<ProviderModelFetchFailure> => {
    try {
      const result = (await response.json()) as { detail?: { code?: unknown } };
      const code = result.detail?.code;
      if (isProviderModelFetchFailure(code)) {
        return code;
      }
    } catch {
      return "request_failed";
    }

    return "request_failed";
  };

  const fetchProviderModels = async () => {
    setIsFetchingModels(true);

    try {
      const response = await fetch("/api/providers/models", {
        body: JSON.stringify({
          base_url: providerDraft.baseUrl,
          provider: providerDraft.type,
          secret_reference: providerDraft.apiKey,
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });

      if (!response.ok) {
        const failure = await providerModelFetchFailureFromResponse(response);
        toast.error(providerModelFetchFailureMessages[failure]);
        return;
      }

      const result = (await response.json()) as { models?: string[] };
      const models = result.models ?? [];
      updateProviderDraft({ models });

      if (models.length === 0) {
        toast.error({
          description: "No models available for this provider.",
          message: "No models found.",
        });
      }
    } catch {
      toast.error(providerModelFetchFailureMessages.connection_failed);
    } finally {
      setIsFetchingModels(false);
    }
  };

  const saveProvider = async () => {
    const savedProvider: Provider = {
      ...providerDraft,
      id: isCreatingProvider ? createClientId("provider") : providerDraft.id,
      name:
        providerDraft.name.trim() ||
        providerOptions.find((type) => type.id === providerDraft.type)?.label ||
        "Provider",
    };

    setProviders((currentProviders) => {
      if (isCreatingProvider) {
        return [...currentProviders, savedProvider];
      }
      return currentProviders.map((provider) =>
        provider.id === savedProvider.id ? savedProvider : provider,
      );
    });
    setProviderEditorId(savedProvider.id);
    setProviderDraft(savedProvider);

    if (!selectedProviderId) {
      setSelectedProviderId(savedProvider.id);
      setSelectedModel("");
      void persistSettings({
        agentPrompt,
        contextWindowLimit,
        reasoningEffort,
        selectedModel: "",
        selectedProviderId: savedProvider.id,
      });
    }

    await fetch("/api/providers", {
      body: JSON.stringify(providerToApi(savedProvider)),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
  };

  const removeProvider = async () => {
    if (isCreatingProvider) {
      return;
    }

    const removedProviderId = providerDraft.id;
    const response = await fetch(`/api/providers/${removedProviderId}`, {
      headers: { "Content-Type": "application/json" },
      method: "DELETE",
    });

    if (response.ok) {
      const removedIndex = providers.findIndex(
        (provider) => provider.id === removedProviderId,
      );
      const remainingProviders = providers.filter(
        (provider) => provider.id !== removedProviderId,
      );

      setProviders(remainingProviders);

      const nextProvider =
        remainingProviders[removedIndex] ||
        remainingProviders[removedIndex - 1];

      if (nextProvider) {
        loadProviderEditor(nextProvider);
      } else {
        openNewProviderEditor();
      }

      if (selectedProviderId === removedProviderId) {
        const nextId = nextProvider?.id ?? "";
        const nextModel = nextProvider?.models[0] ?? "";
        setSelectedProviderId(nextId);
        setSelectedModel(nextModel);
        void persistSettings({
          agentPrompt,
          contextWindowLimit,
          reasoningEffort,
          selectedModel: nextModel,
          selectedProviderId: nextId,
        });
      }
    }
  };

  const saveTelegramBot = async () => {
    const response = await fetch("/api/telegram-bot", {
      body: JSON.stringify(telegramBotToApi(telegramBot)),
      headers: { "Content-Type": "application/json" },
      method: "PUT",
    });

    if (response.ok) {
      const result = telegramBotFromApi(
        (await response.json()) as ApiTelegramBot,
      );
      setTelegramBot(result);
    }
  };

  const saveMcpServer = async () => {
    const parsedCommand =
      mcpDraft.type === "command"
        ? parseCommandLine(mcpDraft.commandLine)
        : { args: [], command: "" };
    const nextServer: McpServer = {
      ...mcpDraft,
      args: parsedCommand.args,
      command: parsedCommand.command,
      id:
        isCreatingMcpServer || mcpDraft.id === "new"
          ? mcpServerId(mcpDraft.name)
          : mcpDraft.id,
      name: mcpDraft.name.trim() || "Server",
      tools: isCreatingMcpServer ? [] : mcpDraft.tools,
      url: mcpDraft.type === "url" ? mcpDraft.url : "",
    };
    const response = await fetch("/api/mcp/servers", {
      body: JSON.stringify(mcpServerToApi(nextServer)),
      headers: { "Content-Type": "application/json" },
      method: "PUT",
    });

    if (response.ok) {
      const savedServer = mcpServerFromApi(
        (await response.json()) as ApiMcpServer,
      );
      setMcpServers((currentServers) => {
        if (isCreatingMcpServer) {
          return [...currentServers, savedServer];
        }
        return currentServers.map((server) =>
          server.id === savedServer.id ? savedServer : server,
        );
      });
      setMcpEditorId(savedServer.id);
      setMcpDraft(savedServer);
    }
  };

  const reconnectMcpServer = async () => {
    if (isCreatingMcpServer) {
      return;
    }
    const response = await fetch(`/api/mcp/servers/${mcpDraft.id}/reconnect`, {
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });

    if (response.ok) {
      const updatedServer = mcpServerFromApi(
        (await response.json()) as ApiMcpServer,
      );
      setMcpServers((currentServers) =>
        currentServers.map((server) =>
          server.id === updatedServer.id ? updatedServer : server,
        ),
      );
      setMcpDraft(updatedServer);
    }
  };

  const removeMcpServer = async () => {
    if (isCreatingMcpServer) {
      return;
    }
    const response = await fetch(`/api/mcp/servers/${mcpDraft.id}`, {
      headers: { "Content-Type": "application/json" },
      method: "DELETE",
    });

    if (response.ok) {
      const remainingServers = mcpServers.filter(
        (server) => server.id !== mcpDraft.id,
      );
      setMcpServers(remainingServers);
      const nextServer = remainingServers[0];
      if (nextServer) {
        setMcpEditorId(nextServer.id);
        setMcpDraft(nextServer);
      } else {
        openNewMcpEditor();
      }
    }
  };

  const reloadSkills = async () => {
    const response = await fetch("/api/skills/reload", {
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });

    if (response.ok) {
      const reloadedSkills = (await response.json()) as Skill[];
      setSkills(reloadedSkills);
      setActiveSkillId((currentSkillId) => {
        if (reloadedSkills.some((skill) => skill.id === currentSkillId)) {
          return currentSkillId;
        }
        return reloadedSkills[0]?.id ?? "";
      });
    }
  };

  const toggleSkill = async (skill: Skill, enabled: boolean) => {
    const response = await fetch(
      `/api/skills/${encodeURIComponent(skill.id)}`,
      {
        body: JSON.stringify({ enabled }),
        headers: { "Content-Type": "application/json" },
        method: "PUT",
      },
    );

    if (response.ok) {
      const updatedSkill = (await response.json()) as Skill;
      setSkills((currentSkills) =>
        currentSkills.map((currentSkill) =>
          currentSkill.id === updatedSkill.id ? updatedSkill : currentSkill,
        ),
      );
    }
  };

  const approveTelegramSession = async (chatId: string) => {
    const response = await fetch("/api/telegram-bot/approve", {
      body: JSON.stringify({ chat_id: chatId }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });

    if (response.ok) {
      const result = telegramSessionFromApi(
        (await response.json()) as ApiTelegramSession,
      );
      setTelegramBot((current) => ({
        ...current,
        sessions: current.sessions.map((session) =>
          session.chatId === result.chatId ? result : session,
        ),
      }));
    }
  };

  const removeWritablePath = async (path: string) => {
    const response = await fetch("/api/permissions/writable-paths", {
      body: JSON.stringify({ path }),
      headers: { "Content-Type": "application/json" },
      method: "DELETE",
    });

    if (response.ok) {
      const result = (await response.json()) as {
        writable_paths?: ApiWritablePath[];
      };
      setWritablePaths((result.writable_paths ?? []).map(writablePathFromApi));
    }
  };

  const addWritablePath = async (path: string) => {
    const response = await fetch("/api/permissions/writable-paths", {
      body: JSON.stringify({ path }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });

    if (!response.ok) {
      throw new Error("Directory could not be added.");
    }

    const result = (await response.json()) as ApiWritablePath;
    setWritablePaths((currentWritablePaths) => {
      const savedWritablePath = writablePathFromApi(result);
      if (
        currentWritablePaths.some(
          (writablePath) => writablePath.path === savedWritablePath.path,
        )
      ) {
        return currentWritablePaths;
      }
      return [...currentWritablePaths, savedWritablePath];
    });
  };

  const clearWorkspace = async () => {
    const response = await fetch("/api/workspace/clear", {
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });

    if (!response.ok) {
      throw new Error("Conversation could not be cleared.");
    }

    return (await response.json()) as Partial<ApiState>;
  };

  const responseErrorFromApi = useCallback(async (response: Response) => {
    try {
      const result = (await response.json()) as { detail?: unknown };
      if (typeof result.detail === "string") {
        return result.detail;
      }
    } catch {
      return "Message could not be sent.";
    }
    return response.status === 409
      ? "Response in progress"
      : "Message could not be sent.";
  }, []);

  const showWorkspaceNotification = useCallback(
    (message: string) => {
      toast.error(message);
    },
    [toast],
  );

  const editWorkspaceMessage = async ({
    action,
    content,
    messageId,
  }: MessageActionRequest) => {
    const response = await fetch(
      `/api/workspace/messages/${encodeURIComponent(messageId)}/edit`,
      {
        body: JSON.stringify({ action, content }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      },
    );

    if (!response.ok) {
      let detail = "";
      try {
        const result = (await response.json()) as { detail?: unknown };
        if (typeof result.detail === "string") {
          detail = result.detail;
        }
      } catch {
        detail = "";
      }
      if (detail) {
        throw new Error(detail);
      }
      throw new Error(
        response.status === 409
          ? "Response in progress"
          : "Message could not be updated.",
      );
    }

    const result = (await response.json()) as WorkspaceMessageEditResponse;
    if (!Array.isArray(result.messages)) {
      throw new Error("Message could not be updated.");
    }
    return result;
  };

  const retryWorkspaceError = async ({
    errorId,
    messageId,
  }: MessageErrorRetryRequest) => {
    const response = await fetch(
      `/api/workspace/messages/${encodeURIComponent(messageId)}/errors/${encodeURIComponent(errorId)}/retry`,
      {
        headers: { "Content-Type": "application/json" },
        method: "POST",
      },
    );

    if (!response.ok) {
      throw new Error(await responseErrorFromApi(response));
    }

    const result = (await response.json()) as WorkspaceMessageEditResponse;
    if (!Array.isArray(result.messages)) {
      throw new Error("Message could not be updated.");
    }
    return result;
  };

  const parseWorkspaceStreamEvent = useCallback(
    (rawEvent: string): WorkspaceStreamEventEnvelope => {
      const lines = rawEvent.split("\n");
      const id = lines.find((line) => line.startsWith("id: "))?.slice(4);
      const event = lines
        .find((line) => line.startsWith("event: "))
        ?.slice("event: ".length);
      const data = lines
        .find((line) => line.startsWith("data: "))
        ?.slice("data: ".length);

      if (!event || !data) {
        throw new Error("Message could not be sent.");
      }

      const eventIndex = id ? Number(id) : undefined;
      return {
        data: JSON.parse(data) as WorkspaceStreamEvent["data"],
        event,
        eventIndex: Number.isSafeInteger(eventIndex) ? eventIndex : undefined,
      } as WorkspaceStreamEventEnvelope;
    },
    [],
  );

  const readWorkspaceStream = useCallback(
    async (response: Response, handlers: WorkspaceStreamHandlers) => {
      if (!response.body) {
        throw new Error("Message could not be sent.");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });
        const events = buffer.split("\n\n");
        buffer = events.pop() ?? "";

        for (const rawEvent of events) {
          if (!rawEvent.trim()) {
            continue;
          }

          const streamEvent = parseWorkspaceStreamEvent(rawEvent);
          if (streamEvent.eventIndex !== undefined) {
            handlers.onEventIndex(streamEvent.eventIndex);
          }
          if (streamEvent.event === "start") {
            handlers.onStart(streamEvent.data.id);
          }
          if (streamEvent.event === "output_start") {
            handlers.onOutputStart(streamEvent.data.index);
          }
          if (streamEvent.event === "output_done") {
            handlers.onOutputDone();
          }
          if (streamEvent.event === "delta") {
            handlers.onDelta(streamEvent.data.content);
          }
          if (streamEvent.event === "thinking_delta") {
            handlers.onThinkingDelta(streamEvent.data.content);
          }
          if (streamEvent.event === "snapshot") {
            handlers.onSnapshot(streamEvent.data.message);
          }
          if (streamEvent.event === "context_optimized") {
            if (streamEvent.data.usage_info) {
              handlers.onUsage(streamEvent.data.usage_info);
            }
            handlers.onContextOptimized(streamEvent.data.message);
          }
          if (streamEvent.event === "usage") {
            handlers.onUsage(streamEvent.data.usage_info);
          }
          if (streamEvent.event === "done") {
            handlers.onDone(streamEvent.data.message);
            return;
          }
          if (streamEvent.event === "tool_start") {
            handlers.onToolStart(streamEvent.data.tool);
          }
          if (
            streamEvent.event === "tool_done" ||
            streamEvent.event === "tool_error"
          ) {
            handlers.onToolDone(streamEvent.data);
          }
          if (streamEvent.event === "error") {
            const outputError =
              streamEvent.data.error ??
              streamErrorFromMessage(streamEvent.data.message, "");
            const errorMessage = handlers.onError(outputError) ?? null;
            throw new WorkspaceStreamError(
              streamEvent.data.message,
              outputError,
              errorMessage,
            );
          }
        }

        if (done) {
          break;
        }
      }

      throw new Error("Message could not be sent.");
    },
    [parseWorkspaceStreamEvent],
  );

  const createWorkspaceStreamHandlers = useCallback(
    (baseMessages: Message[], responseRun: number): WorkspaceStreamHandlers => {
      const latestMessage = baseMessages.at(-1);
      const existingAssistant =
        latestMessage?.author === "assistant" ? latestMessage : null;
      let assistantMessage: Message | null = existingAssistant;
      let assistantContent = existingAssistant?.content ?? "";
      let assistantId = existingAssistant?.id ?? "";
      let assistantThinking = existingAssistant?.thinking ?? "";
      let assistantThinkingItemId = "";
      let assistantThinkingItemIndex = 0;
      let assistantGroups: AssistantOutputGroup[] = existingAssistant
        ? assistantGroupsFromMessage(existingAssistant)
        : [];
      let assistantTextItemId =
        assistantGroups
          .flatMap((group) => group.items)
          .reverse()
          .find((item) => item.type === "text")?.id ?? "";
      let assistantTextItemIndex = countAssistantOutputItems(
        assistantGroups,
        "text",
      );
      let assistantIsStreamingThinking = false;
      let assistantIsStreamingText = false;
      let assistantTools: ToolItem[] = existingAssistant?.tools ?? [];
      let latestUsageInfo = usageInfoRef.current;
      let pendingAssistantUpdateFrame: number | null = null;
      const nextMessages = existingAssistant
        ? baseMessages.slice(0, -1)
        : baseMessages;
      const isCurrentResponse = () => responseRunRef.current === responseRun;
      const setAssistantMessages = () => {
        const nextState = assistantMessage
          ? [...nextMessages, assistantMessage]
          : [...nextMessages];
        messagesRef.current = nextState;
        setMessages(nextState);
      };
      const cancelPendingAssistantUpdate = () => {
        if (pendingAssistantUpdateFrame === null) {
          return;
        }
        window.cancelAnimationFrame(pendingAssistantUpdateFrame);
        pendingAssistantUpdateFrame = null;
      };
      const flushAssistantUpdate = () => {
        cancelPendingAssistantUpdate();
        setAssistantMessages();
      };
      const scheduleAssistantUpdate = () => {
        if (!isCurrentResponse()) {
          return;
        }
        if (pendingAssistantUpdateFrame !== null) {
          return;
        }
        pendingAssistantUpdateFrame = window.requestAnimationFrame(() => {
          pendingAssistantUpdateFrame = null;
          if (!isCurrentResponse()) {
            return;
          }
          setAssistantMessages();
        });
      };
      const appendSystemMessage = (message: ApiMessage) => {
        if (!isCurrentResponse()) {
          return;
        }
        flushAssistantUpdate();
        nextMessages.push(message);
        if (assistantMessage) {
          setAssistantMessages();
          return;
        }
        setAssistantMessages();
      };
      const updateAssistantMessage = (
        options: { immediate?: boolean } = {},
      ) => {
        if (!assistantId || !isCurrentResponse()) {
          return;
        }
        assistantMessage = {
          author: "assistant",
          content: assistantContent,
          id: assistantId,
          groups: assistantGroups,
          thinking: assistantThinking,
          isStreamingThinking: assistantIsStreamingThinking,
          tools: assistantTools,
          isStreamingText: assistantIsStreamingText,
          usage_info: latestUsageInfo,
        };
        if (options.immediate) {
          flushAssistantUpdate();
          return;
        }
        scheduleAssistantUpdate();
      };
      const finishAssistantThinking = () => {
        if (!assistantIsStreamingThinking) {
          return;
        }
        assistantIsStreamingThinking = false;
        assistantGroups = assistantGroups.map((group) => ({
          ...group,
          items: group.items.map((item) =>
            item.type === "thinking" ? { ...item, isStreaming: false } : item,
          ),
        }));
      };
      const createAssistantGroup = (index: number) => {
        const groupId = `${assistantId || "assistant"}-group-${index}`;
        if (assistantGroups.at(-1)?.id === groupId) {
          return;
        }
        finishAssistantThinking();
        assistantTextItemId = "";
        assistantIsStreamingText = false;
        assistantGroups = [...assistantGroups, { id: groupId, items: [] }];
      };
      const ensureAssistantGroup = () => {
        if (assistantGroups.length === 0) {
          createAssistantGroup(1);
        }
      };
      const updateCurrentAssistantGroupItems = (
        updater: (items: AssistantOutputItem[]) => AssistantOutputItem[],
      ) => {
        ensureAssistantGroup();
        const currentGroupIndex = assistantGroups.length - 1;
        assistantGroups = assistantGroups.map((group, index) =>
          index === currentGroupIndex
            ? { ...group, items: updater(group.items) }
            : group,
        );
      };
      const appendAssistantThinking = (content: string) => {
        assistantTextItemId = "";
        assistantIsStreamingText = false;
        if (!assistantThinkingItemId) {
          assistantThinkingItemIndex += 1;
          assistantThinkingItemId = `${assistantId}-thinking-${assistantThinkingItemIndex}`;
          updateCurrentAssistantGroupItems((items) => [
            ...items,
            {
              content: "",
              id: assistantThinkingItemId,
              isStreaming: true,
              type: "thinking",
            },
          ]);
        }

        assistantThinking += content;
        assistantIsStreamingThinking = true;
        updateCurrentAssistantGroupItems((items) =>
          items.map((item) =>
            item.type === "thinking" && item.id === assistantThinkingItemId
              ? {
                  ...item,
                  content: item.content + content,
                  isStreaming: true,
                }
              : item,
          ),
        );
        updateAssistantMessage();
      };
      const appendAssistantText = (content: string) => {
        finishAssistantThinking();
        if (!assistantTextItemId) {
          assistantTextItemIndex += 1;
          assistantTextItemId = `${assistantId}-text-${assistantTextItemIndex}`;
          updateCurrentAssistantGroupItems((items) => [
            ...items,
            {
              content: "",
              id: assistantTextItemId,
              type: "text",
            },
          ]);
        }

        assistantContent += content;
        updateCurrentAssistantGroupItems((items) =>
          items.map((item) =>
            item.type === "text" && item.id === assistantTextItemId
              ? { ...item, content: item.content + content }
              : item,
          ),
        );
        assistantIsStreamingText = true;
        updateAssistantMessage();
      };
      const appendAssistantError = (
        error: Extract<AssistantOutputItem, { type: "error" }>,
      ) => {
        finishAssistantThinking();
        assistantTextItemId = "";
        assistantIsStreamingText = false;
        const isErrorAlreadyApplied =
          Boolean(error.id) &&
          assistantGroups
            .flatMap((group) => group.items)
            .some((item) => item.type === "error" && item.id === error.id);
        if (!isErrorAlreadyApplied) {
          updateCurrentAssistantGroupItems((items) => [...items, error]);
        }
        if (!isCurrentResponse()) {
          return null;
        }
        const resolvedAssistantId = assistantId || createClientId("message");
        assistantId = resolvedAssistantId;
        const hasTextItem = assistantGroups
          .flatMap((group) => group.items)
          .some((item) => item.type === "text");
        if (assistantContent && !hasTextItem) {
          assistantGroups = [
            {
              id: `${resolvedAssistantId}-content`,
              items: [
                {
                  content: assistantContent,
                  id: `${resolvedAssistantId}-text-1`,
                  type: "text",
                },
              ],
            },
            ...assistantGroups,
          ];
        }
        assistantMessage = {
          author: "assistant",
          content: assistantContent,
          groups: assistantGroups,
          id: resolvedAssistantId,
          isStreamingText: false,
          isStreamingThinking: false,
          status: "failed",
          thinking: assistantThinking,
          tools: assistantTools,
          usage_info: latestUsageInfo,
        };
        flushAssistantUpdate();
        return assistantMessage;
      };
      const updateAssistantTool = (
        toolId: string,
        updater: (tool: ToolItem) => ToolItem,
      ) => {
        let updatedTool: ToolItem | null = null;
        assistantTools = assistantTools.map((currentTool) => {
          if (currentTool.id !== toolId) {
            return currentTool;
          }
          updatedTool = updater(currentTool);
          return updatedTool;
        });
        assistantGroups = assistantGroups.map((group) => ({
          ...group,
          items: group.items.map((item) =>
            item.type === "tool" && item.tool.id === toolId
              ? { ...item, tool: updatedTool ?? updater(item.tool) }
              : item,
          ),
        }));
      };
      const assistantGroupsThinking = () =>
        assistantGroups
          .flatMap((group) => group.items)
          .filter((item) => item.type === "thinking")
          .map((item) => item.content)
          .join("");
      const assistantGroupsText = () =>
        assistantGroups
          .flatMap((group) => group.items)
          .filter((item) => item.type === "text")
          .map((item) => item.content)
          .join("");
      const lastAssistantItemId = (type: AssistantOutputItem["type"]) =>
        assistantGroups
          .flatMap((group) => group.items)
          .reverse()
          .find((item) => item.type === type)?.id ?? "";
      const applyAssistantSnapshot = (
        message: ApiMessage,
        streaming = message.author === "assistant" &&
          message.status === "running",
      ) => {
        if (!isCurrentResponse() || message.author !== "assistant") {
          return;
        }
        assistantId = message.id;
        assistantContent = message.content;
        assistantThinking = message.thinking ?? "";
        assistantGroups = assistantGroupsFromMessage(message);
        assistantTools = message.tools ?? [];
        latestUsageInfo = message.usage_info ?? latestUsageInfo;
        if (message.usage_info) {
          setTrackedUsageInfo(message.usage_info);
        }
        assistantTextItemId = lastAssistantItemId("text");
        assistantThinkingItemId = lastAssistantItemId("thinking");
        assistantTextItemIndex = countAssistantOutputItems(
          assistantGroups,
          "text",
        );
        assistantThinkingItemIndex = countAssistantOutputItems(
          assistantGroups,
          "thinking",
        );
        assistantIsStreamingText =
          message.active_output === "text" &&
          streaming &&
          latestAssistantOutputItem(assistantGroups)?.type === "text";
        assistantIsStreamingThinking =
          message.active_output === "thinking" &&
          streaming &&
          assistantThinking.length > 0;
        assistantGroups = assistantGroups.map((group) => ({
          ...group,
          items: group.items.map((item) =>
            item.type === "thinking"
              ? { ...item, isStreaming: assistantIsStreamingThinking }
              : item,
          ),
        }));
        assistantMessage = {
          ...message,
          groups: assistantGroups,
          isStreamingThinking: assistantIsStreamingThinking,
          isStreamingText: assistantIsStreamingText,
          thinking: assistantThinking,
          tools: assistantTools,
          usage_info: latestUsageInfo,
        };
        flushAssistantUpdate();
      };
      const hasAssistantOutputSnapshot = (message: ApiMessage) =>
        Boolean(
          message.groups?.length ||
            message.items?.length ||
            message.tools?.length ||
            (message.status && message.status !== "completed"),
        );
      const finishAssistantFromLegacyDone = (message: ApiMessage) => {
        if (
          hasAssistantOutputSnapshot(message) ||
          assistantGroups.length === 0
        ) {
          applyAssistantSnapshot(message, false);
          return;
        }
        assistantId = message.id;
        assistantContent = message.content;
        const messageThinking = message.thinking ?? "";
        assistantThinking = messageThinking || assistantThinking;
        finishAssistantThinking();
        const streamedThinking = assistantGroupsThinking();
        if (messageThinking && streamedThinking !== messageThinking) {
          const missingThinking = messageThinking.startsWith(streamedThinking)
            ? messageThinking.slice(streamedThinking.length)
            : messageThinking;
          assistantThinkingItemIndex += 1;
          updateCurrentAssistantGroupItems((items) => [
            ...items,
            {
              content: missingThinking,
              id: `${message.id}-thinking-${assistantThinkingItemIndex}`,
              isStreaming: false,
              type: "thinking",
            },
          ]);
        }
        const streamedText = assistantGroupsText();
        if (message.content && streamedText !== message.content) {
          assistantTextItemIndex += 1;
          updateCurrentAssistantGroupItems((items) => [
            ...items,
            {
              content: message.content.startsWith(streamedText)
                ? message.content.slice(streamedText.length)
                : message.content,
              id: `${message.id}-text-${assistantTextItemIndex}`,
              type: "text",
            },
          ]);
        }
        assistantMessage = {
          ...message,
          groups: assistantGroups,
          isStreamingThinking: false,
          isStreamingText: false,
          thinking: assistantThinking,
          tools: assistantTools,
          usage_info: message.usage_info ?? latestUsageInfo,
        };
        flushAssistantUpdate();
      };

      return {
        onContextOptimized: appendSystemMessage,
        onDelta: (content) => {
          if (!isCurrentResponse()) {
            return;
          }
          appendAssistantText(content);
        },
        onDone: (message) => {
          if (!isCurrentResponse()) {
            return;
          }
          finishAssistantFromLegacyDone(message);
          cancelPendingAssistantUpdate();
          responseEventIndexRef.current = 0;
          setIsResponding(false);
        },
        onError: (error) => {
          if (!isCurrentResponse()) {
            return;
          }
          return appendAssistantError(
            error.id ? error : { ...error, id: `${assistantId}-error-1` },
          );
        },
        onOutputDone: () => {
          if (!isCurrentResponse()) {
            return;
          }
          finishAssistantThinking();
          assistantTextItemId = "";
          assistantIsStreamingText = false;
          updateAssistantMessage({ immediate: true });
        },
        onOutputStart: (index) => {
          if (!isCurrentResponse()) {
            return;
          }
          createAssistantGroup(index);
          updateAssistantMessage();
        },
        onSnapshot: applyAssistantSnapshot,
        onStart: (id) => {
          if (!isCurrentResponse()) {
            return;
          }
          assistantId = id;
          updateAssistantMessage();
        },
        onThinkingDelta: (content) => {
          if (!isCurrentResponse()) {
            return;
          }
          appendAssistantThinking(content);
        },
        onToolDone: (tool) => {
          if (!isCurrentResponse()) {
            return;
          }
          finishAssistantThinking();
          assistantTextItemId = "";
          assistantIsStreamingText = false;
          updateAssistantTool(tool.id, (currentTool) => ({
            ...currentTool,
            ...tool,
          }));
          updateAssistantMessage();
        },
        onToolStart: (tool) => {
          if (!isCurrentResponse()) {
            return;
          }
          finishAssistantThinking();
          assistantTextItemId = "";
          assistantIsStreamingText = false;
          assistantTools = [...assistantTools, tool];
          updateCurrentAssistantGroupItems((items) => [
            ...items,
            {
              id: `tool-${tool.id}`,
              tool,
              type: "tool",
            },
          ]);
          updateAssistantMessage();
        },
        onUsage: (nextUsageInfo) => {
          if (!isCurrentResponse()) {
            return;
          }
          latestUsageInfo = nextUsageInfo;
          setTrackedUsageInfo(nextUsageInfo);
          updateAssistantMessage({ immediate: true });
        },
        onEventIndex: (eventIndex) => {
          if (!isCurrentResponse()) {
            return;
          }
          responseEventIndexRef.current = eventIndex;
        },
      };
    },
    [setTrackedUsageInfo],
  );

  const requestWorkspaceResponse = useCallback(
    async (
      content: string,
      messageId: string,
      handlers: WorkspaceStreamHandlers,
      signal?: AbortSignal,
    ) => {
      const response = await fetch("/api/workspace/respond", {
        body: JSON.stringify({ content, message_id: messageId }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
        signal,
      });

      if (!response.ok) {
        throw new WorkspaceRequestError(await responseErrorFromApi(response));
      }

      await readWorkspaceStream(response, handlers);
    },
    [readWorkspaceStream, responseErrorFromApi],
  );

  const streamWorkspaceResponse = useCallback(
    async (
      handlers: WorkspaceStreamHandlers,
      after: number,
      signal?: AbortSignal,
    ) => {
      const response = await fetch(`/api/workspace/stream?after=${after}`, {
        headers: { "Content-Type": "text/event-stream" },
        method: "GET",
        signal,
      });

      if (!response.ok) {
        throw new Error(await responseErrorFromApi(response));
      }

      await readWorkspaceStream(response, handlers);
    },
    [readWorkspaceStream, responseErrorFromApi],
  );

  useEffect(() => {
    if (streamReconnectKey === 0) {
      return;
    }

    const responseRun = responseRunRef.current || 1;
    responseRunRef.current = responseRun;
    const responseAbortController = new AbortController();
    responseAbortRef.current = responseAbortController;
    setIsResponding(true);
    setResponseError("");

    const streamCurrentResponse = async () => {
      const handlers = createWorkspaceStreamHandlers(
        messagesRef.current,
        responseRun,
      );
      try {
        await streamWorkspaceResponse(
          handlers,
          responseEventIndexRef.current,
          responseAbortController.signal,
        );
      } catch (error) {
        if (
          responseRunRef.current !== responseRun ||
          responseAbortController.signal.aborted
        ) {
          return;
        }
        const state = await refreshAppState().catch(() => null);
        if (state?.is_responding) {
          setStreamReconnectKey((current) => current + 1);
          return;
        }
        responseEventIndexRef.current = 0;
        setIsResponding(false);
        setResponseError(
          error instanceof Error ? error.message : "Message could not be sent.",
        );
      } finally {
        if (responseRunRef.current === responseRun) {
          responseAbortRef.current = null;
        }
      }
    };

    void streamCurrentResponse();

    return () => {
      responseAbortController.abort();
    };
  }, [
    createWorkspaceStreamHandlers,
    refreshAppState,
    streamReconnectKey,
    streamWorkspaceResponse,
  ]);

  const compactWorkspace = async () => {
    setResponseError("");
    setIsRefiningContext(true);
    const compactErrorStartIndex = messages.length;

    const appendCompactMessage = (message: ApiMessage) => {
      setMessages((currentMessages) =>
        currentMessages.some(
          (currentMessage) => currentMessage.id === message.id,
        )
          ? currentMessages
          : [...currentMessages, message],
      );
    };
    const appendCompactSnapshot = (message: ApiMessage) => {
      setMessages((currentMessages) => {
        const messageIndex = currentMessages.findIndex(
          (currentMessage) => currentMessage.id === message.id,
        );
        if (messageIndex >= 0) {
          return currentMessages.map((currentMessage, index) =>
            index === messageIndex ? message : currentMessage,
          );
        }
        return [...currentMessages, message];
      });
    };

    try {
      const response = await fetch("/api/workspace/compact", {
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });

      if (!response.ok) {
        showWorkspaceNotification(await responseErrorFromApi(response));
        setIsRefiningContext(false);
        return;
      }

      await readWorkspaceStream(response, {
        onEventIndex: () => undefined,
        onContextOptimized: appendCompactMessage,
        onDelta: () => undefined,
        onDone: appendCompactMessage,
        onError: () => undefined,
        onOutputDone: () => undefined,
        onOutputStart: () => undefined,
        onSnapshot: appendCompactSnapshot,
        onStart: () => undefined,
        onThinkingDelta: () => undefined,
        onToolDone: () => undefined,
        onToolStart: () => undefined,
        onUsage: setTrackedUsageInfo,
      });
      setIsRefiningContext(false);
    } catch (error) {
      if (isAbortError(error)) {
        void refreshAppState().catch(() => undefined);
        return;
      }
      if (error instanceof WorkspaceStreamError) {
        setIsRefiningContext(false);
        return;
      }
      const detail =
        error instanceof Error
          ? error.message
          : "Context could not be compacted.";
      setMessages((currentMessages) =>
        messagesIncludeErrorBlockFrom(currentMessages, compactErrorStartIndex)
          ? currentMessages
          : [...currentMessages, createWorkspaceErrorMessage(detail)],
      );
      setIsRefiningContext(false);
    }
  };

  const workspaceCommands: WorkspaceCommand[] = useMemo(
    () => [
      {
        description: "Clear the conversation",
        id: "clear",
        label: "/clear",
        name: "clear",
      },
      {
        description: "Compact context",
        id: "compact",
        label: "/compact",
        name: "compact",
      },
    ],
    [],
  );

  const runWorkspaceCommand = (commandId: WorkspaceCommandId) => {
    if (commandId === "clear") {
      void clearMessages();
      return true;
    }
    if (commandId === "compact") {
      if (isResponding) {
        showWorkspaceNotification(
          "Compact is unavailable while Flowent is responding.",
        );
        return false;
      }
      void compactWorkspace();
      return true;
    }
    return false;
  };

  const handleWorkspaceCommandError = (message: string) => {
    showWorkspaceNotification(message);
  };

  const workspaceErrorDetail = (error: unknown, fallback: string) =>
    error instanceof Error ? error.message : fallback;

  const appendWorkspaceErrorMessage = (
    baseMessages: Message[],
    error: unknown,
    fallback: string,
  ) => [
    ...baseMessages,
    createWorkspaceErrorMessage(workspaceErrorDetail(error, fallback)),
  ];

  const stopResponse = () => {
    if (isResponding) {
      void fetch("/api/workspace/stop", {
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
    }
    responseRunRef.current += 1;
    responseEventIndexRef.current = 0;
    responseAbortRef.current?.abort();
    responseAbortRef.current = null;
    setResponseError("");
    setIsResponding(false);
  };

  const sendMessage = async (
    submittedDraft = draft,
    baseMessages = messages,
    options: { clearDraft?: boolean } = {},
  ) => {
    if (submittedDraft.length === 0 || isResponding || isRefiningContext) {
      return;
    }
    const shouldClearDraft = options.clearDraft ?? baseMessages === messages;

    const responseRun = responseRunRef.current + 1;
    const responseAbortController = new AbortController();
    responseAbortRef.current = responseAbortController;
    responseRunRef.current = responseRun;
    responseEventIndexRef.current = 0;
    const userContent = submittedDraft;
    const userMessageId = createClientId("message");
    const nextMessages: Message[] = [
      ...baseMessages,
      {
        author: "user",
        content: userContent,
        id: userMessageId,
      },
    ];
    setResponseError("");
    setIsResponding(true);
    setMessages(nextMessages);
    if (shouldClearDraft) {
      setDraft("");
    }

    try {
      const handlers = createWorkspaceStreamHandlers(nextMessages, responseRun);
      await requestWorkspaceResponse(
        userContent,
        userMessageId,
        handlers,
        responseAbortController.signal,
      );
    } catch (error) {
      if (responseRunRef.current !== responseRun) {
        return;
      }
      if (
        error instanceof DOMException &&
        error.name === "AbortError" &&
        responseAbortController.signal.aborted
      ) {
        return;
      }
      if (error instanceof Error && error.message === "Response in progress") {
        setMessages(baseMessages);
        if (shouldClearDraft) {
          setDraft(userContent);
        }
        setIsResponding(false);
        showWorkspaceNotification(error.message);
        return;
      }
      if (!(error instanceof WorkspaceRequestError)) {
        const state = await refreshAppState().catch(() => null);
        if (state?.is_responding) {
          setStreamReconnectKey((current) => current + 1);
          return;
        }
        if (
          state?.messages &&
          messagesIncludeErrorBlockFrom(state.messages, baseMessages.length)
        ) {
          setMessages(state.messages);
          setIsResponding(false);
          return;
        }
      }
      if (error instanceof WorkspaceStreamError) {
        setMessages([
          ...nextMessages,
          error.errorMessage ??
            createWorkspaceStreamErrorMessage(error.outputError),
        ]);
        setIsResponding(false);
        return;
      }
      setMessages((currentMessages) =>
        messagesIncludeErrorBlockFrom(currentMessages, baseMessages.length)
          ? currentMessages
          : appendWorkspaceErrorMessage(
              nextMessages,
              error,
              "Message could not be sent.",
            ),
      );
      setIsResponding(false);
    } finally {
      if (responseRunRef.current === responseRun) {
        responseAbortRef.current = null;
      }
    }
  };

  const startEditedResponse = (nextMessages: Message[]) => {
    responseRunRef.current += 1;
    responseEventIndexRef.current = 0;
    setMessages(nextMessages);
    setIsResponding(true);
    setStreamReconnectKey((current) => current + 1);
  };

  const retryMessage = async (messageId: string) => {
    if (isResponding) {
      return;
    }

    const messageIndex = messages.findIndex(
      (message) => message.id === messageId,
    );
    if (messageIndex < 0) {
      return;
    }

    const message = messages[messageIndex];
    const userMessage =
      message.author === "user"
        ? message
        : previousUserMessage(messages, messageIndex - 1);
    if (!userMessage) {
      return;
    }
    const userMessageIndex = messages.findIndex(
      (currentMessage) => currentMessage.id === userMessage.id,
    );

    setResponseError("");
    setIsResponding(true);

    try {
      const result = await editWorkspaceMessage({
        action: "resend",
        content: userMessage.content,
        messageId: userMessage.id,
      });
      if (!result.is_responding) {
        throw new Error("Message could not be sent.");
      }
      startEditedResponse(result.messages);
    } catch (error) {
      setMessages(
        appendWorkspaceErrorMessage(
          messages.slice(0, userMessageIndex + 1),
          error,
          "Message could not be updated.",
        ),
      );
      setIsResponding(false);
    }
  };

  const retryError = async ({
    errorId,
    messageId,
  }: MessageErrorRetryRequest) => {
    if (isResponding) {
      return;
    }

    const messageIndex = messages.findIndex(
      (message) => message.id === messageId,
    );
    if (messageIndex < 0 || messages[messageIndex].author !== "assistant") {
      return;
    }

    const trimmedMessage = trimAssistantMessageAtError(
      messages[messageIndex],
      errorId,
    );
    if (!trimmedMessage) {
      return;
    }

    const optimisticMessages = [
      ...messages.slice(0, messageIndex),
      trimmedMessage,
    ];
    setResponseError("");
    setIsResponding(true);
    setMessages(optimisticMessages);

    try {
      const result = await retryWorkspaceError({ errorId, messageId });
      if (!result.is_responding) {
        throw new Error("Message could not be sent.");
      }
      startEditedResponse(result.messages);
    } catch (error) {
      setMessages(
        appendWorkspaceErrorMessage(
          optimisticMessages,
          error,
          "Message could not be sent.",
        ),
      );
      setIsResponding(false);
    }
  };

  const editMessage = async ({
    action,
    content,
    messageId,
  }: MessageActionRequest) => {
    if (isResponding) {
      return;
    }

    const messageIndex = messages.findIndex(
      (message) => message.id === messageId,
    );
    if (messageIndex < 0 || messages[messageIndex].author !== "user") {
      return;
    }

    const previousMessages = messages;
    setResponseError("");
    if (action === "resend") {
      setIsResponding(true);
    }

    try {
      const result = await editWorkspaceMessage({ action, content, messageId });
      if (action === "resend") {
        if (!result.is_responding) {
          throw new Error("Message could not be sent.");
        }
        startEditedResponse(result.messages);
        return;
      }
      setMessages(result.messages);
    } catch (error) {
      setMessages(
        action === "resend"
          ? appendWorkspaceErrorMessage(
              [
                ...previousMessages.slice(0, messageIndex),
                {
                  ...previousMessages[messageIndex],
                  content,
                },
              ],
              error,
              "Message could not be updated.",
            )
          : previousMessages,
      );
      if (action === "resend") {
        setIsResponding(false);
      }
      if (action !== "resend") {
        showWorkspaceNotification(
          workspaceErrorDetail(error, "Message could not be updated."),
        );
      }
    }
  };

  const clearMessages = async () => {
    const previousMessages = messages;
    const previousUsageInfo = usageInfo;

    responseAbortRef.current?.abort();
    responseAbortRef.current = null;
    responseEventIndexRef.current = 0;
    responseRunRef.current += 1;
    setMessages([]);
    setTrackedUsageInfo(null);
    setResponseError("");
    setIsResponding(false);

    try {
      const clearedState = await clearWorkspace();
      if (Array.isArray(clearedState.messages)) {
        setMessages(clearedState.messages);
      }
      setTrackedUsageInfo(clearedState.usage_info ?? null);
    } catch {
      setMessages(previousMessages);
      setTrackedUsageInfo(previousUsageInfo);
      showWorkspaceNotification("Conversation could not be cleared.");
    }
  };

  const openNewWorkflow = () => {
    setActiveWorkflowId("");
    setWorkflowRunResult(null);
    setNewWorkflowKey((currentKey) => currentKey + 1);
    setActiveView("workflows");
  };

  const openWorkflow = (workflowId: string) => {
    setActiveWorkflowId(workflowId);
    setActiveView("workflows");
  };

  const closeWorkflowEditor = () => {
    setActiveView("workspace");
  };

  const saveWorkflow = async (
    workflow: Workflow,
  ): Promise<RequestResult<Workflow>> => {
    const response = await fetch("/api/workflows", {
      body: JSON.stringify(workflowToApi(workflow)),
      headers: { "Content-Type": "application/json" },
      method: "PUT",
    });

    if (!response.ok) {
      return {
        data: null,
        error: await errorMessageFromResponse(
          response,
          "Workflow could not be saved.",
        ),
      };
    }

    const savedWorkflow = workflowFromApi(
      (await response.json()) as ApiWorkflow,
    );
    setWorkflows((currentWorkflows) => {
      if (
        currentWorkflows.some(
          (currentWorkflow) => currentWorkflow.id === savedWorkflow.id,
        )
      ) {
        return currentWorkflows.map((currentWorkflow) =>
          currentWorkflow.id === savedWorkflow.id
            ? savedWorkflow
            : currentWorkflow,
        );
      }
      return [savedWorkflow, ...currentWorkflows];
    });
    setActiveWorkflowId(savedWorkflow.id);
    return { data: savedWorkflow, error: "" };
  };

  const deleteWorkflow = async (workflowId: string) => {
    const response = await fetch(
      `/api/workflows/${encodeURIComponent(workflowId)}`,
      {
        headers: { "Content-Type": "application/json" },
        method: "DELETE",
      },
    );

    if (!response.ok) {
      return false;
    }

    setWorkflows((currentWorkflows) =>
      currentWorkflows.filter((workflow) => workflow.id !== workflowId),
    );
    if (workflowRunResult?.workflowId === workflowId) {
      setWorkflowRunResult(null);
    }
    if (activeWorkflowId === workflowId) {
      setActiveWorkflowId("");
    }
    return true;
  };

  const runWorkflow = async (
    workflowId: string,
  ): Promise<RequestResult<WorkflowRunResult>> => {
    setRunningWorkflowId(workflowId);
    setWorkflowRunResult(null);
    try {
      const response = await fetch(
        `/api/workflows/${encodeURIComponent(workflowId)}/run`,
        {
          headers: { "Content-Type": "application/json" },
          method: "POST",
        },
      );

      if (!response.ok) {
        return {
          data: null,
          error: await errorMessageFromResponse(
            response,
            "Run could not be completed.",
          ),
        };
      }

      const result = workflowRunResultFromApi(
        (await response.json()) as ApiWorkflowRunResult,
      );
      setWorkflowRunResult(result);
      return { data: result, error: "" };
    } finally {
      setRunningWorkflowId("");
    }
  };

  return (
    <AppShell
      activeProviderName={activeProvider?.name}
      activeView={activeView}
      activeWorkflowId={activeWorkflowId}
      onNewWorkflow={openNewWorkflow}
      onViewChange={setActiveView}
      onWorkflowSelect={openWorkflow}
      workflows={workflows}
    >
      <TabsContent
        value="workspace"
        className={viewPanelClassName}
        tabIndex={-1}
      >
        <WorkspaceView
          contextWindowLimit={contextWindowLimit}
          draft={draft}
          errorMessage={responseError}
          isRefiningContext={isRefiningContext}
          isResponding={isResponding}
          messages={messages}
          usageInfo={usageInfo}
          commands={workspaceCommands}
          skills={skills}
          onCommand={runWorkspaceCommand}
          onCommandError={handleWorkspaceCommandError}
          onDraftChange={setDraft}
          onEditMessage={(request) => {
            void editMessage(request);
          }}
          onRetryMessage={(messageId) => {
            void retryMessage(messageId);
          }}
          onRetryError={(request) => {
            void retryError(request);
          }}
          onSendMessage={(content) => {
            void sendMessage(content);
          }}
          onStopResponse={stopResponse}
        />
      </TabsContent>
      <TabsContent value="workflows" className={viewPanelClassName}>
        <WorkflowsView
          activeWorkflow={activeWorkflow}
          isRunningWorkflow={Boolean(runningWorkflowId)}
          newWorkflowKey={newWorkflowKey}
          onCloseEditor={closeWorkflowEditor}
          onDeleteWorkflow={deleteWorkflow}
          onRunWorkflow={runWorkflow}
          onSaveWorkflow={saveWorkflow}
          runningWorkflowId={runningWorkflowId}
          workflowRunResult={workflowRunResult}
        />
      </TabsContent>
      <TabsContent value="providers" className={viewPanelClassName}>
        <ProvidersView
          activeProvider={providerDraft}
          isFetchingModels={isFetchingModels}
          isCreatingProvider={isCreatingProvider}
          onFetchModels={fetchProviderModels}
          onNewProvider={openNewProviderEditor}
          onProviderSelect={loadProviderEditor}
          onRemoveProvider={removeProvider}
          onSaveProvider={saveProvider}
          onUpdateProvider={updateProviderDraft}
          providers={providers}
        />
      </TabsContent>
      <TabsContent value="channels" className={viewPanelClassName}>
        <ChannelsView
          onApproveSession={approveTelegramSession}
          onSaveTelegramBot={saveTelegramBot}
          onUpdateTelegramBot={updateTelegramBot}
          telegramBot={telegramBot}
        />
      </TabsContent>
      <TabsContent value="permissions" className={viewPanelClassName}>
        <PermissionsView
          onAddWritablePath={addWritablePath}
          onRemoveWritablePath={(path) => {
            void removeWritablePath(path);
          }}
          writablePaths={writablePaths}
        />
      </TabsContent>
      <TabsContent value="mcp" className={viewPanelClassName}>
        <McpView
          activeServer={mcpDraft}
          isCreatingServer={isCreatingMcpServer}
          isImportOpen={isMcpImportOpen}
          importPreview={mcpImportPreview}
          importSource={mcpImportSource}
          importingServerId={importingMcpServerId}
          isPreviewing={isPreviewingMcpImport}
          onNewServer={openNewMcpEditor}
          onImport={openMcpImport}
          onImportSourceChange={updateMcpImportSource}
          onImportServer={(serverId) => {
            void importMcpServer(serverId);
          }}
          onReconnectServer={reconnectMcpServer}
          onRemoveServer={removeMcpServer}
          onSaveServer={() => {
            void saveMcpServer();
          }}
          onServerSelect={loadMcpEditor}
          onUpdateServer={updateMcpDraft}
          servers={mcpServers}
        />
      </TabsContent>
      <TabsContent value="skills" className={viewPanelClassName}>
        <SkillsView
          activeSkill={activeSkill}
          onReloadSkills={() => {
            void reloadSkills();
          }}
          onSkillSelect={selectSkill}
          onSkillToggle={(skill, enabled) => {
            void toggleSkill(skill, enabled);
          }}
          skills={skills}
        />
      </TabsContent>
      <TabsContent value="settings" className={viewPanelClassName}>
        <SettingsView
          agentPrompt={agentPrompt}
          appVersion={appVersion}
          contextWindowLimit={contextWindowLimit}
          modelOptions={activeProvider?.models ?? []}
          onModelChange={handleActiveModelChange}
          onProviderChange={handleActiveProviderChange}
          onReasoningEffortChange={handleReasoningEffortChange}
          onRuntimeSettingsSave={saveRuntimeSettings}
          providers={providers}
          reasoningEffort={reasoningEffort}
          selectedModel={selectedModel}
          selectedProviderId={selectedProviderId}
        />
      </TabsContent>
    </AppShell>
  );
}

function App() {
  return (
    <FlowentToastProvider>
      <FlowentApp />
    </FlowentToastProvider>
  );
}

export default App;
