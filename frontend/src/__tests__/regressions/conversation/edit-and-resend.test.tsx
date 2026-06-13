import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import App from "@/App";

type TestMessage = {
  active_output?: "text" | "thinking" | null;
  author: "assistant" | "system" | "user";
  content: string;
  id: string;
  isStreamingText?: boolean;
  status?: string;
};

const selectedProviderState = (messages: TestMessage[]) => ({
  mcp_servers: [],
  messages,
  providers: [
    {
      api_key: "sk-local",
      base_url: "",
      id: "provider-openai",
      models: ["gpt-5.1"],
      name: "OpenAI",
      type: "openai",
    },
  ],
  settings: {
    reasoning_effort: "default",
    selected_model: "gpt-5.1",
    selected_provider_id: "provider-openai",
  },
  skills: [],
  telegram_bot: {
    bot_token: "",
    enabled: false,
    error: "",
    sessions: [],
    status: "disabled",
  },
});

const streamEvent = (event: string, data: Record<string, unknown>) =>
  `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

const assistantStreamResponse = (
  content: string,
  id = "message-assistant-new",
) => {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(streamEvent("start", { id })));
      controller.enqueue(
        encoder.encode(streamEvent("output_start", { index: 1 })),
      );
      controller.enqueue(encoder.encode(streamEvent("delta", { content })));
      controller.enqueue(
        encoder.encode(
          streamEvent("done", {
            message: {
              author: "assistant",
              content,
              id,
            },
          }),
        ),
      );
      controller.close();
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream" },
    status: 200,
  });
};

const messageArticle = async (text: string) => {
  const content = await screen.findByText(text);
  const article = content.closest("article");
  if (!article) {
    throw new Error(`Message article not found for ${text}`);
  }
  return article;
};

describe("edit and resend regressions", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows message actions without hover on touch devices", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "fetch").mockImplementation(async (input) => {
      if (input === "/api/state") {
        return new Response(
          JSON.stringify(
            selectedProviderState([
              {
                author: "user",
                content: "Draft a launch checklist",
                id: "message-user",
              },
              {
                active_output: "text",
                author: "assistant",
                content: "Old checklist.",
                id: "message-assistant",
                isStreamingText: false,
                status: "completed",
              },
            ]),
          ),
          {
            headers: { "Content-Type": "application/json" },
            status: 200,
          },
        );
      }
      if (input === "/api/about") {
        return new Response(JSON.stringify({}), {
          headers: { "Content-Type": "application/json" },
          status: 200,
        });
      }
      return new Response(JSON.stringify({}), {
        headers: { "Content-Type": "application/json" },
        status: 200,
      });
    });
    render(<App />);

    const userArticle = await messageArticle("Draft a launch checklist");
    const editButton = within(userArticle).getByRole("button", {
      name: "Edit",
    });
    const userActionBar = editButton.closest("div");
    expect(userActionBar).toHaveClass("opacity-100");
    expect(userActionBar).toHaveClass("hover-only:opacity-0");
    expect(userActionBar).toHaveClass(
      "hover-only:group-hover/message:opacity-100",
    );
    expect(userActionBar).not.toHaveClass("opacity-0");

    await user.click(editButton);
    expect(
      within(userArticle).getByRole("textbox", { name: "Edit message" }),
    ).toBeInTheDocument();

    const assistantArticle = await messageArticle("Old checklist.");
    const assistantActionBar = within(assistantArticle)
      .getByRole("button", { name: "Retry" })
      .closest("div");
    expect(assistantActionBar).toHaveClass("opacity-100");
    expect(assistantActionBar).not.toHaveClass("opacity-0");
  });

  it("edits and resends a user message without uploading the conversation history", async () => {
    const user = userEvent.setup();
    const messages: TestMessage[] = [
      {
        author: "user",
        content: "Draft a launch checklist",
        id: "message-user",
      },
      {
        active_output: "text",
        author: "assistant",
        content: "Old checklist.",
        id: "message-assistant",
        isStreamingText: false,
        status: "completed",
      },
      {
        author: "user",
        content: "Keep this later note",
        id: "message-later-user",
      },
    ];
    vi.spyOn(window, "fetch").mockImplementation(async (input, init) => {
      if (input === "/api/state") {
        return new Response(JSON.stringify(selectedProviderState(messages)), {
          headers: { "Content-Type": "application/json" },
          status: 200,
        });
      }
      if (input === "/api/about") {
        return new Response(JSON.stringify({}), {
          headers: { "Content-Type": "application/json" },
          status: 200,
        });
      }
      if (
        input === "/api/workspace/messages/message-user/edit" &&
        init?.method === "POST"
      ) {
        return new Response(
          JSON.stringify({
            is_responding: true,
            messages: [
              {
                author: "user",
                content: "Update the launch checklist",
                id: "message-user",
              },
            ],
          }),
          {
            headers: { "Content-Type": "application/json" },
            status: 200,
          },
        );
      }
      if (input === "/api/workspace/stream?after=0" && init?.method === "GET") {
        return assistantStreamResponse("Fresh checklist.");
      }
      return new Response(JSON.stringify({}), {
        headers: { "Content-Type": "application/json" },
        status: 200,
      });
    });
    render(<App />);

    const article = await messageArticle("Draft a launch checklist");
    await user.click(within(article).getByRole("button", { name: "Edit" }));
    const editor = within(article).getByRole("textbox", {
      name: "Edit message",
    });
    await user.clear(editor);
    await user.type(editor, "Update the launch checklist");
    await user.click(
      within(article).getByRole("button", { name: "Save and retry" }),
    );

    expect(await screen.findByText("Fresh checklist.")).toBeInTheDocument();
    expect(screen.queryByText("Old checklist.")).toBeNull();
    expect(screen.queryByText("Keep this later note")).toBeNull();
    const editRequest = vi
      .mocked(window.fetch)
      .mock.calls.find(
        ([input, init]) =>
          input === "/api/workspace/messages/message-user/edit" &&
          init?.method === "POST",
      );
    expect(editRequest).toBeDefined();
    expect(JSON.parse(String(editRequest?.[1]?.body))).toEqual({
      action: "resend",
      content: "Update the launch checklist",
    });
    expect(
      vi
        .mocked(window.fetch)
        .mock.calls.some(
          ([input, init]) =>
            input === "/api/workspace/messages" && init?.method === "PUT",
        ),
    ).toBe(false);
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Stop" })).toBeNull();
    });
  });

  it("shows an error block when edited retry cannot start", async () => {
    const user = userEvent.setup();
    const messages: TestMessage[] = [
      {
        author: "user",
        content: "Draft a launch checklist",
        id: "message-user",
      },
      {
        active_output: "text",
        author: "assistant",
        content: "Old checklist.",
        id: "message-assistant",
        isStreamingText: false,
        status: "completed",
      },
      {
        author: "user",
        content: "Keep this later note",
        id: "message-later-user",
      },
    ];
    vi.spyOn(window, "fetch").mockImplementation(async (input, init) => {
      if (input === "/api/state") {
        return new Response(JSON.stringify(selectedProviderState(messages)), {
          headers: { "Content-Type": "application/json" },
          status: 200,
        });
      }
      if (input === "/api/about") {
        return new Response(JSON.stringify({}), {
          headers: { "Content-Type": "application/json" },
          status: 200,
        });
      }
      if (
        input === "/api/workspace/messages/message-user/edit" &&
        init?.method === "POST"
      ) {
        return new Response(
          JSON.stringify({
            detail: "Choose a provider and model before sending.",
          }),
          {
            headers: { "Content-Type": "application/json" },
            status: 400,
          },
        );
      }
      return new Response(JSON.stringify({}), {
        headers: { "Content-Type": "application/json" },
        status: 200,
      });
    });
    render(<App />);

    const article = await messageArticle("Draft a launch checklist");
    await user.click(within(article).getByRole("button", { name: "Edit" }));
    const editor = within(article).getByRole("textbox", {
      name: "Edit message",
    });
    await user.clear(editor);
    await user.type(editor, "Update the launch checklist");
    await user.click(
      within(article).getByRole("button", { name: "Save and retry" }),
    );

    expect(screen.getByText("Update the launch checklist")).toBeInTheDocument();
    expect(screen.queryByText("Old checklist.")).toBeNull();
    expect(screen.queryByText("Keep this later note")).toBeNull();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Request failed");
    expect(alert).toHaveTextContent(
      "Check the model connection settings and try again.",
    );
    expect(alert).toHaveTextContent(
      "Choose a provider and model before sending.",
    );
    expect(within(alert).getByRole("button", { name: "Retry" })).toBeEnabled();
  });

  it("uses the sent message identity when editing a message from the same page", async () => {
    const user = userEvent.setup();
    let sentMessageId = "";
    vi.spyOn(window, "fetch").mockImplementation(async (input, init) => {
      if (input === "/api/state") {
        return new Response(JSON.stringify(selectedProviderState([])), {
          headers: { "Content-Type": "application/json" },
          status: 200,
        });
      }
      if (input === "/api/about") {
        return new Response(JSON.stringify({}), {
          headers: { "Content-Type": "application/json" },
          status: 200,
        });
      }
      if (input === "/api/workspace/respond" && init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as {
          content?: unknown;
          message_id?: unknown;
        };
        expect(body.content).toBe("Draft a launch checklist");
        const messageId = body.message_id;
        expect(typeof messageId).toBe("string");
        if (typeof messageId !== "string") {
          throw new Error("Message ID was not sent.");
        }
        expect(messageId).toMatch(/^message-/);
        sentMessageId = messageId;
        return assistantStreamResponse("Initial checklist.");
      }
      if (
        input ===
          `/api/workspace/messages/${encodeURIComponent(sentMessageId)}/edit` &&
        init?.method === "POST"
      ) {
        expect(JSON.parse(String(init.body))).toEqual({
          action: "resend",
          content: "Update the launch checklist",
        });
        return new Response(
          JSON.stringify({
            is_responding: true,
            messages: [
              {
                author: "user",
                content: "Update the launch checklist",
                id: sentMessageId,
              },
            ],
          }),
          {
            headers: { "Content-Type": "application/json" },
            status: 200,
          },
        );
      }
      if (input === "/api/workspace/stream?after=0" && init?.method === "GET") {
        return assistantStreamResponse("Updated checklist.");
      }
      return new Response(JSON.stringify({}), {
        headers: { "Content-Type": "application/json" },
        status: 200,
      });
    });
    render(<App />);

    const composer = await screen.findByRole("textbox", {
      name: "Message Flowent",
    });
    await user.type(composer, "Draft a launch checklist");
    await user.click(screen.getByRole("button", { name: "Send message" }));

    const sentArticle = await messageArticle("Draft a launch checklist");
    await user.click(within(sentArticle).getByRole("button", { name: "Edit" }));
    const editor = within(sentArticle).getByRole("textbox", {
      name: "Edit message",
    });
    await user.clear(editor);
    await user.type(editor, "Update the launch checklist");
    await user.click(
      within(sentArticle).getByRole("button", { name: "Save and retry" }),
    );

    expect(await screen.findByText("Updated checklist.")).toBeInTheDocument();
    expect(sentMessageId).toMatch(/^message-/);
  });
});
