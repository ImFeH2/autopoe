import { useCallback, useState } from "react";
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
import { useWorkflowRunCoordinator } from "@/components/flowent/workflows/use-workflow-run-coordinator";

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
  const {
    activeRunResult,
    activeWorkflowSchedule,
    isRunning,
    runDraft,
    runDraftWithInputs,
    stopRun,
  } = useWorkflowRunCoordinator({
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
  });

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
