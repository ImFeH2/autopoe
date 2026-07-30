import { useMemo, useState } from "react";
import {
  Button,
  ScrollArea,
  TextArea,
  TextField,
} from "@radix-ui/themes";
import { Bot, Plus, Search, Wrench } from "lucide-react";
import { ModelConfigurationFields } from "@/components/ModelConfigurationFields";
import { createAgent } from "@/data/defaultWorkflow";
import type {
  AgentConfiguration,
  AgentWorkflowNode,
  WorkflowDefinition,
  WorkflowNode,
} from "@/types/workflow";

interface AgentEntry {
  path: string[];
  node: AgentWorkflowNode;
}

interface AgentsViewProps {
  workflow: WorkflowDefinition;
  onChange: (workflow: WorkflowDefinition) => void;
}

const underscorePattern = /_/g;

function collectAgents(nodes: WorkflowNode[], parent: string[] = []): AgentEntry[] {
  return nodes.flatMap((node) => {
    const path = [...parent, node.id];
    if (node.type === "agent") {
      return [{ path, node }];
    }
    if (node.type === "loop") {
      return collectAgents(node.nodes, path);
    }
    return [];
  });
}

function updateAgentAtPath(
  nodes: WorkflowNode[],
  path: string[],
  agent: AgentConfiguration,
): WorkflowNode[] {
  const [current, ...rest] = path;
  return nodes.map((node) => {
    if (node.id !== current) {
      return node;
    }
    if (rest.length === 0 && node.type === "agent") {
      return { ...node, agent };
    }
    if (rest.length > 0 && node.type === "loop") {
      return { ...node, nodes: updateAgentAtPath(node.nodes, rest, agent) };
    }
    return node;
  });
}

export function AgentsView({ workflow, onChange }: AgentsViewProps) {
  const [query, setQuery] = useState("");
  const entries = useMemo(() => collectAgents(workflow.nodes), [workflow.nodes]);
  const [selectedPath, setSelectedPath] = useState(
    entries[0]?.path.join("/") ?? "",
  );
  const filtered = entries.filter(({ node }) =>
    node.agent.name.toLowerCase().includes(query.toLowerCase()),
  );
  const selected =
    entries.find(({ path }) => path.join("/") === selectedPath) ?? entries[0];

  function updateAgent(patch: Partial<AgentConfiguration>) {
    if (!selected) {
      return;
    }
    onChange({
      ...workflow,
      nodes: updateAgentAtPath(workflow.nodes, selected.path, {
        ...selected.node.agent,
        ...patch,
      }),
    });
  }

  function addAgent() {
    const id = `agent-${Date.now().toString(36)}`;
    onChange({
      ...workflow,
      nodes: [
        ...workflow.nodes,
        {
          id,
          type: "agent",
          name: "New agent",
          depends_on: [],
          position: { x: 160, y: 160 },
          agent: createAgent(id, "New agent", "Complete the assigned step."),
          prompt: "Complete the assigned step.",
          output_mode: "text",
          max_attempts: 1,
        },
      ],
    });
    setSelectedPath(id);
  }

  return (
    <section className="agents-view">
      <aside className="collection-panel">
        <div className="collection-toolbar">
          <TextField.Root
            aria-label="Search agents"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search"
            value={query}
            variant="surface"
          >
            <TextField.Slot>
              <Search size={14} strokeWidth={1.7} />
            </TextField.Slot>
          </TextField.Root>
          <Button
            aria-label="New agent"
            color="gray"
            onClick={addAgent}
            variant="soft"
          >
            <Plus size={15} strokeWidth={1.8} />
          </Button>
        </div>
        <ScrollArea className="collection-scroll" scrollbars="vertical">
          <div className="collection-list">
            {filtered.map(({ node, path }) => {
              const key = path.join("/");
              return (
                <Button
                  aria-current={key === selectedPath ? "page" : undefined}
                  className="collection-item"
                  color="gray"
                  key={key}
                  onClick={() => setSelectedPath(key)}
                  variant="ghost"
                >
                  <span className="collection-icon">
                    <Bot size={15} strokeWidth={1.7} />
                  </span>
                  <span>
                    <strong>{node.agent.name}</strong>
                    <small>{node.agent.model.model}</small>
                  </span>
                </Button>
              );
            })}
          </div>
        </ScrollArea>
      </aside>

      {selected ? (
        <ScrollArea className="detail-scroll" scrollbars="vertical">
          <div className="agent-detail">
            <div className="detail-title-row">
              <span className="large-agent-icon">
                <Bot size={20} strokeWidth={1.55} />
              </span>
              <div>
                <span className="eyebrow">Agent</span>
                <h2>{selected.node.agent.name}</h2>
              </div>
            </div>

            <div className="detail-form-grid">
              <label className="field-label">
                <span>Name</span>
                <TextField.Root
                  onChange={(event) => updateAgent({ name: event.target.value })}
                  value={selected.node.agent.name}
                  variant="surface"
                />
              </label>
              <ModelConfigurationFields
                className="detail-form-wide"
                model={selected.node.agent.model}
                onChange={(model) => updateAgent({ model })}
              />
              <label className="field-label detail-form-wide">
                <span>Instructions</span>
                <TextArea
                  onChange={(event) =>
                    updateAgent({ instructions: event.target.value })
                  }
                  resize="vertical"
                  rows={10}
                  value={selected.node.agent.instructions}
                  variant="surface"
                />
              </label>
            </div>

            <div className="agent-tools-section">
              <div className="section-heading">
                <Wrench size={15} strokeWidth={1.7} />
                <span>Tools</span>
              </div>
              <div className="tool-chip-list">
                {selected.node.agent.tools.map((tool) => (
                  <span className="tool-chip" key={tool}>
                    {tool.replace(underscorePattern, " ")}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </ScrollArea>
      ) : (
        <div className="empty-panel">No agents</div>
      )}
    </section>
  );
}
