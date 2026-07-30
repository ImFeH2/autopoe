export type WorkflowRunStatus =
  | "queued"
  | "running"
  | "waiting"
  | "completed"
  | "failed"
  | "cancelled";

export interface WorkflowRunEvent {
  id: string;
  name: string;
  node?: string;
  detail?: string;
  timestamp: string;
}

export interface WorkflowRun {
  id: string;
  workflowName: string;
  status: WorkflowRunStatus;
  startedAt: string;
  events: WorkflowRunEvent[];
}
