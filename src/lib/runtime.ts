import { Channel, invoke } from "@tauri-apps/api/core";
import type { RuntimeEvent, WorkspaceConfiguration } from "@/types/runtime";

export async function runtimeRequest<T>(
  name: string,
  payload: Record<string, unknown> = {},
) {
  return invoke<T>("runtime_request", { name, payload });
}

interface RunWorkflowOptions {
  runId: string;
  workflowId: string;
  version?: number;
  input: Record<string, unknown>;
  workspace?: WorkspaceConfiguration;
}

export async function runWorkflow(
  options: RunWorkflowOptions,
  onEvent: (event: RuntimeEvent) => void,
) {
  const events = new Channel<RuntimeEvent>();
  events.onmessage = onEvent;
  return invoke<Record<string, unknown>>("run_workflow", {
    ...options,
    events,
  });
}
