import {
  type CSSProperties,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  AlertCircle,
  Check,
  Loader2,
  Maximize,
  Search,
  Trash2,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import {
  Background,
  BackgroundVariant,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type NodeProps,
  type OnConnect,
  type OnEdgesChange,
  type OnNodesChange,
} from "@xyflow/react";
import type { GroupImperativeHandle, Layout } from "react-resizable-panels";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import {
  emptyStateClassName,
  fieldInputClassName,
  sectionTitleClassName,
} from "@/components/flowent/styles";
import type {
  Workflow,
  WorkflowEdge,
  WorkflowNode,
  WorkflowNodeRunResult,
  WorkflowNodeType,
  WorkflowRunResult,
} from "@/components/flowent/types";
import {
  defaultWorkflowNodeData,
  flowEdgeToWorkflowEdge,
  type SelectedWorkflowElement,
  type WorkflowCanvasEdge,
  type WorkflowCanvasNode,
  workflowNodeIconByType,
  workflowNodeTemplates,
  workflowToFlowEdges,
  workflowToFlowNodes,
} from "@/components/flowent/workflows/workflow-model";
import {
  WorkflowEdgeProperties,
  WorkflowNodeProperties,
} from "@/components/flowent/workflows/workflow-properties";
import { cn, createClientId } from "@/lib/utils";

const workflowStatusClasses = {
  failed: {
    border: "border-[#ff7474]/45",
    dot: "bg-[#ff7474]",
    ring: "flowent-workflow-node-ring-failed",
  },
  pending: {
    border: "border-white/10",
    dot: "bg-[#777]",
    ring: "flowent-workflow-node-ring-pending",
  },
  running: {
    border: "border-[#7ddf89]/35",
    dot: "bg-[#7ddf89]",
    ring: "flowent-workflow-node-ring-running",
  },
  success: {
    border: "border-[#7ddf89]/30",
    dot: "bg-[#7ddf89]",
    ring: "flowent-workflow-node-ring-success",
  },
} satisfies Record<
  WorkflowNodeRunResult["status"],
  {
    border: string;
    dot: string;
    ring: string;
  }
>;

function CanvasNode({ data, selected }: NodeProps<WorkflowCanvasNode>) {
  const Icon = workflowNodeIconByType[data.workflowType];
  const result = data.result;
  const status = result?.status ?? "pending";
  const isRunning = status === "running";
  const nodeRef = useRef<HTMLDivElement>(null);
  const statusClasses = workflowStatusClasses[status];

  const updateMouseEffect = (clientX: number, clientY: number) => {
    if (!nodeRef.current) {
      return;
    }
    const rect = nodeRef.current.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const dx = clientX - centerX;
    const dy = clientY - centerY;
    const distance = Math.sqrt(dx * dx + dy * dy);
    const intensity = Math.max(0, 1 - distance / 220);
    const angle = (Math.atan2(dy, dx) * 180) / Math.PI + 90;

    nodeRef.current.style.setProperty("--mouse-angle", `${angle}deg`);
    nodeRef.current.style.setProperty(
      "--mouse-intensity",
      intensity.toString(),
    );
  };

  const resetMouseEffect = () => {
    if (!nodeRef.current) {
      return;
    }
    nodeRef.current.style.setProperty("--mouse-angle", "135deg");
    nodeRef.current.style.setProperty("--mouse-intensity", "0");
  };

  return (
    <div
      ref={nodeRef}
      className={cn(
        "group relative isolate flex h-14 w-max min-w-[120px] max-w-[260px] items-center gap-2 overflow-visible rounded-[10px] border bg-[#111]/95 px-2.5 py-2.5 text-white shadow-[0_10px_24px_rgba(0,0,0,0.24)] transition-[border-color] duration-300",
        selected
          ? "border-white/80 ring-1 ring-white/20"
          : cn(statusClasses.border, "hover:border-white/25"),
      )}
      onMouseEnter={(event) => updateMouseEffect(event.clientX, event.clientY)}
      onMouseLeave={resetMouseEffect}
      onMouseMove={(event) => updateMouseEffect(event.clientX, event.clientY)}
      style={
        {
          "--mouse-angle": "135deg",
          "--mouse-intensity": "0",
        } as CSSProperties
      }
    >
      <div
        aria-hidden="true"
        className={cn("flowent-workflow-node-ring", statusClasses.ring)}
      />
      <div
        aria-hidden="true"
        className={cn(
          "flowent-workflow-node-loading-border",
          isRunning && "flowent-workflow-node-loading-border-active",
        )}
      />
      {data.workflowType !== "input" && data.workflowType !== "timer" ? (
        <Handle
          className="!z-10 !size-3.5 !border !border-black/80 !bg-white/20 !opacity-0 transition-[opacity,transform,box-shadow] duration-150 group-hover:!opacity-100"
          id="in"
          position={Position.Left}
          type="target"
        />
      ) : null}

      <div className="relative z-10 grid size-8 shrink-0 place-items-center rounded-sm border border-white/10 bg-input/30 text-white">
        <Icon className="size-4.5" aria-hidden="true" />
      </div>

      <div className="relative z-10 flex min-w-0 flex-1 items-center justify-between gap-2">
        <span
          className="-translate-y-px truncate text-[13px] leading-5 font-semibold text-white"
          title={data.description || data.label}
        >
          {data.label}
        </span>

        <div
          className="relative flex items-center pr-0.5"
          title={status}
          aria-label={status}
        >
          <span className="relative flex size-2.5">
            {isRunning ? (
              <span
                className={cn(
                  "absolute inline-flex size-full animate-ping rounded-full opacity-40",
                  statusClasses.dot,
                )}
              />
            ) : null}
            <span
              className={cn(
                "relative inline-flex size-2.5 rounded-full border border-black/80 shadow-sm",
                statusClasses.dot,
              )}
            />
          </span>
        </div>
      </div>

      {data.workflowType !== "output" ? (
        <Handle
          className="!z-10 !size-3.5 !border !border-black/80 !bg-white/20 !opacity-0 transition-[opacity,transform,box-shadow] duration-150 group-hover:!opacity-100"
          id="out"
          position={Position.Right}
          type="source"
        />
      ) : null}
    </div>
  );
}

const nodeTypes = {
  workflowNode: CanvasNode,
};

type WorkflowAutoSaveStatus = "idle" | "saving" | "saved" | "error";

const workflowAutoSaveStatusLabel = {
  error: "Could not save",
  idle: "",
  saved: "Saved",
  saving: "Saving...",
} satisfies Record<WorkflowAutoSaveStatus, string>;

const workflowAutoSaveStatusClasses = {
  error: {
    icon: "text-[#ff8a8a]",
    text: "text-[#ffb3b3]",
  },
  idle: {
    icon: "text-white/0",
    text: "text-white/0",
  },
  saved: {
    icon: "text-white/70",
    text: "text-white/65",
  },
  saving: {
    icon: "text-white/70",
    text: "text-white/70",
  },
} satisfies Record<WorkflowAutoSaveStatus, { icon: string; text: string }>;
const workflowCanvasGridSize = 20;
const workflowCanvasSnapGrid: [number, number] = [
  workflowCanvasGridSize,
  workflowCanvasGridSize,
];
const workflowLayoutStorageKey = "flowent:workflow-layout";
const workflowLayoutPanelIds = {
  canvas: "workflow-canvas",
  nodes: "workflow-nodes",
  properties: "workflow-properties",
} as const;
const defaultWorkflowLayout = {
  [workflowLayoutPanelIds.nodes]: 17,
  [workflowLayoutPanelIds.canvas]: 58,
  [workflowLayoutPanelIds.properties]: 25,
} satisfies Layout;
const workflowResizeHandleClassName =
  "w-2 bg-transparent before:absolute before:inset-y-0 before:left-1/2 before:w-px before:-translate-x-1/2 before:bg-white/10 before:content-[''] after:w-full focus-visible:ring-0 focus-visible:ring-offset-0 focus-visible:outline-none max-[860px]:hidden";

function WorkflowResizeHandle({
  ariaLabel,
  onReset,
}: {
  ariaLabel: string;
  onReset: () => void;
}) {
  const handleRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const handle = handleRef.current;
    if (!handle) {
      return;
    }
    const handleDoubleClick = (event: MouseEvent) => {
      event.preventDefault();
      onReset();
    };
    handle.addEventListener("dblclick", handleDoubleClick);
    return () => {
      handle.removeEventListener("dblclick", handleDoubleClick);
    };
  }, [onReset]);

  return (
    <ResizableHandle
      aria-label={ariaLabel}
      className={workflowResizeHandleClassName}
      disableDoubleClick
      elementRef={handleRef}
    />
  );
}

function CanvasControls() {
  const { fitView, zoomIn, zoomOut } = useReactFlow();

  return (
    <div className="absolute top-3 right-3 z-10 flex gap-1 rounded-md border border-white/10 bg-black/80 p-1">
      <Button
        aria-label="Zoom in"
        className="size-7 p-0"
        onClick={() => {
          void zoomIn();
        }}
        size="icon"
        type="button"
        variant="ghost"
      >
        <ZoomIn className="size-4" aria-hidden="true" />
      </Button>
      <Button
        aria-label="Zoom out"
        className="size-7 p-0"
        onClick={() => {
          void zoomOut();
        }}
        size="icon"
        type="button"
        variant="ghost"
      >
        <ZoomOut className="size-4" aria-hidden="true" />
      </Button>
      <Button
        aria-label="Fit view"
        className="size-7 p-0"
        onClick={() => {
          void fitView({ padding: 0.18 });
        }}
        size="icon"
        type="button"
        variant="ghost"
      >
        <Maximize className="size-4" aria-hidden="true" />
      </Button>
    </div>
  );
}

function WorkflowAutoSaveStatusPill({
  status,
}: {
  status: WorkflowAutoSaveStatus;
}) {
  const [renderedStatus, setRenderedStatus] =
    useState<WorkflowAutoSaveStatus | null>(status === "idle" ? null : status);
  const [isVisible, setIsVisible] = useState(status !== "idle");
  const showFrameRef = useRef<number | null>(null);
  const hideTimerRef = useRef<number | null>(null);
  const clearTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (showFrameRef.current) {
      window.cancelAnimationFrame(showFrameRef.current);
      showFrameRef.current = null;
    }
    if (hideTimerRef.current) {
      window.clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
    if (clearTimerRef.current) {
      window.clearTimeout(clearTimerRef.current);
      clearTimerRef.current = null;
    }

    if (status === "idle") {
      setIsVisible(false);
      clearTimerRef.current = window.setTimeout(() => {
        setRenderedStatus(null);
      }, 220);
      return () => {
        if (clearTimerRef.current) {
          window.clearTimeout(clearTimerRef.current);
          clearTimerRef.current = null;
        }
      };
    }

    setRenderedStatus(status);
    showFrameRef.current = window.requestAnimationFrame(() => {
      setIsVisible(true);
      showFrameRef.current = null;
    });

    if (status === "saved") {
      hideTimerRef.current = window.setTimeout(() => {
        setIsVisible(false);
        clearTimerRef.current = window.setTimeout(() => {
          setRenderedStatus(null);
        }, 220);
      }, 1200);
    }

    return () => {
      if (showFrameRef.current) {
        window.cancelAnimationFrame(showFrameRef.current);
        showFrameRef.current = null;
      }
      if (hideTimerRef.current) {
        window.clearTimeout(hideTimerRef.current);
        hideTimerRef.current = null;
      }
      if (clearTimerRef.current) {
        window.clearTimeout(clearTimerRef.current);
        clearTimerRef.current = null;
      }
    };
  }, [status]);

  if (!renderedStatus) {
    return null;
  }

  const statusClasses = workflowAutoSaveStatusClasses[renderedStatus];
  const label = workflowAutoSaveStatusLabel[renderedStatus];

  return (
    <div
      aria-live="polite"
      className={cn(
        "pointer-events-none absolute bottom-3 left-3 z-20 flex h-7 select-none items-center gap-1.5 rounded-md border border-white/10 bg-black/75 px-2.5 text-xs leading-none shadow-[0_8px_24px_rgba(0,0,0,0.26)] backdrop-blur-sm transition-[opacity,transform] duration-200 ease-out",
        isVisible ? "translate-y-0 opacity-100" : "translate-y-1 opacity-0",
        renderedStatus === "error" ? "border-[#ff8a8a]/25" : "",
      )}
    >
      {renderedStatus === "saving" ? (
        <Loader2
          className={cn("size-3.5 animate-spin", statusClasses.icon)}
          aria-hidden="true"
        />
      ) : renderedStatus === "saved" ? (
        <Check
          className={cn("size-3.5", statusClasses.icon)}
          aria-hidden="true"
        />
      ) : (
        <AlertCircle
          className={cn("size-3.5", statusClasses.icon)}
          aria-hidden="true"
        />
      )}
      <span className={statusClasses.text}>{label}</span>
    </div>
  );
}

function snapWorkflowPosition(position: { x: number; y: number }) {
  return {
    x: Math.round(position.x / workflowCanvasGridSize) * workflowCanvasGridSize,
    y: Math.round(position.y / workflowCanvasGridSize) * workflowCanvasGridSize,
  };
}

function snapWorkflowNodes(nodes: WorkflowCanvasNode[]) {
  return nodes.map((node) => ({
    ...node,
    position: snapWorkflowPosition(node.position),
  }));
}

export function WorkflowCanvas({
  autoSaveStatus,
  draftWorkflow,
  isRunning,
  onChange,
  runResult,
}: {
  autoSaveStatus: WorkflowAutoSaveStatus;
  draftWorkflow: Workflow;
  isRunning: boolean;
  onChange: (workflow: Workflow) => void;
  runResult: WorkflowRunResult | null;
}) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const workflowLayoutGroupRef = useRef<GroupImperativeHandle | null>(null);
  const { screenToFlowPosition } = useReactFlow();
  const previousWorkflowIdRef = useRef(draftWorkflow.id);
  const [selectedElement, setSelectedElement] =
    useState<SelectedWorkflowElement | null>(null);
  const [nodes, setNodes] = useNodesState<WorkflowCanvasNode>(
    snapWorkflowNodes(workflowToFlowNodes(draftWorkflow, runResult)),
  );
  const [edges, setEdges] = useEdgesState<WorkflowCanvasEdge>(
    workflowToFlowEdges(draftWorkflow),
  );
  const [nodeSearch, setNodeSearch] = useState("");
  const [workflowLayout, setWorkflowLayout] = useState(() =>
    readStoredWorkflowLayout(),
  );
  const nodesRef = useRef(nodes);
  const edgesRef = useRef(edges);

  useEffect(() => {
    nodesRef.current = nodes;
  }, [nodes]);

  useEffect(() => {
    edgesRef.current = edges;
  }, [edges]);

  useEffect(() => {
    setNodes(snapWorkflowNodes(workflowToFlowNodes(draftWorkflow, runResult)));
    setEdges(workflowToFlowEdges(draftWorkflow));
    if (previousWorkflowIdRef.current !== draftWorkflow.id) {
      previousWorkflowIdRef.current = draftWorkflow.id;
      setSelectedElement(null);
    }
  }, [draftWorkflow, runResult, setEdges, setNodes]);

  const selectedNode = useMemo(() => {
    if (selectedElement?.kind !== "node") {
      return null;
    }
    return draftWorkflow.definition.nodes.find(
      (node) => node.id === selectedElement.id,
    );
  }, [draftWorkflow.definition.nodes, selectedElement]);

  const selectedEdge = useMemo(() => {
    if (selectedElement?.kind !== "edge") {
      return null;
    }
    return draftWorkflow.definition.edges.find(
      (edge) => edge.id === selectedElement.id,
    );
  }, [draftWorkflow.definition.edges, selectedElement]);

  const commitGraph = useCallback(
    (nextNodes: WorkflowCanvasNode[], nextEdges: WorkflowCanvasEdge[]) => {
      const nodeById = new Map(
        draftWorkflow.definition.nodes.map((node) => [node.id, node]),
      );
      const nextWorkflow: Workflow = {
        ...draftWorkflow,
        definition: {
          ...draftWorkflow.definition,
          edges: nextEdges.map(flowEdgeToWorkflowEdge),
          nodes: nextNodes.map((node) => {
            const currentNode = nodeById.get(node.id);
            const position = snapWorkflowPosition(node.position);
            return {
              data: currentNode?.data ?? {},
              description: currentNode?.description ?? "",
              id: node.id,
              name: currentNode?.name ?? node.data.label,
              position,
              type: currentNode?.type ?? node.data.workflowType,
            };
          }),
        },
      };
      onChange(nextWorkflow);
    },
    [draftWorkflow, onChange],
  );

  const onConnect: OnConnect = useCallback(
    (connection: Connection) => {
      setEdges((currentEdges) => {
        const nextEdge = {
          ...connection,
          data: { label: "" },
          id: createClientId("edge"),
          label: "",
          markerEnd: { type: MarkerType.ArrowClosed },
        } satisfies WorkflowCanvasEdge;
        const nextEdges = addEdge<WorkflowCanvasEdge>(nextEdge, currentEdges);
        edgesRef.current = nextEdges;
        window.requestAnimationFrame(() => {
          commitGraph(nodesRef.current, nextEdges);
        });
        return nextEdges;
      });
    },
    [commitGraph, setEdges],
  );

  const handleEdgesChange: OnEdgesChange<WorkflowCanvasEdge> = useCallback(
    (changes) => {
      setEdges((currentEdges) => {
        const nextEdges = applyEdgeChanges(changes, currentEdges);
        edgesRef.current = nextEdges;
        if (changes.some((change) => change.type !== "select")) {
          window.requestAnimationFrame(() => {
            commitGraph(nodesRef.current, nextEdges);
          });
        }
        return nextEdges;
      });
    },
    [commitGraph, setEdges],
  );

  const handleNodesChange: OnNodesChange<WorkflowCanvasNode> = useCallback(
    (changes) => {
      setNodes((currentNodes) => {
        const nextNodes = snapWorkflowNodes(
          applyNodeChanges(changes, currentNodes),
        );
        nodesRef.current = nextNodes;
        if (
          changes.some(
            (change) =>
              change.type === "remove" ||
              change.type === "add" ||
              change.type === "replace" ||
              (change.type === "position" && change.dragging !== true),
          )
        ) {
          window.requestAnimationFrame(() => {
            commitGraph(nextNodes, edgesRef.current);
          });
        }
        return nextNodes;
      });
    },
    [commitGraph, setNodes],
  );

  const addNode = useCallback(
    (type: WorkflowNodeType, position = { x: 120, y: 120 }) => {
      const template = workflowNodeTemplates.find((item) => item.type === type);
      if (!template) {
        return;
      }
      const nodeId = createClientId(type);
      const snappedPosition = snapWorkflowPosition(position);
      const nextWorkflowNode: WorkflowNode = {
        data: defaultWorkflowNodeData(type),
        description: "",
        id: nodeId,
        name: template.label,
        position: snappedPosition,
        type,
      };
      const nextWorkflow = {
        ...draftWorkflow,
        definition: {
          ...draftWorkflow.definition,
          nodes: [...draftWorkflow.definition.nodes, nextWorkflowNode],
        },
      };
      onChange(nextWorkflow);
      setNodes((currentNodes) => [
        ...currentNodes,
        ...workflowToFlowNodes(
          {
            ...draftWorkflow,
            definition: {
              ...draftWorkflow.definition,
              nodes: [nextWorkflowNode],
            },
          },
          runResult,
        ),
      ]);
      setSelectedElement({ id: nodeId, kind: "node" });
    },
    [draftWorkflow, onChange, runResult, setNodes],
  );

  const updateNode = (nodeId: string, updates: Partial<WorkflowNode>) => {
    const nextWorkflow = {
      ...draftWorkflow,
      definition: {
        ...draftWorkflow.definition,
        nodes: draftWorkflow.definition.nodes.map((node) =>
          node.id === nodeId ? { ...node, ...updates } : node,
        ),
      },
    };
    onChange(nextWorkflow);
    setNodes((currentNodes) =>
      currentNodes.map((node) =>
        node.id === nodeId
          ? {
              ...node,
              data: {
                ...node.data,
                description: updates.description ?? node.data.description,
                label: updates.name ?? node.data.label,
              },
            }
          : node,
      ),
    );
  };

  const updateNodeData = (
    nodeId: string,
    key: string,
    value: string | number | boolean,
  ) => {
    const node = draftWorkflow.definition.nodes.find(
      (currentNode) => currentNode.id === nodeId,
    );
    updateNode(nodeId, {
      data: {
        ...(node?.data ?? {}),
        [key]: value,
      },
    });
  };

  const updateEdge = (edgeId: string, updates: Partial<WorkflowEdge>) => {
    const nextWorkflow = {
      ...draftWorkflow,
      definition: {
        ...draftWorkflow.definition,
        edges: draftWorkflow.definition.edges.map((edge) =>
          edge.id === edgeId ? { ...edge, ...updates } : edge,
        ),
      },
    };
    onChange(nextWorkflow);
    setEdges((currentEdges) =>
      currentEdges.map((edge) =>
        edge.id === edgeId
          ? {
              ...edge,
              data: { label: updates.label ?? edge.data?.label ?? "" },
              label: updates.label ?? edge.label,
            }
          : edge,
      ),
    );
  };

  const removeSelected = () => {
    if (!selectedElement) {
      return;
    }
    if (selectedElement.kind === "node") {
      const nextNodes = nodes.filter((node) => node.id !== selectedElement.id);
      const nextEdges = edges.filter(
        (edge) =>
          edge.source !== selectedElement.id &&
          edge.target !== selectedElement.id,
      );
      setNodes(nextNodes);
      setEdges(nextEdges);
      commitGraph(nextNodes, nextEdges);
    }
    if (selectedElement.kind === "edge") {
      const nextEdges = edges.filter((edge) => edge.id !== selectedElement.id);
      setEdges(nextEdges);
      commitGraph(nodes, nextEdges);
    }
    setSelectedElement(null);
  };

  const filteredTemplates = workflowNodeTemplates.filter((template) =>
    template.label.toLowerCase().includes(nodeSearch.trim().toLowerCase()),
  );

  const saveWorkflowLayout = (layout: Layout) => {
    if (!isWorkflowLayout(layout)) {
      return;
    }
    setWorkflowLayout(layout);
    writeStoredWorkflowLayout(layout);
  };

  const resetWorkflowLayout = () => {
    setWorkflowLayout(defaultWorkflowLayout);
    writeStoredWorkflowLayout(defaultWorkflowLayout);
    workflowLayoutGroupRef.current?.setLayout(defaultWorkflowLayout);
  };

  const renderNodesPanel = () => (
    <aside className="flex h-full min-h-0 flex-col bg-black p-3 max-[860px]:h-auto max-[860px]:border-b max-[860px]:border-white/10">
      <div className="flex items-center justify-between gap-2">
        <h3 className={sectionTitleClassName}>Nodes</h3>
      </div>
      <div className="relative mt-3">
        <Search
          className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-[#777]"
          aria-hidden="true"
        />
        <Input
          className={cn(fieldInputClassName, "pl-8")}
          onChange={(event) => setNodeSearch(event.target.value)}
          placeholder="Search nodes..."
          value={nodeSearch}
        />
      </div>
      <div className="mt-4 space-y-2">
        <div className="text-[11px] leading-4 font-medium text-white/45">
          Core
        </div>
        {filteredTemplates.map((template) => {
          const Icon = template.icon;
          return (
            <Button
              aria-label={`${template.label} ${template.description}`}
              className="h-auto w-full justify-start gap-2 rounded-md border border-white/10 bg-input/30 px-2.5 py-2 text-left text-white shadow-none hover:bg-input/50"
              draggable
              key={template.type}
              onClick={() => addNode(template.type)}
              onDragStart={(event) => {
                event.dataTransfer.setData(
                  "application/flowent-node",
                  template.type,
                );
                event.dataTransfer.effectAllowed = "move";
              }}
              type="button"
              variant="ghost"
            >
              <Icon className="size-4 shrink-0" aria-hidden="true" />
              <span className="min-w-0">
                <span className="block text-sm leading-5">
                  {template.label}
                </span>
                <span className="block truncate text-xs leading-4 text-[#9b9b9b]">
                  {template.description}
                </span>
              </span>
            </Button>
          );
        })}
      </div>
    </aside>
  );

  const renderCanvasPanel = () => (
    <section
      className="relative h-full min-h-0 min-w-0 bg-black max-[860px]:min-h-[420px]"
      onDragOver={(event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
      }}
      onDrop={(event) => {
        event.preventDefault();
        const type = event.dataTransfer.getData(
          "application/flowent-node",
        ) as WorkflowNodeType;
        if (!workflowNodeTemplates.some((template) => template.type === type)) {
          return;
        }
        const position = screenToFlowPosition({
          x: event.clientX,
          y: event.clientY,
        });
        addNode(type, position);
      }}
      ref={wrapperRef}
    >
      {nodes.length === 0 ? (
        <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center px-6 text-center text-sm text-[#9b9b9b]">
          Drag nodes from the palette to start building your workflow.
        </div>
      ) : null}
      {isRunning ? (
        <div className="absolute top-3 left-3 z-10 flex items-center gap-2 rounded-md border border-white/10 bg-black/80 px-2.5 py-1.5 text-xs text-[#dedede]">
          <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
          Workflow running...
        </div>
      ) : null}
      <CanvasControls />
      <ReactFlow
        className="flowent-workflow-canvas"
        deleteKeyCode={["Backspace", "Delete"]}
        edges={edges}
        fitView
        nodes={nodes}
        nodeTypes={nodeTypes}
        onConnect={onConnect}
        onEdgesChange={handleEdgesChange}
        onEdgeClick={(_, edge) => {
          setSelectedElement({ id: edge.id, kind: "edge" });
        }}
        onNodeClick={(_, node) => {
          setSelectedElement({ id: node.id, kind: "node" });
        }}
        onNodesChange={handleNodesChange}
        onPaneClick={() => setSelectedElement(null)}
        proOptions={{ hideAttribution: true }}
        snapGrid={workflowCanvasSnapGrid}
        snapToGrid
      >
        <Background
          color="rgba(255,255,255,0.08)"
          gap={workflowCanvasGridSize}
          lineWidth={1}
          variant={BackgroundVariant.Lines}
        />
      </ReactFlow>
      <WorkflowAutoSaveStatusPill status={autoSaveStatus} />
    </section>
  );

  const renderPropertiesPanel = () => (
    <aside className="h-full min-h-0 overflow-y-auto bg-black p-3 max-[860px]:h-auto max-[860px]:border-t max-[860px]:border-white/10">
      <div className="flex items-center justify-between gap-2">
        <h3 className={sectionTitleClassName}>Properties</h3>
        {selectedElement ? (
          <Button
            aria-label="Remove selection"
            className="size-7 p-0 text-[#ff8a8a]"
            onClick={removeSelected}
            size="icon"
            type="button"
            variant="ghost"
          >
            <Trash2 className="size-4" aria-hidden="true" />
          </Button>
        ) : null}
      </div>

      {!selectedNode && !selectedEdge ? (
        <p className={cn(emptyStateClassName, "mt-3")}>
          Select a node or edge to view its properties.
        </p>
      ) : null}

      {selectedNode ? (
        <WorkflowNodeProperties
          node={selectedNode}
          onNodeChange={(updates) => updateNode(selectedNode.id, updates)}
          onNodeDataChange={(key, value) =>
            updateNodeData(selectedNode.id, key, value)
          }
        />
      ) : null}

      {selectedEdge ? (
        <WorkflowEdgeProperties
          edge={selectedEdge}
          onEdgeChange={(updates) => updateEdge(selectedEdge.id, updates)}
        />
      ) : null}
    </aside>
  );

  return (
    <ResizablePanelGroup
      className="min-h-0 flex-1 max-[860px]:!grid max-[860px]:!grid-cols-1 max-[860px]:!grid-rows-[auto_minmax(420px,1fr)_auto]"
      defaultLayout={workflowLayout}
      groupRef={workflowLayoutGroupRef}
      id="flowent-workflow-layout"
      onLayoutChanged={saveWorkflowLayout}
      orientation="horizontal"
      resizeTargetMinimumSize={{ coarse: 32, fine: 8 }}
    >
      <ResizablePanel
        className="min-h-0"
        defaultSize={`${defaultWorkflowLayout[workflowLayoutPanelIds.nodes]}%`}
        groupResizeBehavior="preserve-pixel-size"
        id={workflowLayoutPanelIds.nodes}
        maxSize="280px"
        minSize="160px"
      >
        {renderNodesPanel()}
      </ResizablePanel>
      <WorkflowResizeHandle
        ariaLabel="Resize workflow nodes"
        onReset={resetWorkflowLayout}
      />
      <ResizablePanel
        className="min-h-0"
        defaultSize={`${defaultWorkflowLayout[workflowLayoutPanelIds.canvas]}%`}
        id={workflowLayoutPanelIds.canvas}
        minSize="360px"
      >
        {renderCanvasPanel()}
      </ResizablePanel>
      <WorkflowResizeHandle
        ariaLabel="Resize workflow properties"
        onReset={resetWorkflowLayout}
      />
      <ResizablePanel
        className="min-h-0"
        defaultSize={`${defaultWorkflowLayout[workflowLayoutPanelIds.properties]}%`}
        groupResizeBehavior="preserve-pixel-size"
        id={workflowLayoutPanelIds.properties}
        maxSize="420px"
        minSize="240px"
      >
        {renderPropertiesPanel()}
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}

function readStoredWorkflowLayout() {
  if (typeof window === "undefined") {
    return defaultWorkflowLayout;
  }
  try {
    const value = window.localStorage.getItem(workflowLayoutStorageKey);
    if (!value) {
      return defaultWorkflowLayout;
    }
    const parsed = JSON.parse(value) as unknown;
    if (!isWorkflowLayout(parsed)) {
      return defaultWorkflowLayout;
    }
    return parsed;
  } catch {
    return defaultWorkflowLayout;
  }
}

function writeStoredWorkflowLayout(layout: Layout) {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(workflowLayoutStorageKey, JSON.stringify(layout));
}

function isWorkflowLayout(layout: unknown): layout is Layout {
  if (!layout || typeof layout !== "object") {
    return false;
  }
  return Object.values(workflowLayoutPanelIds).every((panelId) => {
    const value = (layout as Record<string, unknown>)[panelId];
    return typeof value === "number" && Number.isFinite(value) && value > 0;
  });
}
