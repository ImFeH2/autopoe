import { AlertCircle, ArrowRight } from "lucide-react";
import { ReactFlowProvider } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useTranslation } from "react-i18next";

import {
  fieldGroupClassName,
  fieldLabelClassName,
  subtleButtonClassName,
} from "@/components/flowent/styles";
import { WorkflowCanvas } from "@/components/flowent/workflows/workflow-canvas";
import { workflowRunFailureMessage } from "@/components/flowent/workflows/workflow-model";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { WorkflowRunResult } from "@/features/workflows/model/workflow-run-types";
import type {
  WorkflowSchedule,
  WorkflowScheduleRequestState,
} from "@/features/workflows/model/workflow-schedule-types";
import type {
  Workflow,
  WorkflowNode,
} from "@/features/workflows/model/workflow-types";
import {
  workflowInputNodes,
  workflowTimerNodes,
} from "@/components/flowent/workflow-run";
import { cn } from "@/lib/utils";

export type WorkflowAutoSaveStatus = "idle" | "saving" | "saved" | "error";

export function WorkflowEditorView({
  autoSaveError,
  autoSaveStatus,
  draftWorkflow,
  inputValues,
  isInputFormOpen,
  isSchedulePersisted,
  isRunning,
  onCancelInputForm,
  onConfirmInputForm,
  onDraftChange,
  onInputValueChange,
  onRun,
  onStop,
  runResult,
  workflowSchedule,
  workflowScheduleRequestState,
}: {
  autoSaveError: string;
  autoSaveStatus: WorkflowAutoSaveStatus;
  draftWorkflow: Workflow;
  inputValues: Record<string, string>;
  isInputFormOpen: boolean;
  isSchedulePersisted: boolean;
  isRunning: boolean;
  onCancelInputForm: () => void;
  onConfirmInputForm: () => void;
  onDraftChange: (workflow: Workflow) => void;
  onInputValueChange: (nodeId: string, value: string) => void;
  onRun: () => void;
  onStop: () => void;
  runResult: WorkflowRunResult | null;
  workflowSchedule: WorkflowSchedule | null;
  workflowScheduleRequestState: WorkflowScheduleRequestState;
}) {
  const { t } = useTranslation();
  const outputEntries = Object.entries(runResult?.outputs ?? {});
  const inputNodes = workflowInputNodes(draftWorkflow);
  const hasTimer = workflowTimerNodes(draftWorkflow).length > 0;
  const scheduleStatus = workflowSchedule?.status ?? null;
  const canStop =
    hasTimer &&
    scheduleStatus !== null &&
    ["scheduled", "running"].includes(scheduleStatus);
  const isScheduleLoading =
    hasTimer &&
    isSchedulePersisted &&
    ["idle", "loading"].includes(workflowScheduleRequestState);
  const runControl = (() => {
    if (!hasTimer) {
      return {
        label: t("workflows.run.control.run"),
        state: isRunning ? ("running" as const) : ("ready" as const),
      };
    }
    if (isScheduleLoading) {
      return {
        label: t("workflows.run.control.loading"),
        state: "loading" as const,
      };
    }
    if (workflowScheduleRequestState === "starting") {
      return {
        label: t("workflows.run.control.starting"),
        state: "starting" as const,
      };
    }
    if (workflowScheduleRequestState === "stopping") {
      return {
        label: t("workflows.run.control.stopping"),
        state: "stopping" as const,
      };
    }
    if (workflowScheduleRequestState === "unavailable") {
      return {
        label: t("workflows.run.control.unavailable"),
        state: "unavailable" as const,
      };
    }
    if (canStop) {
      return {
        label: t("workflows.run.control.stop"),
        state: "stoppable" as const,
      };
    }
    return {
      label: t("workflows.run.control.run"),
      state: "ready" as const,
    };
  })();
  const runFailed = runResult?.status === "failed";
  const runError = runFailed
    ? workflowRunFailureMessage(runResult, t("workflows.errors.run"))
    : "";

  return (
    <div className="flex h-full min-h-0 flex-col bg-black">
      {isInputFormOpen ? (
        <RunInputPanel
          inputNodes={inputNodes}
          inputValues={inputValues}
          onCancel={onCancelInputForm}
          onChange={onInputValueChange}
          onStart={onConfirmInputForm}
        />
      ) : null}
      {runResult ? (
        <div className="grid shrink-0 gap-2 border-b border-white/10 px-3 py-2 text-xs text-[#dedede]">
          <div className="flex items-center gap-2">
            {runFailed ? (
              <AlertCircle
                className="size-4 text-[#ff8a8a]"
                aria-hidden="true"
              />
            ) : (
              <ArrowRight
                className="size-4 text-[#7ddf89]"
                aria-hidden="true"
              />
            )}
            <span>
              {runFailed
                ? t("workflows.run.result.failed")
                : t("workflows.run.result.completed")}
            </span>
          </div>
          {runFailed ? <div className="text-[#ffb3b3]">{runError}</div> : null}
          {outputEntries.length > 0 ? (
            <div className="grid gap-1">
              {outputEntries.map(([key, value]) => (
                <div
                  className="grid grid-cols-[minmax(72px,140px)_minmax(0,1fr)] gap-2"
                  key={key}
                >
                  <span className="truncate text-[#9b9b9b]">{key}</span>
                  <span className="min-w-0 whitespace-pre-wrap break-words text-white">
                    {value}
                  </span>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
      <ReactFlowProvider>
        <WorkflowCanvas
          autoSaveError={autoSaveError}
          autoSaveStatus={autoSaveStatus}
          draftWorkflow={draftWorkflow}
          isRunning={isRunning}
          onRun={canStop ? onStop : onRun}
          onChange={onDraftChange}
          runResult={runResult}
          runControlLabel={runControl.label}
          runControlState={runControl.state}
          scheduleError={
            workflowScheduleRequestState === "unavailable"
              ? t("workflows.errors.displayRunStatus")
              : workflowSchedule?.status === "error" &&
                  workflowSchedule.lastError !== runError
                ? workflowSchedule.lastError
                : ""
          }
          scheduleStatus={scheduleStatus}
          scheduleNextRunAt={workflowSchedule?.nextRunAt ?? null}
          scheduleTimezone={workflowSchedule?.timezone ?? ""}
        />
      </ReactFlowProvider>
    </div>
  );
}

function RunInputPanel({
  inputNodes,
  inputValues,
  onCancel,
  onChange,
  onStart,
}: {
  inputNodes: WorkflowNode[];
  inputValues: Record<string, string>;
  onCancel: () => void;
  onChange: (nodeId: string, value: string) => void;
  onStart: () => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="grid shrink-0 gap-3 border-b border-white/10 bg-black px-3 py-3">
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm font-medium text-white">
          {t("workflows.run.input.title")}
        </div>
        <div className="flex gap-2">
          <Button
            className={cn(subtleButtonClassName, "px-2.5")}
            onClick={onCancel}
            size="sm"
            type="button"
            variant="outline"
          >
            {t("workflows.run.input.cancel")}
          </Button>
          <Button
            className="h-8 px-2.5"
            onClick={onStart}
            size="sm"
            type="button"
          >
            {t("workflows.run.input.start")}
          </Button>
        </div>
      </div>
      <div className="grid gap-2 md:grid-cols-2">
        {inputNodes.map((node) => {
          const defaultValue = String(node.config.default_value ?? "");
          return (
            <div className={fieldGroupClassName} key={node.id}>
              <Label
                className={fieldLabelClassName}
                htmlFor={`${node.id}-run-input`}
              >
                {node.name}
              </Label>
              <Textarea
                className="min-h-20 rounded-md border-white/10 bg-input/30 text-base text-white shadow-none placeholder:text-[#777] focus-visible:border-[#7a7a7a] focus-visible:ring-2 focus-visible:ring-ring/25"
                id={`${node.id}-run-input`}
                onChange={(event) => onChange(node.id, event.target.value)}
                placeholder={
                  defaultValue
                    ? t("workflows.run.input.defaultValue", {
                        value: defaultValue,
                      })
                    : t("workflows.run.input.useDefaultValue")
                }
                value={inputValues[node.id] ?? ""}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
