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
