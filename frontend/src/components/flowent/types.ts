export type ViewId =
  | "workspace"
  | "workflows"
  | "providers"
  | "channels"
  | "mcp"
  | "permissions"
  | "skills"
  | "settings";

export type FlowentToastTone = "error" | "info" | "success";

export type FlowentToast = {
  description?: string;
  duration: number;
  id: string;
  message: string;
  tone: FlowentToastTone;
};

export type ReasoningEffort = "default" | "low" | "medium" | "high" | "xhigh";

export type ProviderKind =
  | "openai"
  | "openai_responses"
  | "anthropic"
  | "gemini";

export type ProviderOption = {
  id: ProviderKind;
  label: string;
};

export type Provider = {
  id: string;
  name: string;
  type: ProviderKind;
  baseUrl: string;
  apiKey: string;
  models: string[];
};

export type TelegramBotStatus = "disabled" | "error" | "running" | "starting";

export type TelegramSessionStatus = "approved" | "pending";

export type TelegramSession = {
  chatId: string;
  displayName: string;
  recentMessage: string;
  status: TelegramSessionStatus;
  updatedAt: number;
  userId: string;
  username: string;
};

export type TelegramBot = {
  botSecret: string;
  enabled: boolean;
  error: string;
  sessions: TelegramSession[];
  status: TelegramBotStatus;
};

export type McpServerStatus = "disabled" | "error" | "ready" | "starting";

export type McpServerType = "command" | "url";

export type McpImportSource = "claude_code" | "codex";

export type McpImportFile = {
  error: string;
  path: string;
  servers: McpServer[];
  source: McpImportSource;
};

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

export type SkillScope = "project" | "user";

export type Skill = {
  description: string;
  enabled: boolean;
  error: string;
  id: string;
  name: string;
  path: string;
  scope: SkillScope;
  slug: string;
};

export type WritablePath = {
  createdAt: number;
  path: string;
};

export type ToolItemStatus = "failed" | "running" | "success" | "waiting";

export type ToolItem = {
  arguments?: Record<string, unknown> | null;
  content?: string;
  data?: Record<string, unknown> | null;
  id: string;
  name: string;
  status: ToolItemStatus;
  title: string;
};

export type AssistantOutputItem =
  | {
      content: string;
      id: string;
      isStreaming?: boolean;
      type: "thinking";
    }
  | {
      content: string;
      id: string;
      type: "text";
    }
  | {
      detail?: string;
      id: string;
      message: string;
      title: string;
      type: "error";
    }
  | {
      id: string;
      tool: ToolItem;
      type: "tool";
    };

export type AssistantOutputGroup = {
  id: string;
  items: AssistantOutputItem[];
};

export type ContextUsage = {
  cached_input_tokens: number;
  input_tokens: number;
  output_tokens: number;
  reasoning_output_tokens: number;
  total_tokens: number;
};

export type ContextUsageInfo = {
  last_token_usage: ContextUsage;
  model_context_window?: number | null;
  total_token_usage: ContextUsage;
};

export type Message = {
  author: "assistant" | "system" | "user";
  active_output?: "text" | "thinking" | null;
  content: string;
  groups?: AssistantOutputGroup[];
  id: string;
  isStreamingThinking?: boolean;
  isStreamingText?: boolean;
  items?: AssistantOutputItem[];
  status?: "completed" | "failed" | "interrupted" | "running";
  summary?: string;
  thinking?: string;
  tools?: ToolItem[];
  usage_info?: ContextUsageInfo | null;
};

export type MessageEditAction = "resend" | "save";

export type MessageActionRequest = {
  action: MessageEditAction;
  content: string;
  messageId: string;
};

export type WorkspaceCommandId = "clear" | "compact";

export type WorkspaceCommand = {
  description: string;
  id: WorkspaceCommandId;
  label: string;
  name: string;
};

export type RuntimeSettings = {
  agentPrompt: string;
  contextWindowLimit: number | null;
  reasoningEffort: ReasoningEffort;
  selectedModel: string;
  selectedProviderId: string;
};

export type WorkflowNodeType = "input" | "agent" | "merge" | "output";

export type WorkflowNodePosition = {
  x: number;
  y: number;
};

export type WorkflowNode = {
  data: Record<string, unknown>;
  description: string;
  id: string;
  name: string;
  position: WorkflowNodePosition;
  type: WorkflowNodeType;
};

export type WorkflowEdge = {
  id: string;
  label: string;
  source: string;
  sourceHandle: string;
  target: string;
  targetHandle: string;
};

export type WorkflowDefinition = {
  edges: WorkflowEdge[];
  nodes: WorkflowNode[];
  version: number;
};

export type Workflow = {
  createdAt: number;
  definition: WorkflowDefinition;
  id: string;
  name: string;
  updatedAt: number;
};

export type WorkflowNodeRunResult = {
  error: string;
  id: string;
  output: string;
  status: "failed" | "pending" | "running" | "success";
};

export type WorkflowRunResult = {
  nodeResults: WorkflowNodeRunResult[];
  outputs: Record<string, string>;
  status: "failed" | "success";
  workflowId: string;
};
