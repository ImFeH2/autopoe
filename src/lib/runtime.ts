import type { JsonValue, Message, Notification, Request } from "@/lib/agent";

export type AgentStatus = "idle" | "running" | "failed";
export type MessageStatus = "streaming" | "complete" | "failed";
export type TurnStatus = "running" | "completed" | "failed";

export interface AgentInfo {
  id: string;
  name: string;
  role: string;
  status: AgentStatus;
  model: string;
  home: string;
}

export interface ChatMessage {
  id: string;
  author: "user" | "leader";
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
  input?: JsonValue;
  output?: JsonValue;
  message?: string;
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
  agent: AgentInfo | null;
  messages: ChatMessage[];
  turn: TurnSnapshot | null;
  error: string | null;
}

interface RuntimeSnapshot {
  agent: AgentInfo;
  messages: ChatMessage[];
  last_turn: TurnSnapshot | null;
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
  agent: null,
  messages: [],
  turn: null,
  error: null,
};

export function stateRequest(id: string): Request {
  return { id, method: "state/get" };
}

export function chatMessage(content: string): Notification {
  return { method: "chat/send", params: { content } };
}

export function connectionError(
  state: RuntimeState,
  error: unknown,
): RuntimeState {
  return {
    ...state,
    connection: "error",
    error: error instanceof Error ? error.message : String(error),
  };
}

export function reduceRuntimeMessage(
  state: RuntimeState,
  message: Message,
): RuntimeState {
  if ("result" in message && isRecord(message.result)) {
    const snapshot = message.result as unknown as RuntimeSnapshot;
    if (snapshot.agent && Array.isArray(snapshot.messages)) {
      return {
        connection: "ready",
        agent: snapshot.agent,
        messages: snapshot.messages,
        turn: snapshot.last_turn,
        error: snapshot.last_turn?.error ?? null,
      };
    }
  }

  if (!("method" in message) || !isRecord(message.params)) {
    return state;
  }

  if (message.method === "runtime/ready") {
    const { agent } = message.params as unknown as { agent: AgentInfo };
    return agent
      ? { ...state, connection: "ready", agent, error: null }
      : state;
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
      error: params.turn.error,
    };
  }

  return state;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
