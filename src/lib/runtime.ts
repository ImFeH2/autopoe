import type {
  JsonValue,
  Message,
  Notification,
  Request,
  SuccessResponse,
} from "@/lib/agent";
import type { ChatInfo, ChatMessage } from "@/lib/chats";

export type { ChatInfo, ChatMessage } from "@/lib/chats";

export type AgentStatus = "idle" | "running" | "waiting" | "failed";
export type TurnStatus = "running" | "completed" | "failed" | "interrupted";

export interface ProjectInfo {
  id: string;
  name: string;
  workspace: string;
}

export interface AgentInfo {
  id: string;
  kind: "leader" | "worker";
  name: string;
  role: string;
  status: AgentStatus;
  model: string | null;
  home: string;
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
  chat_id: string;
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
  agents: AgentInfo[];
  chat: ChatInfo | null;
  chats: ChatInfo[];
  messagesByChat: Record<string, ChatMessage[]>;
  turn: TurnSnapshot | null;
  approval: CommandApproval | null;
  error: string | null;
}

interface RuntimeSnapshot {
  project: ProjectInfo | null;
  agent: AgentInfo | null;
  agents: AgentInfo[];
  chat: ChatInfo | null;
  chats: ChatInfo[];
  messages: ChatMessage[];
  last_turn: TurnSnapshot | null;
}

interface RuntimeReady {
  project: ProjectInfo | null;
  agent: AgentInfo | null;
  agents: AgentInfo[];
  chat: ChatInfo | null;
  chats: ChatInfo[];
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

interface AgentsUpdated {
  agents: AgentInfo[];
}

interface ChatsUpdated {
  chats: ChatInfo[];
}

export const initialRuntimeState: RuntimeState = {
  connection: "connecting",
  project: null,
  agent: null,
  agents: [],
  chat: null,
  chats: [],
  messagesByChat: {},
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

export function replaceChatMessages(
  state: RuntimeState,
  chatId: string,
  messages: ChatMessage[],
): RuntimeState {
  return {
    ...state,
    messagesByChat: { ...state.messagesByChat, [chatId]: messages },
    error: null,
  };
}

export function addChatMessage(
  state: RuntimeState,
  message: ChatMessage,
): RuntimeState {
  return {
    ...state,
    messagesByChat: upsertMessages(state.messagesByChat, message.chat_id, [
      message,
    ]),
    error: null,
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
      agents: snapshot.agents,
      chat: snapshot.chat,
      chats: snapshot.chats,
      messagesByChat: snapshot.chat
        ? { [snapshot.chat.id]: snapshot.messages }
        : {},
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
      agents: params.agents,
      chat: params.chat,
      chats: params.chats,
      approval: null,
      error: null,
    };
  }

  if (message.method === "turn/started") {
    const params = message.params as unknown as TurnStarted;
    return {
      ...state,
      connection: "ready",
      agent: params.agent,
      agents: replaceAgent(state.agents, params.agent),
      messagesByChat: upsertMessages(
        state.messagesByChat,
        params.user_message.chat_id,
        [params.user_message, params.agent_message],
      ),
      turn: params.turn,
      approval: null,
      error: null,
    };
  }

  if (message.method === "agent/updated") {
    const agent = message.params as unknown as AgentInfo;
    return {
      ...state,
      agent,
      agents: replaceAgent(state.agents, agent),
      error: null,
    };
  }

  if (message.method === "agents/updated") {
    const params = message.params as unknown as AgentsUpdated;
    const agent = state.agent
      ? (params.agents.find((item) => item.id === state.agent?.id) ??
        state.agent)
      : (params.agents.find((item) => item.kind === "leader") ?? null);
    return { ...state, agent, agents: params.agents, error: null };
  }

  if (message.method === "chats/updated") {
    const params = message.params as unknown as ChatsUpdated;
    const chat = state.chat
      ? (params.chats.find((item) => item.id === state.chat?.id) ?? state.chat)
      : (params.chats.find((item) => item.kind === "general") ?? null);
    return { ...state, chat, chats: params.chats, error: null };
  }

  if (message.method === "chat/message") {
    return addChatMessage(state, message.params as unknown as ChatMessage);
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
    const chatId = state.turn.chat_id;
    const messages = state.messagesByChat[chatId] ?? [];
    const updatedMessages =
      params.event.kind === "text_delta" && params.event.content
        ? messages.map((item) =>
            item.id === `${params.turn_id}-agent`
              ? { ...item, content: item.content + params.event.content }
              : item,
          )
        : messages;
    return {
      ...state,
      messagesByChat: {
        ...state.messagesByChat,
        [chatId]: updatedMessages,
      },
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
      agents: replaceAgent(state.agents, params.agent),
      messagesByChat: upsertMessages(
        state.messagesByChat,
        params.message.chat_id,
        [params.message],
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

function replaceAgent(agents: AgentInfo[], agent: AgentInfo): AgentInfo[] {
  return agents.some((item) => item.id === agent.id)
    ? agents.map((item) => (item.id === agent.id ? agent : item))
    : [...agents, agent];
}

function upsertMessages(
  messagesByChat: Record<string, ChatMessage[]>,
  chatId: string,
  messages: ChatMessage[],
): Record<string, ChatMessage[]> {
  const incoming = new Map(messages.map((message) => [message.id, message]));
  const current = (messagesByChat[chatId] ?? []).map(
    (message) => incoming.get(message.id) ?? message,
  );
  const existing = new Set(current.map((message) => message.id));
  const added = messages.filter((message) => !existing.has(message.id));
  return { ...messagesByChat, [chatId]: [...current, ...added] };
}
