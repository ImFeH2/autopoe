import type { ContentPart, Node, NodeDetail } from "@/types";
import { requestJson, requestVoid } from "./shared";

export async function fetchNodes(): Promise<Node[]> {
  return requestJson<{ nodes?: Array<Record<string, unknown>> }, Node[]>(
    "/api/nodes",
    {
      errorMessage: "Failed to fetch nodes",
      fallback: [],
      map: (data) =>
        (data?.nodes ?? []).map(
          (node) =>
            ({
              ...node,
              tab_id:
                typeof node.workflow_id === "string" ? node.workflow_id : null,
            }) as Node,
        ),
    },
  );
}

export async function fetchNodeDetail(
  nodeId: string,
  signal?: AbortSignal,
): Promise<NodeDetail | null> {
  return requestJson<Record<string, unknown>, NodeDetail | null>(
    `/api/nodes/${nodeId}`,
    {
      errorMessage: "Failed to fetch node detail",
      fallback: null,
      signal,
      swallowHttpError: true,
      map: (data) => {
        if (!data || !Array.isArray(data.history)) {
          return null;
        }
        return {
          ...(data as unknown as NodeDetail),
          tab_id:
            typeof data.workflow_id === "string" ? data.workflow_id : null,
        };
      },
    },
  );
}

export async function terminateNode(nodeId: string): Promise<void> {
  await requestVoid(`/api/nodes/${nodeId}/terminate`, {
    method: "POST",
    errorMessage: "Failed to terminate node",
  });
}

export async function interruptNode(nodeId: string): Promise<void> {
  await requestVoid(`/api/nodes/${nodeId}/interrupt`, {
    method: "POST",
    errorMessage: "Failed to interrupt node",
  });
}

export async function clearNodeChatRequest(nodeId: string): Promise<void> {
  await requestVoid(`/api/nodes/${nodeId}/clear-chat`, {
    method: "POST",
    errorMessage: "Failed to clear chat",
  });
}

export const clearAssistantChatRequest = clearNodeChatRequest;

export interface NodeMessageResponse {
  status: "sent" | "command_executed";
  command_name?: string;
  message_id?: string | null;
}

export async function dispatchNodeMessageRequest(
  nodeId: string,
  input: {
    content?: string;
    parts?: ContentPart[];
  },
): Promise<NodeMessageResponse> {
  return requestJson<
    {
      status: string;
      command_name?: string | null;
      message_id?: string | null;
    },
    NodeMessageResponse
  >(`/api/nodes/${nodeId}/messages`, {
    method: "POST",
    body: {
      content: input.content,
      parts: input.parts,
    },
    errorMessage: "Failed to send node message",
    map: (data) => ({
      status: data?.status === "command_executed" ? "command_executed" : "sent",
      command_name:
        typeof data?.command_name === "string" ? data.command_name : undefined,
      message_id:
        typeof data?.message_id === "string" ? data.message_id : undefined,
    }),
  });
}

export async function retryNodeMessageRequest(
  nodeId: string,
  messageId: string,
): Promise<{ message_id: string }> {
  return requestJson<
    { status: string; message_id?: string | null },
    { message_id: string }
  >(`/api/nodes/${nodeId}/messages/${messageId}/retry`, {
    method: "POST",
    errorMessage: "Failed to retry node message",
    map: (data) => {
      if (typeof data?.message_id !== "string") {
        throw new Error("Failed to retry node message");
      }
      return { message_id: data.message_id };
    },
  });
}
