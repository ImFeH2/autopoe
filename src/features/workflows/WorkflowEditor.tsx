import { useMemo, useState } from "react";
import { Button, DropdownMenu, TextField, Tooltip } from "@radix-ui/themes";
import {
  Bot,
  Check,
  ChevronDown,
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

interface WorkflowEditorProps {
  workflow: WorkflowDefinition;
  onChange: (workflow: WorkflowDefinition) => void;
  onRun: () => void;
  onSave: () => Promise<void>;
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

export function WorkflowEditor({
  workflow,
  onChange,
  onRun,
  onSave,
}: WorkflowEditorProps) {
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(
    workflow.nodes[0]?.id ?? null,
  );
  const [saved, setSaved] = useState(true);
  const selectedNode = useMemo(
    () =>
      workflow.nodes.find((node) => node.id === selectedNodeId) ?? null,
    [selectedNodeId, workflow.nodes],
  );

  function updateWorkflow(next: WorkflowDefinition) {
    setSaved(false);
    onChange(next);
  }

  function updateNode(nextNode: WorkflowNode) {
    updateWorkflow({
      ...workflow,
      nodes: workflow.nodes.map((node) =>
        node.id === nextNode.id ? nextNode : node,
      ),
    });
  }

  function addNode(kind: WorkflowNodeKind) {
    const node = createNode(kind, workflow.nodes.length);
    updateWorkflow({ ...workflow, nodes: [...workflow.nodes, node] });
    setSelectedNodeId(node.id);
  }

  function deleteNode(nodeId: string) {
    updateWorkflow({
      ...workflow,
      nodes: workflow.nodes
        .filter((node) => node.id !== nodeId)
        .map((node) => ({
          ...node,
          depends_on: node.depends_on.filter((id) => id !== nodeId),
        })),
    });
    setSelectedNodeId(null);
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
          <GitBranch size={15} strokeWidth={1.7} />
          <TextField.Root
            aria-label="Workflow name"
            className="workflow-name-field"
            onChange={(event) =>
              updateWorkflow({ ...workflow, name: event.target.value })
            }
            value={workflow.name}
            variant="soft"
          />
          <span className="node-count">{workflow.nodes.length} nodes</span>
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
          onChange={updateWorkflow}
          onSelectNode={setSelectedNodeId}
          selectedNodeId={selectedNodeId}
          workflow={workflow}
        />
        <NodeInspector
          node={selectedNode}
          onChange={updateNode}
          onDelete={deleteNode}
        />
      </div>
    </section>
  );
}
