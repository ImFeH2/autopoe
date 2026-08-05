import type {
  JsonValue,
  Message,
  Notification,
  Request,
  SuccessResponse,
} from "@/lib/agent";

export type AgentStatus = "idle" | "running" | "waiting" | "failed";
export type MessageStatus = "streaming" | "complete" | "failed" | "interrupted";
export type TurnStatus = "running" | "completed" | "failed" | "interrupted";

export interface ProjectInfo {
  id: string;
  name: string;
  workspace: string;
}

export interface AgentInfo {
  id: string;
  name: string;
  role: string;
  status: AgentStatus;
  model: string | null;
  home: string;
}

export interface ChatInfo {
  id: string;
  title: string;
  purpose: string;
}

export interface ChatMessage {
  id: string;
  chat_id: string;
  turn_id: string | null;
  author: string;
  content: string;
  status: MessageStatus;
}

export interface TurnContext {
  instructions: string;
  input: string;
  messages: JsonValue[];
  tools: string[];
}

export interface TurnEvent {
  kind: string;
  content?: string;
  name?: string;
  tool_call_id?: string;
  approved?: boolean;
  input?: JsonValue;
  output?: JsonValue;
  message?: string;
}

export interface CommandApproval {
  id: string;
  turn_id: string;
  agent_id: string;
  tool_call_id: string;
  tool: string;
  input: {
    space: "workspace" | "home";
    command: string;
    path?: string;
    timeout?: number;
  };
}

export interface TurnSnapshot {
  id: string;
  status: TurnStatus;
  context: TurnContext;
  events: TurnEvent[];
  usage: JsonValue;
  error: string | null;
}

export interface RuntimeState {
  connection: "connecting" | "ready" | "error";
  project: ProjectInfo | null;
  agent: AgentInfo | null;
  chat: ChatInfo | null;
  messages: ChatMessage[];
  turn: TurnSnapshot | null;
  approval: CommandApproval | null;
  error: string | null;
}

interface RuntimeSnapshot {
  project: ProjectInfo | null;
  agent: AgentInfo | null;
  chat: ChatInfo | null;
  messages: ChatMessage[];
  last_turn: TurnSnapshot | null;
}

interface RuntimeReady {
  project: ProjectInfo | null;
  agent: AgentInfo | null;
  chat: ChatInfo | null;
}

interface TurnStarted {
  agent: AgentInfo;
  user_message: ChatMessage;
  agent_message: ChatMessage;
  turn: TurnSnapshot;
}

interface TurnProgress {
  turn_id: string;
  event: TurnEvent;
}

interface TurnFinished {
  agent: AgentInfo;
  message: ChatMessage;
  turn: TurnSnapshot;
}

export const initialRuntimeState: RuntimeState = {
  connection: "connecting",
  project: null,
  agent: null,
  chat: null,
  messages: [],
  turn: null,
  approval: null,
  error: null,
};

export function stateRequest(id: string): Request {
  return { id, method: "state/get" };
}

export function projectOpenRequest(id: string, workspace: string): Request {
  return { id, method: "project/open", params: { workspace } };
}

export function chatMessage(content: string): Notification {
  return { method: "chat/send", params: { content } };
}

export function approvalResponse(
  id: string,
  approved: boolean,
): SuccessResponse {
  return { id, result: approved };
}

export function connectionError(
  state: RuntimeState,
  error: unknown,
): RuntimeState {
  return {
    ...runtimeError(state, error),
    connection: "error",
  };
}

export function runtimeError(
  state: RuntimeState,
  error: unknown,
): RuntimeState {
  return {
    ...state,
    error: error instanceof Error ? error.message : String(error),
  };
}

export function reduceRuntimeMessage(
  state: RuntimeState,
  message: Message,
): RuntimeState {
  if ("error" in message) {
    return { ...state, error: message.error.message };
  }

  if (
    "result" in message &&
    isRecord(message.result) &&
    Array.isArray(message.result.messages)
  ) {
    const snapshot = message.result as unknown as RuntimeSnapshot;
    return {
      connection: "ready",
      project: snapshot.project,
      agent: snapshot.agent,
      chat: snapshot.chat,
      messages: snapshot.messages,
      turn: snapshot.last_turn,
      approval: null,
      error: null,
    };
  }

  if (!("method" in message) || !isRecord(message.params)) {
    return state;
  }

  if (message.method === "runtime/ready") {
    const params = message.params as unknown as RuntimeReady;
    return {
      ...state,
      connection: "ready",
      project: params.project,
      agent: params.agent,
      chat: params.chat,
      approval: null,
      error: null,
    };
  }

  if (message.method === "turn/started") {
    const params = message.params as unknown as TurnStarted;
    const ids = new Set([params.user_message.id, params.agent_message.id]);
    return {
      ...state,
      connection: "ready",
      agent: params.agent,
      messages: [
        ...state.messages.filter((item) => !ids.has(item.id)),
        params.user_message,
        params.agent_message,
      ],
      turn: params.turn,
      approval: null,
      error: null,
    };
  }

  if (message.method === "agent/updated") {
    return {
      ...state,
      agent: message.params as unknown as AgentInfo,
      error: null,
    };
  }

  if (message.method === "approval/request" && "id" in message) {
    return {
      ...state,
      approval: {
        id: message.id,
        ...(message.params as unknown as Omit<CommandApproval, "id">),
      },
      error: null,
    };
  }

  if (message.method === "turn/event") {
    const params = message.params as unknown as TurnProgress;
    if (state.turn?.id !== params.turn_id) {
      return state;
    }
    const messages =
      params.event.kind === "text_delta" && params.event.content
        ? state.messages.map((item) =>
            item.id === `${params.turn_id}-agent`
              ? { ...item, content: item.content + params.event.content }
              : item,
          )
        : state.messages;
    return {
      ...state,
      messages,
      approval:
        params.event.kind === "approval_resolved" &&
        params.event.tool_call_id === state.approval?.tool_call_id
          ? null
          : state.approval,
      turn: {
        ...state.turn,
        events: [...state.turn.events, params.event],
      },
    };
  }

  if (message.method === "turn/completed" || message.method === "turn/failed") {
    const params = message.params as unknown as TurnFinished;
    return {
      ...state,
      agent: params.agent,
      messages: state.messages.map((item) =>
        item.id === params.message.id ? params.message : item,
      ),
      turn: params.turn,
      approval: null,
      error: null,
    };
  }

  return state;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
