import type {
  ApiWorkflow,
  ApiWorkflowRunResult,
  ApiWorkflowSaveRequest,
  ApiWorkflowSchedule,
  RequestResult,
} from "@/app/api/types";
import {
  errorMessageFromResponse,
  workflowFromApi,
  workflowRunRequestToApi,
  workflowRunResultFromApi,
  workflowScheduleFromApi,
  workflowScheduleStartRequestToApi,
  workflowToApi,
} from "@/app/api/mappers";
import type {
  Workflow,
  WorkflowRunRequest,
  WorkflowRunResult,
  WorkflowSchedule,
  WorkflowScheduleStartRequest,
} from "@/components/flowent/types";

export const saveWorkflowRequest = async (
  workflow: Workflow,
): Promise<RequestResult<Workflow>> => {
  const body: ApiWorkflowSaveRequest = {
    base_revision: workflow.revision > 0 ? workflow.revision : null,
    workflow: workflowToApi(workflow),
  };
  const response = await fetch("/api/workflows", {
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
    method: "PUT",
  });

  if (response.status === 409) {
    const conflict = (await response.json()) as {
      detail?: string;
      workflow?: ApiWorkflow;
    };
    return {
      data: null,
      error:
        conflict.detail ??
        "This workflow changed elsewhere. The latest version is now open.",
      ...(conflict.workflow
        ? { latest: workflowFromApi(conflict.workflow) }
        : {}),
    };
  }

  if (!response.ok) {
    return {
      data: null,
      error: await errorMessageFromResponse(
        response,
        "Workflow could not be saved.",
      ),
    };
  }

  const savedWorkflow = workflowFromApi((await response.json()) as ApiWorkflow);
  return { data: savedWorkflow, error: "" };
};

export const deleteWorkflowRequest = async (workflowId: string) => {
  const response = await fetch(
    `/api/workflows/${encodeURIComponent(workflowId)}`,
    {
      headers: { "Content-Type": "application/json" },
      method: "DELETE",
    },
  );

  return response.ok;
};

export const runWorkflowRequest = async (
  workflowId: string,
  request: WorkflowRunRequest = {},
): Promise<RequestResult<WorkflowRunResult>> => {
  const response = await fetch(
    `/api/workflows/${encodeURIComponent(workflowId)}/run`,
    {
      body: JSON.stringify(workflowRunRequestToApi(request)),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    },
  );

  if (!response.ok) {
    return {
      data: null,
      error: await errorMessageFromResponse(
        response,
        "Run could not be completed.",
      ),
    };
  }

  const result = workflowRunResultFromApi(
    (await response.json()) as ApiWorkflowRunResult,
  );
  return { data: result, error: "" };
};

export const fetchWorkflowScheduleRequest = async (
  workflowId: string,
): Promise<RequestResult<WorkflowSchedule>> => {
  const response = await fetch(
    `/api/workflows/${encodeURIComponent(workflowId)}/schedule`,
  );

  if (!response.ok) {
    return {
      data: null,
      error: await errorMessageFromResponse(
        response,
        "Run status could not be loaded.",
      ),
    };
  }

  return {
    data: workflowScheduleFromApi(
      (await response.json()) as ApiWorkflowSchedule,
    ),
    error: "",
  };
};

export const startWorkflowScheduleRequest = async (
  workflowId: string,
  request: WorkflowScheduleStartRequest = {},
): Promise<RequestResult<WorkflowSchedule>> => {
  const response = await fetch(
    `/api/workflows/${encodeURIComponent(workflowId)}/schedule/start`,
    {
      body: JSON.stringify(workflowScheduleStartRequestToApi(request)),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    },
  );

  if (!response.ok) {
    return {
      data: null,
      error: await errorMessageFromResponse(
        response,
        "Workflow could not be started.",
      ),
    };
  }

  return {
    data: workflowScheduleFromApi(
      (await response.json()) as ApiWorkflowSchedule,
    ),
    error: "",
  };
};

export const stopWorkflowScheduleRequest = async (
  workflowId: string,
): Promise<RequestResult<WorkflowSchedule>> => {
  const response = await fetch(
    `/api/workflows/${encodeURIComponent(workflowId)}/schedule/stop`,
    {
      headers: { "Content-Type": "application/json" },
      method: "POST",
    },
  );

  if (!response.ok) {
    return {
      data: null,
      error: await errorMessageFromResponse(
        response,
        "Workflow could not be stopped.",
      ),
    };
  }

  return {
    data: workflowScheduleFromApi(
      (await response.json()) as ApiWorkflowSchedule,
    ),
    error: "",
  };
};
