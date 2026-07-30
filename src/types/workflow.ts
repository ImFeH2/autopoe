export type ProviderKind =
  | "demo"
  | "openai"
  | "openai_compatible"
  | "anthropic";

export type WorkflowNodeKind = "agent" | "loop" | "approval";

export interface CanvasPosition {
  x: number;
  y: number;
}

export interface ModelConfiguration {
  provider: ProviderKind;
  model: string;
  api_mode: "responses" | "chat";
  credential_id?: string;
  base_url?: string;
}

export interface AgentLimits {
  request_limit: number;
  tool_calls_limit: number;
  timeout_seconds: number;
  max_output_tokens?: number;
}

export interface AgentConfiguration {
  id?: string;
  name: string;
  instructions: string;
  model: ModelConfiguration;
  limits: AgentLimits;
  retries: number;
  tools: string[];
}

interface BaseWorkflowNode {
  id: string;
  name: string;
  depends_on: string[];
  position: CanvasPosition;
}

export interface AgentWorkflowNode extends BaseWorkflowNode {
  type: "agent";
  agent: AgentConfiguration;
  prompt: string;
  output_mode: "text" | "json";
  max_attempts: number;
}

export interface ApprovalWorkflowNode extends BaseWorkflowNode {
  type: "approval";
  prompt: string;
  reject_behavior: "continue" | "fail";
}

export interface Condition {
  path: string;
  operator:
    | "equals"
    | "not_equals"
    | "contains"
    | "not_contains"
    | "truthy"
    | "falsy";
  value?: unknown;
}

export interface LoopWorkflowNode extends BaseWorkflowNode {
  type: "loop";
  nodes: WorkflowNode[];
  until?: Condition;
  max_iterations: number;
  on_exhausted: "complete" | "fail";
}

export type WorkflowNode =
  | AgentWorkflowNode
  | ApprovalWorkflowNode
  | LoopWorkflowNode;

export interface WorkflowDefinition {
  id: string;
  name: string;
  description: string;
  nodes: WorkflowNode[];
  max_parallelism: number;
}

export const availableTools = [
  "read_file",
  "list_files",
  "search_text",
  "write_file",
  "replace_text",
  "run_command",
  "git_status",
  "git_diff",
] as const;

export type AgentTool = (typeof availableTools)[number];
