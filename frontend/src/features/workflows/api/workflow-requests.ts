import type {
  ApiWorkflow,
  ApiWorkflowRunResult,
  ApiWorkflowSaveRequest,
  ApiWorkflowSchedule,
} from "@/features/workflows/api/workflow-api-types";
import {
  workflowFromApi,
  workflowRunRequestToApi,
  workflowRunResultFromApi,
  workflowScheduleFromApi,
  workflowScheduleStartRequestToApi,
  workflowToApi,
} from "@/features/workflows/api/workflow-mappers";
import type {
  WorkflowRunRequest,
  WorkflowRunResult,
} from "@/features/workflows/model/workflow-run-types";
import type {
  WorkflowSchedule,
  WorkflowScheduleStartRequest,
} from "@/features/workflows/model/workflow-schedule-types";
import type { Workflow } from "@/features/workflows/model/workflow-types";
import i18n from "@/i18n/i18n";
import type { RequestResult } from "@/shared/api/request-result";

const errorMessageFromResponse = async (
  response: Response,
  fallback: string,
) => {
  try {
    const body = (await response.json()) as { detail?: unknown };
    if (typeof body.detail === "string" && body.detail.trim()) {
      return body.detail;
    }
  } catch {
    return fallback;
  }
  return fallback;
};

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
      error: conflict.detail ?? i18n.t("workflows.errors.conflict"),
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
        i18n.t("workflows.errors.save"),
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
        i18n.t("workflows.errors.run"),
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
        i18n.t("workflows.errors.loadRunStatus"),
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
        i18n.t("workflows.errors.start"),
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
        i18n.t("workflows.errors.stop"),
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
