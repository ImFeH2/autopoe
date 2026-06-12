import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import App from "@/App";

type TestTool = {
  arguments?: Record<string, unknown> | null;
  content?: string;
  data?: Record<string, unknown> | null;
  id: string;
  name: string;
  status: "failed" | "running" | "success" | "waiting";
  title: string;
};

type TestMessage = {
  author: "assistant" | "system" | "user";
  content: string;
  groups?: Array<{
    id: string;
    items: Array<
      | {
          content: string;
          id: string;
          type: "text";
        }
      | {
          detail?: string;
          id: string;
          message: string;
          title: string;
          type: "error";
        }
      | {
          id: string;
          tool: TestTool;
          type: "tool";
        }
    >;
  }>;
  id: string;
  status?: string;
  tools?: TestTool[];
};

const selectedProviderState = (
  messages: TestMessage[],
  isResponding = false,
) => ({
  is_responding: isResponding,
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
  response_event_index: 0,
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

const tool: TestTool = {
  arguments: { path: "notes.txt" },
  content: "Launch notes",
  data: { path: "/workspace/notes.txt" },
  id: "tool-read",
  name: "read_file",
  status: "success",
  title: "Read notes.txt",
};

const failedAssistantMessage = (): TestMessage => ({
  author: "assistant",
  content: "I read the notes.",
  groups: [
    {
      id: "message-assistant-group-1",
      items: [
        {
          content: "I read the notes.",
          id: "message-assistant-text-1",
          type: "text",
        },
        {
          id: "tool-tool-read",
          tool,
          type: "tool",
        },
      ],
    },
    {
      id: "message-assistant-errors",
      items: [
        {
          detail: "provider dropped",
          id: "message-assistant-error-1",
          message: "Check the model connection settings and try again.",
          title: "Request failed",
          type: "error",
        },
      ],
    },
    {
      id: "message-assistant-group-2",
      items: [
        {
          content: "Stale tail.",
          id: "message-assistant-text-2",
          type: "text",
        },
      ],
    },
  ],
  id: "message-assistant",
  status: "failed",
  tools: [tool],
});

const trimmedMessages = (): TestMessage[] => [
  {
    author: "user",
    content: "Read the notes.",
    id: "message-user",
  },
  {
    author: "assistant",
    content: "I read the notes.",
    groups: [
      {
        id: "message-assistant-group-1",
        items: [
          {
            content: "I read the notes.",
            id: "message-assistant-text-1",
            type: "text",
          },
          {
            id: "tool-tool-read",
            tool,
            type: "tool",
          },
        ],
      },
    ],
    id: "message-assistant",
    status: "running",
    tools: [tool],
  },
];

const streamEvent = (event: string, data: Record<string, unknown>) =>
  `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

const recoveredStreamResponse = () => {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(
        encoder.encode(streamEvent("start", { id: "message-assistant" })),
      );
      controller.enqueue(
        encoder.encode(streamEvent("output_start", { index: 2 })),
      );
      controller.enqueue(
        encoder.encode(streamEvent("delta", { content: " Recovered." })),
      );
      controller.enqueue(
        encoder.encode(
          streamEvent("done", {
            message: {
              author: "assistant",
              content: "I read the notes. Recovered.",
              id: "message-assistant",
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

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
};

describe("error block retry regressions", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("retries from the failed error block and keeps earlier assistant output", async () => {
    const user = userEvent.setup();
    const retryStarted = deferred<void>();
    const retryResponse = deferred<Response>();
    const initialMessages = [
      {
        author: "user" as const,
        content: "Read the notes.",
        id: "message-user",
      },
      failedAssistantMessage(),
    ];

    vi.spyOn(window, "fetch").mockImplementation(async (input, init) => {
      if (input === "/api/state") {
        return new Response(
          JSON.stringify(selectedProviderState(initialMessages)),
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
      if (
        input ===
          "/api/workspace/messages/message-assistant/errors/message-assistant-error-1/retry" &&
        init?.method === "POST"
      ) {
        retryStarted.resolve();
        return retryResponse.promise;
      }
      if (input === "/api/workspace/stream?after=0") {
        return recoveredStreamResponse();
      }
      return new Response(JSON.stringify({}), {
        headers: { "Content-Type": "application/json" },
        status: 200,
      });
    });

    render(<App />);

    const alert = await screen.findByRole("alert");
    expect(screen.getByText("I read the notes.")).toBeInTheDocument();
    expect(screen.getByText("Stale tail.")).toBeInTheDocument();

    await user.click(within(alert).getByRole("button", { name: "Retry" }));
    await retryStarted.promise;

    expect(screen.getByText("I read the notes.")).toBeInTheDocument();
    expect(screen.getByText("Read notes.txt")).toBeInTheDocument();
    expect(screen.queryByText("Request failed")).not.toBeInTheDocument();
    expect(screen.queryByText("Stale tail.")).not.toBeInTheDocument();

    retryResponse.resolve(
      new Response(
        JSON.stringify({
          is_responding: true,
          messages: trimmedMessages(),
        }),
        {
          headers: { "Content-Type": "application/json" },
          status: 200,
        },
      ),
    );

    await waitFor(() => {
      expect(document.body).toHaveTextContent("Recovered.");
    });
    expect(screen.queryByText("Request failed")).not.toBeInTheDocument();
    expect(screen.queryByText("Stale tail.")).not.toBeInTheDocument();
  });

  it("keeps the error block Retry disabled while Flowent is responding", async () => {
    const holdStream = deferred<void>();
    const messages = [
      {
        author: "user" as const,
        content: "Read the notes.",
        id: "message-user",
      },
      failedAssistantMessage(),
    ];

    vi.spyOn(window, "fetch").mockImplementation(async (input) => {
      if (input === "/api/state") {
        return new Response(
          JSON.stringify(selectedProviderState(messages, true)),
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
      if (input === "/api/workspace/stream?after=0") {
        const stream = new ReadableStream({
          async start(controller) {
            await holdStream.promise;
            controller.close();
          },
        });
        return new Response(stream, {
          headers: { "Content-Type": "text/event-stream" },
          status: 200,
        });
      }
      return new Response(JSON.stringify({}), {
        headers: { "Content-Type": "application/json" },
        status: 200,
      });
    });

    render(<App />);

    const alert = await screen.findByRole("alert");
    expect(within(alert).getByRole("button", { name: "Retry" })).toBeDisabled();
    holdStream.resolve();
  });
});
