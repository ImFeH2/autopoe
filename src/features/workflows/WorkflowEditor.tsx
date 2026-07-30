import { useEffect, useMemo, useState } from "react";
import { Button, DropdownMenu, TextField, Tooltip } from "@radix-ui/themes";
import {
  Bot,
  Check,
  ChevronDown,
  ChevronRight,
  CornerUpLeft,
  GitBranch,
  Play,
  Plus,
  Repeat2,
  Save,
  ShieldCheck,
} from "lucide-react";
import { createAgent } from "@/data/defaultWorkflow";
import { NodeInspector } from "@/features/workflows/NodeInspector";
import { WorkflowCanvas } from "@/features/workflows/WorkflowCanvas";
import type {
  WorkflowDefinition,
  WorkflowNode,
  WorkflowNodeKind,
} from "@/types/workflow";
import type { WorkflowSummary } from "@/types/runtime";

interface WorkflowEditorProps {
  workflow: WorkflowDefinition;
  workflowOptions: WorkflowSummary[];
  onChange: (workflow: WorkflowDefinition) => void;
  onNewWorkflow: () => Promise<void>;
  onRun: () => void;
  onSave: () => Promise<void>;
  onSelectWorkflow: (workflowId: string) => Promise<void>;
}

function createNode(kind: WorkflowNodeKind, index: number): WorkflowNode {
  const id = `${kind}-${Date.now().toString(36)}-${index}`;
  const position = { x: 160 + index * 36, y: 140 + index * 28 };
  if (kind === "loop") {
    return {
      id,
      type: "loop",
      name: "New loop",
      depends_on: [],
      position,
      nodes: [
        {
          id: "step",
          type: "agent",
          name: "Loop step",
          depends_on: [],
          position: { x: 0, y: 0 },
          agent: createAgent("loop-agent", "Loop agent", "Complete the loop step."),
          prompt: "Complete iteration {{ iteration }}.",
          output_mode: "text",
          max_attempts: 1,
        },
      ],
      max_iterations: 3,
      on_exhausted: "fail",
    };
  }
  if (kind === "approval") {
    return {
      id,
      type: "approval",
      name: "New gate",
      depends_on: [],
      position,
      prompt: "Approve this step?",
      reject_behavior: "fail",
    };
  }
  return {
    id,
    type: "agent",
    name: "New agent",
    depends_on: [],
    position,
    agent: createAgent(id, "Agent", "Complete the assigned step."),
    prompt: "Complete the assigned step.",
    output_mode: "text",
    max_attempts: 1,
  };
}

function nodesAtPath(nodes: WorkflowNode[], path: string[]): WorkflowNode[] {
  let current = nodes;
  for (const nodeId of path) {
    const node = current.find((candidate) => candidate.id === nodeId);
    if (!node || node.type !== "loop") {
      return [];
    }
    current = node.nodes;
  }
  return current;
}

function replaceNodesAtPath(
  nodes: WorkflowNode[],
  path: string[],
  replacement: WorkflowNode[],
): WorkflowNode[] {
  const [nodeId, ...rest] = path;
  if (!nodeId) {
    return replacement;
  }
  return nodes.map((node) =>
    node.id === nodeId && node.type === "loop"
      ? {
          ...node,
          nodes: replaceNodesAtPath(node.nodes, rest, replacement),
        }
      : node,
  );
}

function loopPathLabels(nodes: WorkflowNode[], path: string[]) {
  const labels: Array<{ id: string; name: string }> = [];
  let current = nodes;
  for (const nodeId of path) {
    const node = current.find((candidate) => candidate.id === nodeId);
    if (!node || node.type !== "loop") {
      break;
    }
    labels.push({ id: node.id, name: node.name });
    current = node.nodes;
  }
  return labels;
}

export function WorkflowEditor({
  workflow,
  workflowOptions,
  onChange,
  onNewWorkflow,
  onRun,
  onSave,
  onSelectWorkflow,
}: WorkflowEditorProps) {
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(
    workflow.nodes[0]?.id ?? null,
  );
  const [activeLoopPath, setActiveLoopPath] = useState<string[]>([]);
  const [saved, setSaved] = useState(true);
  const visibleNodes = useMemo(
    () => nodesAtPath(workflow.nodes, activeLoopPath),
    [activeLoopPath, workflow.nodes],
  );
  const pathLabels = useMemo(
    () => loopPathLabels(workflow.nodes, activeLoopPath),
    [activeLoopPath, workflow.nodes],
  );
  const selectedNode = useMemo(
    () =>
      visibleNodes.find((node) => node.id === selectedNodeId) ?? null,
    [selectedNodeId, visibleNodes],
  );

  useEffect(() => {
    setActiveLoopPath([]);
    setSelectedNodeId(workflow.nodes[0]?.id ?? null);
    setSaved(true);
  }, [workflow.id]);

  function updateWorkflow(next: WorkflowDefinition) {
    setSaved(false);
    onChange(next);
  }

  function updateNode(nextNode: WorkflowNode) {
    updateVisibleNodes(
      visibleNodes.map((node) =>
        node.id === nextNode.id ? nextNode : node,
      ),
    );
  }

  function updateVisibleNodes(nodes: WorkflowNode[]) {
    updateWorkflow({
      ...workflow,
      nodes: replaceNodesAtPath(workflow.nodes, activeLoopPath, nodes),
    });
  }

  function addNode(kind: WorkflowNodeKind) {
    const node = createNode(kind, visibleNodes.length);
    updateVisibleNodes([...visibleNodes, node]);
    setSelectedNodeId(node.id);
  }

  function deleteNode(nodeId: string) {
    updateVisibleNodes(
      visibleNodes
        .filter((node) => node.id !== nodeId)
        .map((node) => ({
          ...node,
          depends_on: node.depends_on.filter((id) => id !== nodeId),
        })),
    );
    setSelectedNodeId(null);
  }

  function openLoop(nodeId: string) {
    const node = visibleNodes.find((candidate) => candidate.id === nodeId);
    if (!node || node.type !== "loop") {
      return;
    }
    setActiveLoopPath((current) => [...current, node.id]);
    setSelectedNodeId(node.nodes[0]?.id ?? null);
  }

  function navigateTo(depth: number) {
    const path = activeLoopPath.slice(0, depth);
    const nodes = nodesAtPath(workflow.nodes, path);
    setActiveLoopPath(path);
    setSelectedNodeId(nodes[0]?.id ?? null);
  }

  async function saveWorkflow() {
    try {
      await onSave();
      setSaved(true);
    } catch {
      setSaved(false);
    }
  }

  return (
    <section className="workflow-editor">
      <div className="workflow-toolbar">
        <div className="workflow-identity">
          {activeLoopPath.length > 0 ? (
            <Button
              aria-label="Back"
              className="workflow-back-button"
              color="gray"
              onClick={() => navigateTo(activeLoopPath.length - 1)}
              variant="ghost"
            >
              <CornerUpLeft size={14} strokeWidth={1.8} />
            </Button>
          ) : (
            <DropdownMenu.Root>
              <DropdownMenu.Trigger>
                <Button
                  aria-label="Select workflow"
                  className="workflow-selector-button"
                  color="gray"
                  variant="ghost"
                >
                  <GitBranch size={15} strokeWidth={1.7} />
                  <ChevronDown size={12} strokeWidth={1.8} />
                </Button>
              </DropdownMenu.Trigger>
              <DropdownMenu.Content align="start">
                {workflowOptions.map((option) => (
                  <DropdownMenu.Item
                    key={option.id}
                    onSelect={() => void onSelectWorkflow(option.id)}
                  >
                    {option.id === workflow.id ? (
                      <Check size={13} strokeWidth={1.8} />
                    ) : (
                      <GitBranch size={13} strokeWidth={1.7} />
                    )}
                    {option.name}
                  </DropdownMenu.Item>
                ))}
                <DropdownMenu.Separator />
                <DropdownMenu.Item onSelect={() => void onNewWorkflow()}>
                  <Plus size={13} strokeWidth={1.8} />
                  New
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Root>
          )}
          {activeLoopPath.length === 0 ? (
            <TextField.Root
              aria-label="Workflow name"
              className="workflow-name-field"
              onChange={(event) =>
                updateWorkflow({ ...workflow, name: event.target.value })
              }
              value={workflow.name}
              variant="soft"
            />
          ) : (
            <div className="workflow-breadcrumbs">
              <Button
                color="gray"
                onClick={() => navigateTo(0)}
                variant="ghost"
              >
                {workflow.name}
              </Button>
              {pathLabels.map((item, index) => (
                <span key={item.id}>
                  <ChevronRight size={12} strokeWidth={1.7} />
                  <Button
                    color="gray"
                    onClick={() => navigateTo(index + 1)}
                    variant="ghost"
                  >
                    {item.name}
                  </Button>
                </span>
              ))}
            </div>
          )}
          <span className="node-count">{visibleNodes.length} nodes</span>
        </div>

        <div className="toolbar-actions">
          <DropdownMenu.Root>
            <DropdownMenu.Trigger>
              <Button className="secondary-button" color="gray" variant="soft">
                <Plus size={14} strokeWidth={1.8} />
                Add
                <ChevronDown size={13} strokeWidth={1.8} />
              </Button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Content align="end">
              <DropdownMenu.Item onSelect={() => addNode("agent")}>
                <Bot size={14} /> Agent
              </DropdownMenu.Item>
              <DropdownMenu.Item onSelect={() => addNode("loop")}>
                <Repeat2 size={14} /> Loop
              </DropdownMenu.Item>
              <DropdownMenu.Item onSelect={() => addNode("approval")}>
                <ShieldCheck size={14} /> Approval
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Root>

          <Tooltip content={saved ? "Saved" : "Save workflow"}>
            <Button
              className="secondary-button"
              color="gray"
              onClick={() => void saveWorkflow()}
              variant="soft"
            >
              {saved ? (
                <Check size={14} strokeWidth={1.8} />
              ) : (
                <Save size={14} strokeWidth={1.8} />
              )}
              {saved ? "Saved" : "Save"}
            </Button>
          </Tooltip>

          <Button className="primary-button" onClick={onRun}>
            <Play fill="currentColor" size={13} strokeWidth={1.8} />
            Run
          </Button>
        </div>
      </div>

      <div className="workflow-workbench">
        <WorkflowCanvas
          definitions={visibleNodes}
          key={activeLoopPath.join("/") || "root"}
          onChange={updateVisibleNodes}
          onOpenLoop={openLoop}
          onSelectNode={setSelectedNodeId}
          selectedNodeId={selectedNodeId}
        />
        <NodeInspector
          node={selectedNode}
          onChange={updateNode}
          onDelete={deleteNode}
          onOpenLoop={openLoop}
        />
      </div>
    </section>
  );
}
