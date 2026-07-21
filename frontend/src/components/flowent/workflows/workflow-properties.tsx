import { useTranslation } from "react-i18next";

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
import type {
  WorkflowEdge,
  WorkflowNode,
} from "@/features/workflows/model/workflow-types";

export function WorkflowNodeProperties({
  node,
  onNodeChange,
  onNodeDataChange,
}: {
  node: WorkflowNode;
  onNodeChange: (updates: Partial<WorkflowNode>) => void;
  onNodeDataChange: (key: string, value: number | string) => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="mt-3 grid gap-3">
      <div className="text-sm font-medium text-white">
        {t("workflows.properties.nodeTitle", { name: node.name })}
      </div>
      <div className={fieldGroupClassName}>
        <Label className={fieldLabelClassName} htmlFor={`${node.id}-name`}>
          {t("workflows.properties.name")}
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
          {t("workflows.properties.description")}
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
      {node.kind === "input" ? (
        <>
          <div className={fieldGroupClassName}>
            <Label className={fieldLabelClassName}>
              {t("workflows.properties.type")}
            </Label>
            <Select
              onValueChange={(value) => onNodeDataChange("input_type", value)}
              value={String(node.config.input_type ?? "text")}
            >
              <SelectTrigger className={fieldTriggerClassName}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="text">
                  {t("workflows.properties.text")}
                </SelectItem>
                <SelectItem value="json">
                  {t("workflows.properties.json")}
                </SelectItem>
                <SelectItem value="file">
                  {t("workflows.properties.file")}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className={fieldGroupClassName}>
            <Label
              className={fieldLabelClassName}
              htmlFor={`${node.id}-default-value`}
            >
              {t("workflows.properties.defaultValue")}
            </Label>
            <Textarea
              className="min-h-24 rounded-md border-white/10 bg-input/30 text-base text-white shadow-none placeholder:text-[#777] focus-visible:border-[#7a7a7a] focus-visible:ring-2 focus-visible:ring-ring/25"
              id={`${node.id}-default-value`}
              onChange={(event) =>
                onNodeDataChange("default_value", event.target.value)
              }
              value={String(node.config.default_value ?? "")}
            />
          </div>
        </>
      ) : null}
      {node.kind === "agent" ? (
        <>
          <div className={fieldGroupClassName}>
            <Label className={fieldLabelClassName}>
              {t("workflows.properties.agent")}
            </Label>
            <Select
              onValueChange={(value) => onNodeDataChange("agent", value)}
              value={String(node.config.agent ?? "Default agent")}
            >
              <SelectTrigger className={fieldTriggerClassName}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Default agent">
                  {t("workflows.properties.defaultAgent")}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className={fieldGroupClassName}>
            <Label
              className={fieldLabelClassName}
              htmlFor={`${node.id}-prompt`}
            >
              {t("workflows.properties.prompt")}
            </Label>
            <Textarea
              className="min-h-32 rounded-md border-white/10 bg-input/30 text-base text-white shadow-none placeholder:text-[#777] focus-visible:border-[#7a7a7a] focus-visible:ring-2 focus-visible:ring-ring/25"
              id={`${node.id}-prompt`}
              onChange={(event) =>
                onNodeDataChange("prompt", event.target.value)
              }
              value={String(node.config.prompt ?? "")}
            />
          </div>
          <div className={fieldGroupClassName}>
            <Label className={fieldLabelClassName}>
              {t("workflows.properties.parameters")}
            </Label>
            <p className={emptyStateClassName}>
              {t("workflows.properties.noParameters")}
            </p>
          </div>
        </>
      ) : null}
      {node.kind === "merge" ? (
        <div className={fieldGroupClassName}>
          <Label className={fieldLabelClassName}>
            {t("workflows.properties.mergeStrategy")}
          </Label>
          <Select
            onValueChange={(value) => onNodeDataChange("merge_strategy", value)}
            value={String(node.config.merge_strategy ?? "text")}
          >
            <SelectTrigger className={fieldTriggerClassName}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="text">
                {t("workflows.properties.concatenateText")}
              </SelectItem>
              <SelectItem value="json">
                {t("workflows.properties.jsonMerge")}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
      ) : null}
      {node.kind === "code" ? (
        <div className={fieldGroupClassName}>
          <Label className={fieldLabelClassName} htmlFor={`${node.id}-code`}>
            {t("workflows.properties.pythonCode")}
          </Label>
          <Textarea
            className="min-h-40 rounded-md border-white/10 bg-input/30 font-mono text-sm leading-5 text-white shadow-none placeholder:text-[#777] focus-visible:border-[#7a7a7a] focus-visible:ring-2 focus-visible:ring-ring/25"
            id={`${node.id}-code`}
            onChange={(event) => onNodeDataChange("code", event.target.value)}
            value={String(node.config.code ?? "")}
          />
        </div>
      ) : null}
      {node.kind === "timer" ? (
        <>
          <div className={fieldGroupClassName}>
            <Label className={fieldLabelClassName}>
              {t("workflows.properties.mode")}
            </Label>
            <Select
              onValueChange={(value) => onNodeDataChange("mode", value)}
              value={String(node.config.mode ?? "interval")}
            >
              <SelectTrigger className={fieldTriggerClassName}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="interval">
                  {t("workflows.properties.interval")}
                </SelectItem>
                <SelectItem value="cron">
                  {t("workflows.properties.cron")}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          {String(node.config.mode ?? "interval") === "cron" ? (
            <div className={fieldGroupClassName}>
              <Label
                className={fieldLabelClassName}
                htmlFor={`${node.id}-cron`}
              >
                {t("workflows.properties.cron")}
              </Label>
              <Input
                className={fieldInputClassName}
                id={`${node.id}-cron`}
                onChange={(event) =>
                  onNodeDataChange("cron", event.target.value)
                }
                value={String(node.config.cron ?? "")}
              />
            </div>
          ) : (
            <div className={fieldGroupClassName}>
              <Label
                className={fieldLabelClassName}
                htmlFor={`${node.id}-interval`}
              >
                {t("workflows.properties.intervalSeconds")}
              </Label>
              <Input
                className={fieldInputClassName}
                id={`${node.id}-interval`}
                min={1}
                onChange={(event) =>
                  onNodeDataChange(
                    "interval_seconds",
                    Number(event.target.value),
                  )
                }
                type="number"
                value={String(node.config.interval_seconds ?? "5")}
              />
            </div>
          )}
          <div className={fieldGroupClassName}>
            <Label
              className={fieldLabelClassName}
              htmlFor={`${node.id}-payload`}
            >
              {t("workflows.properties.payload")}
            </Label>
            <Textarea
              className="min-h-24 rounded-md border-white/10 bg-input/30 text-base text-white shadow-none placeholder:text-[#777] focus-visible:border-[#7a7a7a] focus-visible:ring-2 focus-visible:ring-ring/25"
              id={`${node.id}-payload`}
              onChange={(event) =>
                onNodeDataChange("payload", event.target.value)
              }
              value={String(node.config.payload ?? "")}
            />
          </div>
        </>
      ) : null}
      {node.kind === "output" ? (
        <>
          <div className={fieldGroupClassName}>
            <Label
              className={fieldLabelClassName}
              htmlFor={`${node.id}-output-key`}
            >
              {t("workflows.properties.outputKey")}
            </Label>
            <Input
              className={fieldInputClassName}
              id={`${node.id}-output-key`}
              onChange={(event) =>
                onNodeDataChange("output_key", event.target.value)
              }
              value={String(node.config.output_key ?? "")}
            />
          </div>
          <div className={fieldGroupClassName}>
            <Label
              className={fieldLabelClassName}
              htmlFor={`${node.id}-transform`}
            >
              {t("workflows.properties.transform")}
            </Label>
            <Textarea
              className="min-h-24 rounded-md border-white/10 bg-input/30 text-base text-white shadow-none placeholder:text-[#777] focus-visible:border-[#7a7a7a] focus-visible:ring-2 focus-visible:ring-ring/25"
              id={`${node.id}-transform`}
              onChange={(event) =>
                onNodeDataChange("transform", event.target.value)
              }
              value={String(node.config.transform ?? "")}
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
  const { t } = useTranslation();

  return (
    <div className="mt-3 grid gap-3">
      <div className="text-sm font-medium text-white">
        {t("workflows.properties.edgeTitle")}
      </div>
      <div className={fieldGroupClassName}>
        <Label className={fieldLabelClassName} htmlFor={`${edge.id}-label`}>
          {t("workflows.properties.label")}
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
