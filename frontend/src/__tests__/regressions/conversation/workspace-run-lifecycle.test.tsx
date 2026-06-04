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
});
