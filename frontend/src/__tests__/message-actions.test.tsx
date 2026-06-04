import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import App from "@/App";

type TestMessage = {
  author: "assistant" | "system" | "user";
  content: string;
  id: string;
  status?: string;
};

const selectedProviderState = (messages: TestMessage[] = []) => ({
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

const assistantStreamResponse = (
  content: string,
  id = "message-assistant-new",
) => {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(
        encoder.encode(`event: start\ndata: ${JSON.stringify({ id })}\n\n`),
      );
      controller.enqueue(
        encoder.encode(
          `event: output_start\ndata: ${JSON.stringify({ index: 1 })}\n\n`,
        ),
      );
      controller.enqueue(
        encoder.encode(
          `event: delta\ndata: ${JSON.stringify({ content })}\n\n`,
        ),
      );
      controller.enqueue(
        encoder.encode(
          `event: done\ndata: ${JSON.stringify({
            message: {
              author: "assistant",
              content,
              id,
            },
          })}\n\n`,
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

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
};

const controlledAssistantStreamResponse = (
  firstChunk: string,
  content: string,
  id = "message-assistant-new",
) => {
  const encoder = new TextEncoder();
  const release = deferred();
  const stream = new ReadableStream({
    async start(controller) {
      controller.enqueue(
        encoder.encode(`event: start\ndata: ${JSON.stringify({ id })}\n\n`),
      );
      controller.enqueue(
        encoder.encode(
          `event: output_start\ndata: ${JSON.stringify({ index: 1 })}\n\n`,
        ),
      );
      controller.enqueue(
        encoder.encode(
          `event: delta\ndata: ${JSON.stringify({ content: firstChunk })}\n\n`,
        ),
      );
      await release.promise;
      const rest = content.slice(firstChunk.length);
      if (rest.length > 0) {
        controller.enqueue(
          encoder.encode(
            `event: delta\ndata: ${JSON.stringify({ content: rest })}\n\n`,
          ),
        );
      }
      controller.enqueue(
        encoder.encode(
          `event: done\ndata: ${JSON.stringify({
            message: {
              author: "assistant",
              content,
              id,
            },
          })}\n\n`,
        ),
      );
      controller.close();
    },
  });

  return {
    finish: release.resolve,
    response: new Response(stream, {
      headers: { "Content-Type": "text/event-stream" },
      status: 200,
    }),
  };
};

const mockWorkspace = (
  messages: TestMessage[],
  response: Response = assistantStreamResponse("Fresh response."),
) => {
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
    if (input === "/api/workspace/messages" && init?.method === "PUT") {
      return new Response(init.body, {
        headers: { "Content-Type": "application/json" },
        status: 200,
      });
    }
    if (input === "/api/workspace/runs" && init?.method === "POST") {
      return new Response(JSON.stringify({ detail: "Not found." }), {
        headers: { "Content-Type": "application/json" },
        status: 404,
      });
    }
    if (input === "/api/workspace/respond" && init?.method === "POST") {
      return response;
    }
    return new Response(JSON.stringify({}), {
      headers: { "Content-Type": "application/json" },
      status: 200,
    });
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

const latestWorkspaceMessagesRequest = () => {
  const request = vi
    .mocked(window.fetch)
    .mock.calls.filter(
      ([input, init]) =>
        input === "/api/workspace/messages" && init?.method === "PUT",
    )
    .at(-1);
  if (!request) {
    throw new Error("Workspace messages request not found.");
  }
  return JSON.parse(String(request[1]?.body)) as { messages: TestMessage[] };
};

const originalClipboardDescriptor = Object.getOwnPropertyDescriptor(
  navigator,
  "clipboard",
);
const originalExecCommandDescriptor = Object.getOwnPropertyDescriptor(
  document,
  "execCommand",
);

const setClipboard = (
  clipboard: { writeText: (text: string) => Promise<void> } | undefined,
) => {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: clipboard,
  });
};

const setExecCommand = (execCommand: (command: string) => boolean) => {
  Object.defineProperty(document, "execCommand", {
    configurable: true,
    value: execCommand,
  });
};

const restoreCopyEnvironment = () => {
  if (originalClipboardDescriptor) {
    Object.defineProperty(navigator, "clipboard", originalClipboardDescriptor);
  } else {
    Reflect.deleteProperty(navigator, "clipboard");
  }

  if (originalExecCommandDescriptor) {
    Object.defineProperty(
      document,
      "execCommand",
      originalExecCommandDescriptor,
    );
  } else {
    Reflect.deleteProperty(document, "execCommand");
  }
};

describe("message actions", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    restoreCopyEnvironment();
  });

  it("copies message content from an icon action and shows success", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    setClipboard({ writeText });
    mockWorkspace([
      {
        author: "user",
        content: "Draft a launch checklist",
        id: "message-user",
      },
    ]);
    render(<App />);

    const article = await messageArticle("Draft a launch checklist");
    const copyButton = within(article).getByRole("button", { name: "Copy" });
    expect(copyButton.textContent).toBe("");
    await user.click(copyButton);

    expect(writeText).toHaveBeenCalledWith("Draft a launch checklist");
    const copiedButton = within(article).getByRole("button", {
      name: "Copied",
    });
    expect(copiedButton).toBeInTheDocument();
    expect(copiedButton.textContent).toBe("");
  });

  it("copies message content with a fallback action when clipboard access is unavailable", async () => {
    const user = userEvent.setup();
    const copiedValues: string[] = [];
    const execCommand = vi.fn((command: string) => {
      const activeElement = document.activeElement;
      if (command === "copy" && activeElement instanceof HTMLTextAreaElement) {
        copiedValues.push(activeElement.value);
        return true;
      }
      return false;
    });
    setClipboard(undefined);
    setExecCommand(execCommand);
    mockWorkspace([
      {
        author: "user",
        content: "Draft a launch checklist",
        id: "message-user",
      },
    ]);
    render(<App />);

    const article = await messageArticle("Draft a launch checklist");
    await user.click(within(article).getByRole("button", { name: "Copy" }));

    expect(execCommand).toHaveBeenCalledWith("copy");
    expect(copiedValues).toEqual(["Draft a launch checklist"]);
    const copiedButton = within(article).getByRole("button", {
      name: "Copied",
    });
    expect(copiedButton).toBeInTheDocument();
    expect(copiedButton.textContent).toBe("");
  });

  it("shows failure feedback when clipboard and fallback copy actions fail", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockRejectedValue(new Error("Denied"));
    const execCommand = vi.fn().mockReturnValue(false);
    setClipboard({ writeText });
    setExecCommand(execCommand);
    mockWorkspace([
      {
        author: "user",
        content: "Draft a launch checklist",
        id: "message-user",
      },
    ]);
    render(<App />);

    const article = await messageArticle("Draft a launch checklist");
    await user.click(within(article).getByRole("button", { name: "Copy" }));

    expect(writeText).toHaveBeenCalledWith("Draft a launch checklist");
    expect(execCommand).toHaveBeenCalledWith("copy");
    const failedButton = within(article).getByRole("button", {
      name: "Copy failed",
    });
    expect(failedButton).toBeInTheDocument();
    expect(failedButton.textContent).toBe("");
  });

  it("returns copy feedback to the default icon after a short delay", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    const execCommand = vi.fn().mockReturnValue(false);
    setClipboard({ writeText });
    setExecCommand(execCommand);
    mockWorkspace([
      {
        author: "user",
        content: "Draft a launch checklist",
        id: "message-user",
      },
    ]);
    render(<App />);

    const article = await messageArticle("Draft a launch checklist");
    await user.click(within(article).getByRole("button", { name: "Copy" }));
    expect(
      within(article).getByRole("button", { name: "Copied" }),
    ).toBeInTheDocument();

    await waitFor(
      () => {
        expect(
          within(article).getByRole("button", { name: "Copy" }),
        ).toBeInTheDocument();
      },
      { timeout: 2500 },
    );

    writeText.mockRejectedValue(new Error("Denied"));
    await user.click(within(article).getByRole("button", { name: "Copy" }));
    expect(
      within(article).getByRole("button", { name: "Copy failed" }),
    ).toBeInTheDocument();

    await waitFor(
      () => {
        expect(
          within(article).getByRole("button", { name: "Copy" }),
        ).toBeInTheDocument();
      },
      { timeout: 1800 },
    );
  });

  it("edits a user message inline and saves the updated content", async () => {
    const user = userEvent.setup();
    mockWorkspace([
      {
        author: "user",
        content: "Draft a launch checklist",
        id: "message-user",
      },
      {
        author: "assistant",
        content: "Old checklist.",
        id: "message-assistant",
      },
    ]);
    render(<App />);

    const article = await messageArticle("Draft a launch checklist");
    await user.click(within(article).getByRole("button", { name: "Edit" }));
    const editor = within(article).getByRole("textbox", {
      name: "Edit message",
    });
    await user.clear(editor);
    await user.type(editor, "Update the launch checklist");
    await user.click(within(article).getByRole("button", { name: "Save" }));

    expect(screen.getByText("Update the launch checklist")).toBeInTheDocument();
    expect(screen.queryByText("Draft a launch checklist")).toBeNull();
    expect(latestWorkspaceMessagesRequest().messages).toEqual([
      {
        author: "user",
        content: "Update the launch checklist",
        id: "message-user",
      },
      {
        author: "assistant",
        content: "Old checklist.",
        id: "message-assistant",
      },
    ]);
  });

  it("retries a user message and replaces later replies", async () => {
    const user = userEvent.setup();
    mockWorkspace(
      [
        {
          author: "user",
          content: "Draft a launch checklist",
          id: "message-user",
        },
        {
          author: "assistant",
          content: "Old checklist.",
          id: "message-assistant",
        },
        {
          author: "user",
          content: "Keep this later note",
          id: "message-later-user",
        },
      ],
      assistantStreamResponse("Fresh checklist."),
    );
    render(<App />);

    const article = await messageArticle("Draft a launch checklist");
    await user.click(within(article).getByRole("button", { name: "Retry" }));

    expect(await screen.findByText("Fresh checklist.")).toBeInTheDocument();
    expect(screen.queryByText("Old checklist.")).toBeNull();
    expect(screen.queryByText("Keep this later note")).toBeNull();
    expect(window.fetch).toHaveBeenCalledWith(
      "/api/workspace/respond",
      expect.objectContaining({
        body: JSON.stringify({ content: "Draft a launch checklist" }),
        method: "POST",
      }),
    );
    expect(latestWorkspaceMessagesRequest().messages).toEqual([]);
  });

  it("retries an assistant reply from the previous user message", async () => {
    const user = userEvent.setup();
    mockWorkspace(
      [
        {
          author: "user",
          content: "Draft a launch checklist",
          id: "message-user",
        },
        {
          author: "assistant",
          content: "Old checklist.",
          id: "message-assistant",
        },
      ],
      assistantStreamResponse("Fresh answer."),
    );
    render(<App />);

    const article = await messageArticle("Old checklist.");
    await user.click(within(article).getByRole("button", { name: "Retry" }));

    expect(await screen.findByText("Fresh answer.")).toBeInTheDocument();
    expect(screen.queryByText("Old checklist.")).toBeNull();
    expect(window.fetch).toHaveBeenCalledWith(
      "/api/workspace/respond",
      expect.objectContaining({
        body: JSON.stringify({ content: "Draft a launch checklist" }),
        method: "POST",
      }),
    );
    expect(latestWorkspaceMessagesRequest().messages).toEqual([]);
  });

  it("keeps edit and retry disabled while Flowent is responding", async () => {
    const user = userEvent.setup();
    const stream = controlledAssistantStreamResponse(
      "First step",
      "First step is ready.",
    );
    mockWorkspace([], stream.response);
    render(<App />);

    const composer = await screen.findByRole("textbox", {
      name: "Message Flowent",
    });
    await user.type(composer, "Draft a launch checklist");
    await user.click(screen.getByRole("button", { name: "Send message" }));

    const userArticle = await messageArticle("Draft a launch checklist");
    const assistantArticle = await messageArticle("First step");

    expect(
      within(userArticle).getByRole("button", { name: "Copy" }),
    ).toBeEnabled();
    expect(
      within(userArticle).getByRole("button", { name: "Edit" }),
    ).toBeDisabled();
    expect(
      within(userArticle).getByRole("button", { name: "Retry" }),
    ).toBeDisabled();
    expect(
      within(assistantArticle).getByRole("button", { name: "Copy" }),
    ).toBeEnabled();
    expect(
      within(assistantArticle).getByRole("button", { name: "Retry" }),
    ).toBeDisabled();

    stream.finish();
    await waitFor(() => {
      expect(
        screen.queryByRole("button", { name: "Stop" }),
      ).not.toBeInTheDocument();
    });
  });
});
