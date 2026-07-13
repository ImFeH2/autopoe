import type {
  ApiTelegramBot,
  ApiTelegramBotSaveRequest,
  ApiTelegramSession,
  ApiWritablePath,
  ApiWorkflow,
  ApiWorkflowConnection,
  ApiWorkflowDraft,
  ApiWorkflowSpec,
  ApiWorkflowRunResult,
  ApiWorkflowSchedule,
} from "@/app/api/types";
import type {
  ContextUsageInfo,
  Skill,
  TelegramBot,
  TelegramSession,
  Workflow,
  WorkflowConnection,
  WorkflowRunRequest,
  WorkflowRunResult,
  WorkflowSchedule,
  WorkflowScheduleStartRequest,
  WorkflowSpec,
  WritablePath,
} from "@/components/flowent/types";
import type { McpServer } from "@/features/mcp/model/mcp-types";

export const errorNotificationKeysFromState = (
  telegramBot: TelegramBot,
  mcpServers: McpServer[],
  skills: Skill[],
) => {
  const keys: string[] = [];
  if (telegramBot.status === "error" && telegramBot.error) {
    keys.push(`channel:telegram:${telegramBot.error}`);
  }
  for (const server of mcpServers) {
    if (server.status === "error" && server.error) {
      keys.push(`mcp:${server.id}:${server.error}`);
    }
  }
  for (const skill of skills) {
    if (skill.enabled && skill.error) {
      keys.push(`skill:${skill.id}:${skill.error}`);
    }
  }
  return keys;
};

export const contextWindowFromLimit = (
  usageInfo: ContextUsageInfo | null,
  contextWindowLimit: number | null,
) => {
  if (usageInfo === null || contextWindowLimit === null) {
    return usageInfo;
  }
  return {
    ...usageInfo,
    model_context_window: contextWindowLimit,
  };
};

export const telegramSessionFromApi = (
  session: ApiTelegramSession,
): TelegramSession => ({
  chatId: session.chat_id,
  displayName: session.display_name,
  recentMessage: session.recent_message,
  status: session.status,
  updatedAt: session.updated_at ?? 0,
  userId: session.user_id,
  username: session.username,
});

export const createEmptyTelegramBot = (): TelegramBot => ({
  botSecret: "",
  enabled: false,
  error: "",
  hasBotSecret: false,
  sessions: [],
  status: "disabled",
});

export const telegramBotFromApi = (
  telegramBot?: ApiTelegramBot,
): TelegramBot => ({
  botSecret: "",
  enabled: telegramBot?.enabled ?? false,
  error: telegramBot?.error ?? "",
  hasBotSecret: telegramBot?.has_bot_token ?? false,
  sessions: (telegramBot?.sessions ?? []).map(telegramSessionFromApi),
  status: telegramBot?.status ?? "disabled",
});

export const telegramBotToApi = (
  telegramBot: TelegramBot,
): ApiTelegramBotSaveRequest => ({
  enabled: telegramBot.enabled,
  ...(telegramBot.botSecret ? { bot_token: telegramBot.botSecret } : {}),
});

export const writablePathFromApi = (
  writablePath: ApiWritablePath,
): WritablePath => ({
  createdAt: writablePath.created_at,
  path: writablePath.path,
});

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

export const errorMessageFromResponse = async (
  response: Response,
  fallback: string,
) => {
  try {
    const body = (await response.json()) as { detail?: unknown };
    if (typeof body.detail === "string" && body.detail.trim()) {
      return body.detail;
    }
  } catch {
    return fallback;
  }
  return fallback;
};
