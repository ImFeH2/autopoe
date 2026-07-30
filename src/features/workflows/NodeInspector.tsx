import {
  Button,
  ScrollArea,
  Select,
  Switch,
  Tabs,
  TextArea,
  TextField,
} from "@radix-ui/themes";
import { Trash2 } from "lucide-react";
import { ModelConfigurationFields } from "@/components/ModelConfigurationFields";
import type {
  AgentWorkflowNode,
  WorkflowNode,
} from "@/types/workflow";
import { availableTools } from "@/types/workflow";

interface NodeInspectorProps {
  node: WorkflowNode | null;
  onChange: (node: WorkflowNode) => void;
  onDelete: (nodeId: string) => void;
}

const underscorePattern = /_/g;

function updateAgent(
  node: AgentWorkflowNode,
  patch: Partial<AgentWorkflowNode["agent"]>,
): AgentWorkflowNode {
  return { ...node, agent: { ...node.agent, ...patch } };
}

export function NodeInspector({
  node,
  onChange,
  onDelete,
}: NodeInspectorProps) {
  if (!node) {
    return (
      <aside className="inspector inspector-empty">
        <span className="eyebrow">Inspector</span>
        <strong>Select a node</strong>
      </aside>
    );
  }

  return (
    <aside className="inspector">
      <div className="inspector-head">
        <div>
          <span className="eyebrow">{node.type}</span>
          <strong>{node.name}</strong>
        </div>
        <Button
          aria-label="Delete node"
          className="danger-icon-button"
          color="red"
          onClick={() => onDelete(node.id)}
          variant="ghost"
        >
          <Trash2 size={15} strokeWidth={1.7} />
        </Button>
      </div>

      <Tabs.Root className="inspector-tabs" defaultValue="configure">
        <Tabs.List>
          <Tabs.Trigger value="configure">Configure</Tabs.Trigger>
          <Tabs.Trigger value="runtime">Runtime</Tabs.Trigger>
        </Tabs.List>

        <ScrollArea className="inspector-scroll" scrollbars="vertical">
          <Tabs.Content value="configure">
            <div className="field-stack">
              <label className="field-label">
                <span>Name</span>
                <TextField.Root
                  onChange={(event) =>
                    onChange({ ...node, name: event.target.value })
                  }
                  value={node.name}
                  variant="surface"
                />
              </label>

              {node.type === "agent" ? (
                <>
                  <label className="field-label">
                    <span>Agent</span>
                    <TextField.Root
                      onChange={(event) =>
                        onChange(
                          updateAgent(node, { name: event.target.value }),
                        )
                      }
                      value={node.agent.name}
                      variant="surface"
                    />
                  </label>

                  <ModelConfigurationFields
                    model={node.agent.model}
                    onChange={(model) =>
                      onChange(updateAgent(node, { model }))
                    }
                  />

                  <label className="field-label">
                    <span>Instructions</span>
                    <TextArea
                      onChange={(event) =>
                        onChange(
                          updateAgent(node, {
                            instructions: event.target.value,
                          }),
                        )
                      }
                      resize="vertical"
                      rows={6}
                      value={node.agent.instructions}
                      variant="surface"
                    />
                  </label>

                  <label className="field-label">
                    <span>Prompt</span>
                    <TextArea
                      onChange={(event) =>
                        onChange({ ...node, prompt: event.target.value })
                      }
                      resize="vertical"
                      rows={5}
                      value={node.prompt}
                      variant="surface"
                    />
                  </label>

                  <div className="field-label">
                    <span>Tools</span>
                    <div className="tool-list">
                      {availableTools.map((tool) => {
                        const enabled = node.agent.tools.includes(tool);
                        return (
                          <label className="tool-toggle" key={tool}>
                            <span>{tool.replace(underscorePattern, " ")}</span>
                            <Switch
                              checked={enabled}
                              onCheckedChange={(checked) =>
                                onChange(
                                  updateAgent(node, {
                                    tools: checked
                                      ? [...node.agent.tools, tool]
                                      : node.agent.tools.filter(
                                          (current) => current !== tool,
                                        ),
                                  }),
                                )
                              }
                              size="1"
                            />
                          </label>
                        );
                      })}
                    </div>
                  </div>
                </>
              ) : null}

              {node.type === "loop" ? (
                <>
                  <label className="field-label">
                    <span>Iterations</span>
                    <TextField.Root
                      min={1}
                      onChange={(event) =>
                        onChange({
                          ...node,
                          max_iterations: Math.max(
                            1,
                            Number(event.target.value),
                          ),
                        })
                      }
                      type="number"
                      value={String(node.max_iterations)}
                      variant="surface"
                    />
                  </label>
                  <label className="field-label">
                    <span>Condition path</span>
                    <TextField.Root
                      onChange={(event) =>
                        onChange({
                          ...node,
                          until: {
                            path: event.target.value,
                            operator: node.until?.operator ?? "truthy",
                            value: node.until?.value,
                          },
                        })
                      }
                      value={node.until?.path ?? ""}
                      variant="surface"
                    />
                  </label>
                </>
              ) : null}

              {node.type === "approval" ? (
                <>
                  <label className="field-label">
                    <span>Prompt</span>
                    <TextArea
                      onChange={(event) =>
                        onChange({ ...node, prompt: event.target.value })
                      }
                      resize="vertical"
                      rows={5}
                      value={node.prompt}
                      variant="surface"
                    />
                  </label>
                  <label className="field-label">
                    <span>On reject</span>
                    <Select.Root
                      onValueChange={(reject_behavior: "continue" | "fail") =>
                        onChange({ ...node, reject_behavior })
                      }
                      value={node.reject_behavior}
                    >
                      <Select.Trigger className="field-select" />
                      <Select.Content>
                        <Select.Item value="fail">Fail run</Select.Item>
                        <Select.Item value="continue">Continue</Select.Item>
                      </Select.Content>
                    </Select.Root>
                  </label>
                </>
              ) : null}
            </div>
          </Tabs.Content>

          <Tabs.Content value="runtime">
            <div className="runtime-fields">
              <div className="metric-row">
                <span>Dependencies</span>
                <strong>{node.depends_on.length}</strong>
              </div>
              {node.type === "agent" ? (
                <>
                  <div className="metric-row">
                    <span>Requests</span>
                    <strong>{node.agent.limits.request_limit}</strong>
                  </div>
                  <div className="metric-row">
                    <span>Tool calls</span>
                    <strong>{node.agent.limits.tool_calls_limit}</strong>
                  </div>
                  <div className="metric-row">
                    <span>Timeout</span>
                    <strong>{node.agent.limits.timeout_seconds}s</strong>
                  </div>
                </>
              ) : null}
            </div>
          </Tabs.Content>
        </ScrollArea>
      </Tabs.Root>
    </aside>
  );
}
