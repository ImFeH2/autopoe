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
} from "@/components/flowent/styles";
import type { WorkflowEdge, WorkflowNode } from "@/components/flowent/types";

export function WorkflowNodeProperties({
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
      {node.type === "code" ? (
        <div className={fieldGroupClassName}>
          <Label className={fieldLabelClassName} htmlFor={`${node.id}-code`}>
            Python Code
          </Label>
          <Textarea
            className="min-h-40 rounded-md border-white/10 bg-input/30 font-mono text-sm leading-5 text-white shadow-none placeholder:text-[#777] focus-visible:border-[#7a7a7a] focus-visible:ring-2 focus-visible:ring-ring/25"
            id={`${node.id}-code`}
            onChange={(event) => onNodeDataChange("code", event.target.value)}
            value={String(node.data.code ?? "")}
          />
        </div>
      ) : null}
      {node.type === "timer" ? (
        <>
          <div className={fieldGroupClassName}>
            <Label className={fieldLabelClassName}>Mode</Label>
            <Select
              onValueChange={(value) => onNodeDataChange("mode", value)}
              value={String(node.data.mode ?? "interval")}
            >
              <SelectTrigger className={fieldTriggerClassName}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="interval">Interval</SelectItem>
                <SelectItem value="cron">Cron</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {String(node.data.mode ?? "interval") === "cron" ? (
            <div className={fieldGroupClassName}>
              <Label
                className={fieldLabelClassName}
                htmlFor={`${node.id}-cron`}
              >
                Cron
              </Label>
              <Input
                className={fieldInputClassName}
                id={`${node.id}-cron`}
                onChange={(event) =>
                  onNodeDataChange("cron", event.target.value)
                }
                value={String(node.data.cron ?? "")}
              />
            </div>
          ) : (
            <div className={fieldGroupClassName}>
              <Label
                className={fieldLabelClassName}
                htmlFor={`${node.id}-interval`}
              >
                Interval Seconds
              </Label>
              <Input
                className={fieldInputClassName}
                id={`${node.id}-interval`}
                min={1}
                onChange={(event) =>
                  onNodeDataChange("interval_seconds", event.target.value)
                }
                type="number"
                value={String(node.data.interval_seconds ?? "5")}
              />
            </div>
          )}
          <div className={fieldGroupClassName}>
            <Label
              className={fieldLabelClassName}
              htmlFor={`${node.id}-payload`}
            >
              Payload
            </Label>
            <Textarea
              className="min-h-24 rounded-md border-white/10 bg-input/30 text-base text-white shadow-none placeholder:text-[#777] focus-visible:border-[#7a7a7a] focus-visible:ring-2 focus-visible:ring-ring/25"
              id={`${node.id}-payload`}
              onChange={(event) =>
                onNodeDataChange("payload", event.target.value)
              }
              value={String(node.data.payload ?? "")}
            />
          </div>
        </>
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

export function WorkflowEdgeProperties({
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
