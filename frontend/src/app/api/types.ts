import type {
  ContextUsageInfo,
  Message,
  ReasoningEffort,
  Skill,
  TelegramBot,
  TelegramSession,
  Workflow,
  WorkflowConnection,
  WorkflowEdge,
  WorkflowNode,
  WorkflowNodeRunResult,
  WorkflowRunRequest,
  WorkflowRunResult,
  WorkflowSchedule,
  WorkflowSpec,
} from "@/components/flowent/types";
import type { ApiMcpServer } from "@/features/mcp/api/mcp-api-types";
import type { ApiProvider } from "@/features/providers/api/provider-api-types";

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

export type ApiSkill = Skill;

export type ApiWritablePath = {
  created_at: number;
  path: string;
};

export type ApiWorkflowNode = {
  config: Record<string, unknown>;
  id: string;
  kind: WorkflowNode["kind"];
};

export type ApiWorkflowConnectionEnd = {
  node_id: string;
  port: "input" | "output";
};

export type ApiWorkflowConnection = {
  from: ApiWorkflowConnectionEnd;
  id: string;
  to: ApiWorkflowConnectionEnd;
};

export type ApiWorkflowSpec = {
  connections: ApiWorkflowConnection[];
  nodes: ApiWorkflowNode[];
};

export type ApiWorkflowPresentation = {
  connections: Record<string, { label: string }>;
  nodes: Record<
    string,
    {
      description: string;
      name: string;
      position: { x: number; y: number };
    }
  >;
};

export type ApiWorkflow = {
  active_revision: number | null;
  created_at: number;
  id: string;
  name: string;
  presentation: ApiWorkflowPresentation;
  revision: number;
  spec: ApiWorkflowSpec;
  updated_at: number;
};

export type ApiWorkflowDraft = Pick<
  ApiWorkflow,
  "id" | "name" | "presentation" | "spec"
>;

export type ApiWorkflowSaveRequest = {
  base_revision: number | null;
  workflow: ApiWorkflowDraft;
};

export type ApiWorkflowNodeRunResult = {
  error: { code: string; message: string } | null;
  id: string;
  inputs: string[];
  output: string;
  status: WorkflowNodeRunResult["status"];
};

export type ApiWorkflowRunResult = {
  node_results: ApiWorkflowNodeRunResult[];
  outputs: Record<string, string>;
  run_id: string;
  status: WorkflowRunResult["status"];
  trigger: WorkflowRunResult["trigger"];
  workflow_id: string;
  workflow_revision: number;
};

export type ApiWorkflowRunRequest = {
  input?: string;
  inputs?: Record<string, string>;
  workflow_revision?: number;
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
      latest?: T;
    };

export type WorkspaceMessageEditResponse = {
  is_responding?: boolean;
  messages: ApiMessage[];
};

export type DomainWorkflow = Workflow;
export type DomainWorkflowConnection = WorkflowConnection;
export type DomainWorkflowEdge = WorkflowEdge;
export type DomainWorkflowNode = WorkflowNode;
export type DomainWorkflowRunRequest = WorkflowRunRequest;
export type DomainWorkflowSpec = WorkflowSpec;
