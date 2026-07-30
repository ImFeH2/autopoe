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
import type { ModelConfiguration } from "@/types/workflow";
