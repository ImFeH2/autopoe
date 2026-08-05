import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  request: vi.fn(),
}));

vi.mock("@/lib/agent", () => ({ request: mocks.request }));

import {
  closeChat,
  createChat,
  listChatMessages,
  listChats,
  sendChatMessage,
  updateChat,
} from "@/lib/chats";

const chat = {
  id: "chat-1",
  title: "Architecture",
  purpose: "Decisions",
  kind: "custom",
  created_by: "user",
  members: ["leader", "worker-1"],
};

const message = {
  id: "message-1",
  chat_id: chat.id,
  turn_id: null,
  author: "user",
  content: "Review this",
  status: "complete",
};

describe("chats", () => {
  beforeEach(() => {
    mocks.request.mockReset();
  });

  it("lists and validates chats", async () => {
    mocks.request.mockResolvedValue([chat]);

    await expect(listChats()).resolves.toEqual([chat]);
    expect(mocks.request).toHaveBeenCalledWith("chats/list");
  });

  it("creates and updates chats", async () => {
    mocks.request.mockResolvedValue(chat);
    const input = {
      title: chat.title,
      purpose: chat.purpose,
      members: chat.members,
    };

    await createChat(input);
    expect(mocks.request).toHaveBeenLastCalledWith("chats/create", input);

    await updateChat(chat.id, input);
    expect(mocks.request).toHaveBeenLastCalledWith("chats/update", {
      id: chat.id,
      ...input,
    });
  });

  it("loads and sends messages", async () => {
    mocks.request
      .mockResolvedValueOnce([message])
      .mockResolvedValueOnce(message);

    await expect(listChatMessages(chat.id)).resolves.toEqual([message]);
    await expect(sendChatMessage(chat.id, message.content)).resolves.toEqual(
      message,
    );
    expect(mocks.request).toHaveBeenLastCalledWith("chats/send", {
      id: chat.id,
      content: message.content,
    });
  });

  it("closes chats", async () => {
    mocks.request.mockResolvedValue({ closed: chat.id });

    await closeChat(chat.id);

    expect(mocks.request).toHaveBeenCalledWith("chats/close", { id: chat.id });
  });
});
