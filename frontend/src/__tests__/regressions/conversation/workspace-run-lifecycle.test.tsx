import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import App from "@/App";

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

const contextUsage = (totalTokens: number) => ({
  cached_input_tokens: 0,
  input_tokens: 0,
  output_tokens: 0,
  reasoning_output_tokens: 0,
  total_tokens: totalTokens,
});

const contextUsageInfo = (
  totalTokens: number,
  modelContextWindow = 120_000,
) => ({
  last_token_usage: contextUsage(totalTokens),
  model_context_window: modelContextWindow,
  total_token_usage: contextUsage(totalTokens),
});

const streamEvent = (
  event: string,
  data: Record<string, unknown>,
  eventIndex: number,
) => `id: ${eventIndex}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
};

const heldStreamResponse = (events: string[], onCancel?: () => void) => {
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
    cancel: onCancel,
  });

  return {
    finish: hold.resolve,
    response: new Response(stream, {
      headers: { "Content-Type": "text/event-stream" },
      status: 200,
    }),
  };
};

const assistantIndexedStreamResponse = (
  content: string,
  id = "message-assistant",
  firstEventIndex = 1,
) => {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(
        encoder.encode(streamEvent("start", { id }, firstEventIndex)),
      );
      controller.enqueue(
        encoder.encode(
          streamEvent("output_start", { index: 1 }, firstEventIndex + 1),
        ),
      );
      controller.enqueue(
        encoder.encode(streamEvent("delta", { content }, firstEventIndex + 2)),
      );
      controller.enqueue(
        encoder.encode(
          streamEvent(
            "done",
            {
              message: {
                author: "assistant",
                content,
                id,
              },
            },
            firstEventIndex + 3,
          ),
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

const assistantSnapshotStreamResponse = (
  message: Record<string, unknown>,
  firstEventIndex = 1,
) => {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(
        encoder.encode(streamEvent("snapshot", { message }, firstEventIndex)),
      );
      controller.enqueue(
        encoder.encode(streamEvent("done", { message }, firstEventIndex + 1)),
      );
      controller.close();
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream" },
    status: 200,
  });
};

const expectDocumentText = async (text: string) => {
  await waitFor(() => {
    expect(document.body).toHaveTextContent(text);
  });
};

describe("workspace run lifecycle regressions", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps the draft and shows a clear conflict message when another response is running", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "fetch").mockImplementation(async (input) => {
      if (input === "/api/state") {
        return new Response(JSON.stringify(selectedProviderState()), {
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
      if (input === "/api/workspace/runs") {
        return new Response(
          JSON.stringify({ detail: "Response in progress" }),
          {
            headers: { "Content-Type": "application/json" },
            status: 409,
          },
        );
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

    expect(await screen.findByText("Response in progress")).toBeInTheDocument();
    expect(composer).toHaveValue("Draft a launch checklist");
    expect(document.body).not.toHaveTextContent(
      "Draft a launch checklistDraft",
    );
  });

  it("uses one server event index for a context update that also changes usage", async () => {
    const user = userEvent.setup();
    const droppedStream = new Response(
      new ReadableStream({
        start(controller) {
          const encoder = new TextEncoder();
          controller.enqueue(
            encoder.encode(
              streamEvent(
                "context_optimized",
                {
                  message: {
                    author: "system",
                    content: "Context optimized",
                    id: "context-optimized",
                    usage_info: contextUsageInfo(10_000),
                  },
                  usage_info: contextUsageInfo(10_000),
                },
                1,
              ),
            ),
          );
          controller.error(new TypeError("Load failed"));
        },
      }),
      {
        headers: { "Content-Type": "text/event-stream" },
        status: 200,
      },
    );
    const runningState = {
      ...selectedProviderState(),
      active_run_event_index: 1,
      active_run_id: "run-server-index",
      messages: [
        {
          author: "user",
          content: "Continue from there",
          id: "message-user",
        },
        {
          author: "system",
          content: "Context optimized",
          id: "context-optimized",
          usage_info: contextUsageInfo(10_000),
        },
      ],
      usage_info: contextUsageInfo(10_000),
    };
    let stateRequests = 0;
    vi.spyOn(window, "fetch").mockImplementation(async (input, init) => {
      if (input === "/api/state") {
        stateRequests += 1;
        return new Response(
          JSON.stringify(
            stateRequests === 1 ? selectedProviderState() : runningState,
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
      if (input === "/api/workspace/runs" && init?.method === "POST") {
        return new Response(JSON.stringify({ run_id: "run-server-index" }), {
          headers: { "Content-Type": "application/json" },
          status: 200,
        });
      }
      if (input === "/api/workspace/runs/run-server-index/stream?after=0") {
        return droppedStream;
      }
      if (input === "/api/workspace/runs/run-server-index/stream?after=1") {
        return assistantIndexedStreamResponse(
          "Continued.",
          "message-assistant",
          2,
        );
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
    await user.type(composer, "Continue from there");
    await user.click(screen.getByRole("button", { name: "Send message" }));

    await expectDocumentText("Continued.");
    expect(window.fetch).toHaveBeenCalledWith(
      "/api/workspace/runs/run-server-index/stream?after=1",
      expect.objectContaining({ method: "GET" }),
    );
    expect(window.fetch).not.toHaveBeenCalledWith(
      "/api/workspace/runs/run-server-index/stream?after=2",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("keeps a resumed stream open when a snapshot updates usage", async () => {
    const usageInfo = contextUsageInfo(24_000);
    const resumedStream = heldStreamResponse([
      streamEvent(
        "snapshot",
        {
          message: {
            author: "assistant",
            content: "Resumed answer.",
            groups: [
              {
                id: "message-assistant-group-1",
                items: [
                  {
                    content: "Resumed answer.",
                    id: "message-assistant-text-1",
                    type: "text",
                  },
                ],
              },
            ],
            id: "message-assistant",
            status: "running",
            usage_info: usageInfo,
          },
        },
        6,
      ),
    ]);
    const repeatedStream = heldStreamResponse([]);
    const streamRequests: string[] = [];

    vi.spyOn(window, "fetch").mockImplementation(async (input) => {
      if (input === "/api/state") {
        return new Response(
          JSON.stringify({
            ...selectedProviderState(),
            active_run_event_index: 6,
            active_run_id: "run-usage-snapshot",
            messages: [
              {
                author: "user",
                content: "Continue the answer.",
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
      if (input === "/api/about") {
        return new Response(JSON.stringify({}), {
          headers: { "Content-Type": "application/json" },
          status: 200,
        });
      }
      if (
        typeof input === "string" &&
        input === "/api/workspace/runs/run-usage-snapshot/stream?after=6"
      ) {
        streamRequests.push(input);
        return streamRequests.length === 1
          ? resumedStream.response
          : repeatedStream.response;
      }
      return new Response(JSON.stringify({}), {
        headers: { "Content-Type": "application/json" },
        status: 200,
      });
    });

    render(<App />);

    await expectDocumentText("Resumed answer.");
    await screen.findByText("24k / 120k");
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(streamRequests).toHaveLength(1);

    resumedStream.finish();
    repeatedStream.finish();
  });

  it("renders tool progress and final text from a server snapshot without missed events", async () => {
    vi.spyOn(window, "fetch").mockImplementation(async (input) => {
      if (input === "/api/state") {
        return new Response(
          JSON.stringify({
            ...selectedProviderState(),
            active_run_event_index: 2,
            active_run_id: "run-snapshot",
            messages: [
              {
                author: "user",
                content: "Read notes.",
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
      if (input === "/api/about") {
        return new Response(JSON.stringify({}), {
          headers: { "Content-Type": "application/json" },
          status: 200,
        });
      }
      if (input === "/api/workspace/runs/run-snapshot/stream?after=2") {
        return assistantSnapshotStreamResponse(
          {
            author: "assistant",
            content: "Done.",
            groups: [
              {
                id: "message-assistant-group-1",
                items: [
                  {
                    id: "tool-tool-1",
                    tool: {
                      arguments: { path: "notes.txt" },
                      content: "Launch notes",
                      id: "tool-1",
                      name: "read_file",
                      status: "success",
                      title: "Read file",
                    },
                    type: "tool",
                  },
                  {
                    content: "Done.",
                    id: "message-assistant-text-1",
                    type: "text",
                  },
                ],
              },
            ],
            id: "message-assistant",
            status: "completed",
            tools: [
              {
                arguments: { path: "notes.txt" },
                content: "Launch notes",
                id: "tool-1",
                name: "read_file",
                status: "success",
                title: "Read file",
              },
            ],
          },
          3,
        );
      }
      return new Response(JSON.stringify({}), {
        headers: { "Content-Type": "application/json" },
        status: 200,
      });
    });

    render(<App />);

    await expectDocumentText("Read file");
    await expectDocumentText("Done.");
    expect(document.body).toHaveTextContent("Done");
  });

  it("uses the server snapshot when local streaming preview differs", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "fetch").mockImplementation(async (input, init) => {
      if (input === "/api/state") {
        return new Response(JSON.stringify(selectedProviderState()), {
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
      if (input === "/api/workspace/runs" && init?.method === "POST") {
        return new Response(JSON.stringify({ run_id: "run-snapshot" }), {
          headers: { "Content-Type": "application/json" },
          status: 200,
        });
      }
      if (input === "/api/workspace/runs/run-snapshot/stream?after=0") {
        const encoder = new TextEncoder();
        return new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(
                encoder.encode(
                  streamEvent("start", { id: "message-assistant" }, 1),
                ),
              );
              controller.enqueue(
                encoder.encode(streamEvent("output_start", { index: 1 }, 2)),
              );
              controller.enqueue(
                encoder.encode(
                  streamEvent("delta", { content: "Local preview." }, 3),
                ),
              );
              controller.enqueue(
                encoder.encode(
                  streamEvent(
                    "snapshot",
                    {
                      message: {
                        author: "assistant",
                        content: "Server answer.",
                        groups: [
                          {
                            id: "message-assistant-group-1",
                            items: [
                              {
                                content: "Server answer.",
                                id: "message-assistant-text-1",
                                type: "text",
                              },
                            ],
                          },
                        ],
                        id: "message-assistant",
                        status: "running",
                      },
                    },
                    4,
                  ),
                ),
              );
              controller.enqueue(
                encoder.encode(
                  streamEvent(
                    "done",
                    {
                      message: {
                        author: "assistant",
                        content: "Server answer.",
                        groups: [
                          {
                            id: "message-assistant-group-1",
                            items: [
                              {
                                content: "Server answer.",
                                id: "message-assistant-text-1",
                                type: "text",
                              },
                            ],
                          },
                        ],
                        id: "message-assistant",
                        status: "completed",
                      },
                    },
                    5,
                  ),
                ),
              );
              controller.close();
            },
          }),
          {
            headers: { "Content-Type": "text/event-stream" },
            status: 200,
          },
        );
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

    await expectDocumentText("Server answer.");
    expect(document.body).not.toHaveTextContent("Local preview.");
  });

  it("renders rapid delta events without waiting for a final snapshot", async () => {
    const user = userEvent.setup();
    const streamEvents = [
      streamEvent("start", { id: "message-assistant" }, 1),
      streamEvent("output_start", { index: 1 }, 2),
      streamEvent("delta", { content: "First " }, 3),
      streamEvent("delta", { content: "second " }, 4),
      streamEvent("delta", { content: "third." }, 5),
    ];
    const encoder = new TextEncoder();
    let releaseSnapshot!: () => void;
    const waitForSnapshot = new Promise<void>((resolve) => {
      releaseSnapshot = resolve;
    });

    vi.spyOn(window, "fetch").mockImplementation(async (input, init) => {
      if (input === "/api/state") {
        return new Response(JSON.stringify(selectedProviderState()), {
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
      if (input === "/api/workspace/runs" && init?.method === "POST") {
        return new Response(JSON.stringify({ run_id: "run-delta" }), {
          headers: { "Content-Type": "application/json" },
          status: 200,
        });
      }
      if (input === "/api/workspace/runs/run-delta/stream?after=0") {
        return new Response(
          new ReadableStream({
            async start(controller) {
              for (const event of streamEvents) {
                controller.enqueue(encoder.encode(event));
              }
              await waitForSnapshot;
              controller.enqueue(
                encoder.encode(
                  streamEvent(
                    "snapshot",
                    {
                      message: {
                        author: "assistant",
                        content: "First second third.",
                        id: "message-assistant",
                        status: "completed",
                      },
                    },
                    6,
                  ),
                ),
              );
              controller.enqueue(
                encoder.encode(
                  streamEvent(
                    "done",
                    {
                      message: {
                        author: "assistant",
                        content: "First second third.",
                        id: "message-assistant",
                        status: "completed",
                      },
                    },
                    7,
                  ),
                ),
              );
              controller.close();
            },
          }),
          {
            headers: { "Content-Type": "text/event-stream" },
            status: 200,
          },
        );
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
    await user.type(composer, "Draft live output");
    await user.click(screen.getByRole("button", { name: "Send message" }));

    await expectDocumentText("First second third.");
    releaseSnapshot();
  });

  it("keeps one stream connection when a snapshot updates usage", async () => {
    const usageInfo = contextUsageInfo(1_000);
    const encoder = new TextEncoder();
    let releaseStream!: () => void;
    const waitForRelease = new Promise<void>((resolve) => {
      releaseStream = resolve;
    });

    vi.spyOn(window, "fetch").mockImplementation(async (input) => {
      if (input === "/api/state") {
        return new Response(
          JSON.stringify({
            ...selectedProviderState(),
            active_run_event_index: 0,
            active_run_id: "run-usage-snapshot",
            messages: [
              {
                author: "user",
                content: "Continue with usage.",
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
      if (input === "/api/about") {
        return new Response(JSON.stringify({}), {
          headers: { "Content-Type": "application/json" },
          status: 200,
        });
      }
      if (input === "/api/workspace/runs/run-usage-snapshot/stream?after=0") {
        return new Response(
          new ReadableStream({
            async start(controller) {
              controller.enqueue(
                encoder.encode(
                  streamEvent(
                    "snapshot",
                    {
                      message: {
                        author: "assistant",
                        content: "Streaming with usage.",
                        id: "message-assistant",
                        status: "running",
                        usage_info: usageInfo,
                      },
                    },
                    1,
                  ),
                ),
              );
              await waitForRelease;
              controller.close();
            },
          }),
          {
            headers: { "Content-Type": "text/event-stream" },
            status: 200,
          },
        );
      }
      return new Response(JSON.stringify({}), {
        headers: { "Content-Type": "application/json" },
        status: 200,
      });
    });

    render(<App />);

    await expectDocumentText("Streaming with usage.");
    await new Promise((resolve) => window.setTimeout(resolve, 50));

    expect(window.fetch).toHaveBeenCalledWith(
      "/api/workspace/runs/run-usage-snapshot/stream?after=0",
      expect.objectContaining({ method: "GET" }),
    );
    expect(window.fetch).not.toHaveBeenCalledWith(
      "/api/workspace/runs/run-usage-snapshot/stream?after=1",
      expect.objectContaining({ method: "GET" }),
    );
    releaseStream();
  });
});
