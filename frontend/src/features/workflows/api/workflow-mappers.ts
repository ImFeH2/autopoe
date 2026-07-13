import type {
  ApiWorkflow,
  ApiWorkflowConnection,
  ApiWorkflowDraft,
  ApiWorkflowSpec,
  ApiWorkflowRunResult,
  ApiWorkflowSchedule,
} from "@/features/workflows/api/workflow-api-types";
import type {
  WorkflowRunRequest,
  WorkflowRunResult,
} from "@/features/workflows/model/workflow-run-types";
import type {
  WorkflowSchedule,
  WorkflowScheduleStartRequest,
} from "@/features/workflows/model/workflow-schedule-types";
import type {
  Workflow,
  WorkflowConnection,
  WorkflowSpec,
} from "@/features/workflows/model/workflow-types";

export const workflowConnectionFromApi = (
  connection: ApiWorkflowConnection,
): WorkflowConnection => ({
  from: {
    nodeId: connection.from.node_id,
    port: connection.from.port,
  },
  id: connection.id,
  to: {
    nodeId: connection.to.node_id,
    port: connection.to.port,
  },
});

export const workflowConnectionToApi = (
  connection: WorkflowConnection,
): ApiWorkflowConnection => ({
  from: {
    node_id: connection.from.nodeId,
    port: connection.from.port,
  },
  id: connection.id,
  to: {
    node_id: connection.to.nodeId,
    port: connection.to.port,
  },
});

export const workflowSpecFromApi = (spec: ApiWorkflowSpec): WorkflowSpec => ({
  connections: spec.connections.map(workflowConnectionFromApi),
  nodes: spec.nodes.map((node) => ({
    config: node.config,
    id: node.id,
    kind: node.kind,
  })),
});

export const workflowFromApi = (workflow: ApiWorkflow): Workflow => ({
  activeRevision: workflow.active_revision,
  createdAt: workflow.created_at,
  id: workflow.id,
  name: workflow.name,
  presentation: workflow.presentation,
  revision: workflow.revision,
  spec: workflowSpecFromApi(workflow.spec),
  updatedAt: workflow.updated_at,
});

export const workflowToApi = (workflow: Workflow): ApiWorkflowDraft => ({
  id: workflow.id,
  name: workflow.name,
  presentation: workflow.presentation,
  spec: {
    connections: workflow.spec.connections.map(workflowConnectionToApi),
    nodes: workflow.spec.nodes.map((node) => ({
      config: node.config,
      id: node.id,
      kind: node.kind,
    })),
  },
});

export const workflowRunResultFromApi = (
  result: ApiWorkflowRunResult,
): WorkflowRunResult => ({
  nodeResults: result.node_results.map((nodeResult) => ({
    error: nodeResult.error,
    id: nodeResult.id,
    inputs: nodeResult.inputs,
    output: nodeResult.output,
    status: nodeResult.status,
  })),
  outputs: result.outputs,
  runId: result.run_id,
  status: result.status,
  trigger: result.trigger,
  workflowId: result.workflow_id,
  workflowRevision: result.workflow_revision,
});

export const workflowRunRequestToApi = (request: WorkflowRunRequest) => ({
  input: request.input ?? "",
  inputs: request.inputs ?? {},
  ...(request.workflowRevision === undefined
    ? {}
    : { workflow_revision: request.workflowRevision }),
});

export const workflowScheduleFromApi = (
  schedule: ApiWorkflowSchedule,
): WorkflowSchedule => ({
  lastError: schedule.last_error,
  lastResult: schedule.last_result
    ? workflowRunResultFromApi(schedule.last_result)
    : null,
  lastRunAt: schedule.last_run_at,
  nextRunAt: schedule.next_run_at,
  status: schedule.status,
  timezone: schedule.timezone,
  workflowId: schedule.workflow_id,
});

export const workflowScheduleStartRequestToApi = (
  request: WorkflowScheduleStartRequest,
) => ({
  ...(request.input === undefined ? {} : { input: request.input }),
  inputs: request.inputs ?? {},
  ...(request.timezone === undefined ? {} : { timezone: request.timezone }),
  ...(request.workflowRevision === undefined
    ? {}
    : { workflow_revision: request.workflowRevision }),
});
