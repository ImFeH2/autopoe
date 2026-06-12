import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import App from "@/App";
import { MarkdownMessage } from "@/components/flowent/markdown-message";
import { WorkspaceView } from "@/components/flowent/workspace-view";
import type { AssistantOutputItem, Message } from "@/components/flowent/types";

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
};

const eventStreamResponse = (events: string[]) => {
  const encoder = new TextEncoder();
  const hold = deferred();
  const stream = new ReadableStream({
    async start(controller) {
      for (const event of events) {
        controller.enqueue(encoder.encode(event));
      }
      await hold.promise;
      controller.close();
    },
  });

  return {
    finish: hold.resolve,
    response: new Response(stream, {
      headers: { "Content-Type": "text/event-stream" },
      status: 200,
    }),
  };
};

const stagedEventStreamResponse = (stages: string[][]) => {
  const encoder = new TextEncoder();
  const releases = stages.slice(1).map(() => deferred());
  const hold = deferred();
  const stream = new ReadableStream({
    async start(controller) {
      for (const event of stages[0] ?? []) {
        controller.enqueue(encoder.encode(event));
      }
      for (const [stageIndex, stage] of stages.slice(1).entries()) {
        await releases[stageIndex].promise;
        for (const event of stage) {
          controller.enqueue(encoder.encode(event));
        }
      }
      await hold.promise;
      controller.close();
    },
  });

  return {
    finish: hold.resolve,
    releaseStage: (stage: number) => releases[stage - 1]?.resolve(),
    response: new Response(stream, {
      headers: { "Content-Type": "text/event-stream" },
      status: 200,
    }),
  };
};

const streamEvent = (event: string, data: Record<string, unknown>) =>
  `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

const selectedProviderState = () => ({
  mcp_servers: [],
  messages: [],
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

const renderWorkspace = (messages: Message[]) =>
  render(
    <WorkspaceView
      commands={[]}
      contextWindowLimit={null}
      draft=""
      errorMessage=""
      isRefiningContext={false}
      isResponding={true}
      messages={messages}
      onCommand={() => false}
      onCommandError={vi.fn()}
      onDraftChange={vi.fn()}
      onEditMessage={vi.fn()}
      onRetryError={vi.fn()}
      onRetryMessage={vi.fn()}
      onSendMessage={vi.fn()}
      onStopResponse={vi.fn()}
      skills={[]}
      usageInfo={null}
    />,
  );

const assistantWithItems = (
  items: AssistantOutputItem[],
  isStreamingText = false,
): Message => ({
  author: "assistant",
  content: items
    .filter((item) => item.type === "text")
    .map((item) => item.content)
    .join(""),
  groups: [
    {
      id: "message-assistant-group-1",
      items,
    },
  ],
  id: "message-assistant",
  isStreamingText,
  status: "running",
});

const toolSnapshotMessage = (status: "running" | "success") => ({
  author: "assistant",
  content: "I checked the files.",
  groups: [
    {
      id: "message-assistant-group-1",
      items: [
        {
          content: "I checked the files.",
          id: "message-assistant-text-1",
          type: "text",
        },
        {
          id: "tool-tool-1",
          tool: {
            arguments: { command: "ls -al" },
            content: status === "success" ? "total 8" : undefined,
            id: "tool-1",
            name: "shell_command",
            status,
            title: "List files",
          },
          type: "tool",
        },
      ],
    },
  ],
  id: "message-assistant",
  status: "running",
  tools: [
    {
      arguments: { command: "ls -al" },
      content: status === "success" ? "total 8" : undefined,
      id: "tool-1",
      name: "shell_command",
      status,
      title: "List files",
    },
  ],
});

const mockRunningSnapshotStream = (
  message: ReturnType<typeof toolSnapshotMessage>,
) => {
  const stream = eventStreamResponse([streamEvent("snapshot", { message })]);
  const state = {
    ...selectedProviderState(),
    is_responding: true,
    response_event_index: 3,
    messages: [
      {
        author: "user",
        content: "List the files.",
        id: "message-user",
      },
    ],
  };

  vi.spyOn(window, "fetch").mockImplementation(async (input) => {
    if (input === "/api/state") {
      return new Response(JSON.stringify(state), {
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
      typeof input === "string" &&
      input === "/api/workspace/stream?after=3"
    ) {
      return stream.response;
    }
    return new Response(JSON.stringify({}), {
      headers: { "Content-Type": "application/json" },
      status: 200,
    });
  });

  return stream;
};

describe("streaming cursor regressions", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows one cursor at the final paragraph of a streaming Markdown message", () => {
    render(
      <MarkdownMessage content={"First block.\n\nSecond block."} isStreaming />,
    );

    const cursor = screen.getByTestId("response-cursor");

    expect(screen.getAllByTestId("response-cursor")).toHaveLength(1);
    expect(cursor.closest("p")).toHaveTextContent("Second block.");
  });

  it("keeps resumed streaming output on the latest text block cursor only", async () => {
    const assistantId = "message-assistant";
    const stream = eventStreamResponse([
      streamEvent("output_start", { index: 2 }),
      streamEvent("delta", { content: "Second block." }),
    ]);
    const state = {
      ...selectedProviderState(),
      is_responding: true,
      response_event_index: 3,
      messages: [
        {
          author: "user",
          content: "Continue the draft.",
          id: "message-user",
        },
        {
          author: "assistant",
          content: "First block.",
          groups: [
            {
              id: `${assistantId}-group-1`,
              items: [
                {
                  content: "First block.",
                  id: `${assistantId}-text-1`,
                  type: "text",
                },
              ],
            },
          ],
          id: assistantId,
        },
      ],
    };

    vi.spyOn(window, "fetch").mockImplementation(async (input) => {
      if (input === "/api/state") {
        return new Response(JSON.stringify(state), {
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
        typeof input === "string" &&
        input === "/api/workspace/stream?after=3"
      ) {
        return stream.response;
      }
      return new Response(JSON.stringify({}), {
        headers: { "Content-Type": "application/json" },
        status: 200,
      });
    });

    render(<App />);

    await screen.findByText("Second block.");
    await waitFor(() => {
      expect(screen.getAllByTestId("response-cursor")).toHaveLength(1);
    });
    expect(
      screen.getByTestId("response-cursor").closest("p"),
    ).toHaveTextContent("Second block.");

    stream.finish();
  });

  it("does not restore a text cursor when a running snapshot ends with a completed tool", async () => {
    const stream = mockRunningSnapshotStream(toolSnapshotMessage("success"));

    render(<App />);

    await screen.findByText("List files");
    await screen.findByText("Done");
    await waitFor(() => {
      expect(screen.queryByTestId("response-cursor")).not.toBeInTheDocument();
    });

    stream.finish();
  });

  it("does not restore a text cursor when a running snapshot ends with a running tool", async () => {
    const stream = mockRunningSnapshotStream(toolSnapshotMessage("running"));

    render(<App />);

    await screen.findByText("List files");
    await screen.findByText("Running");
    await waitFor(() => {
      expect(screen.queryByTestId("response-cursor")).not.toBeInTheDocument();
    });

    stream.finish();
  });

  it("shows the cursor only on the latest text block after a tool block", () => {
    renderWorkspace([
      {
        author: "user",
        content: "Check the files.",
        id: "message-user",
      },
      assistantWithItems(
        [
          {
            content: "I will check the files first.",
            id: "message-assistant-text-1",
            type: "text",
          },
          {
            id: "tool-tool-1",
            tool: {
              id: "tool-1",
              name: "shell_command",
              status: "success",
              title: "List files",
            },
            type: "tool",
          },
          {
            content: "I found the issue.",
            id: "message-assistant-text-2",
            type: "text",
          },
        ],
        true,
      ),
    ]);

    const cursor = screen.getByTestId("response-cursor");

    expect(screen.getAllByTestId("response-cursor")).toHaveLength(1);
    expect(cursor.closest("p")).toHaveTextContent("I found the issue.");
  });

  it("removes the cursor when the current model output ends before the run finishes", async () => {
    const stream = stagedEventStreamResponse([
      [
        streamEvent("start", { id: "message-assistant" }),
        streamEvent("output_start", { index: 1 }),
        streamEvent("delta", { content: "I will check the files first." }),
      ],
      [streamEvent("output_done", { index: 1 })],
      [streamEvent("output_start", { index: 2 })],
    ]);
    const state = {
      ...selectedProviderState(),
      is_responding: true,
      response_event_index: 0,
      messages: [
        {
          author: "user",
          content: "Check the files.",
          id: "message-user",
        },
      ],
    };

    vi.spyOn(window, "fetch").mockImplementation(async (input) => {
      if (input === "/api/state") {
        return new Response(JSON.stringify(state), {
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
        typeof input === "string" &&
        input === "/api/workspace/stream?after=0"
      ) {
        return stream.response;
      }
      return new Response(JSON.stringify({}), {
        headers: { "Content-Type": "application/json" },
        status: 200,
      });
    });

    render(<App />);

    await screen.findByText("I will check the files first.");
    await waitFor(() => {
      expect(screen.getByTestId("response-cursor")).toBeInTheDocument();
    });

    stream.releaseStage(1);

    await waitFor(() => {
      expect(screen.queryByTestId("response-cursor")).not.toBeInTheDocument();
    });

    stream.releaseStage(2);

    await waitFor(() => {
      expect(screen.queryByTestId("response-cursor")).not.toBeInTheDocument();
    });

    stream.finish();
  });
});
