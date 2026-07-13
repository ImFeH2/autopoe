import { useCallback, useEffect, useRef, useState } from "react";

import { useFlowentToast } from "@/components/flowent/toast-context";
import {
  cloneWorkflow,
  createDraftWorkflow,
} from "@/components/flowent/workflows/workflow-model";
import { rebaseWorkflowChanges } from "@/features/workflows/model/workflow-rebase";
import type { Workflow } from "@/features/workflows/model/workflow-types";

const AUTO_SAVE_DELAY_MS = 500;

type WorkflowSaveResult = {
  data: Workflow | null;
  error: string;
  latest?: Workflow;
};

export function useWorkflowEditorSession({
  activeWorkflow,
  newWorkflowKey,
  onSessionReset,
  onSaveWorkflow,
  onWorkflowPersisted,
}: {
  activeWorkflow: Workflow | null;
  newWorkflowKey: number;
  onSessionReset: () => void;
  onSaveWorkflow: (workflow: Workflow) => Promise<WorkflowSaveResult>;
  onWorkflowPersisted: (workflowId: string) => void;
}) {
  const [draftWorkflow, setDraftWorkflow] = useState<Workflow>(() =>
    activeWorkflow ? cloneWorkflow(activeWorkflow) : createDraftWorkflow(),
  );
  const [autoSaveStatus, setAutoSaveStatus] = useState<
    "error" | "idle" | "saved" | "saving"
  >("idle");
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
    onSessionReset();
    setAutoSaveStatus("idle");
    setSaveRevision(0);
  }, [
    activeWorkflow,
    clearAutoSaveTimer,
    newWorkflowKey,
    onSessionReset,
    saveLatestDraft,
  ]);

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

  const reportRunError = useCallback((error: string) => {
    setAutoSaveError(error);
    setAutoSaveStatus("error");
  }, []);

  const clearRunError = useCallback(() => {
    setAutoSaveError("");
  }, []);

  return {
    autoSaveError: autoSaveConflict || autoSaveError,
    autoSaveStatus: autoSaveConflict ? ("error" as const) : autoSaveStatus,
    clearRunError,
    draftWorkflow,
    isPersisted: isPersistedRef.current,
    reportRunError,
    saveLatestDraft,
    updateDraftWorkflow,
  };
}
