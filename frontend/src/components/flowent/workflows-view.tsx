import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight } from "lucide-react";
import { ReactFlowProvider } from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  fieldGroupClassName,
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

const AUTO_SAVE_DELAY_MS = 500;

type AutoSaveStatus = "idle" | "saving" | "saved" | "error";

function WorkflowEditorView({
  autoSaveStatus,
  draftWorkflow,
  inputValues,
  isInputFormOpen,
  isRunning,
  onCancelInputForm,
  onConfirmInputForm,
  onDraftChange,
  onInputValueChange,
  onRun,
  onStop,
  runResult,
}: {
  autoSaveStatus: AutoSaveStatus;
  draftWorkflow: Workflow;
  inputValues: Record<string, string>;
  isInputFormOpen: boolean;
  isRunning: boolean;
  onCancelInputForm: () => void;
  onConfirmInputForm: () => void;
  onDraftChange: (workflow: Workflow) => void;
  onInputValueChange: (nodeId: string, value: string) => void;
  onRun: () => void;
  onStop: () => void;
  runResult: WorkflowRunResult | null;
}) {
  const outputEntries = Object.entries(runResult?.outputs ?? {});
  const inputNodes = workflowInputNodes(draftWorkflow);
  const hasTimer = workflowTimerNodes(draftWorkflow).length > 0;
  const canStop = isRunning && hasTimer;

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
          autoSaveStatus={autoSaveStatus}
          draftWorkflow={draftWorkflow}
          isRunning={isRunning}
          onRun={canStop ? onStop : onRun}
          onChange={onDraftChange}
          runResult={runResult}
          runControlLabel={canStop ? "Stop" : "Run"}
          runControlState={
            canStop ? "stoppable" : isRunning ? "running" : "ready"
          }
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
  onFinishWorkflowRun,
  onRunWorkflow,
  onSaveWorkflow,
  runningWorkflowId,
  workflowRunResult,
}: {
  activeWorkflow: Workflow | null;
  isRunningWorkflow: boolean;
  newWorkflowKey: number;
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
  const [autoSaveStatus, setAutoSaveStatus] = useState<AutoSaveStatus>("idle");
  const [saveRevision, setSaveRevision] = useState(0);
  const toast = useFlowentToast();
  const runAbortControllerRef = useRef<AbortController | null>(null);
  const saveTimerRef = useRef<number | null>(null);
  const savePromiseRef = useRef<Promise<Workflow | null> | null>(null);
  const latestDraftRef = useRef(draftWorkflow);
  const latestRevisionRef = useRef(0);
  const savedRevisionRef = useRef(0);
  const isPersistedRef = useRef(Boolean(activeWorkflow));
  const editorSessionRef = useRef(0);
  const editorKeyRef = useRef({
    newWorkflowKey,
    workflowId: activeWorkflow?.id ?? "",
  });

  const clearAutoSaveTimer = useCallback(() => {
    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
  }, []);

  const saveLatestDraft = useCallback(
    async (options: { force?: boolean } = {}) => {
      clearAutoSaveTimer();
      const shouldSave =
        latestRevisionRef.current > savedRevisionRef.current ||
        (options.force === true && !isPersistedRef.current);
      if (!shouldSave) {
        return latestDraftRef.current;
      }

      if (savePromiseRef.current) {
        await savePromiseRef.current;
        const stillNeedsSave =
          latestRevisionRef.current > savedRevisionRef.current ||
          (options.force === true && !isPersistedRef.current);
        if (!stillNeedsSave) {
          return latestDraftRef.current;
        }
      }

      const workflowToSave = latestDraftRef.current;
      const requestRevision = latestRevisionRef.current;
      const requestSession = editorSessionRef.current;
      setAutoSaveStatus("saving");

      const savePromise = onSaveWorkflow(workflowToSave)
        .then((result) => {
          const isCurrentSession = editorSessionRef.current === requestSession;
          const isCurrentRevision =
            latestRevisionRef.current === requestRevision;

          if (!result.data) {
            if (isCurrentSession) {
              setAutoSaveStatus(isCurrentRevision ? "error" : "saving");
            }
            if ((isCurrentSession && isCurrentRevision) || !isCurrentSession) {
              toast.error(result.error);
            }
            return null;
          }

          const savedWorkflow = result.data;

          if (isCurrentSession) {
            isPersistedRef.current = true;
            savedRevisionRef.current = Math.max(
              savedRevisionRef.current,
              requestRevision,
            );
            if (isCurrentRevision) {
              latestDraftRef.current = savedWorkflow;
              setDraftWorkflow(savedWorkflow);
              setAutoSaveStatus("saved");
            } else {
              setAutoSaveStatus("saving");
            }
          }

          return savedWorkflow;
        })
        .finally(() => {
          if (savePromiseRef.current === savePromise) {
            savePromiseRef.current = null;
          }
        });

      savePromiseRef.current = savePromise;
      return savePromise;
    },
    [clearAutoSaveTimer, onSaveWorkflow, toast],
  );

  const updateDraftWorkflow = useCallback((workflow: Workflow) => {
    latestDraftRef.current = workflow;
    latestRevisionRef.current += 1;
    setDraftWorkflow(workflow);
    setAutoSaveStatus("saving");
    setSaveRevision(latestRevisionRef.current);
  }, []);

  useEffect(() => {
    const nextWorkflowId = activeWorkflow?.id ?? "";
    if (
      editorKeyRef.current.workflowId === nextWorkflowId &&
      editorKeyRef.current.newWorkflowKey === newWorkflowKey
    ) {
      return;
    }
    if (
      !editorKeyRef.current.workflowId &&
      nextWorkflowId &&
      nextWorkflowId === latestDraftRef.current.id &&
      editorKeyRef.current.newWorkflowKey === newWorkflowKey
    ) {
      editorKeyRef.current = {
        newWorkflowKey,
        workflowId: nextWorkflowId,
      };
      isPersistedRef.current = true;
      return;
    }

    if (latestRevisionRef.current > savedRevisionRef.current) {
      void saveLatestDraft();
    }

    clearAutoSaveTimer();
    editorSessionRef.current += 1;
    savePromiseRef.current = null;
    const nextWorkflow = activeWorkflow
      ? cloneWorkflow(activeWorkflow)
      : createDraftWorkflow();
    editorKeyRef.current = {
      newWorkflowKey,
      workflowId: nextWorkflowId,
    };
    latestDraftRef.current = nextWorkflow;
    latestRevisionRef.current = 0;
    savedRevisionRef.current = 0;
    isPersistedRef.current = Boolean(activeWorkflow);
    setDraftWorkflow(nextWorkflow);
    setInputValues({});
    setIsInputFormOpen(false);
    setAutoSaveStatus("idle");
    setSaveRevision(0);
  }, [activeWorkflow, clearAutoSaveTimer, newWorkflowKey, saveLatestDraft]);

  useEffect(
    () => () => {
      clearAutoSaveTimer();
      runAbortControllerRef.current?.abort();
    },
    [clearAutoSaveTimer],
  );

  useEffect(() => {
    if (saveRevision <= savedRevisionRef.current) {
      return;
    }
    clearAutoSaveTimer();
    saveTimerRef.current = window.setTimeout(() => {
      void saveLatestDraft();
    }, AUTO_SAVE_DELAY_MS);
    return clearAutoSaveTimer;
  }, [clearAutoSaveTimer, saveLatestDraft, saveRevision]);

  const activeRunResult =
    workflowRunResult?.workflowId === draftWorkflow.id
      ? workflowRunResult
      : null;
  const isRunning = runningWorkflowId === draftWorkflow.id && isRunningWorkflow;

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
    const savedWorkflow = await saveLatestDraft({ force: true });
    if (!savedWorkflow) {
      return;
    }
    setIsInputFormOpen(false);
    await runSavedWorkflow(savedWorkflow, nextInputValues);
  };

  const runDraft = async () => {
    const savedWorkflow = await saveLatestDraft({ force: true });
    if (!savedWorkflow) {
      return;
    }
    const inputNodes = workflowInputNodes(savedWorkflow);
    if (inputNodes.length > 1) {
      setInputValues(
        Object.fromEntries(
          inputNodes.map((node) => [node.id, inputValues[node.id] ?? ""]),
        ),
      );
      setIsInputFormOpen(true);
      return;
    }
    await runSavedWorkflow(savedWorkflow, inputValues);
  };

  return (
    <WorkflowEditorView
      autoSaveStatus={autoSaveStatus}
      draftWorkflow={draftWorkflow}
      inputValues={inputValues}
      isInputFormOpen={isInputFormOpen}
      isRunning={isRunning}
      onCancelInputForm={() => setIsInputFormOpen(false)}
      onConfirmInputForm={() => {
        void runDraftWithInputs(inputValues);
      }}
      onDraftChange={updateDraftWorkflow}
      onInputValueChange={(nodeId, value) =>
        setInputValues((currentValues) => ({
          ...currentValues,
          [nodeId]: value,
        }))
      }
      onRun={() => {
        void runDraft();
      }}
      onStop={stopRun}
      runResult={activeRunResult}
    />
  );
}
