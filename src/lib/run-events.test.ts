import { describe, expect, it } from "vitest";
import { applyRuntimeEvent, markApprovalResolved } from "@/lib/run-events";
import type { WorkflowRun } from "@/types/run";

function createRun(): WorkflowRun {
  return {
    id: "run-1",
    workflowName: "Delivery",
    status: "running",
    startedAt: "10:00",
    events: [],
  };
}

describe("run events", () => {
  it("marks a queued workflow as running", () => {
    const started = applyRuntimeEvent(
      { ...createRun(), status: "queued" },
      {
        name: "workflow.started",
        sequence: 0,
        scope: { run_id: "run-1" },
        payload: {},
      },
    );

    expect(started.status).toBe("running");
  });

  it("coalesces streaming text by agent run", () => {
    const first = applyRuntimeEvent(createRun(), {
      name: "agent.text_delta",
      sequence: 1,
      scope: { run_id: "run-1", agent_run_id: "agent-1" },
      payload: { node_id: "analysis", delta: "Hello " },
    });
    const second = applyRuntimeEvent(first, {
      name: "agent.text_delta",
      sequence: 2,
      scope: { run_id: "run-1", agent_run_id: "agent-1" },
      payload: { node_id: "analysis", delta: "world" },
    });

    expect(second.events).toHaveLength(1);
    expect(second.events[0].detail).toBe("Hello world");
  });

  it("tracks approval and terminal states", () => {
    const waiting = applyRuntimeEvent(createRun(), {
      name: "approval.required",
      sequence: 3,
      scope: { run_id: "run-1" },
      payload: { approval_id: "approval-1", prompt: "Run tests" },
    });
    const resolved = markApprovalResolved(waiting, "approval-1");
    const completed = applyRuntimeEvent(resolved, {
      name: "workflow.completed",
      sequence: 4,
      scope: { run_id: "run-1" },
      payload: {},
    });

    expect(waiting.status).toBe("waiting");
    expect(resolved.events[0].resolved).toBe(true);
    expect(completed.status).toBe("completed");
  });

  it("replays stored timestamps and resolves prior approvals", () => {
    const waiting = applyRuntimeEvent(createRun(), {
      name: "workflow.approval_required",
      sequence: 3,
      scope: { run_id: "run-1" },
      payload: { approval_id: "approval-1", prompt: "Ship" },
      created_at: "2026-07-30T10:15:30+00:00",
    });
    const resolved = applyRuntimeEvent(waiting, {
      name: "workflow.approval_resolved",
      sequence: 4,
      scope: { run_id: "run-1" },
      payload: { approval_id: "approval-1", approved: true },
      created_at: "2026-07-30T10:16:00+00:00",
    });

    expect(resolved.events[0].resolved).toBe(true);
    expect(resolved.events[0].timestamp).not.toBe("");
  });
});
