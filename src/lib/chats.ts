import { request } from "@/lib/agent";

export type MessageStatus = "streaming" | "complete" | "failed" | "interrupted";

export interface ChatInfo {
  id: string;
  title: string;
  purpose: string;
  kind: "general" | "custom";
  created_by: string;
  members: string[];
}

export interface ChatMessage {
  id: string;
  chat_id: string;
  turn_id: string | null;
  author: string;
  content: string;
  status: MessageStatus;
}

export interface ChatInput {
  title: string;
  purpose: string;
  members: string[];
}

export async function listChats(): Promise<ChatInfo[]> {
  const result = await request("chats/list");
  if (!Array.isArray(result)) {
    throw new Error("Invalid chat list");
  }
  return result.map(readChat);
}

export async function createChat(input: ChatInput): Promise<ChatInfo> {
  return readChat(
    await request("chats/create", {
      title: input.title,
      purpose: input.purpose,
      members: input.members,
    }),
  );
}

export async function updateChat(
  chatId: string,
  input: ChatInput,
): Promise<ChatInfo> {
  return readChat(await request("chats/update", { id: chatId, ...input }));
}

export async function closeChat(chatId: string): Promise<void> {
  await request("chats/close", { id: chatId });
}

export async function listChatMessages(chatId: string): Promise<ChatMessage[]> {
  const result = await request("chats/messages", { id: chatId });
  if (!Array.isArray(result)) {
    throw new Error("Invalid chat messages");
  }
  return result.map(readMessage);
}

export async function sendChatMessage(
  chatId: string,
  content: string,
): Promise<ChatMessage> {
  return readMessage(await request("chats/send", { id: chatId, content }));
}

function readChat(value: unknown): ChatInfo {
  if (!isRecord(value)) {
    throw new Error("Invalid chat");
  }
  const { id, title, purpose, kind, created_by, members } = value;
  if (
    typeof id !== "string" ||
    typeof title !== "string" ||
    typeof purpose !== "string" ||
    (kind !== "general" && kind !== "custom") ||
    typeof created_by !== "string" ||
    !Array.isArray(members) ||
    !members.every((member) => typeof member === "string")
  ) {
    throw new Error("Invalid chat");
  }
  return { id, title, purpose, kind, created_by, members };
}

function readMessage(value: unknown): ChatMessage {
  if (!isRecord(value)) {
    throw new Error("Invalid chat message");
  }
  const { id, chat_id, turn_id, author, content, status } = value;
  if (
    typeof id !== "string" ||
    typeof chat_id !== "string" ||
    (turn_id !== null && typeof turn_id !== "string") ||
    typeof author !== "string" ||
    typeof content !== "string" ||
    !["streaming", "complete", "failed", "interrupted"].includes(String(status))
  ) {
    throw new Error("Invalid chat message");
  }
  return {
    id,
    chat_id,
    turn_id,
    author,
    content,
    status: status as MessageStatus,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
