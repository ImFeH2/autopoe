export type MessageRole = "user" | "assistant";

export type RunState =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export type RunEvent =
  | { type: "started" }
  | { type: "text_delta"; delta: string }
  | { type: "completed" }
  | { type: "failed"; message: string }
  | { type: "cancelled" };

export interface AgentMessage {
  role: MessageRole;
  content: string;
}

export interface ChatMessage extends AgentMessage {
  id: string;
  state?: RunState;
}
