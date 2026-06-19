import { MarkerType, type Edge, type Node } from "@xyflow/react";
import {
  Bot,
  ClipboardList,
  Code2,
  GitMerge,
  Square,
  Timer,
  type LucideIcon,
} from "lucide-react";

import type {
  Workflow,
  WorkflowDefinition,
  WorkflowEdge,
  WorkflowNodeRunResult,
  WorkflowNodeType,
  WorkflowRunResult,
} from "@/components/flowent/types";
import { createUuid } from "@/lib/utils";

export type WorkflowCanvasNodeData = {
  description: string;
  label: string;
  result?: WorkflowNodeRunResult;
  workflowType: WorkflowNodeType;
};

export type WorkflowCanvasNode = Node<WorkflowCanvasNodeData, "workflowNode">;
export type WorkflowCanvasEdge = Edge<{ label: string }>;

export type SelectedWorkflowElement =
  | {
      id: string;
      kind: "edge";
    }
  | {
      id: string;
      kind: "node";
    };

export type WorkflowNodeTemplate = {
  description: string;
  icon: LucideIcon;
  label: string;
  type: WorkflowNodeType;
};

export const workflowNodeTemplates: WorkflowNodeTemplate[] = [
  {
    description: "Data entry point",
    icon: Square,
    label: "Input",
    type: "input",
  },
  {
    description: "Agent step",
    icon: Bot,
    label: "Agent",
    type: "agent",
  },
  {
    description: "Combine inputs",
    icon: GitMerge,
    label: "Merge",
    type: "merge",
  },
  {
    description: "Python step",
    icon: Code2,
    label: "Code",
    type: "code",
  },
  {
    description: "Scheduled trigger",
    icon: Timer,
    label: "Timer",
    type: "timer",
  },
  {
    description: "Final result",
    icon: ClipboardList,
    label: "Output",
    type: "output",
  },
];

export const workflowNodeIconByType = {
  agent: Bot,
  code: Code2,
  input: Square,
  merge: GitMerge,
  output: ClipboardList,
  timer: Timer,
} satisfies Record<WorkflowNodeType, LucideIcon>;

export const defaultWorkflowNodeData = (
  type: WorkflowNodeType,
): Record<string, unknown> => {
  if (type === "input") {
    return { default_value: "", input_type: "text" };
  }
  if (type === "agent") {
    return { agent: "Default agent", prompt: "{{input.output}}" };
  }
  if (type === "merge") {
    return { merge_strategy: "text" };
  }
  if (type === "code") {
    return { code: "output = input" };
  }
  if (type === "timer") {
    return {
      cron: "* * * * *",
      interval_seconds: 5,
      mode: "interval",
      payload: "Timer fired.",
    };
  }
  return { output_key: "final_result", transform: "" };
};

export const defaultWorkflowDefinition = (): WorkflowDefinition => ({
  edges: [],
  nodes: [],
  version: 1,
});

export const createDraftWorkflow = (): Workflow => ({
  createdAt: 0,
  definition: defaultWorkflowDefinition(),
  id: createUuid(),
  name: "Untitled Workflow",
  updatedAt: 0,
});

export const cloneWorkflow = (workflow: Workflow): Workflow =>
  JSON.parse(JSON.stringify(workflow)) as Workflow;

const runResultMap = (runResult: WorkflowRunResult | null) =>
  new Map((runResult?.nodeResults ?? []).map((result) => [result.id, result]));

export const workflowToFlowNodes = (
  workflow: Workflow,
  runResult: WorkflowRunResult | null,
): WorkflowCanvasNode[] => {
  const results = runResultMap(runResult);
  return workflow.definition.nodes.map((node) => ({
    data: {
      description: node.description,
      label: node.name,
      result: results.get(node.id),
      workflowType: node.type,
    },
    id: node.id,
    position: node.position,
    type: "workflowNode",
  }));
};

export const workflowToFlowEdges = (workflow: Workflow): WorkflowCanvasEdge[] =>
  workflow.definition.edges.map((edge) => ({
    data: { label: edge.label },
    id: edge.id,
    label: edge.label,
    markerEnd: { type: MarkerType.ArrowClosed },
    source: edge.source,
    sourceHandle: edge.sourceHandle || undefined,
    target: edge.target,
    targetHandle: edge.targetHandle || undefined,
  }));

export const flowEdgeToWorkflowEdge = (
  edge: WorkflowCanvasEdge,
): WorkflowEdge => ({
  id: edge.id,
  label: String(edge.label ?? edge.data?.label ?? ""),
  source: edge.source,
  sourceHandle: edge.sourceHandle ?? "",
  target: edge.target,
  targetHandle: edge.targetHandle ?? "",
});
