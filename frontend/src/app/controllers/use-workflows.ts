import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  deleteWorkflowRequest,
  fetchWorkflowScheduleRequest,
  runWorkflowRequest,
  saveWorkflowRequest,
  startWorkflowScheduleRequest,
  stopWorkflowScheduleRequest,
} from "@/features/workflows/api/workflow-requests";
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
import i18n from "@/i18n/i18n";
import type { RequestResult } from "@/shared/api/request-result";

const SCHEDULE_POLL_INTERVAL_MS = 2_000;

const workflowHasTimer = (workflow: Workflow | null) =>
  Boolean(workflow?.spec.nodes.some((node) => node.kind === "timer"));

const upsertWorkflow = (workflows: Workflow[], incomingWorkflow: Workflow) => {
  const existing = workflows.find(
    (workflow) => workflow.id === incomingWorkflow.id,
  );
  if (!existing) {
    return [incomingWorkflow, ...workflows];
  }
  if (existing.revision > incomingWorkflow.revision) {
    return workflows;
  }
  return workflows.map((workflow) =>
    workflow.id === incomingWorkflow.id ? incomingWorkflow : workflow,
  );
};

const loadWorkflowSchedule = async (
  workflowId: string,
): Promise<RequestResult<WorkflowSchedule>> => {
  try {
    return await fetchWorkflowScheduleRequest(workflowId);
  } catch {
    return {
      data: null,
      error: i18n.t("workflows.errors.loadRunStatus"),
    };
  }
};

export const useWorkflows = (initialWorkflowId = "") => {
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [workflowRunResult, setWorkflowRunResult] =
    useState<WorkflowRunResult | null>(null);
  const [runningWorkflowId, setRunningWorkflowId] = useState("");
  const [scheduleByWorkflowId, setScheduleByWorkflowId] = useState<
    Record<string, WorkflowSchedule>
  >({});
  const [
    scheduleRequestStateByWorkflowId,
    setScheduleRequestStateByWorkflowId,
  ] = useState<Record<string, WorkflowScheduleRequestState>>({});
  const [activeWorkflowId, setActiveWorkflowId] = useState(initialWorkflowId);
  const [newWorkflowKey, setNewWorkflowKey] = useState(0);
  const scheduleRequestVersionRef = useRef(new Map<string, number>());
  const scheduleMutationRef = useRef(new Set<string>());
  const scheduleByWorkflowIdRef = useRef(scheduleByWorkflowId);

  useEffect(() => {
    scheduleByWorkflowIdRef.current = scheduleByWorkflowId;
  }, [scheduleByWorkflowId]);

  const activeWorkflow = useMemo(
    () =>
      workflows.find((workflow) => workflow.id === activeWorkflowId) ?? null,
    [activeWorkflowId, workflows],
  );
  const activeWorkflowHasTimer = workflowHasTimer(activeWorkflow);
  const workflowSchedule = scheduleByWorkflowId[activeWorkflowId] ?? null;
  const workflowScheduleRequestState =
    scheduleRequestStateByWorkflowId[activeWorkflowId] ?? "idle";

  const nextScheduleRequestVersion = useCallback((workflowId: string) => {
    const nextVersion =
      (scheduleRequestVersionRef.current.get(workflowId) ?? 0) + 1;
    scheduleRequestVersionRef.current.set(workflowId, nextVersion);
    return nextVersion;
  }, []);

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

  const openWorkflow = useCallback(
    (workflowId: string) => {
      if (workflowId === activeWorkflowId) {
        return;
      }
      setActiveWorkflowId(workflowId);
      setScheduleRequestStateByWorkflowId((currentStates) => ({
        ...currentStates,
        [workflowId]: "idle",
      }));
    },
    [activeWorkflowId],
  );

  const closeWorkflowEditor = useCallback(() => {
    setActiveWorkflowId("");
  }, []);

  const saveWorkflow = useCallback(
    async (workflow: Workflow): Promise<RequestResult<Workflow>> => {
      let result: RequestResult<Workflow>;
      try {
        result = await saveWorkflowRequest(workflow);
      } catch {
        return {
          data: null,
          error: i18n.t("workflows.errors.save"),
        };
      }
      if (!result.data) {
        if (result.latest) {
          setWorkflows((currentWorkflows) =>
            upsertWorkflow(currentWorkflows, result.latest as Workflow),
          );
        }
        return result;
      }
      const savedWorkflow = result.data;
      setWorkflows((currentWorkflows) =>
        upsertWorkflow(currentWorkflows, savedWorkflow),
      );
      if (workflowHasTimer(savedWorkflow)) {
        setScheduleRequestStateByWorkflowId((currentStates) =>
          currentStates[savedWorkflow.id]
            ? currentStates
            : { ...currentStates, [savedWorkflow.id]: "idle" },
        );
      }
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
    setScheduleByWorkflowId((currentSchedules) => {
      const nextSchedules = { ...currentSchedules };
      delete nextSchedules[workflowId];
      return nextSchedules;
    });
    setScheduleRequestStateByWorkflowId((currentStates) => {
      const nextStates = { ...currentStates };
      delete nextStates[workflowId];
      return nextStates;
    });
    scheduleRequestVersionRef.current.delete(workflowId);
    scheduleMutationRef.current.delete(workflowId);
    setActiveWorkflowId((currentWorkflowId) =>
      currentWorkflowId === workflowId ? "" : currentWorkflowId,
    );
    return true;
  }, []);

  const renameWorkflow = useCallback(
    async (
      workflowId: string,
      nextName: string,
    ): Promise<RequestResult<Workflow>> => {
      const workflow = workflows.find(
        (currentWorkflow) => currentWorkflow.id === workflowId,
      );
      if (!workflow) {
        return {
          data: null,
          error: i18n.t("workflows.errors.rename"),
        };
      }
      return saveWorkflow({ ...workflow, name: nextName });
    },
    [saveWorkflow, workflows],
  );

  const runWorkflow = useCallback(
    async (
      workflowId: string,
      request: WorkflowRunRequest = {},
    ): Promise<RequestResult<WorkflowRunResult>> => {
      setRunningWorkflowId(workflowId);
      setWorkflowRunResult(null);
      try {
        const result = await runWorkflowRequest(workflowId, request);
        setWorkflowRunResult(result.data);
        return result;
      } finally {
        setRunningWorkflowId("");
      }
    },
    [],
  );

  useEffect(() => {
    if (
      !activeWorkflowId ||
      !activeWorkflowHasTimer ||
      scheduleMutationRef.current.has(activeWorkflowId)
    ) {
      return;
    }

    let ignore = false;
    const requestVersion = nextScheduleRequestVersion(activeWorkflowId);
    setScheduleRequestStateByWorkflowId((currentStates) => ({
      ...currentStates,
      [activeWorkflowId]: "loading",
    }));

    void loadWorkflowSchedule(activeWorkflowId).then((result) => {
      if (
        ignore ||
        scheduleRequestVersionRef.current.get(activeWorkflowId) !==
          requestVersion
      ) {
        return;
      }
      if (!result.data) {
        setScheduleRequestStateByWorkflowId((currentStates) => ({
          ...currentStates,
          [activeWorkflowId]: scheduleByWorkflowIdRef.current[activeWorkflowId]
            ? "ready"
            : "unavailable",
        }));
        return;
      }
      setScheduleByWorkflowId((currentSchedules) => ({
        ...currentSchedules,
        [activeWorkflowId]: result.data,
      }));
      setScheduleRequestStateByWorkflowId((currentStates) => ({
        ...currentStates,
        [activeWorkflowId]: "ready",
      }));
    });

    return () => {
      ignore = true;
    };
  }, [activeWorkflowHasTimer, activeWorkflowId, nextScheduleRequestVersion]);

  useEffect(() => {
    if (
      !activeWorkflowId ||
      !activeWorkflowHasTimer ||
      !["ready", "unavailable"].includes(workflowScheduleRequestState)
    ) {
      return;
    }

    let ignore = false;
    let timeoutId: number | null = null;
    const pollSchedule = async () => {
      if (!scheduleMutationRef.current.has(activeWorkflowId)) {
        const requestVersion = nextScheduleRequestVersion(activeWorkflowId);
        const result = await loadWorkflowSchedule(activeWorkflowId);
        if (
          !ignore &&
          scheduleRequestVersionRef.current.get(activeWorkflowId) ===
            requestVersion &&
          result.data
        ) {
          setScheduleByWorkflowId((currentSchedules) => ({
            ...currentSchedules,
            [activeWorkflowId]: result.data,
          }));
          setScheduleRequestStateByWorkflowId((currentStates) => ({
            ...currentStates,
            [activeWorkflowId]: "ready",
          }));
        }
      }
      if (!ignore) {
        timeoutId = window.setTimeout(() => {
          void pollSchedule();
        }, SCHEDULE_POLL_INTERVAL_MS);
      }
    };

    timeoutId = window.setTimeout(() => {
      void pollSchedule();
    }, SCHEDULE_POLL_INTERVAL_MS);
    return () => {
      ignore = true;
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [
    activeWorkflowHasTimer,
    activeWorkflowId,
    nextScheduleRequestVersion,
    workflowScheduleRequestState,
  ]);

  const startWorkflowSchedule = useCallback(
    async (
      workflowId: string,
      request: WorkflowScheduleStartRequest = {},
    ): Promise<RequestResult<WorkflowSchedule>> => {
      scheduleMutationRef.current.add(workflowId);
      nextScheduleRequestVersion(workflowId);
      setScheduleRequestStateByWorkflowId((currentStates) => ({
        ...currentStates,
        [workflowId]: "starting",
      }));
      let result: RequestResult<WorkflowSchedule>;
      try {
        result = await startWorkflowScheduleRequest(workflowId, request);
      } catch {
        result = {
          data: null,
          error: i18n.t("workflows.errors.start"),
        };
      } finally {
        scheduleMutationRef.current.delete(workflowId);
      }
      if (!result.data) {
        setScheduleRequestStateByWorkflowId((currentStates) => ({
          ...currentStates,
          [workflowId]: scheduleByWorkflowId[workflowId]
            ? "ready"
            : "unavailable",
        }));
        return result;
      }
      setScheduleByWorkflowId((currentSchedules) => ({
        ...currentSchedules,
        [workflowId]: result.data,
      }));
      setScheduleRequestStateByWorkflowId((currentStates) => ({
        ...currentStates,
        [workflowId]: "ready",
      }));
      return result;
    },
    [nextScheduleRequestVersion, scheduleByWorkflowId],
  );

  const stopWorkflowSchedule = useCallback(
    async (workflowId: string): Promise<RequestResult<WorkflowSchedule>> => {
      scheduleMutationRef.current.add(workflowId);
      nextScheduleRequestVersion(workflowId);
      setScheduleRequestStateByWorkflowId((currentStates) => ({
        ...currentStates,
        [workflowId]: "stopping",
      }));
      let result: RequestResult<WorkflowSchedule>;
      try {
        result = await stopWorkflowScheduleRequest(workflowId);
      } catch {
        result = {
          data: null,
          error: i18n.t("workflows.errors.stop"),
        };
      } finally {
        scheduleMutationRef.current.delete(workflowId);
      }
      if (!result.data) {
        setScheduleRequestStateByWorkflowId((currentStates) => ({
          ...currentStates,
          [workflowId]: scheduleByWorkflowId[workflowId]
            ? "ready"
            : "unavailable",
        }));
        return result;
      }
      setScheduleByWorkflowId((currentSchedules) => ({
        ...currentSchedules,
        [workflowId]: result.data,
      }));
      setScheduleRequestStateByWorkflowId((currentStates) => ({
        ...currentStates,
        [workflowId]: "ready",
      }));
      return result;
    },
    [nextScheduleRequestVersion, scheduleByWorkflowId],
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
    renameWorkflow,
    runWorkflow,
    runningWorkflowId,
    saveWorkflow,
    startWorkflowSchedule,
    stopWorkflowSchedule,
    workflowRunResult,
    workflowSchedule,
    workflowScheduleRequestState,
    workflows,
  };
};
