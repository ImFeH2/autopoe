import type {
  Connection,
  Edge as FlowEdge,
  Node as FlowNode,
  ReactFlowInstance,
} from "@xyflow/react";
import type { MouseEvent as ReactMouseEvent, RefObject } from "react";
import type { ContextMenuEntry } from "@/components/ContextMenu";
import type {
  AgentState,
  Node as AgentGraphNode,
  NodeType,
  Role,
  TabEdge,
  WorkflowPort,
  WorkflowPortType,
} from "@/types";

export const NODE_EXIT_MS = 320;
export const EDGE_EXIT_MS = 220;
export const VIEWPORT_FIT_PADDING = 0.3;
export const VIEWPORT_FIT_MAX_ZOOM = 1;
export const VIEWPORT_MIN_ZOOM = 0.05;
export const VIEWPORT_MAX_ZOOM = 6;
export const LAYOUT_RETRY_LIMIT = 1;
export const graphChromePillClass =
  "rounded-md border border-border bg-popover px-3 py-1 text-[11px] font-medium text-popover-foreground shadow-sm";
export const quickCreateInputClass =
  "h-8 w-full rounded-md border border-input bg-background/55 px-3 text-[13px] text-foreground shadow-xs placeholder:text-muted-foreground transition-[border-color,box-shadow] focus:border-ring focus:outline-none focus:ring-[3px] focus:ring-ring/50";
export const quickCreateListClass =
  "max-h-56 space-y-2 overflow-y-auto rounded-md border border-border bg-background/40 p-2 scrollbar-none";
export const quickCreateButtonClass =
  "w-full rounded-md border px-3 py-2 text-left transition-colors";
export const NODE_BODY_SOURCE_HANDLE = "__node-body-source";
export const NODE_BODY_TARGET_HANDLE = "__node-body-target";

export type FlowFitViewOptions = NonNullable<
  Parameters<ReactFlowInstance["fitView"]>[0]
>;

export interface TooltipData {
  agentId: string;
  x: number;
  y: number;
}

export type ContextMenuState =
  | {
      kind: "pane";
      x: number;
      y: number;
    }
  | {
      kind: "node";
      x: number;
      y: number;
      agentId: string;
    }
  | {
      kind: "edge";
      x: number;
      y: number;
      sourceId: string;
      targetId: string;
      sourcePortKey?: string | null;
      targetPortKey?: string | null;
    };

export type QuickCreateState =
  | {
      kind: "standalone";
      x: number;
      y: number;
    }
  | {
      kind: "linked";
      x: number;
      y: number;
      anchorNodeId: string;
    }
  | {
      kind: "between";
      x: number;
      y: number;
      sourceNodeId: string;
      targetNodeId: string;
    };

export interface ConnectionPortChoice {
  sourcePortKey: string;
  sourcePortLabel: string;
  targetPortKey: string;
  targetPortLabel: string;
  type: WorkflowPortType;
}

export interface ConnectionChoiceState {
  tabId: string;
  sourceNodeId: string;
  sourceNodeLabel: string;
  targetNodeId: string;
  targetNodeLabel: string;
  choices: ConnectionPortChoice[];
}

export interface AgentNodeData extends Record<string, unknown> {
  label: string;
  width: number;
  node_type: NodeType;
  is_leader: boolean;
  state: AgentState;
  shortId: string;
  name: string | null;
  role_name: string | null;
  latestTodo: string | null;
  selected: boolean;
  toolCall: string | null;
  leaving: boolean;
  canConnect: boolean;
  showConnectionEntryHint: boolean;
  connectionState?: "source" | "valid-target" | "invalid-target" | null;
  inputPorts: WorkflowPort[];
  outputPorts: WorkflowPort[];
}

export interface AgentGraphHandle {
  enterConnectMode: () => void;
}

export interface AgentGraphProps {
  roles?: Role[];
  loadingRoles?: boolean;
  onConnectModeChange?: (active: boolean) => void;
  onCreateConnection?: (
    tabId: string,
    sourceNodeId: string,
    targetNodeId: string,
    sourcePortKey?: string,
    targetPortKey?: string,
  ) => Promise<void>;
  onDeleteConnection?: (
    tabId: string,
    sourceNodeId: string,
    targetNodeId: string,
    sourcePortKey?: string,
    targetPortKey?: string,
  ) => Promise<void>;
  onCreateStandaloneAgent?: (input: {
    tabId: string;
    roleName: string;
    name?: string;
  }) => Promise<unknown>;
  onCreateLinkedAgent?: (input: {
    tabId: string;
    anchorNodeId: string;
    roleName: string;
    name?: string;
  }) => Promise<unknown>;
  onDeleteAgent?: (input: {
    tabId: string;
    node: AgentGraphNode;
    edges?: TabEdge[];
  }) => Promise<void>;
  onInsertAgentBetween?: (input: {
    tabId: string;
    sourceNodeId: string;
    targetNodeId: string;
    roleName: string;
    name?: string;
  }) => Promise<unknown>;
  onOpenConnectDialog?: () => void;
  readOnly?: boolean;
}

export interface AgentGraphController {
  activeTabId: string | null;
  animatedEdges: FlowEdge[];
  animatedNodes: FlowNode[];
  connectHintLabel: string | null;
  containerRef: RefObject<HTMLDivElement | null>;
  contextMenu: ContextMenuState | null;
  contextMenuItems: ContextMenuEntry[];
  connectionChoice: ConnectionChoiceState | null;
  emptyState: {
    title: string;
  } | null;
  enterConnectMode: () => void;
  loadingRoles: boolean;
  quickCreate: QuickCreateState | null;
  quickCreateName: string;
  quickCreateRoleName: string;
  readOnly: boolean;
  setQuickCreateName: (value: string) => void;
  setQuickCreateRoleName: (value: string) => void;
  submittingConnectionChoice: boolean;
  submittingQuickCreate: boolean;
  tooltip: TooltipData | null;
  tooltipAgent: AgentGraphNode | null;
  tooltipRef: RefObject<HTMLDivElement | null>;
  tooltipStyle:
    | {
        left: number;
        top: number;
      }
    | undefined;
  tooltipToolCall: string | null;
  viewportZoom: number;
  availableRoles: Role[];
  closeConnectionChoice: () => void;
  closeContextMenu: () => void;
  closeQuickCreate: () => void;
  handleFlowInit: (instance: ReactFlowInstance) => void;
  handleViewportMove: (
    event: MouseEvent | TouchEvent | null,
    viewport: { zoom: number },
  ) => void;
  isValidConnection: (edgeOrConnection: FlowEdge | Connection) => boolean;
  onConnect: (connection: Connection) => void;
  onConnectEnd: (
    event?: globalThis.MouseEvent | TouchEvent,
    state?: Record<string, unknown>,
  ) => void;
  onConnectStart: (
    event: globalThis.MouseEvent | TouchEvent,
    params?: {
      nodeId: string | null;
      handleId?: string | null;
      handleType: "source" | "target" | null;
    },
  ) => void;
  onEdgeClick: (
    event: ReactMouseEvent<Element, MouseEvent>,
    edge: FlowEdge,
  ) => void;
  onEdgeContextMenu: (
    event: ReactMouseEvent<Element, MouseEvent>,
    edge: FlowEdge,
  ) => void;
  onNodeClick: (
    event: ReactMouseEvent<Element, MouseEvent>,
    node: FlowNode,
  ) => void;
  onNodeContextMenu: (
    event: ReactMouseEvent<Element, MouseEvent>,
    node: FlowNode,
  ) => void;
  onNodeMouseEnter: (
    event: ReactMouseEvent<Element, MouseEvent>,
    node: FlowNode,
  ) => void;
  onNodeMouseLeave: (
    event: ReactMouseEvent<Element, MouseEvent>,
    node: FlowNode,
  ) => void;
  onNodeMouseMove: (
    event: ReactMouseEvent<Element, MouseEvent>,
    node: FlowNode,
  ) => void;
  onPaneClick: () => void;
  onPaneContextMenu: (event: React.MouseEvent | globalThis.MouseEvent) => void;
  submitConnectionChoice: (choice: ConnectionPortChoice) => void;
  submitQuickCreate: () => void;
}

export function getCanonicalEdgeId(leftId: string, rightId: string) {
  return leftId <= rightId
    ? `${leftId}<->${rightId}`
    : `${rightId}<->${leftId}`;
}

export function getHorizontalHandleIds(
  sourcePosition: { x: number; y: number } | undefined,
  targetPosition: { x: number; y: number } | undefined,
) {
  if ((sourcePosition?.x ?? 0) <= (targetPosition?.x ?? 0)) {
    return {
      sourceHandle: "right-entry",
      targetHandle: "left-entry",
    };
  }
  return {
    sourceHandle: "left-entry",
    targetHandle: "right-entry",
  };
}

export function getQuickCreateTitle(state: QuickCreateState) {
  if (state.kind === "standalone") {
    return "Add Agent";
  }
  if (state.kind === "between") {
    return "Insert Agent Between";
  }
  return "Add Agent After";
}

export function getPointerPosition(event: globalThis.MouseEvent | TouchEvent) {
  if ("clientX" in event) {
    return { x: event.clientX, y: event.clientY };
  }
  const touch = event.changedTouches[0] ?? event.touches[0];
  if (!touch) {
    return null;
  }
  return { x: touch.clientX, y: touch.clientY };
}
