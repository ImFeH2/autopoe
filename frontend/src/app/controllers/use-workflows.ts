import { useCallback, useMemo, useState } from "react";

import {
  deleteWorkflowRequest,
  runWorkflowRequest,
  saveWorkflowRequest,
} from "@/app/api/workflow-requests";
import type { RequestResult } from "@/app/api/types";
import type { Workflow, WorkflowRunResult } from "@/components/flowent/types";

export const useWorkflows = (initialWorkflowId = "") => {
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [workflowRunResult, setWorkflowRunResult] =
    useState<WorkflowRunResult | null>(null);
  const [runningWorkflowId, setRunningWorkflowId] = useState("");
  const [activeWorkflowId, setActiveWorkflowId] = useState(initialWorkflowId);
  const [newWorkflowKey, setNewWorkflowKey] = useState(0);

  const activeWorkflow = useMemo(
    () =>
      workflows.find((workflow) => workflow.id === activeWorkflowId) ?? null,
    [activeWorkflowId, workflows],
  );

  const replaceWorkflows = useCallback((nextWorkflows: Workflow[]) => {
    setWorkflows(nextWorkflows);
    setActiveWorkflowId((currentWorkflowId) =>
      currentWorkflowId &&
      !nextWorkflows.some((workflow) => workflow.id === currentWorkflowId)
        ? ""
        : currentWorkflowId,
    );
  }, []);

  const openNewWorkflow = useCallback(() => {
    setActiveWorkflowId("");
    setWorkflowRunResult(null);
    setNewWorkflowKey((currentKey) => currentKey + 1);
  }, []);

  const openWorkflow = useCallback((workflowId: string) => {
    setActiveWorkflowId(workflowId);
  }, []);

  const closeWorkflowEditor = useCallback(() => {
    setActiveWorkflowId("");
  }, []);

  const saveWorkflow = useCallback(
    async (workflow: Workflow): Promise<RequestResult<Workflow>> => {
      const result = await saveWorkflowRequest(workflow);
      if (!result.data) {
        return result;
      }
      const savedWorkflow = result.data;
      setWorkflows((currentWorkflows) => {
        if (
          currentWorkflows.some(
            (currentWorkflow) => currentWorkflow.id === savedWorkflow.id,
          )
        ) {
          return currentWorkflows.map((currentWorkflow) =>
            currentWorkflow.id === savedWorkflow.id
              ? savedWorkflow
              : currentWorkflow,
          );
        }
        return [savedWorkflow, ...currentWorkflows];
      });
      setActiveWorkflowId(savedWorkflow.id);
      return result;
    },
    [],
  );

  const deleteWorkflow = useCallback(async (workflowId: string) => {
    const wasDeleted = await deleteWorkflowRequest(workflowId);

    if (!wasDeleted) {
      return false;
    }

    setWorkflows((currentWorkflows) =>
      currentWorkflows.filter((workflow) => workflow.id !== workflowId),
    );
    setWorkflowRunResult((currentResult) =>
      currentResult?.workflowId === workflowId ? null : currentResult,
    );
    setActiveWorkflowId((currentWorkflowId) =>
      currentWorkflowId === workflowId ? "" : currentWorkflowId,
    );
    return true;
  }, []);

  const runWorkflow = useCallback(
    async (workflowId: string): Promise<RequestResult<WorkflowRunResult>> => {
      setRunningWorkflowId(workflowId);
      setWorkflowRunResult(null);
      try {
        const result = await runWorkflowRequest(workflowId);
        setWorkflowRunResult(result.data);
        return result;
      } finally {
        setRunningWorkflowId("");
      }
    },
    [],
  );

  return {
    activeWorkflow,
    activeWorkflowId,
    closeWorkflowEditor,
    deleteWorkflow,
    newWorkflowKey,
    openNewWorkflow,
    openWorkflow,
    replaceWorkflows,
    runWorkflow,
    runningWorkflowId,
    saveWorkflow,
    workflowRunResult,
    workflows,
  };
};
