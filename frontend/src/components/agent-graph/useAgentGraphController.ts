import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";
import type {
  Connection,
  Edge as FlowEdge,
  EdgeMouseHandler,
  Node as FlowNode,
  NodeMouseHandler,
  ReactFlowInstance,
} from "@xyflow/react";
import { toast } from "sonner";
import { type ContextMenuEntry } from "@/components/ContextMenu";
import {
  useAgentActivityRuntime,
  useAgentNodesRuntime,
  useAgentTabsRuntime,
  useAgentUI,
} from "@/context/AgentContext";
import { AGENT_NODE_HEIGHT, getAgentNodeWidth } from "@/lib/layout";
import { getNodeLabel } from "@/lib/constants";
import { cn } from "@/lib/utils";
import type {
  AgentGraphController,
  AgentGraphProps,
  AgentNodeData,
  ConnectionPortChoice,
  QuickCreateNodeResult,
  QuickCreateState,
} from "@/components/agent-graph/lib";
import type {
  Node as RuntimeNode,
  WorkflowNodeDefinition,
  WorkflowPort,
  WorkflowPortType,
  WorkflowNodeType,
} from "@/types";
import {
  EDGE_EXIT_MS,
  LAYOUT_RETRY_LIMIT,
  NODE_BODY_SOURCE_HANDLE,
  NODE_BODY_TARGET_HANDLE,
  NODE_EXIT_MS,
  VIEWPORT_FIT_MAX_ZOOM,
  VIEWPORT_FIT_PADDING,
  getPointerPosition,
} from "@/components/agent-graph/lib";

type ConnectionPortFilters = {
  sourcePortKey?: string;
  targetPortKey?: string;
};

function buildWorkflowPort(
  key: string,
  direction: WorkflowPort["direction"],
  type: WorkflowPortType = "parts",
  options: { multiple?: boolean; required?: boolean } = {},
): WorkflowPort {
  return {
    key,
    direction,
    type,
    required: options.required ?? direction === "in",
    multiple: options.multiple ?? false,
  };
}

function getDefaultWorkflowPorts(
  nodeType: WorkflowNodeType,
): Pick<WorkflowNodeDefinition, "inputs" | "outputs"> {
  if (nodeType === "trigger") {
    return {
      inputs: [],
      outputs: [buildWorkflowPort("out", "out", "parts", { multiple: true })],
    };
  }

  if (nodeType === "if") {
    return {
      inputs: [buildWorkflowPort("in", "in")],
      outputs: [
        buildWorkflowPort("then", "out", "parts", { multiple: true }),
        buildWorkflowPort("else", "out", "parts", { multiple: true }),
      ],
    };
  }

  if (nodeType === "merge") {
    return {
      inputs: [buildWorkflowPort("in", "in", "parts", { multiple: true })],
      outputs: [buildWorkflowPort("out", "out", "json", { multiple: true })],
    };
  }

  return {
    inputs: [buildWorkflowPort("in", "in")],
    outputs: [buildWorkflowPort("out", "out", "parts", { multiple: true })],
  };
}

function isBodySourceHandle(handleId?: string | null) {
  return !handleId || handleId === NODE_BODY_SOURCE_HANDLE;
}

function isBodyTargetHandle(handleId?: string | null) {
  return !handleId || handleId === NODE_BODY_TARGET_HANDLE;
}

function getNodeIdFromElement(target: EventTarget | null) {
  if (!(target instanceof Element)) {
    return null;
  }
  const nodeElement = target.closest(".react-flow__node");
  return nodeElement?.getAttribute("data-id") ?? null;
}

function targetIsFlowPane(target: EventTarget | null) {
  return (
    target instanceof Element && Boolean(target.closest(".react-flow__pane"))
  );
}

function getElementFromPointer(event: globalThis.MouseEvent | TouchEvent) {
  if (
    typeof document === "undefined" ||
    typeof document.elementFromPoint !== "function"
  ) {
    return null;
  }
  const position = getPointerPosition(event);
  return position ? document.elementFromPoint(position.x, position.y) : null;
}

function formatPortLabel(port: { key: string; type: string }) {
  return `${port.key} · ${port.type}`;
}

function getCreatedNodeId(result: unknown) {
  if (typeof result === "string") {
    return result;
  }
  if (
    result &&
    typeof result === "object" &&
    typeof (result as { id?: unknown }).id === "string"
  ) {
    return (result as { id: string }).id;
  }
  return null;
}

function normalizeWorkflowNodeType(value: unknown): WorkflowNodeType | null {
  if (
    value === "agent" ||
    value === "trigger" ||
    value === "llm" ||
    value === "if" ||
    value === "merge" ||
    value === "code"
  ) {
    return value;
  }
  return null;
}

function getWorkflowNodeFromCreatedResult(
  result: unknown,
  fallbackType: WorkflowNodeType,
): WorkflowNodeDefinition | null {
  if (!result || typeof result !== "object") {
    return null;
  }
  const node = result as QuickCreateNodeResult;
  const id = typeof node.id === "string" ? node.id : null;
  const type =
    normalizeWorkflowNodeType(node.type) ??
    normalizeWorkflowNodeType(node.node_type) ??
    fallbackType;
  if (!id || !type) {
    return null;
  }
  const fallbackPorts = getDefaultWorkflowPorts(type);
  return {
    id,
    type,
    config: {},
    inputs: Array.isArray(node.inputs) ? node.inputs : fallbackPorts.inputs,
    outputs: Array.isArray(node.outputs) ? node.outputs : fallbackPorts.outputs,
  };
}

function getConnectionPortChoicesForNodes({
  sourceNode,
  targetNode,
  edges,
  filters = {},
}: {
  sourceNode: WorkflowNodeDefinition;
  targetNode: WorkflowNodeDefinition;
  edges: Array<{
    from_node_id: string;
    from_port_key: string;
    to_node_id: string;
    to_port_key: string;
  }>;
  filters?: ConnectionPortFilters;
}): ConnectionPortChoice[] {
  if (sourceNode.id === targetNode.id) {
    return [];
  }

  const sourcePorts = filters.sourcePortKey
    ? sourceNode.outputs.filter((port) => port.key === filters.sourcePortKey)
    : sourceNode.outputs;
  const targetPorts = filters.targetPortKey
    ? targetNode.inputs.filter((port) => port.key === filters.targetPortKey)
    : targetNode.inputs;
  const choices: ConnectionPortChoice[] = [];

  for (const sourcePort of sourcePorts) {
    for (const targetPort of targetPorts) {
      if (sourcePort.type !== targetPort.type) {
        continue;
      }
      if (
        !targetPort.multiple &&
        edges.some(
          (edge) =>
            edge.to_node_id === targetNode.id &&
            edge.to_port_key === targetPort.key,
        )
      ) {
        continue;
      }
      if (
        edges.some(
          (edge) =>
            edge.from_node_id === sourceNode.id &&
            edge.from_port_key === sourcePort.key &&
            edge.to_node_id === targetNode.id &&
            edge.to_port_key === targetPort.key,
        )
      ) {
        continue;
      }
      choices.push({
        sourcePortKey: sourcePort.key,
        sourcePortLabel: formatPortLabel(sourcePort),
        targetPortKey: targetPort.key,
        targetPortLabel: formatPortLabel(targetPort),
        type: sourcePort.type,
      });
    }
  }

  return choices;
}

function useTransientGraphElements(
  nodes: FlowNode[],
  edges: FlowEdge[],
): { nodes: FlowNode[]; edges: FlowEdge[] } {
  const [renderNodes, setRenderNodes] = useState<FlowNode[]>(nodes);
  const [renderEdges, setRenderEdges] = useState<FlowEdge[]>(edges);
  const nodeTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const edgeTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  useEffect(() => {
    setRenderNodes((prev) => {
      const nextIds = new Set(nodes.map((node) => node.id));
      const prevMap = new Map(prev.map((node) => [node.id, node] as const));
      const nextNodes = nodes.map((node) => {
        const timer = nodeTimers.current.get(node.id);
        if (timer) {
          clearTimeout(timer);
          nodeTimers.current.delete(node.id);
        }

        const previous = prevMap.get(node.id);
        return {
          ...previous,
          ...node,
          className: cn(node.className, "agent-graph-node-present"),
          data: {
            ...((previous?.data as Record<string, unknown> | undefined) ?? {}),
            ...((node.data as Record<string, unknown> | undefined) ?? {}),
            leaving: false,
          },
        } satisfies FlowNode;
      });

      for (const node of prev) {
        if (nextIds.has(node.id)) {
          continue;
        }
        if (!nodeTimers.current.has(node.id)) {
          const timer = setTimeout(() => {
            setRenderNodes((current) =>
              current.filter((item) => item.id !== node.id),
            );
            nodeTimers.current.delete(node.id);
          }, NODE_EXIT_MS);
          nodeTimers.current.set(node.id, timer);
        }

        nextNodes.push({
          ...node,
          className: cn(node.className, "agent-graph-node-leaving"),
          data: {
            ...((node.data as Record<string, unknown> | undefined) ?? {}),
            leaving: true,
          },
        } satisfies FlowNode);
      }

      return nextNodes;
    });
  }, [nodes]);

  useEffect(() => {
    setRenderEdges((prev) => {
      const nextIds = new Set<string>();
      for (let i = 0; i < edges.length; i++) nextIds.add(edges[i].id);
      const prevMap = new Map<string, FlowEdge>();
      for (let i = 0; i < prev.length; i++) prevMap.set(prev[i].id, prev[i]);
      const nextEdges = edges.map((edge) => {
        const timer = edgeTimers.current.get(edge.id);
        if (timer) {
          clearTimeout(timer);
          edgeTimers.current.delete(edge.id);
        }

        const previous = prevMap.get(edge.id);
        return {
          ...previous,
          ...edge,
          data: {
            ...((previous?.data as Record<string, unknown> | undefined) ?? {}),
            ...((edge.data as Record<string, unknown> | undefined) ?? {}),
            leaving: false,
          },
        } satisfies FlowEdge;
      });

      for (const edge of prev) {
        if (nextIds.has(edge.id)) {
          continue;
        }
        if (!edgeTimers.current.has(edge.id)) {
          const timer = setTimeout(() => {
            setRenderEdges((current) =>
              current.filter((item) => item.id !== edge.id),
            );
            edgeTimers.current.delete(edge.id);
          }, EDGE_EXIT_MS);
          edgeTimers.current.set(edge.id, timer);
        }

        nextEdges.push({
          ...edge,
          data: {
            ...((edge.data as Record<string, unknown> | undefined) ?? {}),
            leaving: true,
          },
        } satisfies FlowEdge);
      }

      return nextEdges;
    });
  }, [edges]);

  useEffect(() => {
    const nodeTimersMap = nodeTimers.current;
    const edgeTimersMap = edgeTimers.current;
    return () => {
      for (const timer of nodeTimersMap.values()) {
        clearTimeout(timer);
      }
      for (const timer of edgeTimersMap.values()) {
        clearTimeout(timer);
      }
    };
  }, []);

  return { nodes: renderNodes, edges: renderEdges };
}

export function useAgentGraphController({
  roles = [],
  loadingRoles = false,
  onConnectModeChange,
  onCreateConnection = async () => undefined,
  onDeleteConnection = async () => undefined,
  onCreateStandaloneAgent = async () => undefined,
  onCreateStandaloneNode = async () => undefined,
  onCreateLinkedAgent = async () => undefined,
  onDeleteAgent = async () => undefined,
  onInsertAgentBetween = async () => undefined,
  readOnly = false,
}: AgentGraphProps): AgentGraphController {
  const { agents } = useAgentNodesRuntime();
  const { tabs } = useAgentTabsRuntime();
  const { activeToolCalls } = useAgentActivityRuntime();
  const { activeTabId, selectedAgentId, selectAgent } = useAgentUI();
  const [tooltip, setTooltip] = useState<AgentGraphController["tooltip"]>(null);
  const [contextMenu, setContextMenu] =
    useState<AgentGraphController["contextMenu"]>(null);
  const [quickCreate, setQuickCreate] =
    useState<AgentGraphController["quickCreate"]>(null);
  const [quickCreateNodeType, setQuickCreateNodeType] =
    useState<WorkflowNodeType>("agent");
  const [quickCreateName, setQuickCreateName] = useState("");
  const [quickCreateRoleName, setQuickCreateRoleName] = useState("");
  const [submittingQuickCreate, setSubmittingQuickCreate] = useState(false);
  const [flowInstance, setFlowInstance] = useState<ReactFlowInstance | null>(
    null,
  );
  const [viewportZoom, setViewportZoom] = useState(1);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [connectMode, setConnectMode] = useState(false);
  const [targetPickSourceId, setTargetPickSourceId] = useState<string | null>(
    null,
  );
  const [dragConnectionSourceId, setDragConnectionSourceId] = useState<
    string | null
  >(null);
  const [connectionChoice, setConnectionChoice] =
    useState<AgentGraphController["connectionChoice"]>(null);
  const [submittingConnectionChoice, setSubmittingConnectionChoice] =
    useState(false);
  const connectingNodeId = useRef<string | null>(null);
  const completedConnection = useRef(false);
  const suppressNextPaneClick = useRef(false);
  const layoutWorker = useRef<Worker | null>(null);
  const requestedLayoutKey = useRef("");
  const layoutRetryCounts = useRef(new Map<string, number>());
  const [layoutRetryNonce, setLayoutRetryNonce] = useState(0);
  const [layoutState, setLayoutState] = useState<{
    key: string;
    positions: Map<string, { x: number; y: number }>;
  }>({ key: "", positions: new Map() });
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const lastViewportStructureKey = useRef<string | null>(null);
  const [tooltipSize, setTooltipSize] = useState<{
    width: number;
    height: number;
  } | null>(null);

  const activeTab = activeTabId ? (tabs.get(activeTabId) ?? null) : null;
  const workflowNodes = useMemo(
    () => activeTab?.definition.nodes ?? [],
    [activeTab?.definition.nodes],
  );
  const workflowEdges = useMemo(
    () => activeTab?.definition.edges ?? [],
    [activeTab?.definition.edges],
  );
  const workflowNodeMap = useMemo(
    () => new Map(workflowNodes.map((node) => [node.id, node] as const)),
    [workflowNodes],
  );

  const scheduleLayoutRetry = useCallback(
    (key: string, message: string, detail?: unknown) => {
      requestedLayoutKey.current = "";
      console.error(message, detail);

      const retryCount = layoutRetryCounts.current.get(key) ?? 0;
      if (retryCount >= LAYOUT_RETRY_LIMIT) {
        return;
      }

      layoutRetryCounts.current.set(key, retryCount + 1);
      setLayoutRetryNonce((value) => value + 1);
    },
    [],
  );

  useEffect(() => {
    const worker = new Worker(
      new URL("../../lib/layout.worker.ts", import.meta.url),
      { type: "module" },
    );
    const layoutRetryCountMap = layoutRetryCounts.current;
    worker.onerror = (event) => {
      const key = requestedLayoutKey.current;
      if (!key) {
        return;
      }
      scheduleLayoutRetry(key, "AgentGraph layout worker error", event);
    };
    worker.onmessageerror = (event) => {
      const key = requestedLayoutKey.current;
      if (!key) {
        return;
      }
      scheduleLayoutRetry(key, "AgentGraph layout worker message error", event);
    };
    worker.onmessage = (event) => {
      const {
        positions,
        key,
        error,
      }: {
        positions?: Array<{ id: string; position: { x: number; y: number } }>;
        key: string;
        error?: string;
      } = event.data;
      if (key !== requestedLayoutKey.current) {
        return;
      }
      if (error || !positions) {
        scheduleLayoutRetry(
          key,
          "AgentGraph layout worker rejected request",
          error,
        );
        return;
      }
      layoutRetryCounts.current.delete(key);
      const map = new Map<string, { x: number; y: number }>();
      for (const pos of positions) {
        map.set(pos.id, pos.position);
      }
      setLayoutState({ key, positions: map });
    };
    layoutWorker.current = worker;
    return () => {
      requestedLayoutKey.current = "";
      layoutRetryCountMap.clear();
      layoutWorker.current = null;
      worker.terminate();
    };
  }, [scheduleLayoutRetry]);

  useEffect(() => {
    onConnectModeChange?.(connectMode);
  }, [connectMode, onConnectModeChange]);

  useEffect(() => {
    if (!readOnly) {
      return;
    }
    setConnectMode(false);
    setTargetPickSourceId(null);
    setDragConnectionSourceId(null);
    setConnectionChoice(null);
    setSubmittingConnectionChoice(false);
    setQuickCreate(null);
    setContextMenu(null);
  }, [readOnly]);

  const syncViewportZoom = useCallback((zoom: number) => {
    if (!Number.isFinite(zoom) || zoom <= 0) {
      return;
    }
    setViewportZoom(zoom);
  }, []);

  const syncViewportZoomFromInstance = useCallback(
    (instance: ReactFlowInstance | null) => {
      if (!instance) {
        return;
      }
      syncViewportZoom(instance.getZoom());
    },
    [syncViewportZoom],
  );

  const fitViewport = useCallback(
    async (options: { padding: number; maxZoom: number; duration: number }) => {
      if (!flowInstance) {
        return false;
      }
      try {
        const didFit = await flowInstance.fitView(options);
        syncViewportZoomFromInstance(flowInstance);
        return didFit;
      } catch {
        return false;
      }
    },
    [flowInstance, syncViewportZoomFromInstance],
  );

  const handleFlowInit = useCallback(
    (instance: ReactFlowInstance) => {
      setFlowInstance(instance);
      syncViewportZoomFromInstance(instance);
    },
    [syncViewportZoomFromInstance],
  );

  const handleViewportMove = useCallback(
    (_event: MouseEvent | TouchEvent | null, viewport: { zoom: number }) => {
      syncViewportZoom(viewport.zoom);
    },
    [syncViewportZoom],
  );

  const enterConnectMode = useCallback(() => {
    if (readOnly) {
      return;
    }
    setConnectMode((current) => !current);
  }, [readOnly]);

  const runtimeAgentMap = useMemo(
    () => new Map(Array.from(agents.entries())),
    [agents],
  );

  const buildDefinitionAgentNode = useCallback(
    (nodeId: string): RuntimeNode | null => {
      const workflowNode = workflowNodeMap.get(nodeId);
      if (!workflowNode) {
        return null;
      }

      return {
        id: workflowNode.id,
        node_type: workflowNode.type,
        tab_id: activeTabId,
        is_leader: false,
        state: "idle",
        connections: workflowEdges
          .filter((edge) => edge.from_node_id === workflowNode.id)
          .map((edge) => edge.to_node_id),
        name:
          typeof workflowNode.config.name === "string"
            ? workflowNode.config.name
            : null,
        todos: [],
        role_name:
          typeof workflowNode.config.role_name === "string"
            ? workflowNode.config.role_name
            : null,
        config: workflowNode.config,
        inputs: workflowNode.inputs,
        outputs: workflowNode.outputs,
      };
    },
    [activeTabId, workflowEdges, workflowNodeMap],
  );

  const getContextAgentNode = useCallback(
    (nodeId: string): RuntimeNode | null =>
      runtimeAgentMap.get(nodeId) ?? buildDefinitionAgentNode(nodeId),
    [buildDefinitionAgentNode, runtimeAgentMap],
  );

  const getWorkflowNodeLabel = useCallback(
    (nodeId: string) => {
      const node = workflowNodeMap.get(nodeId);
      if (!node) {
        return nodeId.slice(0, 8);
      }
      return getNodeLabel({
        name: typeof node.config.name === "string" ? node.config.name : null,
        roleName:
          typeof node.config.role_name === "string"
            ? node.config.role_name
            : null,
        nodeType: node.type,
        isLeader: false,
      });
    },
    [workflowNodeMap],
  );

  const getConnectionPortChoices = useCallback(
    (
      sourceNodeId: string,
      targetNodeId: string,
      filters: ConnectionPortFilters = {},
    ): ConnectionPortChoice[] => {
      if (sourceNodeId === targetNodeId) {
        return [];
      }
      const sourceNode = workflowNodeMap.get(sourceNodeId);
      const targetNode = workflowNodeMap.get(targetNodeId);
      if (!sourceNode || !targetNode) {
        return [];
      }
      return getConnectionPortChoicesForNodes({
        sourceNode,
        targetNode,
        edges: workflowEdges,
        filters,
      });
    },
    [workflowEdges, workflowNodeMap],
  );

  const isValidDirectConnection = useCallback(
    (sourceNodeId: string, targetNodeId: string) => {
      return getConnectionPortChoices(sourceNodeId, targetNodeId).length > 0;
    },
    [getConnectionPortChoices],
  );

  const activeConnectionSourceId = dragConnectionSourceId ?? targetPickSourceId;

  const transientData = useMemo(() => {
    const data = new Map<string, AgentNodeData>();

    for (const node of workflowNodes) {
      const runtimeNode = runtimeAgentMap.get(node.id) ?? null;
      const label = getNodeLabel({
        name: typeof node.config.name === "string" ? node.config.name : null,
        roleName:
          typeof node.config.role_name === "string"
            ? node.config.role_name
            : null,
        nodeType: node.type,
        isLeader: false,
      });
      data.set(node.id, {
        label,
        width: getAgentNodeWidth(label),
        node_type: node.type,
        is_leader: false,
        state: runtimeNode?.state ?? "idle",
        shortId: node.id.slice(0, 8),
        name: typeof node.config.name === "string" ? node.config.name : null,
        role_name:
          typeof node.config.role_name === "string"
            ? node.config.role_name
            : null,
        latestTodo:
          runtimeNode?.todos[runtimeNode.todos.length - 1]?.text ?? null,
        selected: node.id === selectedAgentId && selectedEdgeId === null,
        toolCall: runtimeNode ? (activeToolCalls.get(node.id) ?? null) : null,
        leaving: false,
        canConnect: Boolean(activeTabId) && !readOnly,
        showConnectionEntryHint:
          connectMode || Boolean(activeConnectionSourceId),
        connectionState:
          activeConnectionSourceId === node.id
            ? "source"
            : activeConnectionSourceId
              ? isValidDirectConnection(activeConnectionSourceId, node.id)
                ? "valid-target"
                : "invalid-target"
              : null,
        inputPorts: node.inputs,
        outputPorts: node.outputs,
      });
    }

    return data;
  }, [
    activeTabId,
    activeToolCalls,
    activeConnectionSourceId,
    connectMode,
    isValidDirectConnection,
    readOnly,
    runtimeAgentMap,
    selectedAgentId,
    selectedEdgeId,
    workflowNodes,
  ]);

  const { rawNodes, baseEdges, structureKey } = useMemo(() => {
    const nextRawNodes: FlowNode[] = workflowNodes.flatMap((node) => {
      const data = transientData.get(node.id);
      if (!data) {
        return [];
      }
      return [
        {
          id: node.id,
          type: "agent",
          position: { x: 0, y: 0 },
          width: data.width,
          height: AGENT_NODE_HEIGHT,
          data,
          className: "agent-graph-node-shell",
        } satisfies FlowNode,
      ];
    });

    const nextBaseEdges: FlowEdge[] = workflowEdges.map((edge) => ({
      id: edge.id,
      source: edge.from_node_id,
      sourceHandle: edge.from_port_key,
      target: edge.to_node_id,
      targetHandle: edge.to_port_key,
      type: "animated",
      data: {
        sourcePortKey: edge.from_port_key,
        targetPortKey: edge.to_port_key,
      },
    }));

    const nextStructureKey = `${activeTabId ?? "unassigned"}:${workflowNodes
      .map((node) => `${node.id}:${node.type}:${JSON.stringify(node.config)}`)
      .sort()
      .join("|")}:${workflowEdges
      .map(
        (edge) =>
          `${edge.id}:${edge.from_node_id}:${edge.from_port_key}:${edge.to_node_id}:${edge.to_port_key}:${edge.kind}`,
      )
      .sort()
      .join("|")}`;

    return {
      rawNodes: nextRawNodes,
      baseEdges: nextBaseEdges,
      structureKey: nextStructureKey,
    };
  }, [activeTabId, transientData, workflowEdges, workflowNodes]);

  useEffect(() => {
    if (rawNodes.length === 0) {
      requestedLayoutKey.current = "";
      layoutRetryCounts.current.clear();
      return;
    }
    if (layoutState.key === structureKey) {
      return;
    }
    if (requestedLayoutKey.current === structureKey) {
      return;
    }
    const worker = layoutWorker.current;
    if (!worker) {
      return;
    }
    worker.postMessage({
      nodes: rawNodes,
      edges: baseEdges,
      key: structureKey,
    });
    requestedLayoutKey.current = structureKey;
  }, [baseEdges, layoutRetryNonce, layoutState.key, rawNodes, structureKey]);

  const graphElements = useMemo(() => {
    const positions = layoutState.positions;
    const nodes = rawNodes.map((node) => ({
      ...node,
      position: positions.get(node.id) ?? { x: 0, y: 0 },
    }));
    const edges = baseEdges.map((edge) => ({
      ...edge,
      data: {
        active: false,
        flowDirection: null,
        leaving: false,
        selected: edge.id === selectedEdgeId,
      },
      animated: false,
    }));

    return { nodes, edges, structureKey };
  }, [
    baseEdges,
    layoutState.positions,
    rawNodes,
    selectedEdgeId,
    structureKey,
  ]);

  const { nodes: animatedNodes, edges: animatedEdges } =
    useTransientGraphElements(graphElements.nodes, graphElements.edges);

  const closeQuickCreate = useCallback(() => {
    setQuickCreate(null);
    setQuickCreateNodeType("agent");
    setQuickCreateName("");
    setQuickCreateRoleName("");
    setSubmittingQuickCreate(false);
  }, []);

  const closeConnectionChoice = useCallback(() => {
    setConnectionChoice(null);
    setSubmittingConnectionChoice(false);
  }, []);

  const openQuickCreate = useCallback((state: QuickCreateState) => {
    setQuickCreate(state);
    setQuickCreateNodeType("agent");
    setQuickCreateName("");
    setQuickCreateRoleName("");
    setSubmittingQuickCreate(false);
    setConnectionChoice(null);
    setSubmittingConnectionChoice(false);
    setContextMenu(null);
    setTooltip(null);
  }, []);

  const clearConnectionInteraction = useCallback(() => {
    connectingNodeId.current = null;
    completedConnection.current = false;
    setDragConnectionSourceId(null);
  }, []);

  const createResolvedConnection = useCallback(
    (
      tabId: string,
      sourceNodeId: string,
      targetNodeId: string,
      choice: ConnectionPortChoice,
    ) =>
      onCreateConnection(
        tabId,
        sourceNodeId,
        targetNodeId,
        choice.sourcePortKey,
        choice.targetPortKey,
      )
        .then(() => {
          setConnectMode(false);
          setTargetPickSourceId(null);
          setDragConnectionSourceId(null);
          setConnectionChoice(null);
          setSubmittingConnectionChoice(false);
          setSelectedEdgeId(null);
        })
        .catch((error) => {
          setSubmittingConnectionChoice(false);
          toast.error(
            error instanceof Error ? error.message : "Failed to connect nodes",
          );
        }),
    [onCreateConnection],
  );

  const createQuickNode = useCallback(
    (
      tabId: string,
      nodeType: WorkflowNodeType,
      roleName: string,
      name?: string,
    ) => {
      if (nodeType === "agent") {
        return onCreateStandaloneAgent({
          tabId,
          roleName,
          name,
        });
      }
      return onCreateStandaloneNode({
        tabId,
        nodeType,
        name,
      });
    },
    [onCreateStandaloneAgent, onCreateStandaloneNode],
  );

  const createBestEffortConnection = useCallback(
    async (
      tabId: string,
      sourceNodeId: string,
      targetNodeId: string,
      sourceNode: WorkflowNodeDefinition,
      targetNode: WorkflowNodeDefinition,
      edges: typeof workflowEdges,
      filters: ConnectionPortFilters = {},
    ) => {
      const choices = getConnectionPortChoicesForNodes({
        sourceNode,
        targetNode,
        edges,
        filters,
      });
      if (choices.length === 0) {
        toast.error("This connection is not available");
        return;
      }
      await onCreateConnection(
        tabId,
        sourceNodeId,
        targetNodeId,
        choices[0].sourcePortKey,
        choices[0].targetPortKey,
      );
    },
    [onCreateConnection],
  );

  const resolveConnectionAttempt = useCallback(
    (
      sourceNodeId: string,
      targetNodeId: string,
      filters: ConnectionPortFilters = {},
    ) => {
      if (!activeTabId) {
        return;
      }
      if (readOnly) {
        toast.error("Workflow editing is not available");
        return;
      }
      if (sourceNodeId === targetNodeId) {
        return;
      }

      const choices = getConnectionPortChoices(
        sourceNodeId,
        targetNodeId,
        filters,
      );
      if (choices.length === 0) {
        toast.error("This connection is not available");
        return;
      }
      if (choices.length === 1) {
        void createResolvedConnection(
          activeTabId,
          sourceNodeId,
          targetNodeId,
          choices[0],
        );
        return;
      }

      setConnectionChoice({
        tabId: activeTabId,
        sourceNodeId,
        sourceNodeLabel: getWorkflowNodeLabel(sourceNodeId),
        targetNodeId,
        targetNodeLabel: getWorkflowNodeLabel(targetNodeId),
        choices,
      });
      setQuickCreate(null);
      setQuickCreateNodeType("agent");
      setQuickCreateName("");
      setQuickCreateRoleName("");
      setSubmittingQuickCreate(false);
      setTargetPickSourceId(null);
      setDragConnectionSourceId(null);
      setConnectMode(false);
      setSelectedEdgeId(null);
      setContextMenu(null);
      setTooltip(null);
    },
    [
      activeTabId,
      createResolvedConnection,
      getConnectionPortChoices,
      getWorkflowNodeLabel,
      readOnly,
    ],
  );

  const onNodeClick: NodeMouseHandler = useCallback(
    (_, node) => {
      if (targetPickSourceId && activeTabId) {
        if (node.id === targetPickSourceId) {
          return;
        }
        resolveConnectionAttempt(targetPickSourceId, node.id);
        return;
      }
      setSelectedEdgeId(null);
      if (getContextAgentNode(node.id)) {
        selectAgent(node.id);
      } else {
        selectAgent(null);
      }
    },
    [
      activeTabId,
      getContextAgentNode,
      resolveConnectionAttempt,
      selectAgent,
      targetPickSourceId,
    ],
  );

  const onNodeMouseEnter: NodeMouseHandler = useCallback(
    (event, node) => {
      if (!runtimeAgentMap.has(node.id)) {
        return;
      }
      const mouseEvent = event as unknown as ReactMouseEvent;
      setTooltip({
        agentId: node.id,
        x: mouseEvent.clientX,
        y: mouseEvent.clientY,
      });
    },
    [runtimeAgentMap],
  );

  const onNodeMouseMove: NodeMouseHandler = useCallback(
    (event, node) => {
      if (!runtimeAgentMap.has(node.id)) {
        return;
      }
      const mouseEvent = event as unknown as ReactMouseEvent;
      setTooltip({
        agentId: node.id,
        x: mouseEvent.clientX,
        y: mouseEvent.clientY,
      });
    },
    [runtimeAgentMap],
  );

  const onNodeMouseLeave: NodeMouseHandler = useCallback(() => {
    setTooltip(null);
  }, []);

  const onPaneClick = useCallback(() => {
    if (suppressNextPaneClick.current) {
      suppressNextPaneClick.current = false;
      return;
    }
    setSelectedEdgeId(null);
    setTooltip(null);
    setContextMenu(null);
    setTargetPickSourceId(null);
    setDragConnectionSourceId(null);
    closeConnectionChoice();
    closeQuickCreate();
    selectAgent(null);
  }, [closeConnectionChoice, closeQuickCreate, selectAgent]);

  const onPaneContextMenu = useCallback(
    (event: ReactMouseEvent | globalThis.MouseEvent) => {
      event.preventDefault();
      const mouseEvent = event as globalThis.MouseEvent;
      setSelectedEdgeId(null);
      setTooltip(null);
      setTargetPickSourceId(null);
      setDragConnectionSourceId(null);
      closeConnectionChoice();
      closeQuickCreate();
      selectAgent(null);
      setContextMenu({
        kind: "pane",
        x: mouseEvent.clientX,
        y: mouseEvent.clientY,
      });
    },
    [closeConnectionChoice, closeQuickCreate, selectAgent],
  );

  const onNodeContextMenu: NodeMouseHandler = useCallback(
    (event, node) => {
      const contextNode = getContextAgentNode(node.id);
      const mouseEvent = event as unknown as globalThis.MouseEvent;
      mouseEvent.preventDefault();
      mouseEvent.stopPropagation();
      if (!contextNode || !activeTabId) {
        setContextMenu(null);
        return;
      }
      selectAgent(node.id);
      setSelectedEdgeId(null);
      setTargetPickSourceId(null);
      setDragConnectionSourceId(null);
      closeConnectionChoice();
      setTooltip(null);
      closeQuickCreate();
      setContextMenu({
        kind: "node",
        x: mouseEvent.clientX,
        y: mouseEvent.clientY,
        agentId: node.id,
      });
    },
    [
      activeTabId,
      closeConnectionChoice,
      closeQuickCreate,
      getContextAgentNode,
      selectAgent,
    ],
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      if (!activeTabId || !connection.source || !connection.target) {
        return;
      }
      if (readOnly) {
        toast.error("Workflow editing is not available");
        return;
      }
      completedConnection.current = true;
      const filters: ConnectionPortFilters = {};
      if (!isBodySourceHandle(connection.sourceHandle)) {
        filters.sourcePortKey = connection.sourceHandle ?? undefined;
      }
      if (!isBodyTargetHandle(connection.targetHandle)) {
        filters.targetPortKey = connection.targetHandle ?? undefined;
      }
      resolveConnectionAttempt(connection.source, connection.target, filters);
    },
    [activeTabId, readOnly, resolveConnectionAttempt],
  );

  const onConnectStart = useCallback(
    (
      event: globalThis.MouseEvent | TouchEvent,
      params?: {
        nodeId: string | null;
        handleId?: string | null;
        handleType: "source" | "target" | null;
      },
    ) => {
      if (readOnly || params?.handleType === "target") {
        return;
      }
      const sourceNodeId = params?.nodeId ?? getNodeIdFromElement(event.target);
      if (!sourceNodeId || !workflowNodeMap.has(sourceNodeId)) {
        return;
      }
      if (params?.handleId && !isBodySourceHandle(params.handleId)) {
        return;
      }
      connectingNodeId.current = sourceNodeId;
      completedConnection.current = false;
      setDragConnectionSourceId(sourceNodeId);
      setTargetPickSourceId(null);
      setConnectionChoice(null);
      setSubmittingConnectionChoice(false);
      setContextMenu(null);
      setTooltip(null);
    },
    [readOnly, workflowNodeMap],
  );

  const onConnectEnd = useCallback(
    (event?: globalThis.MouseEvent | TouchEvent) => {
      const sourceNodeId = connectingNodeId.current;
      const didComplete = completedConnection.current;
      clearConnectionInteraction();
      if (!sourceNodeId || didComplete || !event || readOnly) {
        if (!connectMode) {
          setConnectMode(false);
        }
        return;
      }

      const pointerElement = getElementFromPointer(event);
      const targetNodeId =
        getNodeIdFromElement(event.target) ??
        getNodeIdFromElement(pointerElement);
      if (targetNodeId) {
        resolveConnectionAttempt(sourceNodeId, targetNodeId);
        return;
      }

      if (targetIsFlowPane(event.target) || targetIsFlowPane(pointerElement)) {
        const position = getPointerPosition(event);
        if (position) {
          suppressNextPaneClick.current = true;
          openQuickCreate({
            kind: "linked",
            x: position.x,
            y: position.y,
            anchorNodeId: sourceNodeId,
          });
        }
      }

      if (!connectMode) {
        setConnectMode(false);
      }
    },
    [
      clearConnectionInteraction,
      connectMode,
      openQuickCreate,
      readOnly,
      resolveConnectionAttempt,
    ],
  );

  const onEdgeClick: EdgeMouseHandler = useCallback(
    (_, edge) => {
      setSelectedEdgeId(edge.id);
      setTooltip(null);
      setContextMenu(null);
      setTargetPickSourceId(null);
      setDragConnectionSourceId(null);
      closeConnectionChoice();
      closeQuickCreate();
      selectAgent(null);
    },
    [closeConnectionChoice, closeQuickCreate, selectAgent],
  );

  const onEdgeContextMenu: EdgeMouseHandler = useCallback(
    (event, edge) => {
      const mouseEvent = event as unknown as globalThis.MouseEvent;
      mouseEvent.preventDefault();
      mouseEvent.stopPropagation();
      setSelectedEdgeId(edge.id);
      setTooltip(null);
      setTargetPickSourceId(null);
      setDragConnectionSourceId(null);
      closeConnectionChoice();
      closeQuickCreate();
      selectAgent(null);
      setContextMenu({
        kind: "edge",
        x: mouseEvent.clientX,
        y: mouseEvent.clientY,
        sourceId: edge.source,
        targetId: edge.target,
        sourcePortKey: edge.sourceHandle,
        targetPortKey: edge.targetHandle,
      });
    },
    [closeConnectionChoice, closeQuickCreate, selectAgent],
  );

  const closeContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  const fitViewFromContextMenu = useCallback(() => {
    void fitViewport({
      padding: VIEWPORT_FIT_PADDING,
      maxZoom: VIEWPORT_FIT_MAX_ZOOM,
      duration: 250,
    });
  }, [fitViewport]);

  const contextMenuItems = useMemo((): ContextMenuEntry[] => {
    if (!contextMenu) {
      return [];
    }

    if (contextMenu.kind === "node") {
      const contextNode = getContextAgentNode(contextMenu.agentId);
      if (!contextNode || !activeTabId) {
        return [];
      }
      if (readOnly) {
        return [
          {
            label: "Clear Selection",
            onClick: () => {
              selectAgent(null);
            },
          },
        ];
      }
      return [
        {
          label: "Add Connected Node",
          onClick: () => {
            openQuickCreate({
              kind: "linked",
              x: contextMenu.x,
              y: contextMenu.y,
              anchorNodeId: contextNode.id,
            });
          },
        },
        {
          label: "Connect To...",
          onClick: () => {
            setQuickCreate(null);
            setQuickCreateNodeType("agent");
            setQuickCreateName("");
            setQuickCreateRoleName("");
            closeConnectionChoice();
            setConnectMode(false);
            setTargetPickSourceId(contextNode.id);
            setDragConnectionSourceId(null);
            setSelectedEdgeId(null);
            selectAgent(contextNode.id);
          },
        },
        "divider",
        {
          label: "Delete Node",
          danger: true,
          onClick: () => {
            void onDeleteAgent({
              tabId: activeTabId,
              node: contextNode,
              edges: workflowEdges,
            }).catch((error) => {
              toast.error(
                error instanceof Error
                  ? error.message
                  : "Failed to delete agent",
              );
            });
          },
        },
      ];
    }

    if (contextMenu.kind === "edge") {
      if (!activeTabId) {
        return [];
      }
      if (readOnly) {
        return [];
      }
      return [
        {
          label: "Insert Node Between",
          onClick: () => {
            openQuickCreate({
              kind: "between",
              x: contextMenu.x,
              y: contextMenu.y,
              sourceNodeId: contextMenu.sourceId,
              targetNodeId: contextMenu.targetId,
              sourcePortKey: contextMenu.sourcePortKey,
              targetPortKey: contextMenu.targetPortKey,
            });
          },
        },
        {
          label: "Delete Connection",
          danger: true,
          onClick: () => {
            void onDeleteConnection(
              activeTabId,
              contextMenu.sourceId,
              contextMenu.targetId,
              contextMenu.sourcePortKey ?? undefined,
              contextMenu.targetPortKey ?? undefined,
            ).catch((error) => {
              toast.error(
                error instanceof Error
                  ? error.message
                  : "Failed to delete edge",
              );
            });
          },
        },
      ];
    }

    return [
      {
        label: "Add Node",
        disabled: !activeTabId || readOnly,
        onClick: () => {
          openQuickCreate({
            kind: "standalone",
            x: contextMenu.x,
            y: contextMenu.y,
          });
        },
      },
      {
        label: "Fit View",
        disabled: animatedNodes.length === 0,
        onClick: fitViewFromContextMenu,
      },
      {
        label: "Clear Selection",
        onClick: () => {
          setSelectedEdgeId(null);
          selectAgent(null);
        },
      },
    ];
  }, [
    activeTabId,
    animatedNodes.length,
    contextMenu,
    fitViewFromContextMenu,
    onDeleteAgent,
    onDeleteConnection,
    openQuickCreate,
    readOnly,
    closeConnectionChoice,
    getContextAgentNode,
    selectAgent,
    workflowEdges,
  ]);

  const submitQuickCreate = useCallback(() => {
    if (
      !activeTabId ||
      !quickCreate ||
      (quickCreateNodeType === "agent" && !quickCreateRoleName) ||
      submittingQuickCreate
    ) {
      return;
    }
    const name = quickCreateName.trim() || undefined;
    setSubmittingQuickCreate(true);

    const request = (async () => {
      if (quickCreate.kind === "standalone") {
        await createQuickNode(
          activeTabId,
          quickCreateNodeType,
          quickCreateRoleName,
          name,
        );
        return;
      }

      if (quickCreate.kind === "linked" && quickCreateNodeType === "agent") {
        await onCreateLinkedAgent({
          tabId: activeTabId,
          anchorNodeId: quickCreate.anchorNodeId,
          roleName: quickCreateRoleName,
          name,
        });
        return;
      }

      if (quickCreate.kind === "between" && quickCreateNodeType === "agent") {
        await onInsertAgentBetween({
          tabId: activeTabId,
          sourceNodeId: quickCreate.sourceNodeId,
          targetNodeId: quickCreate.targetNodeId,
          roleName: quickCreateRoleName,
          name,
        });
        return;
      }

      const createdResult = await createQuickNode(
        activeTabId,
        quickCreateNodeType,
        quickCreateRoleName,
        name,
      );
      const createdNode =
        getWorkflowNodeFromCreatedResult(createdResult, quickCreateNodeType) ??
        (getCreatedNodeId(createdResult)
          ? {
              id: getCreatedNodeId(createdResult) as string,
              type: quickCreateNodeType,
              config: {},
              ...getDefaultWorkflowPorts(quickCreateNodeType),
            }
          : null);
      if (!createdNode) {
        return;
      }

      if (quickCreate.kind === "linked") {
        const anchorNode = workflowNodeMap.get(quickCreate.anchorNodeId);
        if (!anchorNode) {
          return;
        }
        await createBestEffortConnection(
          activeTabId,
          quickCreate.anchorNodeId,
          createdNode.id,
          anchorNode,
          createdNode,
          workflowEdges,
        );
        return;
      }

      const sourceNode = workflowNodeMap.get(quickCreate.sourceNodeId);
      const targetNode = workflowNodeMap.get(quickCreate.targetNodeId);
      if (!sourceNode || !targetNode) {
        return;
      }

      await onDeleteConnection(
        activeTabId,
        quickCreate.sourceNodeId,
        quickCreate.targetNodeId,
        quickCreate.sourcePortKey ?? undefined,
        quickCreate.targetPortKey ?? undefined,
      );
      const edgesAfterDelete = workflowEdges.filter(
        (edge) =>
          !(
            edge.from_node_id === quickCreate.sourceNodeId &&
            edge.to_node_id === quickCreate.targetNodeId &&
            (!quickCreate.sourcePortKey ||
              edge.from_port_key === quickCreate.sourcePortKey) &&
            (!quickCreate.targetPortKey ||
              edge.to_port_key === quickCreate.targetPortKey)
          ),
      );
      await createBestEffortConnection(
        activeTabId,
        quickCreate.sourceNodeId,
        createdNode.id,
        sourceNode,
        createdNode,
        edgesAfterDelete,
        { sourcePortKey: quickCreate.sourcePortKey ?? undefined },
      );
      await createBestEffortConnection(
        activeTabId,
        createdNode.id,
        quickCreate.targetNodeId,
        createdNode,
        targetNode,
        [
          ...edgesAfterDelete,
          {
            id: "",
            from_node_id: quickCreate.sourceNodeId,
            from_port_key: "",
            to_node_id: createdNode.id,
            to_port_key: "",
          },
        ],
        { targetPortKey: quickCreate.targetPortKey ?? undefined },
      );
    })();

    void request
      .then(() => {
        closeQuickCreate();
        setSelectedEdgeId(null);
        setTargetPickSourceId(null);
      })
      .catch((error) => {
        setSubmittingQuickCreate(false);
        toast.error(
          error instanceof Error ? error.message : "Failed to add agent",
        );
      });
  }, [
    activeTabId,
    closeQuickCreate,
    createBestEffortConnection,
    createQuickNode,
    onCreateLinkedAgent,
    onDeleteConnection,
    onInsertAgentBetween,
    quickCreate,
    quickCreateName,
    quickCreateNodeType,
    quickCreateRoleName,
    submittingQuickCreate,
    workflowEdges,
    workflowNodeMap,
  ]);

  const submitConnectionChoice = useCallback(
    (choice: ConnectionPortChoice) => {
      if (!connectionChoice || submittingConnectionChoice) {
        return;
      }
      setSubmittingConnectionChoice(true);
      void createResolvedConnection(
        connectionChoice.tabId,
        connectionChoice.sourceNodeId,
        connectionChoice.targetNodeId,
        choice,
      );
    },
    [connectionChoice, createResolvedConnection, submittingConnectionChoice],
  );

  const tooltipAgent = tooltip
    ? (runtimeAgentMap.get(tooltip.agentId) ?? null)
    : null;
  const tooltipToolCall =
    tooltip && tooltip.agentId
      ? (activeToolCalls.get(tooltip.agentId) ?? null)
      : null;

  useEffect(() => {
    if (!tooltip || !tooltipAgent) {
      return;
    }
    const raf = requestAnimationFrame(() => {
      const el = tooltipRef.current;
      if (!el) {
        return;
      }
      const rect = el.getBoundingClientRect();
      setTooltipSize((prev) =>
        prev &&
        Math.abs(prev.width - rect.width) < 0.5 &&
        Math.abs(prev.height - rect.height) < 0.5
          ? prev
          : { width: rect.width, height: rect.height },
      );
    });
    return () => cancelAnimationFrame(raf);
  }, [tooltip, tooltipAgent]);

  useEffect(() => {
    if (!flowInstance || animatedNodes.length === 0) {
      return;
    }
    if (lastViewportStructureKey.current === graphElements.structureKey) {
      return;
    }
    const isInitialViewport = lastViewportStructureKey.current === null;
    lastViewportStructureKey.current = graphElements.structureKey;

    const raf = requestAnimationFrame(() => {
      void fitViewport({
        padding: VIEWPORT_FIT_PADDING,
        maxZoom: VIEWPORT_FIT_MAX_ZOOM,
        duration: isInitialViewport ? 0 : 250,
      });
    });

    return () => cancelAnimationFrame(raf);
  }, [
    animatedNodes.length,
    fitViewport,
    flowInstance,
    graphElements.structureKey,
  ]);

  useEffect(() => {
    if (!flowInstance || !containerRef.current || animatedNodes.length === 0) {
      return;
    }

    let raf = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        void fitViewport({
          padding: VIEWPORT_FIT_PADDING,
          maxZoom: VIEWPORT_FIT_MAX_ZOOM,
          duration: 250,
        });
      });
    });

    observer.observe(containerRef.current);

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
    };
  }, [animatedNodes.length, fitViewport, flowInstance]);

  const tooltipStyle = useMemo(() => {
    if (!tooltip || typeof window === "undefined") {
      return undefined;
    }
    const margin = 8;
    const offset = 12;
    const width = tooltipSize?.width ?? 280;
    const height = tooltipSize?.height ?? 120;
    const maxLeft = window.innerWidth - margin - width;
    const maxTop = window.innerHeight - margin - height;
    const left = Math.max(margin, Math.min(tooltip.x + offset, maxLeft));
    const top = Math.max(margin, Math.min(tooltip.y + offset, maxTop));
    return { left, top };
  }, [tooltip, tooltipSize]);

  const emptyState = useMemo(() => {
    if (tabs.size === 0) {
      return { title: "No workflows yet" };
    }
    if (!activeTab) {
      return { title: "Select a workflow" };
    }
    return null;
  }, [activeTab, tabs.size]);

  const connectHintLabel = targetPickSourceId
    ? "Choose target node"
    : connectMode
      ? "Connect nodes"
      : null;

  const isValidConnection = useCallback(
    (edgeOrConnection: FlowEdge | Connection) => {
      if (readOnly || !edgeOrConnection.source || !edgeOrConnection.target) {
        return false;
      }
      if (edgeOrConnection.source === edgeOrConnection.target) {
        return false;
      }
      const filters: ConnectionPortFilters = {};
      if (!isBodySourceHandle(edgeOrConnection.sourceHandle)) {
        filters.sourcePortKey = edgeOrConnection.sourceHandle ?? undefined;
      }
      if (!isBodyTargetHandle(edgeOrConnection.targetHandle)) {
        filters.targetPortKey = edgeOrConnection.targetHandle ?? undefined;
      }
      return (
        getConnectionPortChoices(
          edgeOrConnection.source,
          edgeOrConnection.target,
          filters,
        ).length > 0
      );
    },
    [getConnectionPortChoices, readOnly],
  );

  return {
    activeTabId,
    animatedEdges,
    animatedNodes,
    availableRoles: roles,
    closeConnectionChoice,
    closeContextMenu,
    closeQuickCreate,
    connectHintLabel,
    connectionChoice,
    containerRef,
    contextMenu,
    contextMenuItems,
    emptyState,
    enterConnectMode,
    handleFlowInit,
    handleViewportMove,
    isValidConnection,
    loadingRoles,
    onConnect,
    onConnectEnd,
    onConnectStart,
    onEdgeClick,
    onEdgeContextMenu,
    onNodeClick,
    onNodeContextMenu,
    onNodeMouseEnter,
    onNodeMouseLeave,
    onNodeMouseMove,
    onPaneClick,
    onPaneContextMenu,
    quickCreate,
    quickCreateName,
    quickCreateNodeType,
    quickCreateRoleName,
    readOnly,
    setQuickCreateName,
    setQuickCreateNodeType,
    setQuickCreateRoleName,
    submitConnectionChoice,
    submittingConnectionChoice,
    submitQuickCreate,
    submittingQuickCreate,
    tooltip,
    tooltipAgent,
    tooltipRef,
    tooltipStyle,
    tooltipToolCall,
    viewportZoom,
  };
}
