import type {
  WorkflowNodeRunResult,
  WorkflowRunResult,
} from "@/features/workflows/model/workflow-run-types";
import type { WorkflowSchedule } from "@/features/workflows/model/workflow-schedule-types";
import type { WorkflowNodeKind } from "@/features/workflows/model/workflow-types";

export type ApiWorkflowNode = {
  config: Record<string, unknown>;
  id: string;
  kind: WorkflowNodeKind;
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
