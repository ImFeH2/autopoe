import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import App from "@/App";
import { MarkdownMessage } from "@/components/flowent/markdown-message";

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
      active_run_event_index: 3,
      active_run_id: "run-1",
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
        input === "/api/workspace/runs/run-1/stream?after=3"
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
});
