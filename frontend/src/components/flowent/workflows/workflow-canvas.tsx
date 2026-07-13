import {
  type CSSProperties,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  AlertCircle,
  ChevronRight,
  Check,
  Loader2,
  Maximize,
  Play,
  Plus,
  Search,
  Square,
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
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import {
  emptyStateClassName,
  sectionTitleClassName,
} from "@/components/flowent/styles";
import type {
  WorkflowNodeRunResult,
  WorkflowRunResult,
} from "@/features/workflows/model/workflow-run-types";
import type { WorkflowScheduleStatus } from "@/features/workflows/model/workflow-schedule-types";
import type {
  Workflow,
  WorkflowEdge,
  WorkflowNode,
  WorkflowNodeKind,
} from "@/features/workflows/model/workflow-types";
import {
  defaultWorkflowNodeData,
  flowEdgeToWorkflowConnection,
  type SelectedWorkflowElement,
  type WorkflowCanvasEdge,
  type WorkflowCanvasNode,
  type WorkflowNodeTemplate,
  workflowNodeIconByType,
  workflowNodeTemplates,
  workflowEdges,
  workflowNodes,
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
  const labelMeasureRef = useRef<HTMLSpanElement>(null);
  const [nodeWidth, setNodeWidth] = useState(workflowNodeMinWidth);
  const statusClasses = workflowStatusClasses[status];

  useLayoutEffect(() => {
    const labelWidth =
      labelMeasureRef.current?.getBoundingClientRect().width ?? 0;
    setNodeWidth(
      snapWorkflowNodeWidth(labelWidth + workflowNodeMeasuredChromeWidth),
    );
  }, [data.label]);

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
        "group relative isolate flex h-[60px] items-center gap-2 overflow-visible rounded-[10px] border bg-[#111]/95 px-2.5 py-2.5 text-white shadow-[0_10px_24px_rgba(0,0,0,0.24)] transition-[border-color] duration-300",
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
          width: `${nodeWidth}px`,
        } as CSSProperties
      }
    >
      <span
        aria-hidden="true"
        className="pointer-events-none invisible absolute top-0 left-0 h-0 w-max max-w-none overflow-hidden whitespace-nowrap text-[13px] leading-5 font-semibold"
        ref={labelMeasureRef}
      >
        {data.label}
      </span>
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
          id="input"
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
          id="output"
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
type WorkflowRunControlState =
  | "ready"
  | "running"
  | "stoppable"
  | "loading"
  | "starting"
  | "stopping"
  | "unavailable";

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
const workflowNodeMinWidth = 120;
const workflowNodeMaxWidth = 260;
const workflowNodeMeasuredChromeWidth = 88;
const workflowLayoutStorageKey = "flowent:workflow-layout";
const workflowNodeTemplateGroups: Array<{
  label: string;
  types: WorkflowNodeKind[];
}> = [
  { label: "Triggers", types: ["input", "timer"] },
  { label: "Actions", types: ["agent", "merge", "code"] },
  { label: "Outputs", types: ["output"] },
];
const workflowLayoutPanelIds = {
  canvas: "workflow-canvas",
  properties: "workflow-properties",
} as const;
const defaultWorkflowLayout = {
  [workflowLayoutPanelIds.canvas]: 72,
  [workflowLayoutPanelIds.properties]: 28,
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
    <div className="flex gap-1 rounded-md border border-white/10 bg-black/80 p-1">
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

function WorkflowRunControl({
  isDisabled,
  label,
  onRun,
  state,
}: {
  isDisabled: boolean;
  label: string;
  onRun: () => void;
  state: WorkflowRunControlState;
}) {
  return (
    <Button
      className="h-9 gap-1.5 rounded-md border-white/10 bg-black/80 px-3 text-white shadow-none hover:bg-input/50"
      disabled={isDisabled}
      onClick={onRun}
      size="sm"
      type="button"
      variant={state === "ready" ? "default" : "outline"}
    >
      {state === "stoppable" ? (
        <Square className="size-4" aria-hidden="true" />
      ) : ["running", "loading", "starting", "stopping"].includes(state) ? (
        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
      ) : state === "unavailable" ? (
        <AlertCircle className="size-4" aria-hidden="true" />
      ) : (
        <Play className="size-4" aria-hidden="true" />
      )}
      {label}
    </Button>
  );
}

function WorkflowNodePickerContent({
  Item,
  onAddNode,
}: {
  Item: typeof ContextMenuItem | typeof DropdownMenuItem;
  onAddNode: (type: WorkflowNodeKind) => void;
}) {
  const [query, setQuery] = useState("");
  const [previewTemplate, setPreviewTemplate] =
    useState<WorkflowNodeTemplate | null>(workflowNodeTemplates[0] ?? null);
  const normalizedQuery = query.trim().toLowerCase();
  const filteredTemplates = workflowNodeTemplates.filter((template) => {
    if (!normalizedQuery) {
      return true;
    }
    return (
      template.label.toLowerCase().includes(normalizedQuery) ||
      template.description.toLowerCase().includes(normalizedQuery)
    );
  });
  const filteredTemplateByType = new Map(
    filteredTemplates.map((template) => [template.type, template]),
  );
  const hasMatches = filteredTemplates.length > 0;

  useEffect(() => {
    if (!previewTemplate || !filteredTemplateByType.has(previewTemplate.type)) {
      setPreviewTemplate(filteredTemplates[0] ?? null);
    }
  }, [filteredTemplateByType, filteredTemplates, previewTemplate]);

  return (
    <div className="flex w-[390px] gap-1.5">
      <div className="min-w-0 flex-1">
        <div className="relative p-1">
          <Search
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-white/45"
            aria-hidden="true"
          />
          <Input
            aria-label="Search nodes"
            autoComplete="off"
            className="h-8 rounded-xl border-white/10 bg-black/35 pr-2 pl-8 text-sm text-white shadow-none placeholder:text-white/35 focus-visible:border-white/20 focus-visible:ring-0"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => event.stopPropagation()}
            placeholder="Search nodes..."
            value={query}
          />
        </div>
        <div className="max-h-[330px] overflow-y-auto px-1 pb-1">
          {hasMatches ? (
            workflowNodeTemplateGroups.map((group) => {
              const groupTemplates = group.types
                .map((type) => filteredTemplateByType.get(type))
                .filter((template): template is WorkflowNodeTemplate =>
                  Boolean(template),
                );

              if (groupTemplates.length === 0) {
                return null;
              }

              return (
                <div className="pt-2 first:pt-1" key={group.label}>
                  <div className="px-2 pb-1 text-[11px] leading-4 font-medium text-white/45">
                    {group.label}
                  </div>
                  <div className="grid gap-0.5">
                    {groupTemplates.map((template) => {
                      const Icon = template.icon;
                      return (
                        <Item
                          className="h-9 rounded-xl px-2"
                          key={template.type}
                          onFocus={() => setPreviewTemplate(template)}
                          onMouseEnter={() => setPreviewTemplate(template)}
                          onSelect={() => onAddNode(template.type)}
                        >
                          <Icon
                            className="size-4 shrink-0"
                            aria-hidden="true"
                          />
                          <span className="min-w-0 truncate">
                            {template.label}
                          </span>
                        </Item>
                      );
                    })}
                  </div>
                </div>
              );
            })
          ) : (
            <div className="px-2 py-6 text-center text-sm text-white/45">
              No nodes found.
            </div>
          )}
        </div>
      </div>
      <div className="w-36 border-l border-white/10 p-2">
        {previewTemplate ? (
          <div className="rounded-xl border border-white/10 bg-black/35 p-3 shadow-sm">
            <div className="flex items-center gap-2">
              {(() => {
                const PreviewIcon = previewTemplate.icon;
                return (
                  <PreviewIcon
                    className="size-4 shrink-0 text-white"
                    aria-hidden="true"
                  />
                );
              })()}
              <div className="min-w-0 truncate text-sm leading-5 font-medium text-white">
                {previewTemplate.label}
              </div>
            </div>
            <p className="mt-2 text-xs leading-4 text-white/55">
              {previewTemplate.description}
            </p>
          </div>
        ) : (
          <div className="rounded-xl border border-white/10 bg-black/35 p-3 text-xs leading-4 text-white/45">
            Hover a node to preview it.
          </div>
        )}
      </div>
    </div>
  );
}

function WorkflowCanvasContextAddMenu({
  onAddNode,
}: {
  onAddNode: (type: WorkflowNodeKind) => void;
}) {
  const [isNodePickerOpen, setIsNodePickerOpen] = useState(false);

  return (
    <ContextMenuSub open={isNodePickerOpen} onOpenChange={setIsNodePickerOpen}>
      <ContextMenuSubTrigger
        className="min-w-40"
        onClick={(event) => {
          event.preventDefault();
          setIsNodePickerOpen(true);
        }}
      >
        <Plus className="size-4 shrink-0" aria-hidden="true" />
        <span className="min-w-0 flex-1">Add Node</span>
        <ChevronRight className="size-4 shrink-0 text-white/45" />
      </ContextMenuSubTrigger>
      <ContextMenuSubContent>
        <WorkflowNodePickerContent
          Item={ContextMenuItem}
          onAddNode={onAddNode}
        />
      </ContextMenuSubContent>
    </ContextMenuSub>
  );
}

function WorkflowAutoSaveStatusPill({
  error,
  status,
}: {
  error: string;
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
  const label =
    renderedStatus === "error" && error
      ? error
      : workflowAutoSaveStatusLabel[renderedStatus];

  return (
    <div
      aria-live="polite"
      role={renderedStatus === "error" ? "alert" : "status"}
      className={cn(
        "pointer-events-none absolute bottom-3 left-3 z-20 flex min-h-7 max-w-[min(420px,calc(100%-1.5rem))] select-none items-center gap-1.5 rounded-md border border-white/10 bg-black/75 px-2.5 py-1.5 text-xs leading-4 shadow-[0_8px_24px_rgba(0,0,0,0.26)] backdrop-blur-sm transition-[opacity,transform] duration-200 ease-out",
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
      <span className={cn("break-words", statusClasses.text)}>{label}</span>
    </div>
  );
}

function snapWorkflowPosition(position: { x: number; y: number }) {
  return {
    x: Math.round(position.x / workflowCanvasGridSize) * workflowCanvasGridSize,
    y: Math.round(position.y / workflowCanvasGridSize) * workflowCanvasGridSize,
  };
}

function snapWorkflowNodeWidth(width: number) {
  return Math.min(
    workflowNodeMaxWidth,
    Math.max(
      workflowNodeMinWidth,
      Math.ceil(width / workflowCanvasGridSize) * workflowCanvasGridSize,
    ),
  );
}

function snapWorkflowNodes(nodes: WorkflowCanvasNode[]) {
  return nodes.map((node) => ({
    ...node,
    position: snapWorkflowPosition(node.position),
  }));
}

function formatScheduleTime(timestamp: number, timezone: string) {
  const fallbackTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const displayTimezone = timezone || fallbackTimezone;
  const options: Intl.DateTimeFormatOptions = {
    dateStyle: "medium",
    timeStyle: "short",
    ...(displayTimezone ? { timeZone: displayTimezone } : {}),
  };
  try {
    const formattedTime = new Intl.DateTimeFormat(undefined, options).format(
      new Date(timestamp * 1000),
    );
    return displayTimezone
      ? `${formattedTime} (${displayTimezone})`
      : formattedTime;
  } catch {
    const formattedTime = new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(timestamp * 1000));
    return fallbackTimezone
      ? `${formattedTime} (${fallbackTimezone})`
      : formattedTime;
  }
}

export function WorkflowCanvas({
  autoSaveError,
  autoSaveStatus,
  draftWorkflow,
  isRunning,
  onChange,
  onRun,
  runResult,
  runControlLabel,
  runControlState,
  scheduleError,
  scheduleNextRunAt,
  scheduleStatus,
  scheduleTimezone,
}: {
  autoSaveError: string;
  autoSaveStatus: WorkflowAutoSaveStatus;
  draftWorkflow: Workflow;
  isRunning: boolean;
  onChange: (workflow: Workflow) => void;
  onRun: () => void;
  runResult: WorkflowRunResult | null;
  runControlLabel: string;
  runControlState: WorkflowRunControlState;
  scheduleError: string;
  scheduleNextRunAt: number | null;
  scheduleStatus: WorkflowScheduleStatus | null;
  scheduleTimezone: string;
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
  const [workflowLayout, setWorkflowLayout] = useState<Layout>(() =>
    readStoredWorkflowLayout(),
  );
  const [isAddMenuOpen, setIsAddMenuOpen] = useState(false);
  const contextMenuPositionRef = useRef<{ x: number; y: number } | null>(null);
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
    return workflowNodes(draftWorkflow).find(
      (node) => node.id === selectedElement.id,
    );
  }, [draftWorkflow, selectedElement]);

  const selectedEdge = useMemo(() => {
    if (selectedElement?.kind !== "edge") {
      return null;
    }
    return workflowEdges(draftWorkflow).find(
      (edge) => edge.id === selectedElement.id,
    );
  }, [draftWorkflow, selectedElement]);

  const commitGraph = useCallback(
    (nextNodes: WorkflowCanvasNode[], nextEdges: WorkflowCanvasEdge[]) => {
      const nodeById = new Map(
        draftWorkflow.spec.nodes.map((node) => [node.id, node]),
      );
      const nextWorkflow: Workflow = {
        ...draftWorkflow,
        presentation: {
          connections: Object.fromEntries(
            nextEdges.map((edge) => [
              edge.id,
              { label: String(edge.label ?? edge.data?.label ?? "") },
            ]),
          ),
          nodes: Object.fromEntries(
            nextNodes.map((node) => {
              const currentPresentation =
                draftWorkflow.presentation.nodes[node.id];
              return [
                node.id,
                {
                  description: currentPresentation?.description ?? "",
                  name: currentPresentation?.name ?? node.data.label,
                  position: snapWorkflowPosition(node.position),
                },
              ];
            }),
          ),
        },
        spec: {
          connections: nextEdges.map(flowEdgeToWorkflowConnection),
          nodes: nextNodes.map((node) => {
            const currentNode = nodeById.get(node.id);
            return {
              config: currentNode?.config ?? {},
              id: node.id,
              kind: currentNode?.kind ?? node.data.workflowType,
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
    (type: WorkflowNodeKind, position = { x: 120, y: 120 }) => {
      const template = workflowNodeTemplates.find((item) => item.type === type);
      if (!template) {
        return;
      }
      const nodeId = createClientId(type);
      const snappedPosition = snapWorkflowPosition(position);
      const nextWorkflowNode: WorkflowNode = {
        config: defaultWorkflowNodeData(type),
        description: "",
        id: nodeId,
        kind: type,
        name: template.label,
        position: snappedPosition,
      };
      const nextWorkflow = {
        ...draftWorkflow,
        presentation: {
          ...draftWorkflow.presentation,
          nodes: {
            ...draftWorkflow.presentation.nodes,
            [nodeId]: {
              description: nextWorkflowNode.description,
              name: nextWorkflowNode.name,
              position: nextWorkflowNode.position,
            },
          },
        },
        spec: {
          ...draftWorkflow.spec,
          nodes: [
            ...draftWorkflow.spec.nodes,
            {
              config: nextWorkflowNode.config,
              id: nextWorkflowNode.id,
              kind: nextWorkflowNode.kind,
            },
          ],
        },
      };
      onChange(nextWorkflow);
      setNodes((currentNodes) => [
        ...currentNodes,
        ...workflowToFlowNodes(
          {
            ...draftWorkflow,
            presentation: {
              connections: {},
              nodes: {
                [nodeId]: {
                  description: nextWorkflowNode.description,
                  name: nextWorkflowNode.name,
                  position: nextWorkflowNode.position,
                },
              },
            },
            spec: {
              connections: [],
              nodes: [
                {
                  config: nextWorkflowNode.config,
                  id: nextWorkflowNode.id,
                  kind: nextWorkflowNode.kind,
                },
              ],
            },
          },
          runResult,
        ),
      ]);
      setSelectedElement({ id: nodeId, kind: "node" });
    },
    [draftWorkflow, onChange, runResult, setNodes],
  );

  const addNodeAtViewportCenter = useCallback(
    (type: WorkflowNodeKind) => {
      const rect = wrapperRef.current?.getBoundingClientRect();
      const position = rect
        ? screenToFlowPosition({
            x: rect.left + rect.width / 2,
            y: rect.top + rect.height / 2,
          })
        : { x: 120, y: 120 };
      addNode(type, position);
    },
    [addNode, screenToFlowPosition],
  );

  const addNodeAtContextMenuPosition = useCallback(
    (type: WorkflowNodeKind) => {
      addNode(type, contextMenuPositionRef.current ?? { x: 120, y: 120 });
      contextMenuPositionRef.current = null;
    },
    [addNode],
  );

  const updateNode = (nodeId: string, updates: Partial<WorkflowNode>) => {
    const currentPresentation = draftWorkflow.presentation.nodes[nodeId];
    const nextWorkflow = {
      ...draftWorkflow,
      presentation: {
        ...draftWorkflow.presentation,
        nodes: {
          ...draftWorkflow.presentation.nodes,
          [nodeId]: {
            description: updates.description ?? currentPresentation.description,
            name: updates.name ?? currentPresentation.name,
            position: updates.position ?? currentPresentation.position,
          },
        },
      },
      spec: {
        ...draftWorkflow.spec,
        nodes: draftWorkflow.spec.nodes.map((node) =>
          node.id === nodeId
            ? {
                ...node,
                config: updates.config ?? node.config,
                kind: updates.kind ?? node.kind,
              }
            : node,
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
    const node = draftWorkflow.spec.nodes.find(
      (currentNode) => currentNode.id === nodeId,
    );
    updateNode(nodeId, {
      config: {
        ...(node?.config ?? {}),
        [key]: value,
      },
    });
  };

  const updateEdge = (edgeId: string, updates: Partial<WorkflowEdge>) => {
    const nextWorkflow = {
      ...draftWorkflow,
      presentation: {
        ...draftWorkflow.presentation,
        connections: {
          ...draftWorkflow.presentation.connections,
          [edgeId]: {
            label:
              updates.label ??
              draftWorkflow.presentation.connections[edgeId].label,
          },
        },
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

  const renderCanvasPanel = () => (
    <section
      className="relative h-full min-h-0 min-w-0 bg-black max-[860px]:min-h-[420px]"
      ref={wrapperRef}
    >
      {nodes.length === 0 ? (
        <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center px-6 text-center text-sm text-[#9b9b9b]">
          Right-click the canvas or use Add to create your first node.
        </div>
      ) : null}
      {isRunning ||
      ["scheduled", "running", "error"].includes(scheduleStatus ?? "") ||
      scheduleError ? (
        <div
          className="absolute top-3 left-3 z-10 grid gap-1 rounded-md border border-white/10 bg-black/80 px-2.5 py-1.5 text-xs text-[#dedede] backdrop-blur-sm max-[640px]:top-16 max-[640px]:right-3"
          data-slot="workflow-schedule-status"
        >
          <div className="flex items-center gap-2">
            {isRunning || scheduleStatus === "running" ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
            ) : scheduleStatus === "error" || scheduleError ? (
              <AlertCircle
                className="size-3.5 text-[#ff8a8a]"
                aria-hidden="true"
              />
            ) : (
              <Check className="size-3.5 text-[#7ddf89]" aria-hidden="true" />
            )}
            <span>
              {isRunning
                ? "Workflow running..."
                : scheduleStatus === "running"
                  ? "Running now"
                  : scheduleStatus === "scheduled"
                    ? "Running"
                    : scheduleStatus === "error"
                      ? "Needs attention"
                      : "Unavailable"}
            </span>
          </div>
          {scheduleNextRunAt ? (
            <div className="text-[#9b9b9b]">
              Next run {formatScheduleTime(scheduleNextRunAt, scheduleTimezone)}
            </div>
          ) : null}
          {scheduleError ? (
            <div className="max-w-72 text-[#ffb3b3]">{scheduleError}</div>
          ) : null}
        </div>
      ) : null}
      <div className="absolute top-3 right-3 z-10 flex items-center gap-2">
        <DropdownMenu open={isAddMenuOpen} onOpenChange={setIsAddMenuOpen}>
          <DropdownMenuTrigger asChild>
            <Button
              className="h-9 gap-1.5 rounded-md border border-white/10 bg-black/80 px-3 text-white shadow-none hover:bg-input/50"
              onClick={() => setIsAddMenuOpen(true)}
              size="sm"
              type="button"
              variant="outline"
            >
              <Plus className="size-4" aria-hidden="true" />
              Add Node
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="p-1">
            <WorkflowNodePickerContent
              Item={DropdownMenuItem}
              onAddNode={addNodeAtViewportCenter}
            />
          </DropdownMenuContent>
        </DropdownMenu>
        <WorkflowRunControl
          isDisabled={!["ready", "stoppable"].includes(runControlState)}
          label={runControlLabel}
          onRun={onRun}
          state={runControlState}
        />
        <CanvasControls />
      </div>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div className="h-full min-h-0 w-full">
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
              onNodeContextMenu={(event) => {
                event.preventDefault();
                event.stopPropagation();
              }}
              onNodesChange={handleNodesChange}
              onPaneClick={() => setSelectedElement(null)}
              onPaneContextMenu={(event) => {
                contextMenuPositionRef.current = screenToFlowPosition({
                  x: event.clientX,
                  y: event.clientY,
                });
              }}
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
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent className="min-w-44">
          <WorkflowCanvasContextAddMenu
            onAddNode={addNodeAtContextMenuPosition}
          />
        </ContextMenuContent>
      </ContextMenu>
      <WorkflowAutoSaveStatusPill
        error={autoSaveError}
        status={autoSaveStatus}
      />
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
      className="min-h-0 flex-1 max-[860px]:!grid max-[860px]:!grid-cols-1 max-[860px]:!grid-rows-[minmax(420px,1fr)_auto]"
      defaultLayout={workflowLayout}
      groupRef={workflowLayoutGroupRef}
      id="flowent-workflow-layout"
      onLayoutChanged={saveWorkflowLayout}
      orientation="horizontal"
      resizeTargetMinimumSize={{ coarse: 32, fine: 8 }}
    >
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
    return {
      [workflowLayoutPanelIds.canvas]: parsed[workflowLayoutPanelIds.canvas],
      [workflowLayoutPanelIds.properties]:
        parsed[workflowLayoutPanelIds.properties],
    } satisfies Layout;
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
  const record = layout as Record<string, unknown>;
  return Object.values(workflowLayoutPanelIds).every((panelId) => {
    const value = record[panelId];
    return typeof value === "number" && Number.isFinite(value) && value > 0;
  });
}
