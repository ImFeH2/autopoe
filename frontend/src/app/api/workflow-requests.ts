import type {
  ApiWorkflow,
  ApiWorkflowRunResult,
  RequestResult,
} from "@/app/api/types";
import {
  errorMessageFromResponse,
  workflowFromApi,
  workflowRunRequestToApi,
  workflowRunResultFromApi,
  workflowToApi,
} from "@/app/api/mappers";
import type {
  Workflow,
  WorkflowRunRequest,
  WorkflowRunResult,
} from "@/components/flowent/types";

export const saveWorkflowRequest = async (
  workflow: Workflow,
): Promise<RequestResult<Workflow>> => {
  const response = await fetch("/api/workflows", {
    body: JSON.stringify(workflowToApi(workflow)),
    headers: { "Content-Type": "application/json" },
    method: "PUT",
  });

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
      signal: request.signal,
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
