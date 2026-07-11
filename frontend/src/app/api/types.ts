import type {
  ContextUsageInfo,
  McpServer,
  Message,
  Provider,
  ReasoningEffort,
  Skill,
  TelegramBot,
  TelegramSession,
  Workflow,
  WorkflowDefinition,
  WorkflowEdge,
  WorkflowNode,
  WorkflowNodeRunResult,
  WorkflowRunRequest,
  WorkflowRunResult,
  WorkflowSchedule,
} from "@/components/flowent/types";

export type ApiProvider = {
  base_url: string;
  has_api_key: boolean;
  id: string;
  models: string[];
  name: string;
  type: Provider["type"];
};

export type ApiProviderSaveRequest = Omit<ApiProvider, "has_api_key"> & {
  api_key?: string;
};

export type ApiTelegramSession = {
  chat_id: string;
  display_name: string;
  recent_message: string;
  status: TelegramSession["status"];
  updated_at?: number;
  user_id: string;
  username: string;
};

export type ApiTelegramBot = {
  enabled: boolean;
  error?: string;
  has_bot_token: boolean;
  sessions?: ApiTelegramSession[];
  status?: TelegramBot["status"];
};

export type ApiTelegramBotSaveRequest = {
  bot_token?: string;
  enabled: boolean;
};

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

export type ApiSkill = Skill;

export type ApiWritablePath = {
  created_at: number;
  path: string;
};

export type ApiWorkflowNode = {
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

export type ApiWorkflowEdge = {
  id: string;
  label: string;
  source: string;
  source_handle: string;
  target: string;
  target_handle: string;
};

export type ApiWorkflowDefinition = {
  edges: ApiWorkflowEdge[];
  nodes: ApiWorkflowNode[];
  version: number;
};

export type ApiWorkflow = {
  created_at: number;
  definition: ApiWorkflowDefinition;
  id: string;
  name: string;
  updated_at: number;
};

export type ApiWorkflowNodeRunResult = {
  error: string;
  id: string;
  output: string;
  status: WorkflowNodeRunResult["status"];
};

export type ApiWorkflowRunResult = {
  node_results: ApiWorkflowNodeRunResult[];
  outputs: Record<string, string>;
  status: WorkflowRunResult["status"];
  workflow_id: string;
};

export type ApiWorkflowRunRequest = {
  input?: string;
  inputs?: Record<string, string>;
};

export type ApiWorkflowSchedule = {
  last_error: string;
  last_result: ApiWorkflowRunResult | null;
  last_run_at: number | null;
  next_run_at: number | null;
  status: WorkflowSchedule["status"];
  timezone: string;
  workflow_id: string;
};

export type ApiWorkflowScheduleStartRequest = ApiWorkflowRunRequest & {
  timezone?: string;
};

export type ApiMessage = Message;

export type ApiState = {
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

export type ApiAbout = {
  version?: string;
};

export type RequestResult<T> =
  | {
      data: T;
      error: "";
    }
  | {
      data: null;
      error: string;
    };

export type WorkspaceMessageEditResponse = {
  is_responding?: boolean;
  messages: ApiMessage[];
};

export type DomainWorkflow = Workflow;
export type DomainWorkflowDefinition = WorkflowDefinition;
export type DomainWorkflowEdge = WorkflowEdge;
export type DomainWorkflowNode = WorkflowNode;
export type DomainWorkflowRunRequest = WorkflowRunRequest;
