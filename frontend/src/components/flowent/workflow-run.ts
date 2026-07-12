import type {
  Workflow,
  WorkflowNode,
  WorkflowRunResult,
} from "@/components/flowent/types";
import { workflowNodes } from "@/components/flowent/workflows/workflow-model";

export const workflowInputNodes = (workflow: Workflow) =>
  workflowNodes(workflow).filter((node) => node.kind === "input");

export const workflowTimerNodes = (workflow: Workflow) =>
  workflowNodes(workflow).filter((node) => node.kind === "timer");

export const normalizeRunInputs = (
  inputNodes: WorkflowNode[],
  values: Record<string, string>,
) => {
  const inputNodeIds = new Set(inputNodes.map((node) => node.id));
  return Object.fromEntries(
    Object.entries(values).filter(
      ([nodeId, value]) => inputNodeIds.has(nodeId) && value !== "",
    ),
  );
};

export const workflowFailureMessage = (result: WorkflowRunResult) =>
  result.nodeResults.find((nodeResult) => nodeResult.status === "failed")?.error
    ?.message || "Run could not be completed.";
