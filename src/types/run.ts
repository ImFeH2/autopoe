export type WorkflowRunStatus =
  | "queued"
  | "running"
  | "waiting"
  | "completed"
  | "failed"
  | "cancelled"
  | "interrupted";

export interface WorkflowRunEvent {
  id: string;
  name: string;
  node?: string;
  detail?: string;
  approvalId?: string;
  prompt?: string;
  resolved?: boolean;
  timestamp: string;
}

export interface WorkflowRun {
  id: string;
  workflowName: string;
  status: WorkflowRunStatus;
  startedAt: string;
  events: WorkflowRunEvent[];
  eventsLoaded?: boolean;
}
