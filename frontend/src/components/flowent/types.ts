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
  hasBotSecret: boolean;
  sessions: TelegramSession[];
  status: TelegramBotStatus;
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
  id: string;
  name: string;
  result?: Record<string, unknown> | null;
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

export type MessageErrorRetryRequest = {
  errorId: string;
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

export type WorkflowNodeKind =
  | "input"
  | "agent"
  | "merge"
  | "code"
  | "timer"
  | "output";

export type WorkflowNodePosition = {
  x: number;
  y: number;
};

export type WorkflowSpecNode = {
  config: Record<string, unknown>;
  id: string;
  kind: WorkflowNodeKind;
};

export type WorkflowConnectionEnd = {
  nodeId: string;
  port: "input" | "output";
};

export type WorkflowConnection = {
  from: WorkflowConnectionEnd;
  id: string;
  to: WorkflowConnectionEnd;
};

export type WorkflowNodePresentation = {
  description: string;
  name: string;
  position: WorkflowNodePosition;
};

export type WorkflowConnectionPresentation = {
  label: string;
};

export type WorkflowSpec = {
  connections: WorkflowConnection[];
  nodes: WorkflowSpecNode[];
};

export type WorkflowPresentation = {
  connections: Record<string, WorkflowConnectionPresentation>;
  nodes: Record<string, WorkflowNodePresentation>;
};

export type WorkflowNode = WorkflowSpecNode & WorkflowNodePresentation;

export type WorkflowEdge = WorkflowConnection & WorkflowConnectionPresentation;

export type WorkflowNodeType = WorkflowNodeKind;

export type Workflow = {
  activeRevision: number | null;
  createdAt: number;
  id: string;
  name: string;
  presentation: WorkflowPresentation;
  revision: number;
  spec: WorkflowSpec;
  updatedAt: number;
};

export type WorkflowNodeRunError = {
  code: string;
  message: string;
};

export type WorkflowNodeRunResult = {
  error: WorkflowNodeRunError | null;
  id: string;
  inputs: string[];
  output: string;
  status: "failed" | "pending" | "running" | "success";
};

export type WorkflowRunResult = {
  nodeResults: WorkflowNodeRunResult[];
  outputs: Record<string, string>;
  runId: string;
  status: "failed" | "success";
  trigger: "manual" | "schedule";
  workflowId: string;
  workflowRevision: number;
};

export type WorkflowRunRequest = {
  input?: string;
  inputs?: Record<string, string>;
  workflowRevision?: number;
};

export type WorkflowScheduleStatus =
  | "stopped"
  | "scheduled"
  | "running"
  | "error";

export type WorkflowSchedule = {
  lastError: string;
  lastResult: WorkflowRunResult | null;
  lastRunAt: number | null;
  nextRunAt: number | null;
  status: WorkflowScheduleStatus;
  timezone: string;
  workflowId: string;
};

export type WorkflowScheduleStartRequest = WorkflowRunRequest & {
  timezone?: string;
};

export type WorkflowScheduleRequestState =
  | "idle"
  | "loading"
  | "ready"
  | "starting"
  | "stopping"
  | "unavailable";
