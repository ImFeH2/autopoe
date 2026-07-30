import { useCallback, useEffect } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  ReactFlow,
  addEdge,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  useEdgesState,
  useNodesState,
} from "@xyflow/react";
import {
  WorkflowNodeCard,
  type WorkflowFlowNode,
} from "@/features/workflows/WorkflowNodeCard";
import type { WorkflowNode } from "@/types/workflow";

interface WorkflowCanvasProps {
  definitions: WorkflowNode[];
  selectedNodeId: string | null;
  onChange: (nodes: WorkflowNode[]) => void;
  onOpenLoop: (nodeId: string) => void;
  onSelectNode: (nodeId: string | null) => void;
}

const nodeTypes = { workflowNode: WorkflowNodeCard };

function toFlowNode(node: WorkflowNode): WorkflowFlowNode {
  return {
    id: node.id,
    type: "workflowNode",
    position: node.position,
    selected: false,
    data: {
      label: node.name,
      kind: node.type,
      dependencies: node.depends_on.length,
      agentName: node.type === "agent" ? node.agent.name : undefined,
      model: node.type === "agent" ? node.agent.model.model : undefined,
      maxIterations: node.type === "loop" ? node.max_iterations : undefined,
    },
  };
}

function toEdges(nodes: WorkflowNode[]): Edge[] {
  return nodes.flatMap((node) =>
    node.depends_on.map((dependency) => ({
      id: `${dependency}:${node.id}`,
      source: dependency,
      target: node.id,
      type: "smoothstep",
    })),
  );
}

export function WorkflowCanvas({
  definitions,
  selectedNodeId,
  onChange,
  onOpenLoop,
  onSelectNode,
}: WorkflowCanvasProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState<WorkflowFlowNode>(
    definitions.map(toFlowNode),
  );
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(
    toEdges(definitions),
  );

  useEffect(() => {
    setNodes((current) => {
      const currentById = new Map(current.map((node) => [node.id, node]));
      return definitions.map((definition) => ({
        ...currentById.get(definition.id),
        ...toFlowNode(definition),
        selected: definition.id === selectedNodeId,
      }));
    });
  }, [definitions, selectedNodeId, setNodes]);

  useEffect(() => {
    setEdges((current) => {
      const currentById = new Map(current.map((edge) => [edge.id, edge]));
      return toEdges(definitions).map((edge) => ({
        ...currentById.get(edge.id),
        ...edge,
      }));
    });
  }, [definitions, setEdges]);

  const handleNodeDragStop = useCallback(
    (_: unknown, draggedNode: Node) => {
      onChange(
        definitions.map((node) =>
          node.id === draggedNode.id
            ? { ...node, position: draggedNode.position }
            : node,
        ),
      );
    },
    [definitions, onChange],
  );

  const handleEdgesChange = useCallback(
    (changes: EdgeChange<Edge>[]) => {
      onEdgesChange(changes);
      const removedIds = new Set(
        changes
          .filter((change) => change.type === "remove")
          .map((change) => change.id),
      );
      if (removedIds.size === 0) {
        return;
      }
      onChange(
        definitions.map((node) => ({
          ...node,
          depends_on: node.depends_on.filter(
            (dependency) => !removedIds.has(`${dependency}:${node.id}`),
          ),
        })),
      );
    },
    [definitions, onChange, onEdgesChange],
  );

  const handleConnect = useCallback(
    (connection: Connection) => {
      if (
        !connection.source ||
        !connection.target ||
        connection.source === connection.target
      ) {
        return;
      }
      setEdges((current) =>
        addEdge({ ...connection, type: "smoothstep" }, current),
      );
      onChange(
        definitions.map((node) => ({
          ...node,
          depends_on:
            node.id === connection.target &&
            !node.depends_on.includes(connection.source)
              ? [...node.depends_on, connection.source]
              : node.depends_on,
        })),
      );
    },
    [definitions, onChange, setEdges],
  );

  const handleNodesDelete = useCallback(
    (deletedNodes: Node[]) => {
      const deletedIds = new Set(deletedNodes.map((node) => node.id));
      onChange(
        definitions
          .filter((node) => !deletedIds.has(node.id))
          .map((node) => ({
            ...node,
            depends_on: node.depends_on.filter((id) => !deletedIds.has(id)),
          })),
      );
      onSelectNode(null);
    },
    [definitions, onChange, onSelectNode],
  );

  return (
    <div className="workflow-canvas" aria-label="Workflow canvas">
      <ReactFlow
        colorMode="dark"
        deleteKeyCode={["Backspace", "Delete"]}
        edges={edges}
        fitView
        fitViewOptions={{ maxZoom: 1, minZoom: 0.72, padding: 0.1 }}
        maxZoom={1.6}
        minZoom={0.35}
        nodeTypes={nodeTypes}
        nodes={nodes}
        onConnect={handleConnect}
        onEdgesChange={handleEdgesChange}
        onNodeDragStop={handleNodeDragStop}
        onNodeClick={(_, node) => onSelectNode(node.id)}
        onNodeDoubleClick={(_, node) => onOpenLoop(node.id)}
        onNodesChange={onNodesChange}
        onNodesDelete={handleNodesDelete}
        onPaneClick={() => onSelectNode(null)}
        proOptions={{ hideAttribution: true }}
        snapGrid={[16, 16]}
        snapToGrid
      >
        <Background
          color="rgba(255,255,255,0.09)"
          gap={24}
          size={1}
          variant={BackgroundVariant.Dots}
        />
        <Controls orientation="horizontal" position="bottom-left" />
      </ReactFlow>
    </div>
  );
}
