import type {
  WorkflowRunRequest,
  WorkflowRunResult,
} from "@/features/workflows/model/workflow-run-types";

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
