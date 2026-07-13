export type WorkflowNodeKind =
  | "input"
  | "agent"
  | "merge"
  | "code"
  | "timer"
  | "output";

export type WorkflowNodePosition = {
  x: number;
  y: number;
};

export type WorkflowSpecNode = {
  config: Record<string, unknown>;
  id: string;
  kind: WorkflowNodeKind;
};

export type WorkflowConnectionEnd = {
  nodeId: string;
  port: "input" | "output";
};

export type WorkflowConnection = {
  from: WorkflowConnectionEnd;
  id: string;
  to: WorkflowConnectionEnd;
};

export type WorkflowNodePresentation = {
  description: string;
  name: string;
  position: WorkflowNodePosition;
};

export type WorkflowConnectionPresentation = {
  label: string;
};

export type WorkflowSpec = {
  connections: WorkflowConnection[];
  nodes: WorkflowSpecNode[];
};

export type WorkflowPresentation = {
  connections: Record<string, WorkflowConnectionPresentation>;
  nodes: Record<string, WorkflowNodePresentation>;
};

export type WorkflowNode = WorkflowSpecNode & WorkflowNodePresentation;

export type WorkflowEdge = WorkflowConnection & WorkflowConnectionPresentation;

export type Workflow = {
  activeRevision: number | null;
  createdAt: number;
  id: string;
  name: string;
  presentation: WorkflowPresentation;
  revision: number;
  spec: WorkflowSpec;
  updatedAt: number;
};
