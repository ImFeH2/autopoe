import type { ApiState, WorkspaceMessageEditResponse } from "@/app/api/types";
import { WorkspaceRequestError } from "@/app/workspace/messages";
import {
  readWorkspaceStream,
  type WorkspaceStreamHandlers,
} from "@/app/workspace/stream";
import type {
  MessageActionRequest,
  MessageErrorRetryRequest,
} from "@/features/workspace/model/message-types";

export const responseErrorFromApi = async (response: Response) => {
  try {
    const result = (await response.json()) as { detail?: unknown };
    if (typeof result.detail === "string") {
      return result.detail;
    }
  } catch {
    return "Message could not be sent.";
  }
  return response.status === 409
    ? "Response in progress"
    : "Message could not be sent.";
};

export const clearWorkspace = async () => {
  const response = await fetch("/api/workspace/clear", {
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });

  if (!response.ok) {
    throw new Error("Conversation could not be cleared.");
  }

  return (await response.json()) as Partial<ApiState>;
};

export const editWorkspaceMessage = async ({
  action,
  content,
  messageId,
}: MessageActionRequest) => {
  const response = await fetch(
    `/api/workspace/messages/${encodeURIComponent(messageId)}/edit`,
    {
      body: JSON.stringify({ action, content }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    },
  );

  if (!response.ok) {
    let detail = "";
    try {
      const result = (await response.json()) as { detail?: unknown };
      if (typeof result.detail === "string") {
        detail = result.detail;
      }
    } catch {
      detail = "";
    }
    if (detail) {
      throw new Error(detail);
    }
    throw new Error(
      response.status === 409
        ? "Response in progress"
        : "Message could not be updated.",
    );
  }

  const result = (await response.json()) as WorkspaceMessageEditResponse;
  if (!Array.isArray(result.messages)) {
    throw new Error("Message could not be updated.");
  }
  return result;
};

export const retryWorkspaceError = async ({
  errorId,
  messageId,
}: MessageErrorRetryRequest) => {
  const response = await fetch(
    `/api/workspace/messages/${encodeURIComponent(messageId)}/errors/${encodeURIComponent(errorId)}/retry`,
    {
      headers: { "Content-Type": "application/json" },
      method: "POST",
    },
  );

  if (!response.ok) {
    throw new Error(await responseErrorFromApi(response));
  }

  const result = (await response.json()) as WorkspaceMessageEditResponse;
  if (!Array.isArray(result.messages)) {
    throw new Error("Message could not be updated.");
  }
  return result;
};

export const requestWorkspaceResponse = async ({
  content,
  handlers,
  messageId,
  signal,
}: {
  content: string;
  handlers: WorkspaceStreamHandlers;
  messageId: string;
  signal?: AbortSignal;
}) => {
  const response = await fetch("/api/workspace/respond", {
    body: JSON.stringify({ content, message_id: messageId }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
    signal,
  });

  if (!response.ok) {
    throw new WorkspaceRequestError(await responseErrorFromApi(response));
  }

  await readWorkspaceStream(response, handlers);
};

export const streamWorkspaceResponse = async ({
  after,
  handlers,
  signal,
}: {
  after: number;
  handlers: WorkspaceStreamHandlers;
  signal?: AbortSignal;
}) => {
  const response = await fetch(`/api/workspace/stream?after=${after}`, {
    headers: { "Content-Type": "text/event-stream" },
    method: "GET",
    signal,
  });

  if (!response.ok) {
    throw new Error(await responseErrorFromApi(response));
  }

  await readWorkspaceStream(response, handlers);
};

export const compactWorkspaceRequest = async () => {
  const response = await fetch("/api/workspace/compact", {
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });

  if (!response.ok) {
    throw new Error(await responseErrorFromApi(response));
  }

  return response;
};

export const stopWorkspaceResponse = () =>
  fetch("/api/workspace/stop", {
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
