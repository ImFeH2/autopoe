import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  Bot,
  CheckCircle,
  ClipboardList,
  Clock,
  GitMerge,
  Loader2,
  Maximize,
  Play,
  Redo,
  Save,
  Search,
  Square,
  Trash2,
  Undo,
  X,
  XCircle,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import {
  Background,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  ReactFlowProvider,
  addEdge,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type Edge,
  type Node,
  type NodeProps,
  type OnConnect,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  emptyStateClassName,
  fieldGroupClassName,
  fieldInputClassName,
  fieldLabelClassName,
  fieldTriggerClassName,
  sectionTitleClassName,
  subtleButtonClassName,
} from "@/components/flowent/styles";
import { useFlowentToast } from "@/components/flowent/toast-context";
import type {
  Workflow,
  WorkflowDefinition,
  WorkflowEdge,
  WorkflowNode,
  WorkflowNodeRunResult,
  WorkflowNodeType,
  WorkflowRunResult,
} from "@/components/flowent/types";
import { cn, createClientId } from "@/lib/utils";

type WorkflowCanvasNodeData = {
  description: string;
  label: string;
  result?: WorkflowNodeRunResult;
  workflowType: WorkflowNodeType;
};

type WorkflowCanvasNode = Node<WorkflowCanvasNodeData, "workflowNode">;
type WorkflowCanvasEdge = Edge<{ label: string }>;

type SelectedElement =
  | {
      id: string;
      kind: "edge";
    }
  | {
      id: string;
      kind: "node";
    };

type NodeTemplate = {
  description: string;
  icon: typeof Square;
  label: string;
  type: WorkflowNodeType;
};

const nodeTemplates: NodeTemplate[] = [
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
    description: "Final result",
    icon: ClipboardList,
    label: "Output",
    type: "output",
  },
];

const nodeIconByType = {
  agent: Bot,
  input: Square,
  merge: GitMerge,
  output: ClipboardList,
} satisfies Record<WorkflowNodeType, typeof Square>;

const defaultNodeData = (type: WorkflowNodeType): Record<string, unknown> => {
  if (type === "input") {
    return { default_value: "", input_type: "text" };
  }
  if (type === "agent") {
    return { agent: "Default agent", prompt: "{{input.output}}" };
  }
  if (type === "merge") {
    return { merge_strategy: "text" };
  }
  return { output_key: "final_result", transform: "" };
};

const defaultWorkflowDefinition = (): WorkflowDefinition => ({
  edges: [],
  nodes: [],
  version: 1,
});

const createDraftWorkflow = (): Workflow => ({
  createdAt: 0,
  definition: defaultWorkflowDefinition(),
  id: createClientId("workflow"),
  name: "Untitled Workflow",
  updatedAt: 0,
});

const cloneWorkflow = (workflow: Workflow): Workflow =>
  JSON.parse(JSON.stringify(workflow)) as Workflow;

const runResultMap = (runResult: WorkflowRunResult | null) =>
  new Map((runResult?.nodeResults ?? []).map((result) => [result.id, result]));

const workflowToFlowNodes = (
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

const workflowToFlowEdges = (workflow: Workflow): WorkflowCanvasEdge[] =>
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

const flowEdgeToWorkflowEdge = (edge: WorkflowCanvasEdge): WorkflowEdge => ({
  id: edge.id,
  label: String(edge.label ?? edge.data?.label ?? ""),
  source: edge.source,
  sourceHandle: edge.sourceHandle ?? "",
  target: edge.target,
  targetHandle: edge.targetHandle ?? "",
});

function CanvasNode({ data, selected }: NodeProps<WorkflowCanvasNode>) {
  const Icon = nodeIconByType[data.workflowType];
  const result = data.result;
  const status = result?.status ?? "pending";
  const isRunning = status === "running";
  const StatusIcon =
    status === "success"
      ? CheckCircle
      : status === "failed"
        ? XCircle
        : isRunning
          ? Loader2
          : Clock;

  return (
    <div
      className={cn(
        "min-h-[86px] w-[172px] rounded-md border bg-[#111] px-3 py-2 text-white shadow-[0_10px_28px_rgba(0,0,0,0.28)]",
        selected ? "border-[#7c82ff]" : "border-white/15",
      )}
    >
      {data.workflowType !== "input" ? (
        <Handle
          className="!size-2.5 !border-white/30 !bg-[#111]"
          id="in"
          position={Position.Left}
          type="target"
        />
      ) : null}
      <div className="flex items-start gap-2">
        <div className="grid size-7 shrink-0 place-items-center rounded-md border border-white/10 bg-input/30">
          <Icon className="size-4 text-white" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium leading-5">
            {data.label}
          </div>
          <div className="truncate text-xs leading-4 text-[#9b9b9b]">
            {data.workflowType}
          </div>
        </div>
      </div>
      <div className="mt-3 flex items-center gap-1.5 border-t border-white/10 pt-2 text-xs text-[#9b9b9b]">
        <StatusIcon
          className={cn(
            "size-3.5",
            isRunning && "animate-spin",
            status === "success" && "text-[#7ddf89]",
            status === "failed" && "text-[#ff7474]",
          )}
          aria-hidden="true"
        />
        <span className="capitalize">{status}</span>
      </div>
      {data.workflowType !== "output" ? (
        <Handle
          className="!size-2.5 !border-white/30 !bg-[#111]"
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

function WorkflowCanvas({
  draftWorkflow,
  isRunning,
  onChange,
  onDirty,
  runResult,
}: {
  draftWorkflow: Workflow;
  isRunning: boolean;
  onChange: (workflow: Workflow) => void;
  onDirty: () => void;
  runResult: WorkflowRunResult | null;
}) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const { screenToFlowPosition } = useReactFlow();
  const previousWorkflowIdRef = useRef(draftWorkflow.id);
  const [selectedElement, setSelectedElement] =
    useState<SelectedElement | null>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState<WorkflowCanvasNode>(
    workflowToFlowNodes(draftWorkflow, runResult),
  );
  const [edges, setEdges, onEdgesChange] = useEdgesState<WorkflowCanvasEdge>(
    workflowToFlowEdges(draftWorkflow),
  );
  const [nodeSearch, setNodeSearch] = useState("");

  useEffect(() => {
    setNodes(workflowToFlowNodes(draftWorkflow, runResult));
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
            return {
              data: currentNode?.data ?? {},
              description: currentNode?.description ?? "",
              id: node.id,
              name: currentNode?.name ?? node.data.label,
              position: node.position,
              type: currentNode?.type ?? node.data.workflowType,
            };
          }),
        },
      };
      onChange(nextWorkflow);
      onDirty();
    },
    [draftWorkflow, onChange, onDirty],
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
        commitGraph(nodes, nextEdges);
        return nextEdges;
      });
    },
    [commitGraph, nodes, setEdges],
  );

  const addNode = useCallback(
    (type: WorkflowNodeType, position = { x: 120, y: 120 }) => {
      const template = nodeTemplates.find((item) => item.type === type);
      if (!template) {
        return;
      }
      const nodeId = createClientId(type);
      const nextWorkflowNode: WorkflowNode = {
        data: defaultNodeData(type),
        description: "",
        id: nodeId,
        name: template.label,
        position,
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
      onDirty();
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
    [draftWorkflow, onChange, onDirty, runResult, setNodes],
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
    onDirty();
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
    onDirty();
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

  const filteredTemplates = nodeTemplates.filter((template) =>
    template.label.toLowerCase().includes(nodeSearch.trim().toLowerCase()),
  );

  return (
    <div className="grid min-h-0 flex-1 grid-cols-[200px_minmax(0,1fr)_300px] max-[1100px]:grid-cols-[180px_minmax(0,1fr)_280px] max-[860px]:grid-cols-1 max-[860px]:grid-rows-[auto_minmax(420px,1fr)_auto]">
      <aside className="min-h-0 border-r border-white/10 bg-black p-3 max-[860px]:border-r-0 max-[860px]:border-b">
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

      <section
        className="relative min-h-0 min-w-0 bg-black"
        onDragOver={(event) => {
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
        }}
        onDrop={(event) => {
          event.preventDefault();
          const type = event.dataTransfer.getData(
            "application/flowent-node",
          ) as WorkflowNodeType;
          if (!nodeTemplates.some((template) => template.type === type)) {
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
          onEdgesChange={(changes) => {
            onEdgesChange(changes);
            if (changes.some((change) => change.type !== "select")) {
              window.requestAnimationFrame(() => {
                setEdges((currentEdges) => {
                  commitGraph(nodes, currentEdges);
                  return currentEdges;
                });
              });
            }
          }}
          onEdgeClick={(_, edge) => {
            setSelectedElement({ id: edge.id, kind: "edge" });
          }}
          onNodeClick={(_, node) => {
            setSelectedElement({ id: node.id, kind: "node" });
          }}
          onNodesChange={(changes) => {
            onNodesChange(changes);
            if (
              changes.some(
                (change) =>
                  change.type !== "select" && change.type !== "dimensions",
              )
            ) {
              window.requestAnimationFrame(() => {
                setNodes((currentNodes) => {
                  commitGraph(currentNodes, edges);
                  return currentNodes;
                });
              });
            }
          }}
          onPaneClick={() => setSelectedElement(null)}
          proOptions={{ hideAttribution: true }}
        >
          <Background color="rgba(255,255,255,0.08)" gap={18} />
        </ReactFlow>
      </section>

      <aside className="min-h-0 overflow-y-auto border-l border-white/10 bg-black p-3 max-[860px]:border-l-0 max-[860px]:border-t">
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
          <NodeProperties
            node={selectedNode}
            onNodeChange={(updates) => updateNode(selectedNode.id, updates)}
            onNodeDataChange={(key, value) =>
              updateNodeData(selectedNode.id, key, value)
            }
          />
        ) : null}

        {selectedEdge ? (
          <EdgeProperties
            edge={selectedEdge}
            onEdgeChange={(updates) => updateEdge(selectedEdge.id, updates)}
          />
        ) : null}
      </aside>
    </div>
  );
}

function NodeProperties({
  node,
  onNodeChange,
  onNodeDataChange,
}: {
  node: WorkflowNode;
  onNodeChange: (updates: Partial<WorkflowNode>) => void;
  onNodeDataChange: (key: string, value: string) => void;
}) {
  return (
    <div className="mt-3 grid gap-3">
      <div className="text-sm font-medium text-white">
        {node.name} Properties
      </div>
      <div className={fieldGroupClassName}>
        <Label className={fieldLabelClassName} htmlFor={`${node.id}-name`}>
          Name
        </Label>
        <Input
          className={fieldInputClassName}
          id={`${node.id}-name`}
          onChange={(event) => onNodeChange({ name: event.target.value })}
          value={node.name}
        />
      </div>
      <div className={fieldGroupClassName}>
        <Label
          className={fieldLabelClassName}
          htmlFor={`${node.id}-description`}
        >
          Description
        </Label>
        <Textarea
          className="min-h-20 rounded-md border-white/10 bg-input/30 text-base text-white shadow-none placeholder:text-[#777] focus-visible:border-[#7a7a7a] focus-visible:ring-2 focus-visible:ring-ring/25"
          id={`${node.id}-description`}
          onChange={(event) =>
            onNodeChange({ description: event.target.value })
          }
          value={node.description}
        />
      </div>
      {node.type === "input" ? (
        <>
          <div className={fieldGroupClassName}>
            <Label className={fieldLabelClassName}>Type</Label>
            <Select
              onValueChange={(value) => onNodeDataChange("input_type", value)}
              value={String(node.data.input_type ?? "text")}
            >
              <SelectTrigger className={fieldTriggerClassName}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="text">Text</SelectItem>
                <SelectItem value="json">JSON</SelectItem>
                <SelectItem value="file">File</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className={fieldGroupClassName}>
            <Label
              className={fieldLabelClassName}
              htmlFor={`${node.id}-default-value`}
            >
              Default Value
            </Label>
            <Textarea
              className="min-h-24 rounded-md border-white/10 bg-input/30 text-base text-white shadow-none placeholder:text-[#777] focus-visible:border-[#7a7a7a] focus-visible:ring-2 focus-visible:ring-ring/25"
              id={`${node.id}-default-value`}
              onChange={(event) =>
                onNodeDataChange("default_value", event.target.value)
              }
              value={String(node.data.default_value ?? "")}
            />
          </div>
        </>
      ) : null}
      {node.type === "agent" ? (
        <>
          <div className={fieldGroupClassName}>
            <Label className={fieldLabelClassName}>Agent</Label>
            <Select
              onValueChange={(value) => onNodeDataChange("agent", value)}
              value={String(node.data.agent ?? "Default agent")}
            >
              <SelectTrigger className={fieldTriggerClassName}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Default agent">Default agent</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className={fieldGroupClassName}>
            <Label
              className={fieldLabelClassName}
              htmlFor={`${node.id}-prompt`}
            >
              Prompt
            </Label>
            <Textarea
              className="min-h-32 rounded-md border-white/10 bg-input/30 text-base text-white shadow-none placeholder:text-[#777] focus-visible:border-[#7a7a7a] focus-visible:ring-2 focus-visible:ring-ring/25"
              id={`${node.id}-prompt`}
              onChange={(event) =>
                onNodeDataChange("prompt", event.target.value)
              }
              value={String(node.data.prompt ?? "")}
            />
          </div>
          <div className={fieldGroupClassName}>
            <Label className={fieldLabelClassName}>Parameters</Label>
            <p className={emptyStateClassName}>No parameters set.</p>
          </div>
        </>
      ) : null}
      {node.type === "merge" ? (
        <div className={fieldGroupClassName}>
          <Label className={fieldLabelClassName}>Merge Strategy</Label>
          <Select
            onValueChange={(value) => onNodeDataChange("merge_strategy", value)}
            value={String(node.data.merge_strategy ?? "text")}
          >
            <SelectTrigger className={fieldTriggerClassName}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="text">Concatenate Text</SelectItem>
              <SelectItem value="json">JSON Merge</SelectItem>
            </SelectContent>
          </Select>
        </div>
      ) : null}
      {node.type === "output" ? (
        <>
          <div className={fieldGroupClassName}>
            <Label
              className={fieldLabelClassName}
              htmlFor={`${node.id}-output-key`}
            >
              Output Key
            </Label>
            <Input
              className={fieldInputClassName}
              id={`${node.id}-output-key`}
              onChange={(event) =>
                onNodeDataChange("output_key", event.target.value)
              }
              value={String(node.data.output_key ?? "")}
            />
          </div>
          <div className={fieldGroupClassName}>
            <Label
              className={fieldLabelClassName}
              htmlFor={`${node.id}-transform`}
            >
              Transform
            </Label>
            <Textarea
              className="min-h-24 rounded-md border-white/10 bg-input/30 text-base text-white shadow-none placeholder:text-[#777] focus-visible:border-[#7a7a7a] focus-visible:ring-2 focus-visible:ring-ring/25"
              id={`${node.id}-transform`}
              onChange={(event) =>
                onNodeDataChange("transform", event.target.value)
              }
              value={String(node.data.transform ?? "")}
            />
          </div>
        </>
      ) : null}
    </div>
  );
}

function EdgeProperties({
  edge,
  onEdgeChange,
}: {
  edge: WorkflowEdge;
  onEdgeChange: (updates: Partial<WorkflowEdge>) => void;
}) {
  return (
    <div className="mt-3 grid gap-3">
      <div className="text-sm font-medium text-white">Edge Properties</div>
      <div className={fieldGroupClassName}>
        <Label className={fieldLabelClassName} htmlFor={`${edge.id}-label`}>
          Label
        </Label>
        <Input
          className={fieldInputClassName}
          id={`${edge.id}-label`}
          onChange={(event) => onEdgeChange({ label: event.target.value })}
          value={edge.label}
        />
      </div>
    </div>
  );
}

function WorkflowEditorView({
  draftWorkflow,
  isDirty,
  isRunning,
  onClose,
  onDelete,
  onDraftChange,
  onMarkDirty,
  onRun,
  onSave,
  runResult,
}: {
  draftWorkflow: Workflow;
  isDirty: boolean;
  isRunning: boolean;
  onClose: () => void;
  onDelete: () => void;
  onDraftChange: (workflow: Workflow) => void;
  onMarkDirty: () => void;
  onRun: () => void;
  onSave: () => void;
  runResult: WorkflowRunResult | null;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col bg-black">
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-white/10 bg-black px-3">
        <Input
          aria-label="Workflow name"
          className={cn(fieldInputClassName, "max-w-[360px]")}
          onChange={(event) => {
            onDraftChange({ ...draftWorkflow, name: event.target.value });
            onMarkDirty();
          }}
          value={draftWorkflow.name}
        />
        {isDirty ? (
          <span className="text-xs text-[#9b9b9b]">Unsaved</span>
        ) : null}
        <div className="ml-auto flex items-center gap-1.5">
          <Button
            className={cn(subtleButtonClassName, "gap-1.5 px-2.5")}
            disabled
            size="sm"
            type="button"
            variant="outline"
          >
            <Undo className="size-4" aria-hidden="true" />
            Undo
          </Button>
          <Button
            className={cn(subtleButtonClassName, "gap-1.5 px-2.5")}
            disabled
            size="sm"
            type="button"
            variant="outline"
          >
            <Redo className="size-4" aria-hidden="true" />
            Redo
          </Button>
          <Button
            className={cn(subtleButtonClassName, "gap-1.5 px-2.5")}
            onClick={onSave}
            size="sm"
            type="button"
            variant="outline"
          >
            <Save className="size-4" aria-hidden="true" />
            Save
          </Button>
          <Button
            className="h-8 gap-1.5 px-2.5"
            disabled={isRunning}
            onClick={onRun}
            size="sm"
            type="button"
          >
            {isRunning ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <Play className="size-4" aria-hidden="true" />
            )}
            Run
          </Button>
          <Button
            aria-label="Delete workflow"
            className="size-8 p-0 text-[#ff8a8a]"
            onClick={onDelete}
            size="icon"
            type="button"
            variant="ghost"
          >
            <Trash2 className="size-4" aria-hidden="true" />
          </Button>
          <Button
            aria-label="Close editor"
            className="size-8 p-0"
            onClick={onClose}
            size="icon"
            type="button"
            variant="ghost"
          >
            <X className="size-4" aria-hidden="true" />
          </Button>
        </div>
      </div>
      {runResult?.outputs ? (
        <div className="flex min-h-9 shrink-0 items-center gap-2 border-b border-white/10 px-3 text-xs text-[#dedede]">
          <ArrowRight className="size-4 text-[#7ddf89]" aria-hidden="true" />
          <span className="truncate">
            {Object.values(runResult.outputs)[0] || "Run completed."}
          </span>
        </div>
      ) : null}
      <ReactFlowProvider>
        <WorkflowCanvas
          draftWorkflow={draftWorkflow}
          isRunning={isRunning}
          onChange={onDraftChange}
          onDirty={onMarkDirty}
          runResult={runResult}
        />
      </ReactFlowProvider>
    </div>
  );
}

export function WorkflowsView({
  activeWorkflow,
  isRunningWorkflow,
  newWorkflowKey,
  onCloseEditor,
  onDeleteWorkflow,
  onRunWorkflow,
  onSaveWorkflow,
  runningWorkflowId,
  workflowRunResult,
}: {
  activeWorkflow: Workflow | null;
  isRunningWorkflow: boolean;
  newWorkflowKey: number;
  onCloseEditor: () => void;
  onDeleteWorkflow: (workflowId: string) => Promise<boolean>;
  onRunWorkflow: (workflowId: string) => Promise<{
    data: WorkflowRunResult | null;
    error: string;
  }>;
  onSaveWorkflow: (workflow: Workflow) => Promise<{
    data: Workflow | null;
    error: string;
  }>;
  runningWorkflowId: string;
  workflowRunResult: WorkflowRunResult | null;
}) {
  const [draftWorkflow, setDraftWorkflow] = useState<Workflow>(() =>
    activeWorkflow ? cloneWorkflow(activeWorkflow) : createDraftWorkflow(),
  );
  const [isDirty, setIsDirty] = useState(!activeWorkflow);
  const toast = useFlowentToast();
  const editorKeyRef = useRef({
    newWorkflowKey,
    workflowId: activeWorkflow?.id ?? "",
  });

  useEffect(() => {
    const nextWorkflowId = activeWorkflow?.id ?? "";
    if (
      editorKeyRef.current.workflowId === nextWorkflowId &&
      editorKeyRef.current.newWorkflowKey === newWorkflowKey
    ) {
      return;
    }
    editorKeyRef.current = {
      newWorkflowKey,
      workflowId: nextWorkflowId,
    };
    setDraftWorkflow(
      activeWorkflow ? cloneWorkflow(activeWorkflow) : createDraftWorkflow(),
    );
    setIsDirty(!activeWorkflow);
  }, [activeWorkflow, newWorkflowKey]);

  const activeRunResult =
    workflowRunResult?.workflowId === draftWorkflow.id
      ? workflowRunResult
      : null;
  const isRunning = runningWorkflowId === draftWorkflow.id && isRunningWorkflow;

  const closeEditor = () => {
    if (isDirty && !window.confirm("Unsaved changes will be lost. Continue?")) {
      return;
    }
    onCloseEditor();
  };

  const saveDraft = async () => {
    const result = await onSaveWorkflow(draftWorkflow);
    if (!result.data) {
      toast.error(result.error);
      return null;
    }
    setDraftWorkflow(result.data);
    setIsDirty(false);
    return result.data;
  };

  const runDraft = async () => {
    const savedWorkflow = await saveDraft();
    if (!savedWorkflow) {
      return;
    }
    const result = await onRunWorkflow(savedWorkflow.id);
    if (!result.data) {
      toast.error(result.error);
    }
  };

  const deleteDraft = async () => {
    const deleted = await onDeleteWorkflow(draftWorkflow.id);
    if (deleted) {
      onCloseEditor();
    }
  };

  return (
    <WorkflowEditorView
      draftWorkflow={draftWorkflow}
      isDirty={isDirty}
      isRunning={isRunning}
      onClose={closeEditor}
      onDelete={() => {
        void deleteDraft();
      }}
      onDraftChange={setDraftWorkflow}
      onMarkDirty={() => setIsDirty(true)}
      onRun={() => {
        void runDraft();
      }}
      onSave={() => {
        void saveDraft();
      }}
      runResult={activeRunResult}
    />
  );
}
