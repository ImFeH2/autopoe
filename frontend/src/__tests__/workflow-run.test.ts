import { describe, expect, it } from "vitest";

import type {
  WorkflowNode,
  WorkflowRunResult,
} from "@/components/flowent/types";
import {
  cronDelayMs,
  normalizeRunInputs,
  timerDelayMs,
  workflowFailureMessage,
} from "@/components/flowent/workflow-run";

const workflowNode = (
  updates: Partial<WorkflowNode> & Pick<WorkflowNode, "id" | "type">,
): WorkflowNode => ({
  data: {},
  description: "",
  name: updates.id,
  position: { x: 0, y: 0 },
  ...updates,
});

describe("workflow run helpers", () => {
  it("keeps only filled values for known input nodes", () => {
    expect(
      normalizeRunInputs(
        [
          workflowNode({ id: "input-a", type: "input" }),
          workflowNode({ id: "input-b", type: "input" }),
        ],
        {
          "input-a": "launch",
          "input-b": "",
          missing: "ignored",
        },
      ),
    ).toEqual({ "input-a": "launch" });
  });

  it("uses interval seconds for interval timers", () => {
    expect(
      timerDelayMs(
        workflowNode({
          data: { interval_seconds: 7, mode: "interval" },
          id: "timer",
          type: "timer",
        }),
      ),
    ).toBe(7000);
  });

  it("falls back to one minute for invalid cron expressions", () => {
    expect(cronDelayMs("not-a-cron", new Date("2026-06-17T10:00:30Z"))).toBe(
      60_000,
    );
  });

  it("finds the next matching cron minute", () => {
    expect(cronDelayMs("*/5 * * * *", new Date("2026-06-17T10:02:30Z"))).toBe(
      150_000,
    );
  });

  it("uses the first node failure as the workflow failure message", () => {
    const result: WorkflowRunResult = {
      nodeResults: [
        { error: "", id: "input", output: "", status: "success" },
        { error: "Code failed.", id: "code", output: "", status: "failed" },
      ],
      outputs: {},
      status: "failed",
      workflowId: "workflow",
    };

    expect(workflowFailureMessage(result)).toBe("Code failed.");
  });
});
