import type { WorkflowRun, WorkflowRunEvent } from "@/types/run";
import type { RuntimeEvent } from "@/types/runtime";

const terminalStatus = {
  "workflow.completed": "completed",
  "workflow.failed": "failed",
  "workflow.cancelled": "cancelled",
} as const;

function text(value: unknown) {
  return typeof value === "string" ? value : undefined;
}

function eventDetail(event: RuntimeEvent) {
  if (event.name === "agent.tool_started") {
    return JSON.stringify(event.payload.arguments ?? {}, null, 2);
  }
  if (event.name === "agent.tool_completed") {
    return JSON.stringify(event.payload.result ?? {}, null, 2);
  }
  return text(event.payload.message);
}

function eventId(event: RuntimeEvent) {
  const sequence = event.sequence ?? Date.now();
  return `${event.scope?.run_id ?? "run"}-${sequence}-${event.name}`;
}

function eventTime(event: RuntimeEvent) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(event.created_at ? new Date(event.created_at) : new Date());
}

function toRunEvent(event: RuntimeEvent): WorkflowRunEvent {
  const approvalId = text(event.payload.approval_id);
  return {
    id: eventId(event),
    name: event.name,
    node: text(event.payload.node_id),
    detail: eventDetail(event),
    approvalId,
    prompt: text(event.payload.prompt),
    timestamp: eventTime(event),
  };
}

function applyTextDelta(run: WorkflowRun, event: RuntimeEvent): WorkflowRun {
  const agentId = event.scope?.agent_run_id ?? "agent";
  const outputId = `${run.id}:output:${agentId}`;
  const delta = text(event.payload.delta) ?? "";
  const existing = run.events.find((item) => item.id === outputId);
  if (!existing) {
    return {
      ...run,
      events: [
        ...run.events,
        {
          id: outputId,
          name: "agent.output",
          node: text(event.payload.node_id),
          detail: delta,
          timestamp: toRunEvent(event).timestamp,
        },
      ],
    };
  }
  return {
    ...run,
    events: run.events.map((item) =>
      item.id === outputId
        ? { ...item, detail: `${item.detail ?? ""}${delta}` }
        : item,
    ),
  };
}

export function applyRuntimeEvent(
  run: WorkflowRun,
  event: RuntimeEvent,
): WorkflowRun {
  if (event.name === "agent.text_delta") {
    return applyTextDelta(run, event);
  }
  const status = terminalStatus[event.name as keyof typeof terminalStatus];
  const waiting =
    event.name === "approval.required" ||
    event.name === "workflow.approval_required";
  const resumed =
    event.name === "approval.resolved" ||
    event.name === "workflow.approval_resolved";
  const approvalId = text(event.payload.approval_id);
  const events =
    resumed && approvalId
      ? run.events.map((item) =>
          item.approvalId === approvalId ? { ...item, resolved: true } : item,
        )
      : run.events;
  return {
    ...run,
    status: status ?? (waiting ? "waiting" : resumed ? "running" : run.status),
    events: [...events, toRunEvent(event)],
  };
}

export function markApprovalResolved(
  run: WorkflowRun,
  approvalId: string,
): WorkflowRun {
  return {
    ...run,
    status: "running",
    events: run.events.map((event) =>
      event.approvalId === approvalId ? { ...event, resolved: true } : event,
    ),
  };
}
