export type ViewId =
  | "workspace"
  | "providers"
  | "channels"
  | "mcp"
  | "permissions"
  | "skills"
  | "settings";

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
  content: string;
  groups?: AssistantOutputGroup[];
  id: string;
  isStreamingThinking?: boolean;
  isStreamingText?: boolean;
  items?: AssistantOutputItem[];
  status?: "completed" | "failed" | "interrupted" | "running";
  thinking?: string;
  tools?: ToolItem[];
  usage_info?: ContextUsageInfo | null;
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
  reasoningEffort: ReasoningEffort;
  selectedModel: string;
  selectedProviderId: string;
};
