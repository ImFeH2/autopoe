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

export type PermissionDecision = "allow_once" | "always_allow" | "deny";

export type PermissionRequest = {
  id: string;
  path: string;
  reason: string;
};

export type ToolItemStatus = "failed" | "running" | "success";

export type ToolItem = {
  arguments?: Record<string, unknown>;
  content?: string;
  data?: Record<string, unknown>;
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
      id: string;
      tool: ToolItem;
      type: "tool";
    };

export type AssistantOutputGroup = {
  id: string;
  items: AssistantOutputItem[];
};

export type Message = {
  author: "assistant" | "system" | "user";
  content: string;
  groups?: AssistantOutputGroup[];
  id: string;
  isStreamingThinking?: boolean;
  isStreamingText?: boolean;
  items?: AssistantOutputItem[];
  thinking?: string;
  tools?: ToolItem[];
};

export type WorkspaceCommandId = "clear" | "compact";

export type WorkspaceCommand = {
  description: string;
  id: WorkspaceCommandId;
  label: string;
  name: string;
};
