import { describe, expect, it } from "vitest";

import type {
  WorkflowNode,
  WorkflowRunResult,
} from "@/components/flowent/types";
import {
  normalizeRunInputs,
  workflowFailureMessage,
} from "@/components/flowent/workflow-run";

const workflowNode = (
  updates: Partial<WorkflowNode> & Pick<WorkflowNode, "id" | "kind">,
): WorkflowNode => ({
  config: {},
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
          workflowNode({ id: "input-a", kind: "input" }),
          workflowNode({ id: "input-b", kind: "input" }),
        ],
        {
          "input-a": "launch",
          "input-b": "",
          missing: "ignored",
        },
      ),
    ).toEqual({ "input-a": "launch" });
  });

  it("uses the first node failure as the workflow failure message", () => {
    const result: WorkflowRunResult = {
      nodeResults: [
        {
          error: null,
          id: "input",
          inputs: [],
          output: "",
          status: "success",
        },
        {
          error: { code: "node_execution_failed", message: "Code failed." },
          id: "code",
          inputs: [],
          output: "",
          status: "failed",
        },
      ],
      outputs: {},
      runId: "run",
      status: "failed",
      trigger: "manual",
      workflowId: "workflow",
      workflowRevision: 1,
    };

    expect(workflowFailureMessage(result)).toBe("Code failed.");
  });
});
