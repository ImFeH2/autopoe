export interface RuntimeScope {
  run_id?: string;
  workflow_run_id?: string;
  agent_run_id?: string;
}

export interface RuntimeEvent {
  name: string;
  sequence?: number;
  scope?: RuntimeScope;
  payload: Record<string, unknown>;
  created_at?: string;
}

export interface WorkspaceConfiguration {
  path: string;
  mode: "direct" | "worktree";
  base_ref: string;
}

export interface WorkflowVersionResponse {
  version: {
    id: string;
    workflow_id: string;
    version: number;
    created_at: string;
  };
}

export interface RuntimePreferences {
  default_workspace_mode: "direct" | "worktree";
}

export interface SettingsResponse {
  model: ModelConfiguration;
  runtime: RuntimePreferences;
  has_api_key: boolean;
  credential_store_available: boolean;
}

export interface StoredWorkflowRun {
  id: string;
  workflow_id?: string;
  workflow_name: string;
  version?: number;
  status: string;
  input: Record<string, unknown>;
  output?: Record<string, unknown>;
  error?: string;
  workspace?: Record<string, unknown>;
  created_at: string;
  started_at?: string;
  completed_at?: string;
}

export interface RunListResponse {
  runs: StoredWorkflowRun[];
}

export interface RunEventsResponse {
  events: RuntimeEvent[];
}
import type { ModelConfiguration } from "@/types/workflow";
