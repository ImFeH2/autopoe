import type { Dispatch, SetStateAction } from "react";

import { useFlowentToast } from "@/components/flowent/toast-context";
import {
  normalizeRunInputs,
  workflowFailureMessage,
  workflowInputNodes,
  workflowTimerNodes,
} from "@/components/flowent/workflow-run";
import type {
  WorkflowRunRequest,
  WorkflowRunResult,
} from "@/features/workflows/model/workflow-run-types";
import type {
  WorkflowSchedule,
  WorkflowScheduleStartRequest,
} from "@/features/workflows/model/workflow-schedule-types";
import type { Workflow } from "@/features/workflows/model/workflow-types";

export function useWorkflowRunCoordinator({
  clearRunError,
  draftWorkflow,
  inputValues,
  onRunWorkflow,
  onStartWorkflowSchedule,
  onStopWorkflowSchedule,
  reportRunError,
  runningWorkflowId,
  saveLatestDraft,
  setInputValues,
  setIsInputFormOpen,
  workflowRunResult,
  workflowSchedule,
}: {
  clearRunError: () => void;
  draftWorkflow: Workflow;
  inputValues: Record<string, string>;
  onRunWorkflow: (
    workflowId: string,
    request?: WorkflowRunRequest,
  ) => Promise<{
    data: WorkflowRunResult | null;
    error: string;
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
  reportRunError: (error: string) => void;
  runningWorkflowId: string;
  saveLatestDraft: (options?: { force?: boolean }) => Promise<Workflow | null>;
  setInputValues: Dispatch<SetStateAction<Record<string, string>>>;
  setIsInputFormOpen: Dispatch<SetStateAction<boolean>>;
  workflowRunResult: WorkflowRunResult | null;
  workflowSchedule: WorkflowSchedule | null;
}) {
  const toast = useFlowentToast();
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
        reportRunError(result.error);
        return;
      }
      if (result.data.status === "failed") {
        reportRunError(workflowFailureMessage(result.data));
      } else {
        clearRunError();
      }
      return;
    }

    const result = await onStartWorkflowSchedule(savedWorkflow.id, {
      inputs: requestInputs,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      workflowRevision: savedWorkflow.revision,
    });
    if (!result.data) {
      reportRunError(result.error);
    } else {
      clearRunError();
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

  return {
    activeRunResult,
    activeWorkflowSchedule,
    isRunning,
    runDraft,
    runDraftWithInputs,
    stopRun,
  };
}
