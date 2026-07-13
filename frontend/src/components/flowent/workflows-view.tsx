import { useCallback, useEffect, useRef, useState } from "react";
import { useFlowentToast } from "@/components/flowent/toast-context";
import type {
  WorkflowRunRequest,
  WorkflowRunResult,
} from "@/features/workflows/model/workflow-run-types";
import type {
  WorkflowSchedule,
  WorkflowScheduleRequestState,
  WorkflowScheduleStartRequest,
} from "@/features/workflows/model/workflow-schedule-types";
import type { Workflow } from "@/features/workflows/model/workflow-types";
import { rebaseWorkflowChanges } from "@/features/workflows/model/workflow-rebase";
import {
  cloneWorkflow,
  createDraftWorkflow,
} from "@/components/flowent/workflows/workflow-model";
import {
  type WorkflowAutoSaveStatus,
  WorkflowEditorView,
} from "@/components/flowent/workflows/workflow-editor-view";
import {
  normalizeRunInputs,
  workflowFailureMessage,
  workflowInputNodes,
  workflowTimerNodes,
} from "@/components/flowent/workflow-run";

const AUTO_SAVE_DELAY_MS = 500;

export function WorkflowsView({
  activeWorkflow,
  newWorkflowKey,
  onRunWorkflow,
  onSaveWorkflow,
  onStartWorkflowSchedule,
  onStopWorkflowSchedule,
  onWorkflowPersisted,
  runningWorkflowId,
  workflowRunResult,
  workflowSchedule,
  workflowScheduleRequestState,
}: {
  activeWorkflow: Workflow | null;
  newWorkflowKey: number;
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
    latest?: Workflow;
  }>;
  onStartWorkflowSchedule: (
    workflowId: string,
    request?: WorkflowScheduleStartRequest,
  ) => Promise<{
    data: WorkflowSchedule | null;
    error: string;
  }>;
  onStopWorkflowSchedule: (workflowId: string) => Promise<{
    data: WorkflowSchedule | null;
    error: string;
  }>;
  onWorkflowPersisted: (workflowId: string) => void;
  runningWorkflowId: string;
  workflowRunResult: WorkflowRunResult | null;
  workflowSchedule: WorkflowSchedule | null;
  workflowScheduleRequestState: WorkflowScheduleRequestState;
}) {
  const [draftWorkflow, setDraftWorkflow] = useState<Workflow>(() =>
    activeWorkflow ? cloneWorkflow(activeWorkflow) : createDraftWorkflow(),
  );
  const [inputValues, setInputValues] = useState<Record<string, string>>({});
  const [isInputFormOpen, setIsInputFormOpen] = useState(false);
  const [autoSaveStatus, setAutoSaveStatus] =
    useState<WorkflowAutoSaveStatus>("idle");
  const [autoSaveError, setAutoSaveError] = useState("");
  const [autoSaveConflict, setAutoSaveConflict] = useState("");
  const [saveRevision, setSaveRevision] = useState(0);
  const toast = useFlowentToast();
  const saveTimerRef = useRef<number | null>(null);
  const savePromiseRef = useRef<Promise<Workflow | null> | null>(null);
  const saveLatestDraftRef = useRef<
    (options?: { force?: boolean }) => Promise<Workflow | null>
  >(async () => null);
  const isMountedRef = useRef(true);
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
      if (isMountedRef.current) {
        setAutoSaveStatus("saving");
      }

      const savePromise = onSaveWorkflow(workflowToSave)
        .then((result) => {
          const isSameSession = editorSessionRef.current === requestSession;
          const isCurrentSession = isSameSession && isMountedRef.current;
          const isCurrentRevision =
            latestRevisionRef.current === requestRevision;

          if (!result.data) {
            if (isSameSession) {
              if (result.latest) {
                const hasNewerEdits = !isCurrentRevision;
                const nextDraft = hasNewerEdits
                  ? rebaseWorkflowChanges(
                      workflowToSave,
                      latestDraftRef.current,
                      result.latest,
                    )
                  : result.latest;
                latestDraftRef.current = nextDraft;
                savedRevisionRef.current = requestRevision;
                isPersistedRef.current = true;
                if (!hasNewerEdits) {
                  latestRevisionRef.current = requestRevision;
                }
                if (isCurrentSession) {
                  setDraftWorkflow(nextDraft);
                  setAutoSaveError("");
                  setAutoSaveConflict(result.error);
                  setAutoSaveStatus(hasNewerEdits ? "saving" : "error");
                }
              } else if (isCurrentSession) {
                setAutoSaveError(result.error);
                setAutoSaveStatus(isCurrentRevision ? "error" : "saving");
              }
            }
            if (!isCurrentSession) {
              toast.error(result.error);
            }
            return null;
          }

          const savedWorkflow = result.data;

          if (isSameSession) {
            const wasPersisted = isPersistedRef.current;
            isPersistedRef.current = true;
            if (isCurrentSession) {
              setAutoSaveConflict("");
            }
            savedRevisionRef.current = Math.max(
              savedRevisionRef.current,
              requestRevision,
            );
            if (isCurrentRevision) {
              latestDraftRef.current = savedWorkflow;
              if (isCurrentSession) {
                setDraftWorkflow(savedWorkflow);
                setAutoSaveError("");
                setAutoSaveStatus("saved");
              }
            } else {
              const currentDraft = latestDraftRef.current;
              const rebasedDraft = {
                ...currentDraft,
                activeRevision: savedWorkflow.activeRevision,
                createdAt: savedWorkflow.createdAt,
                revision: savedWorkflow.revision,
                updatedAt: savedWorkflow.updatedAt,
              };
              latestDraftRef.current = rebasedDraft;
              if (isCurrentSession) {
                setDraftWorkflow(rebasedDraft);
                setAutoSaveError("");
                setAutoSaveStatus("saving");
              }
            }
            if (isCurrentSession && !wasPersisted) {
              onWorkflowPersisted(savedWorkflow.id);
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
    [clearAutoSaveTimer, onSaveWorkflow, onWorkflowPersisted, toast],
  );
  saveLatestDraftRef.current = saveLatestDraft;

  const updateDraftWorkflow = useCallback((workflow: Workflow) => {
    latestDraftRef.current = workflow;
    latestRevisionRef.current += 1;
    setDraftWorkflow(workflow);
    setAutoSaveError("");
    setAutoSaveConflict("");
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
    setAutoSaveError("");
    setAutoSaveConflict("");
    setInputValues({});
    setIsInputFormOpen(false);
    setAutoSaveStatus("idle");
    setSaveRevision(0);
  }, [activeWorkflow, clearAutoSaveTimer, newWorkflowKey, saveLatestDraft]);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      clearAutoSaveTimer();
      void saveLatestDraftRef.current();
    };
  }, [clearAutoSaveTimer]);

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

  const hasTimer = workflowTimerNodes(draftWorkflow).length > 0;
  const activeWorkflowSchedule =
    workflowSchedule?.workflowId === draftWorkflow.id ? workflowSchedule : null;
  const activeWorkflowRevision =
    draftWorkflow.activeRevision ?? draftWorkflow.revision;
  const activeRunResult = hasTimer
    ? activeWorkflowSchedule?.lastResult?.workflowRevision ===
      activeWorkflowRevision
      ? activeWorkflowSchedule.lastResult
      : null
    : workflowRunResult?.workflowId === draftWorkflow.id &&
        workflowRunResult.workflowRevision === activeWorkflowRevision
      ? workflowRunResult
      : null;
  const isRunning = runningWorkflowId === draftWorkflow.id;

  const stopRun = async () => {
    const result = await onStopWorkflowSchedule(draftWorkflow.id);
    if (!result.data) {
      toast.error(result.error);
    }
  };

  const runSavedWorkflow = async (
    savedWorkflow: Workflow,
    nextInputValues: Record<string, string>,
  ) => {
    const requestInputs = normalizeRunInputs(
      workflowInputNodes(savedWorkflow),
      nextInputValues,
    );
    if (workflowTimerNodes(savedWorkflow).length === 0) {
      const result = await onRunWorkflow(savedWorkflow.id, {
        inputs: requestInputs,
        workflowRevision: savedWorkflow.revision,
      });
      if (!result.data) {
        setAutoSaveError(result.error);
        setAutoSaveStatus("error");
        return;
      }
      if (result.data.status === "failed") {
        setAutoSaveError(workflowFailureMessage(result.data));
        setAutoSaveStatus("error");
      } else {
        setAutoSaveError("");
      }
      return;
    }

    const result = await onStartWorkflowSchedule(savedWorkflow.id, {
      inputs: requestInputs,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      workflowRevision: savedWorkflow.revision,
    });
    if (!result.data) {
      setAutoSaveError(result.error);
      setAutoSaveStatus("error");
    } else {
      setAutoSaveError("");
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
      autoSaveError={autoSaveConflict || autoSaveError}
      autoSaveStatus={autoSaveConflict ? "error" : autoSaveStatus}
      draftWorkflow={draftWorkflow}
      inputValues={inputValues}
      isInputFormOpen={isInputFormOpen}
      isSchedulePersisted={isPersistedRef.current}
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
      workflowSchedule={activeWorkflowSchedule}
      workflowScheduleRequestState={workflowScheduleRequestState}
    />
  );
}
