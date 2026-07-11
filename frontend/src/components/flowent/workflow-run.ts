import type {
  Workflow,
  WorkflowNode,
  WorkflowRunResult,
} from "@/components/flowent/types";

export const workflowInputNodes = (workflow: Workflow) =>
  workflow.definition.nodes.filter((node) => node.type === "input");

export const workflowTimerNodes = (workflow: Workflow) =>
  workflow.definition.nodes.filter((node) => node.type === "timer");

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
  result.nodeResults.find((nodeResult) => nodeResult.status === "failed")
    ?.error || "Run could not be completed.";
