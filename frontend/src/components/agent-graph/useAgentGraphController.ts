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
  QuickCreateState,
} from "@/components/agent-graph/lib";
import type { Node as RuntimeNode } from "@/types";
import {
  EDGE_EXIT_MS,
  LAYOUT_RETRY_LIMIT,
  NODE_EXIT_MS,
  VIEWPORT_FIT_MAX_ZOOM,
  VIEWPORT_FIT_PADDING,
} from "@/components/agent-graph/lib";

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
  onCreateLinkedAgent = async () => undefined,
  onDeleteAgent = async () => undefined,
  onInsertAgentBetween = async () => undefined,
  onOpenConnectDialog = () => undefined,
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

  const workflowRuntimeNodes = useMemo(
    () =>
      workflowNodes.flatMap((node) => {
        const runtimeNode = runtimeAgentMap.get(node.id);
        if (runtimeNode) {
          return [runtimeNode];
        }
        const definitionNode = buildDefinitionAgentNode(node.id);
        return definitionNode ? [definitionNode] : [];
      }),
    [buildDefinitionAgentNode, runtimeAgentMap, workflowNodes],
  );
  const getConnectionPorts = useCallback(
    (sourceNodeId: string, targetNodeId: string) => {
      const sourceNode = workflowNodeMap.get(sourceNodeId);
      const targetNode = workflowNodeMap.get(targetNodeId);
      const sourcePort =
        sourceNode?.outputs.find((output) =>
          targetNode?.inputs.some((input) => input.type === output.type),
        ) ?? sourceNode?.outputs[0];
      const targetPort =
        sourcePort && targetNode
          ? (targetNode.inputs.find(
              (input) => input.type === sourcePort.type,
            ) ?? targetNode.inputs[0])
          : null;

      if (!sourcePort || !targetPort) {
        return null;
      }
      return {
        sourcePortKey: sourcePort.key,
        targetPortKey: targetPort.key,
      };
    },
    [workflowNodeMap],
  );
  const isValidDirectConnection = useCallback(
    (sourceNodeId: string, targetNodeId: string) => {
      if (sourceNodeId === targetNodeId) {
        return false;
      }
      const ports = getConnectionPorts(sourceNodeId, targetNodeId);
      if (!ports) {
        return false;
      }
      const targetNode = workflowNodeMap.get(targetNodeId);
      const targetPort = targetNode?.inputs.find(
        (port) => port.key === ports.targetPortKey,
      );
      if (
        targetPort &&
        !targetPort.multiple &&
        workflowEdges.some(
          (edge) =>
            edge.to_node_id === targetNodeId &&
            edge.to_port_key === ports.targetPortKey,
        )
      ) {
        return false;
      }
      return !workflowEdges.some(
        (edge) =>
          edge.from_node_id === sourceNodeId &&
          edge.from_port_key === ports.sourcePortKey &&
          edge.to_node_id === targetNodeId &&
          edge.to_port_key === ports.targetPortKey,
      );
    },
    [getConnectionPorts, workflowEdges, workflowNodeMap],
  );

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
        showConnectionEntryHint: connectMode || Boolean(targetPickSourceId),
        connectionState:
          targetPickSourceId === node.id
            ? "source"
            : targetPickSourceId
              ? isValidDirectConnection(targetPickSourceId, node.id)
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
    connectMode,
    isValidDirectConnection,
    readOnly,
    runtimeAgentMap,
    selectedAgentId,
    selectedEdgeId,
    targetPickSourceId,
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
    setQuickCreateName("");
    setQuickCreateRoleName("");
    setSubmittingQuickCreate(false);
  }, []);

  const openQuickCreate = useCallback((state: QuickCreateState) => {
    setQuickCreate(state);
    setQuickCreateName("");
    setQuickCreateRoleName("");
    setSubmittingQuickCreate(false);
    setContextMenu(null);
    setTooltip(null);
  }, []);

  const onNodeClick: NodeMouseHandler = useCallback(
    (_, node) => {
      if (targetPickSourceId && activeTabId) {
        if (node.id === targetPickSourceId) {
          return;
        }
        if (!isValidDirectConnection(targetPickSourceId, node.id)) {
          toast.error("This connection is not available");
          return;
        }
        const ports = getConnectionPorts(targetPickSourceId, node.id);
        if (!ports) {
          toast.error("This connection is not available");
          return;
        }
        void onCreateConnection(
          activeTabId,
          targetPickSourceId,
          node.id,
          ports.sourcePortKey,
          ports.targetPortKey,
        )
          .then(() => {
            setTargetPickSourceId(null);
            setConnectMode(false);
            setSelectedEdgeId(null);
          })
          .catch((error) => {
            toast.error(
              error instanceof Error
                ? error.message
                : "Failed to connect nodes",
            );
          });
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
      getConnectionPorts,
      isValidDirectConnection,
      onCreateConnection,
      getContextAgentNode,
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
    setSelectedEdgeId(null);
    setTooltip(null);
    setContextMenu(null);
    setTargetPickSourceId(null);
    closeQuickCreate();
    selectAgent(null);
  }, [closeQuickCreate, selectAgent]);

  const onPaneContextMenu = useCallback(
    (event: ReactMouseEvent | globalThis.MouseEvent) => {
      event.preventDefault();
      const mouseEvent = event as globalThis.MouseEvent;
      setSelectedEdgeId(null);
      setTooltip(null);
      setTargetPickSourceId(null);
      closeQuickCreate();
      selectAgent(null);
      setContextMenu({
        kind: "pane",
        x: mouseEvent.clientX,
        y: mouseEvent.clientY,
      });
    },
    [closeQuickCreate, selectAgent],
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
      setTooltip(null);
      closeQuickCreate();
      setContextMenu({
        kind: "node",
        x: mouseEvent.clientX,
        y: mouseEvent.clientY,
        agentId: node.id,
      });
    },
    [activeTabId, closeQuickCreate, getContextAgentNode, selectAgent],
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      if (!activeTabId || !connection.source || !connection.target) {
        return;
      }
      if (readOnly) {
        toast.error("Deactivate workflow before editing");
        return;
      }
      void onCreateConnection(
        activeTabId,
        connection.source,
        connection.target,
        connection.sourceHandle ?? "out",
        connection.targetHandle ?? "in",
      )
        .then(() => {
          setConnectMode(false);
          setTargetPickSourceId(null);
          setSelectedEdgeId(null);
        })
        .catch((error) => {
          toast.error(
            error instanceof Error ? error.message : "Failed to connect nodes",
          );
        });
    },
    [activeTabId, onCreateConnection, readOnly],
  );

  const onConnectStart = useCallback(() => {}, []);

  const onConnectEnd = useCallback(() => {
    if (!connectMode) {
      setConnectMode(false);
    }
  }, [connectMode]);

  const onEdgeClick: EdgeMouseHandler = useCallback(
    (_, edge) => {
      setSelectedEdgeId(edge.id);
      setTooltip(null);
      setContextMenu(null);
      setTargetPickSourceId(null);
      closeQuickCreate();
      selectAgent(null);
    },
    [closeQuickCreate, selectAgent],
  );

  const onEdgeContextMenu: EdgeMouseHandler = useCallback(
    (event, edge) => {
      const mouseEvent = event as unknown as globalThis.MouseEvent;
      mouseEvent.preventDefault();
      mouseEvent.stopPropagation();
      setSelectedEdgeId(edge.id);
      setTooltip(null);
      setTargetPickSourceId(null);
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
    [closeQuickCreate, selectAgent],
  );

  const closeContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

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
          label: "Add Agent After",
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
          label: "Connect to...",
          onClick: () => {
            setQuickCreate(null);
            setQuickCreateName("");
            setQuickCreateRoleName("");
            setConnectMode(false);
            setTargetPickSourceId(contextNode.id);
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
              tabAgents: workflowRuntimeNodes,
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
          label: "Insert Agent Between",
          onClick: () => {
            openQuickCreate({
              kind: "between",
              x: contextMenu.x,
              y: contextMenu.y,
              sourceNodeId: contextMenu.sourceId,
              targetNodeId: contextMenu.targetId,
            });
          },
        },
        {
          label: "Delete Edge",
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
        label: "Add Agent",
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
        label: "Connect Ports",
        disabled: !activeTabId || readOnly || workflowRuntimeNodes.length < 2,
        onClick: onOpenConnectDialog,
      },
      "divider",
      {
        label: "Fit View",
        disabled: !flowInstance,
        onClick: () => {
          void fitViewport({
            padding: VIEWPORT_FIT_PADDING,
            maxZoom: VIEWPORT_FIT_MAX_ZOOM,
            duration: 350,
          });
        },
      },
      {
        label: "Clear Selection",
        onClick: () => {
          setSelectedEdgeId(null);
          setTargetPickSourceId(null);
          selectAgent(null);
        },
      },
    ];
  }, [
    activeTabId,
    contextMenu,
    fitViewport,
    flowInstance,
    onDeleteAgent,
    onDeleteConnection,
    onOpenConnectDialog,
    openQuickCreate,
    readOnly,
    getContextAgentNode,
    selectAgent,
    workflowRuntimeNodes,
  ]);

  const submitQuickCreate = useCallback(() => {
    if (
      !activeTabId ||
      !quickCreate ||
      !quickCreateRoleName ||
      submittingQuickCreate
    ) {
      return;
    }
    const name = quickCreateName.trim() || undefined;
    setSubmittingQuickCreate(true);

    const request =
      quickCreate.kind === "standalone"
        ? onCreateStandaloneAgent({
            tabId: activeTabId,
            roleName: quickCreateRoleName,
            name,
          })
        : quickCreate.kind === "linked"
          ? onCreateLinkedAgent({
              tabId: activeTabId,
              anchorNodeId: quickCreate.anchorNodeId,
              roleName: quickCreateRoleName,
              name,
            })
          : onInsertAgentBetween({
              tabId: activeTabId,
              sourceNodeId: quickCreate.sourceNodeId,
              targetNodeId: quickCreate.targetNodeId,
              roleName: quickCreateRoleName,
              name,
            });

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
    onCreateLinkedAgent,
    onCreateStandaloneAgent,
    onInsertAgentBetween,
    quickCreate,
    quickCreateName,
    quickCreateRoleName,
    submittingQuickCreate,
  ]);

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
    if (!activeTabId) {
      return { title: "Select a workflow" };
    }
    return { title: "This workflow is ready for its first node" };
  }, [activeTabId, tabs.size]);

  const connectHintLabel = targetPickSourceId
    ? "Choose target Agent"
    : connectMode
      ? "Connect Ports"
      : null;

  const isValidConnection = useCallback(
    (edgeOrConnection: FlowEdge | Connection) => {
      if (
        readOnly ||
        !edgeOrConnection.source ||
        !edgeOrConnection.target ||
        !edgeOrConnection.sourceHandle ||
        !edgeOrConnection.targetHandle
      ) {
        return false;
      }
      if (edgeOrConnection.source === edgeOrConnection.target) {
        return false;
      }
      const sourceNode = workflowNodeMap.get(edgeOrConnection.source);
      const targetNode = workflowNodeMap.get(edgeOrConnection.target);
      const sourcePort = sourceNode?.outputs.find(
        (port) => port.key === edgeOrConnection.sourceHandle,
      );
      const targetPort = targetNode?.inputs.find(
        (port) => port.key === edgeOrConnection.targetHandle,
      );
      if (!sourcePort || !targetPort || sourcePort.type !== targetPort.type) {
        return false;
      }
      if (
        !targetPort.multiple &&
        workflowEdges.some(
          (edge) =>
            edge.to_node_id === edgeOrConnection.target &&
            edge.to_port_key === edgeOrConnection.targetHandle,
        )
      ) {
        return false;
      }
      return !workflowEdges.some(
        (edge) =>
          edge.from_node_id === edgeOrConnection.source &&
          edge.from_port_key === edgeOrConnection.sourceHandle &&
          edge.to_node_id === edgeOrConnection.target &&
          edge.to_port_key === edgeOrConnection.targetHandle,
      );
    },
    [readOnly, workflowEdges, workflowNodeMap],
  );

  return {
    activeTabId,
    animatedEdges,
    animatedNodes,
    availableRoles: roles,
    closeContextMenu,
    closeQuickCreate,
    connectHintLabel,
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
    quickCreateRoleName,
    readOnly,
    setQuickCreateName,
    setQuickCreateRoleName,
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
