import { useCallback, useState } from "react";
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
import { WorkflowEditorView } from "@/components/flowent/workflows/workflow-editor-view";
import { useWorkflowEditorSession } from "@/components/flowent/workflows/use-workflow-editor-session";
import {
  normalizeRunInputs,
  workflowFailureMessage,
  workflowInputNodes,
  workflowTimerNodes,
} from "@/components/flowent/workflow-run";

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
  const [inputValues, setInputValues] = useState<Record<string, string>>({});
  const [isInputFormOpen, setIsInputFormOpen] = useState(false);
  const resetRunInputs = useCallback(() => {
    setInputValues({});
    setIsInputFormOpen(false);
  }, []);
  const {
    autoSaveError,
    autoSaveStatus,
    clearRunError,
    draftWorkflow,
    isPersisted,
    reportRunError,
    saveLatestDraft,
    updateDraftWorkflow,
  } = useWorkflowEditorSession({
    activeWorkflow,
    newWorkflowKey,
    onSaveWorkflow,
    onSessionReset: resetRunInputs,
    onWorkflowPersisted,
  });
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

  return (
    <WorkflowEditorView
      autoSaveError={autoSaveError}
      autoSaveStatus={autoSaveStatus}
      draftWorkflow={draftWorkflow}
      inputValues={inputValues}
      isInputFormOpen={isInputFormOpen}
      isSchedulePersisted={isPersisted}
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
