import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  Loader2,
  Play,
  Redo,
  Save,
  Square,
  Trash2,
  Undo,
  X,
} from "lucide-react";
import { ReactFlowProvider } from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  fieldGroupClassName,
  fieldInputClassName,
  fieldLabelClassName,
  subtleButtonClassName,
} from "@/components/flowent/styles";
import { useFlowentToast } from "@/components/flowent/toast-context";
import type {
  Workflow,
  WorkflowNode,
  WorkflowRunRequest,
  WorkflowRunResult,
} from "@/components/flowent/types";
import {
  cloneWorkflow,
  createDraftWorkflow,
} from "@/components/flowent/workflows/workflow-model";
import { WorkflowCanvas } from "@/components/flowent/workflows/workflow-canvas";
import {
  isAbortError,
  normalizeRunInputs,
  timerDelayMs,
  waitForTimer,
  workflowFailureMessage,
  workflowInputNodes,
  workflowTimerNodes,
} from "@/components/flowent/workflow-run";
import { cn } from "@/lib/utils";

function WorkflowEditorView({
  draftWorkflow,
  inputValues,
  isInputFormOpen,
  isDirty,
  isRunning,
  onCancelInputForm,
  onClose,
  onConfirmInputForm,
  onDelete,
  onDraftChange,
  onInputValueChange,
  onMarkDirty,
  onRun,
  onSave,
  onStop,
  runResult,
}: {
  draftWorkflow: Workflow;
  inputValues: Record<string, string>;
  isInputFormOpen: boolean;
  isDirty: boolean;
  isRunning: boolean;
  onCancelInputForm: () => void;
  onClose: () => void;
  onConfirmInputForm: () => void;
  onDelete: () => void;
  onDraftChange: (workflow: Workflow) => void;
  onInputValueChange: (nodeId: string, value: string) => void;
  onMarkDirty: () => void;
  onRun: () => void;
  onSave: () => void;
  onStop: () => void;
  runResult: WorkflowRunResult | null;
}) {
  const outputEntries = Object.entries(runResult?.outputs ?? {});
  const inputNodes = workflowInputNodes(draftWorkflow);
  const hasTimer = workflowTimerNodes(draftWorkflow).length > 0;
  const canStop = isRunning && hasTimer;

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
            disabled={isRunning && !canStop}
            onClick={canStop ? onStop : onRun}
            size="sm"
            type="button"
            variant={isRunning ? "outline" : "default"}
          >
            {canStop ? (
              <Square className="size-4" aria-hidden="true" />
            ) : isRunning ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <Play className="size-4" aria-hidden="true" />
            )}
            {canStop ? "Stop" : "Run"}
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
            <ArrowRight className="size-4 text-[#7ddf89]" aria-hidden="true" />
            <span>
              {runResult.status === "success"
                ? "Run completed."
                : "Run failed."}
            </span>
          </div>
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
  return (
    <div className="grid shrink-0 gap-3 border-b border-white/10 bg-black px-3 py-3">
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm font-medium text-white">Workflow Input</div>
        <div className="flex gap-2">
          <Button
            className={cn(subtleButtonClassName, "px-2.5")}
            onClick={onCancel}
            size="sm"
            type="button"
            variant="outline"
          >
            Cancel
          </Button>
          <Button
            className="h-8 px-2.5"
            onClick={onStart}
            size="sm"
            type="button"
          >
            Start
          </Button>
        </div>
      </div>
      <div className="grid gap-2 md:grid-cols-2">
        {inputNodes.map((node) => {
          const defaultValue = String(node.data.default_value ?? "");
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
                    ? `Default: ${defaultValue}`
                    : "Use default value"
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

export function WorkflowsView({
  activeWorkflow,
  isRunningWorkflow,
  newWorkflowKey,
  onCloseEditor,
  onDeleteWorkflow,
  onFinishWorkflowRun,
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
  onFinishWorkflowRun: (workflowId: string) => void;
  onRunWorkflow: (
    workflowId: string,
    request?: WorkflowRunRequest,
  ) => Promise<{
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
  const [inputValues, setInputValues] = useState<Record<string, string>>({});
  const [isInputFormOpen, setIsInputFormOpen] = useState(false);
  const [isDirty, setIsDirty] = useState(!activeWorkflow);
  const toast = useFlowentToast();
  const runAbortControllerRef = useRef<AbortController | null>(null);
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
    setInputValues({});
    setIsInputFormOpen(false);
    setIsDirty(!activeWorkflow);
  }, [activeWorkflow, newWorkflowKey]);

  useEffect(
    () => () => {
      runAbortControllerRef.current?.abort();
    },
    [],
  );

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

  const stopRun = () => {
    runAbortControllerRef.current?.abort();
    runAbortControllerRef.current = null;
    onFinishWorkflowRun(draftWorkflow.id);
  };

  const runSavedWorkflow = async (
    savedWorkflow: Workflow,
    nextInputValues: Record<string, string>,
  ) => {
    const requestInputs = normalizeRunInputs(
      workflowInputNodes(savedWorkflow),
      nextInputValues,
    );
    const timerNodes = workflowTimerNodes(savedWorkflow);
    if (timerNodes.length === 0) {
      const result = await onRunWorkflow(savedWorkflow.id, {
        inputs: requestInputs,
      });
      if (!result.data) {
        toast.error(result.error);
        return;
      }
      if (result.data.status === "failed") {
        toast.error(workflowFailureMessage(result.data));
      }
      return;
    }

    const abortController = new AbortController();
    runAbortControllerRef.current?.abort();
    runAbortControllerRef.current = abortController;
    try {
      await runTimers(
        savedWorkflow,
        timerNodes,
        requestInputs,
        abortController,
      );
    } catch (error) {
      if (!isAbortError(error)) {
        toast.error(
          error instanceof Error
            ? error.message
            : "Run could not be completed.",
        );
      }
    } finally {
      if (runAbortControllerRef.current === abortController) {
        runAbortControllerRef.current = null;
      }
      onFinishWorkflowRun(savedWorkflow.id);
    }
  };

  const runTimers = async (
    savedWorkflow: Workflow,
    timerNodes: WorkflowNode[],
    requestInputs: Record<string, string>,
    abortController: AbortController,
  ) => {
    const signal = abortController.signal;
    for (const timerNode of timerNodes) {
      if (signal.aborted) {
        throw new DOMException("Run stopped.", "AbortError");
      }
      const result = await onRunWorkflow(savedWorkflow.id, {
        inputs: requestInputs,
        signal,
        timerId: timerNode.id,
      });
      if (!result.data) {
        throw new Error(result.error);
      }
      if (result.data.status === "failed") {
        throw new Error(workflowFailureMessage(result.data));
      }
    }

    const scheduledTimers = timerNodes.map((timerNode) => ({
      nextAt: Date.now() + timerDelayMs(timerNode),
      timerNode,
    }));

    while (!signal.aborted) {
      const nextTimer = scheduledTimers.sort((a, b) => a.nextAt - b.nextAt)[0];
      if (!nextTimer) {
        return;
      }
      await waitForTimer(Math.max(0, nextTimer.nextAt - Date.now()), signal);
      const result = await onRunWorkflow(savedWorkflow.id, {
        inputs: requestInputs,
        signal,
        timerId: nextTimer.timerNode.id,
      });
      if (!result.data) {
        throw new Error(result.error);
      }
      if (result.data.status === "failed") {
        throw new Error(workflowFailureMessage(result.data));
      }
      nextTimer.nextAt = Date.now() + timerDelayMs(nextTimer.timerNode);
    }
  };

  const runDraftWithInputs = async (
    nextInputValues: Record<string, string>,
  ) => {
    const savedWorkflow = await saveDraft();
    if (!savedWorkflow) {
      return;
    }
    setIsInputFormOpen(false);
    await runSavedWorkflow(savedWorkflow, nextInputValues);
  };

  const runDraft = async () => {
    const inputNodes = workflowInputNodes(draftWorkflow);
    if (inputNodes.length > 1) {
      setInputValues(
        Object.fromEntries(
          inputNodes.map((node) => [node.id, inputValues[node.id] ?? ""]),
        ),
      );
      setIsInputFormOpen(true);
      return;
    }
    await runDraftWithInputs(inputValues);
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
      inputValues={inputValues}
      isInputFormOpen={isInputFormOpen}
      isDirty={isDirty}
      isRunning={isRunning}
      onCancelInputForm={() => setIsInputFormOpen(false)}
      onClose={closeEditor}
      onConfirmInputForm={() => {
        void runDraftWithInputs(inputValues);
      }}
      onDelete={() => {
        void deleteDraft();
      }}
      onDraftChange={setDraftWorkflow}
      onInputValueChange={(nodeId, value) =>
        setInputValues((currentValues) => ({
          ...currentValues,
          [nodeId]: value,
        }))
      }
      onMarkDirty={() => setIsDirty(true)}
      onRun={() => {
        void runDraft();
      }}
      onSave={() => {
        void saveDraft();
      }}
      onStop={stopRun}
      runResult={activeRunResult}
    />
  );
}
