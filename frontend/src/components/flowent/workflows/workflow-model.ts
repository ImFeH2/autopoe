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
  WorkflowConnection,
  WorkflowEdge,
  WorkflowNode,
  WorkflowNodeRunResult,
  WorkflowNodeType,
  WorkflowRunResult,
  WorkflowSpec,
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
  | { id: string; kind: "edge" }
  | { id: string; kind: "node" };

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
    return { agent: "Default agent", prompt: "" };
  }
  if (type === "merge") {
    return { merge_strategy: "text" };
  }
  if (type === "code") {
    return { code: "" };
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

export const defaultWorkflowSpec = (): WorkflowSpec => ({
  connections: [],
  nodes: [],
});

export const createDraftWorkflow = (): Workflow => ({
  activeRevision: null,
  createdAt: 0,
  id: createUuid(),
  name: "Untitled Workflow",
  presentation: { connections: {}, nodes: {} },
  revision: 0,
  spec: defaultWorkflowSpec(),
  updatedAt: 0,
});

export const cloneWorkflow = (workflow: Workflow): Workflow =>
  JSON.parse(JSON.stringify(workflow)) as Workflow;

export const workflowNodes = (workflow: Workflow): WorkflowNode[] =>
  workflow.spec.nodes.map((node) => {
    const presentation = workflow.presentation.nodes[node.id];
    if (!presentation) {
      throw new Error(`Missing presentation for workflow node ${node.id}.`);
    }
    return { ...node, ...presentation };
  });

export const workflowEdges = (workflow: Workflow): WorkflowEdge[] =>
  workflow.spec.connections.map((connection) => {
    const presentation = workflow.presentation.connections[connection.id];
    if (!presentation) {
      throw new Error(
        `Missing presentation for workflow connection ${connection.id}.`,
      );
    }
    return { ...connection, ...presentation };
  });

const runResultMap = (runResult: WorkflowRunResult | null) =>
  new Map((runResult?.nodeResults ?? []).map((result) => [result.id, result]));

export const workflowToFlowNodes = (
  workflow: Workflow,
  runResult: WorkflowRunResult | null,
): WorkflowCanvasNode[] => {
  const results = runResultMap(runResult);
  return workflowNodes(workflow).map((node) => ({
    data: {
      description: node.description,
      label: node.name,
      result: results.get(node.id),
      workflowType: node.kind,
    },
    id: node.id,
    position: node.position,
    type: "workflowNode",
  }));
};

export const workflowToFlowEdges = (workflow: Workflow): WorkflowCanvasEdge[] =>
  workflowEdges(workflow).map((connection) => ({
    data: { label: connection.label },
    id: connection.id,
    label: connection.label,
    markerEnd: { type: MarkerType.ArrowClosed },
    source: connection.from.nodeId,
    sourceHandle: connection.from.port,
    target: connection.to.nodeId,
    targetHandle: connection.to.port,
  }));

export const flowEdgeToWorkflowConnection = (
  edge: WorkflowCanvasEdge,
): WorkflowConnection => ({
  from: { nodeId: edge.source, port: "output" },
  id: edge.id,
  to: { nodeId: edge.target, port: "input" },
});
