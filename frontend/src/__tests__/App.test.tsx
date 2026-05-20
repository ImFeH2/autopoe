import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import App from "@/App";

const assistantStreamResponse = (
  content: string,
  id = "message-assistant",
  chunks: string[] = [content],
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
      for (const chunk of chunks) {
        controller.enqueue(
          encoder.encode(
            `event: delta\ndata: ${JSON.stringify({ content: chunk })}\n\n`,
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
  chunks: string[],
  content: string,
  id = "message-assistant",
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
          `event: delta\ndata: ${JSON.stringify({ content: chunks[0] })}\n\n`,
        ),
      );
      await release.promise;
      for (const chunk of chunks.slice(1)) {
        controller.enqueue(
          encoder.encode(
            `event: delta\ndata: ${JSON.stringify({ content: chunk })}\n\n`,
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

const assistantErrorStreamResponse = (
  message: string,
  firstChunk = "Partial response",
  id = "message-assistant",
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
          `event: delta\ndata: ${JSON.stringify({ content: firstChunk })}\n\n`,
        ),
      );
      controller.enqueue(
        encoder.encode(
          `event: error\ndata: ${JSON.stringify({ message })}\n\n`,
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

const assistantToolStreamResponse = (
  tool: {
    id: string;
    name: string;
    status?: "failed" | "running" | "success";
    title: string;
  },
  content: string,
  id = "message-assistant",
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
          `event: tool_start\ndata: ${JSON.stringify({
            tool: { ...tool, status: "running" },
          })}\n\n`,
        ),
      );
      controller.enqueue(
        encoder.encode(
          `event: tool_done\ndata: ${JSON.stringify({
            content: "tool output",
            id: tool.id,
            status: tool.status ?? "success",
            title: tool.title,
          })}\n\n`,
        ),
      );
      controller.enqueue(
        encoder.encode(
          `event: output_start\ndata: ${JSON.stringify({ index: 2 })}\n\n`,
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

const controlledToolTimelineResponse = (
  tool: {
    id: string;
    name: string;
    title: string;
  },
  content: string,
  id = "message-assistant",
) => {
  const encoder = new TextEncoder();
  const completeTool = deferred();
  const finish = deferred();
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
          `event: tool_start\ndata: ${JSON.stringify({
            tool: { ...tool, status: "running" },
          })}\n\n`,
        ),
      );
      await completeTool.promise;
      controller.enqueue(
        encoder.encode(
          `event: tool_done\ndata: ${JSON.stringify({
            content: "tool output",
            id: tool.id,
            status: "success",
            title: tool.title,
          })}\n\n`,
        ),
      );
      await finish.promise;
      controller.enqueue(
        encoder.encode(
          `event: output_start\ndata: ${JSON.stringify({ index: 2 })}\n\n`,
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

  return {
    completeTool: completeTool.resolve,
    finish: finish.resolve,
    response: new Response(stream, {
      headers: { "Content-Type": "text/event-stream" },
      status: 200,
    }),
  };
};

const controlledToolTextStreamResponse = (
  tool: {
    id: string;
    name: string;
    title: string;
  },
  firstChunk: string,
  content: string,
  id = "message-assistant",
) => {
  const encoder = new TextEncoder();
  const completeTool = deferred();
  const startText = deferred();
  const finish = deferred();
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
          `event: tool_start\ndata: ${JSON.stringify({
            tool: { ...tool, status: "running" },
          })}\n\n`,
        ),
      );
      await completeTool.promise;
      controller.enqueue(
        encoder.encode(
          `event: tool_done\ndata: ${JSON.stringify({
            content: "tool output",
            id: tool.id,
            status: "success",
            title: tool.title,
          })}\n\n`,
        ),
      );
      await startText.promise;
      controller.enqueue(
        encoder.encode(
          `event: output_start\ndata: ${JSON.stringify({ index: 2 })}\n\n`,
        ),
      );
      controller.enqueue(
        encoder.encode(
          `event: delta\ndata: ${JSON.stringify({ content: firstChunk })}\n\n`,
        ),
      );
      await finish.promise;
      controller.enqueue(
        encoder.encode(
          `event: delta\ndata: ${JSON.stringify({ content: content.slice(firstChunk.length) })}\n\n`,
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

  return {
    completeTool: completeTool.resolve,
    finish: finish.resolve,
    response: new Response(stream, {
      headers: { "Content-Type": "text/event-stream" },
      status: 200,
    }),
    startText: startText.resolve,
  };
};

const assistantToolBatchStreamResponse = (
  groups: Array<
    Array<{
      id: string;
      name: string;
      status?: "failed" | "running" | "success";
      title: string;
    }>
  >,
  content = "",
  id = "message-assistant",
) => {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(
        encoder.encode(`event: start\ndata: ${JSON.stringify({ id })}\n\n`),
      );

      groups.forEach((tools, groupIndex) => {
        controller.enqueue(
          encoder.encode(
            `event: output_start\ndata: ${JSON.stringify({ index: groupIndex + 1 })}\n\n`,
          ),
        );

        tools.forEach((tool) => {
          controller.enqueue(
            encoder.encode(
              `event: tool_start\ndata: ${JSON.stringify({
                tool: { ...tool, status: "running" },
              })}\n\n`,
            ),
          );
          controller.enqueue(
            encoder.encode(
              `event: tool_done\ndata: ${JSON.stringify({
                content: "tool output",
                id: tool.id,
                status: tool.status ?? "success",
                title: tool.title,
              })}\n\n`,
            ),
          );
        });
      });

      if (content) {
        controller.enqueue(
          encoder.encode(
            `event: output_start\ndata: ${JSON.stringify({ index: groups.length + 1 })}\n\n`,
          ),
        );
        controller.enqueue(
          encoder.encode(
            `event: delta\ndata: ${JSON.stringify({ content })}\n\n`,
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

  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream" },
    status: 200,
  });
};

const mockInitialState = (
  state: Record<string, unknown>,
  modelResults: string[] = ["gpt-5.1"],
  assistantContent = "Here is the checklist.",
) => {
  vi.spyOn(window, "fetch").mockImplementation(async (input, init) => {
    if (input === "/api/state") {
      return new Response(JSON.stringify(state), {
        headers: { "Content-Type": "application/json" },
        status: 200,
      });
    }

    if (input === "/api/providers" && init?.method === "POST") {
      return new Response(init.body, {
        headers: { "Content-Type": "application/json" },
        status: 200,
      });
    }

    if (input === "/api/settings" && init?.method === "PUT") {
      return new Response(init.body, {
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

    if (input === "/api/workspace/respond" && init?.method === "POST") {
      return assistantStreamResponse(assistantContent);
    }

    return new Response(JSON.stringify({ models: modelResults }), {
      headers: { "Content-Type": "application/json" },
      status: 200,
    });
  });
};

const selectedProviderState = () => ({
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
    selected_model: "gpt-5.1",
    selected_provider_id: "provider-openai",
  },
});

const expectDocumentText = async (text: string) => {
  await waitFor(() => {
    expect(document.body).toHaveTextContent(text);
  });
};

describe("App", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("opens the Workspace as the default chat view", () => {
    render(<App />);

    expect(
      screen.getByRole("navigation", { name: "Primary navigation" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Workspace" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getAllByText("No provider").length).toBeGreaterThan(0);
    expect(
      screen.getByRole("textbox", { name: "Message Flowent" }),
    ).toBeInTheDocument();
    const sendButton = screen.getByRole("button", { name: "Send message" });
    expect(sendButton).toBeDisabled();
    expect(sendButton).not.toHaveTextContent("Send");
    expect(
      screen.queryByText(
        "I can help coordinate the launch checklist, draft each step, and keep the conversation focused on the decisions that still need a person.",
      ),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(
        "Start with the provider setup and a first workspace flow.",
      ),
    ).not.toBeInTheDocument();
  });

  it("enables the composer after content is drafted", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.type(
      screen.getByRole("textbox", { name: "Message Flowent" }),
      "   ",
    );

    expect(screen.getByRole("button", { name: "Send message" })).toBeEnabled();
  });

  it("clears the composer after a message is sent", async () => {
    const user = userEvent.setup();
    mockInitialState(selectedProviderState());
    render(<App />);

    const composer = await screen.findByRole("textbox", {
      name: "Message Flowent",
    });
    await user.type(composer, "Draft a launch checklist");
    await user.click(screen.getByRole("button", { name: "Send message" }));

    expect(composer).toHaveValue("");
    expect(screen.getByText("Draft a launch checklist")).toBeInTheDocument();
    await expectDocumentText("Here is the checklist.");
  });

  it("sends the composer content when Enter is pressed", async () => {
    const user = userEvent.setup();
    mockInitialState(selectedProviderState());
    render(<App />);

    const composer = await screen.findByRole("textbox", {
      name: "Message Flowent",
    });
    await user.type(composer, "Draft a launch checklist");
    await user.keyboard("{Enter}");

    expect(composer).toHaveValue("");
    expect(screen.getByText("Draft a launch checklist")).toBeInTheDocument();
    await expectDocumentText("Here is the checklist.");
  });

  it("requests a workspace reply and appends the assistant message", async () => {
    const user = userEvent.setup();
    mockInitialState(
      selectedProviderState(),
      ["gpt-5.1"],
      "The plan is ready.",
    );
    render(<App />);

    const composer = await screen.findByRole("textbox", {
      name: "Message Flowent",
    });
    await user.type(composer, "Draft a launch checklist");
    await user.click(screen.getByRole("button", { name: "Send message" }));

    expect(window.fetch).toHaveBeenCalledWith(
      "/api/workspace/respond",
      expect.objectContaining({
        body: JSON.stringify({ content: "Draft a launch checklist" }),
        method: "POST",
      }),
    );
    await expectDocumentText("The plan is ready.");
  });

  it("shows the first assistant stream chunk before the request finishes", async () => {
    const user = userEvent.setup();
    const assistantStream = controlledAssistantStreamResponse(
      ["First step", " is ready."],
      "First step is ready.",
    );
    mockInitialState(selectedProviderState());
    vi.mocked(window.fetch).mockImplementation(async (input, init) => {
      if (input === "/api/workspace/respond" && init?.method === "POST") {
        return assistantStream.response;
      }
      if (input === "/api/state") {
        return new Response(JSON.stringify(selectedProviderState()), {
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
      return new Response("{}", {
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

    await expectDocumentText("First step");
    expect(document.body).not.toHaveTextContent("First step is ready.");

    assistantStream.finish();
    await expectDocumentText("First step is ready.");
  });

  it("keeps the streaming cursor at the end of the current paragraph", async () => {
    const user = userEvent.setup();
    const assistantStream = controlledAssistantStreamResponse(
      ["First step", " is ready."],
      "First step is ready.",
    );
    mockInitialState(selectedProviderState());
    vi.mocked(window.fetch).mockImplementation(async (input, init) => {
      if (input === "/api/workspace/respond" && init?.method === "POST") {
        return assistantStream.response;
      }
      if (input === "/api/state") {
        return new Response(JSON.stringify(selectedProviderState()), {
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
      return new Response("{}", {
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

    const cursor = await screen.findByTestId("response-cursor");

    expect(screen.getAllByTestId("response-cursor")).toHaveLength(1);
    expect(cursor.closest("p")).toHaveTextContent("First step");
  });

  it("keeps the streaming cursor at the end of the final list item", async () => {
    const user = userEvent.setup();
    const assistantStream = controlledAssistantStreamResponse(
      ["- First step\n- Second step"],
      "- First step\n- Second step",
    );
    mockInitialState(selectedProviderState());
    vi.mocked(window.fetch).mockImplementation(async (input, init) => {
      if (input === "/api/workspace/respond" && init?.method === "POST") {
        return assistantStream.response;
      }
      if (input === "/api/state") {
        return new Response(JSON.stringify(selectedProviderState()), {
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
      return new Response("{}", {
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

    const cursor = await screen.findByTestId("response-cursor");

    expect(screen.getAllByTestId("response-cursor")).toHaveLength(1);
    expect(cursor.closest("li")).toHaveTextContent("Second step");
    expect(cursor.closest("ul")).not.toBeNull();
  });

  it("keeps the streaming cursor at the end of the code block", async () => {
    const user = userEvent.setup();
    const assistantStream = controlledAssistantStreamResponse(
      ["```ts\nconst ready = true;\n```"],
      "```ts\nconst ready = true;\n```",
    );
    mockInitialState(selectedProviderState());
    vi.mocked(window.fetch).mockImplementation(async (input, init) => {
      if (input === "/api/workspace/respond" && init?.method === "POST") {
        return assistantStream.response;
      }
      if (input === "/api/state") {
        return new Response(JSON.stringify(selectedProviderState()), {
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
      return new Response("{}", {
        headers: { "Content-Type": "application/json" },
        status: 200,
      });
    });
    render(<App />);

    const composer = await screen.findByRole("textbox", {
      name: "Message Flowent",
    });
    await user.type(composer, "Draft code");
    await user.click(screen.getByRole("button", { name: "Send message" }));

    const cursor = await screen.findByTestId("response-cursor");

    expect(screen.getAllByTestId("response-cursor")).toHaveLength(1);
    expect(cursor.closest("code")).toHaveTextContent("const ready = true;");
    expect(cursor.closest("pre")).not.toBeNull();
  });

  it("removes the streaming cursor after the reply completes", async () => {
    const user = userEvent.setup();
    const assistantStream = controlledAssistantStreamResponse(
      ["First step", " is ready."],
      "First step is ready.",
    );
    mockInitialState(selectedProviderState());
    vi.mocked(window.fetch).mockImplementation(async (input, init) => {
      if (input === "/api/workspace/respond" && init?.method === "POST") {
        return assistantStream.response;
      }
      if (input === "/api/state") {
        return new Response(JSON.stringify(selectedProviderState()), {
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
      return new Response("{}", {
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

    expect(await screen.findByTestId("response-cursor")).toBeInTheDocument();

    assistantStream.finish();

    await waitFor(() => {
      expect(screen.queryByTestId("response-cursor")).not.toBeInTheDocument();
    });
  });

  it("persists the full streamed assistant reply when streaming completes", async () => {
    const user = userEvent.setup();
    mockInitialState(
      selectedProviderState(),
      ["gpt-5.1"],
      "First step is ready.",
    );
    render(<App />);

    const composer = await screen.findByRole("textbox", {
      name: "Message Flowent",
    });
    await user.type(composer, "Draft a launch checklist");
    await user.click(screen.getByRole("button", { name: "Send message" }));

    await expectDocumentText("First step is ready.");

    expect(window.fetch).toHaveBeenCalledWith(
      "/api/workspace/respond",
      expect.objectContaining({
        body: JSON.stringify({ content: "Draft a launch checklist" }),
        method: "POST",
      }),
    );
  });

  it("stops streaming and shows an error when a streamed reply fails", async () => {
    const user = userEvent.setup();
    mockInitialState(selectedProviderState());
    vi.mocked(window.fetch).mockImplementation(async (input, init) => {
      if (input === "/api/workspace/respond" && init?.method === "POST") {
        return assistantErrorStreamResponse("Connection lost.");
      }
      if (input === "/api/state") {
        return new Response(JSON.stringify(selectedProviderState()), {
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
      return new Response("{}", {
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

    await expectDocumentText("Partial response");
    expect(await screen.findByText("Connection lost.")).toBeInTheDocument();
    expect(
      screen.queryByRole("status", { name: "Thinking" }),
    ).not.toBeInTheDocument();
  });

  it("shows tool work steps before the final streamed reply", async () => {
    const user = userEvent.setup();
    mockInitialState(selectedProviderState());
    vi.mocked(window.fetch).mockImplementation(async (input, init) => {
      if (input === "/api/workspace/respond" && init?.method === "POST") {
        return assistantToolStreamResponse(
          { id: "tool-1", name: "read_file", title: "Reading notes.txt" },
          "The notes are ready.",
        );
      }
      if (input === "/api/state") {
        return new Response(JSON.stringify(selectedProviderState()), {
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
      return new Response("{}", {
        headers: { "Content-Type": "application/json" },
        status: 200,
      });
    });
    render(<App />);

    const composer = await screen.findByRole("textbox", {
      name: "Message Flowent",
    });
    await user.type(composer, "Read the notes");
    await user.click(screen.getByRole("button", { name: "Send message" }));

    expect(await screen.findByText("Reading notes.txt")).toBeInTheDocument();
    expect(screen.getByText("Done")).toBeInTheDocument();
    await expectDocumentText("The notes are ready.");
  });

  it("keeps streaming assistant text after a failed tool step", async () => {
    const user = userEvent.setup();
    mockInitialState(selectedProviderState());
    vi.mocked(window.fetch).mockImplementation(async (input, init) => {
      if (input === "/api/workspace/respond" && init?.method === "POST") {
        return assistantToolStreamResponse(
          {
            id: "tool-1",
            name: "read_file",
            status: "failed",
            title: "Reading missing.txt",
          },
          "I could not read it.",
        );
      }
      if (input === "/api/state") {
        return new Response(JSON.stringify(selectedProviderState()), {
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
      return new Response("{}", {
        headers: { "Content-Type": "application/json" },
        status: 200,
      });
    });
    render(<App />);

    const composer = await screen.findByRole("textbox", {
      name: "Message Flowent",
    });
    await user.type(composer, "Read the file");
    await user.click(screen.getByRole("button", { name: "Send message" }));

    expect(await screen.findByText("Failed")).toBeInTheDocument();
    await expectDocumentText("I could not read it.");
  });

  it("shows plan updates as work steps", async () => {
    const user = userEvent.setup();
    mockInitialState(selectedProviderState());
    vi.mocked(window.fetch).mockImplementation(async (input, init) => {
      if (input === "/api/workspace/respond" && init?.method === "POST") {
        return assistantToolStreamResponse(
          { id: "tool-1", name: "update_plan", title: "Updating plan" },
          "Plan updated.",
        );
      }
      if (input === "/api/state") {
        return new Response(JSON.stringify(selectedProviderState()), {
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
      return new Response("{}", {
        headers: { "Content-Type": "application/json" },
        status: 200,
      });
    });
    render(<App />);

    const composer = await screen.findByRole("textbox", {
      name: "Message Flowent",
    });
    await user.type(composer, "Make a plan");
    await user.click(screen.getByRole("button", { name: "Send message" }));

    expect(await screen.findByText("Updating plan")).toBeInTheDocument();
    await expectDocumentText("Plan updated.");
  });

  it("renders assistant reply lists as Markdown", async () => {
    const user = userEvent.setup();
    mockInitialState(
      selectedProviderState(),
      ["gpt-5.1"],
      "- First step\n- Second step",
    );
    render(<App />);

    const composer = await screen.findByRole("textbox", {
      name: "Message Flowent",
    });
    await user.type(composer, "Draft a launch checklist");
    await user.click(screen.getByRole("button", { name: "Send message" }));

    const firstStep = await screen.findByText("First step");
    const list = firstStep.closest("ul");

    expect(list).not.toBeNull();
    expect(list).toHaveTextContent("Second step");
  });

  it("renders assistant reply code blocks as Markdown", async () => {
    const user = userEvent.setup();
    mockInitialState(
      selectedProviderState(),
      ["gpt-5.1"],
      "```ts\nconst ready = true;\n```",
    );
    render(<App />);

    const composer = await screen.findByRole("textbox", {
      name: "Message Flowent",
    });
    await user.type(composer, "Draft a launch checklist");
    await user.click(screen.getByRole("button", { name: "Send message" }));

    const code = await screen.findByText("const ready = true;");

    expect(code.tagName).toBe("CODE");
    expect(code.closest("pre")).not.toBeNull();
  });

  it("renders assistant reply HTML as text", async () => {
    const user = userEvent.setup();
    mockInitialState(
      selectedProviderState(),
      ["gpt-5.1"],
      "<script>window.flowentUnsafe = true;</script>",
    );
    render(<App />);

    const composer = await screen.findByRole("textbox", {
      name: "Message Flowent",
    });
    await user.type(composer, "Draft a launch checklist");
    await user.click(screen.getByRole("button", { name: "Send message" }));

    expect(
      await screen.findByText("<script>window.flowentUnsafe = true;</script>"),
    ).toBeInTheDocument();
    expect(document.querySelector("script")).toBeNull();
    expect("flowentUnsafe" in window).toBe(false);
  });

  it("renders incomplete assistant Markdown without failing", async () => {
    const user = userEvent.setup();
    mockInitialState(
      selectedProviderState(),
      ["gpt-5.1"],
      "```ts\nconst ready = true;",
    );
    render(<App />);

    const composer = await screen.findByRole("textbox", {
      name: "Message Flowent",
    });
    await user.type(composer, "Draft a launch checklist");
    await user.click(screen.getByRole("button", { name: "Send message" }));

    await expectDocumentText("const ready = true;");
  });

  it("keeps the message and shows a sending error when no model is selected", async () => {
    const user = userEvent.setup();
    mockInitialState({
      messages: [],
      providers: [],
      settings: {
        selected_model: "",
        selected_provider_id: "",
      },
    });
    vi.mocked(window.fetch).mockImplementation(async (input, init) => {
      if (input === "/api/state") {
        return new Response(
          JSON.stringify({
            messages: [],
            providers: [],
            settings: {
              selected_model: "",
              selected_provider_id: "",
            },
          }),
          {
            headers: { "Content-Type": "application/json" },
            status: 200,
          },
        );
      }
      if (input === "/api/workspace/messages" && init?.method === "PUT") {
        return new Response(init.body, {
          headers: { "Content-Type": "application/json" },
          status: 200,
        });
      }
      if (input === "/api/workspace/respond" && init?.method === "POST") {
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
      return new Response("{}", {
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

    expect(screen.getByText("Draft a launch checklist")).toBeInTheDocument();
    expect(
      await screen.findByText("Choose a provider and model before sending."),
    ).toBeInTheDocument();
  });

  it("sends drafted spaces to the workspace reply", async () => {
    const user = userEvent.setup();
    mockInitialState(selectedProviderState());
    render(<App />);

    const composer = await screen.findByRole("textbox", {
      name: "Message Flowent",
    });
    await user.type(composer, "   ");
    await user.click(screen.getByRole("button", { name: "Send message" }));

    expect(window.fetch).toHaveBeenCalledWith(
      "/api/workspace/respond",
      expect.objectContaining({
        body: JSON.stringify({ content: "   " }),
        method: "POST",
      }),
    );
  });

  it("keeps the composer content when Shift Enter is pressed", async () => {
    const user = userEvent.setup();
    mockInitialState({
      messages: [],
      providers: [],
      settings: {
        selected_model: "",
        selected_provider_id: "",
      },
    });
    render(<App />);

    const composer = await screen.findByRole("textbox", {
      name: "Message Flowent",
    });
    await user.type(composer, "Line one");
    await user.keyboard("{Shift>}{Enter}{/Shift}");
    await user.type(composer, "Line two");

    expect(composer).toHaveValue("Line one\nLine two");
    expect(screen.queryByText("Line one")).not.toBeInTheDocument();
  });

  it("keeps the composer empty when Enter is pressed without content", async () => {
    const user = userEvent.setup();
    mockInitialState({
      messages: [],
      providers: [],
      settings: {
        selected_model: "",
        selected_provider_id: "",
      },
    });
    render(<App />);

    const composer = await screen.findByRole("textbox", {
      name: "Message Flowent",
    });
    await user.click(composer);
    await user.keyboard("{Enter}");

    expect(composer).toHaveValue("");
    expect(screen.queryByRole("article")).not.toBeInTheDocument();
  });

  it("starts provider setup from an empty provider sidebar", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("tab", { name: "Providers" }));

    expect(screen.getByRole("button", { name: "New" })).toBeInTheDocument();
    expect(screen.getByText("No providers")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Provider name" })).toHaveValue(
      "",
    );
    expect(
      screen.getByRole("combobox", { name: "Provider type" }),
    ).toHaveTextContent("OpenAI");
    expect(screen.getByRole("textbox", { name: "Base URL" })).toHaveValue("");
    expect(screen.getByLabelText("API key")).toBeInTheDocument();
    expect(screen.getByText("No models")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "New" }));

    expect(screen.getByRole("textbox", { name: "Provider name" })).toHaveValue(
      "",
    );
    expect(
      screen.getByRole("combobox", { name: "Provider type" }),
    ).toHaveTextContent("OpenAI");

    await user.click(screen.getByRole("combobox", { name: "Provider type" }));

    expect(screen.getByRole("option", { name: "OpenAI" })).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: "OpenAI Responses" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: "Anthropic" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Gemini" })).toBeInTheDocument();
  });

  it("updates provider models from fetched model results", async () => {
    const user = userEvent.setup();
    mockInitialState(
      {
        messages: [],
        providers: [],
        settings: {
          selected_model: "",
          selected_provider_id: "",
        },
      },
      ["claude-sonnet-4-5", "claude-haiku-4-5"],
    );
    render(<App />);

    await user.click(screen.getByRole("tab", { name: "Providers" }));
    await user.click(screen.getByRole("combobox", { name: "Provider type" }));
    await user.click(screen.getByRole("option", { name: "Anthropic" }));
    await user.click(screen.getByRole("button", { name: "Fetch" }));

    expect(window.fetch).toHaveBeenCalledWith(
      "/api/providers/models",
      expect.objectContaining({
        body: JSON.stringify({
          base_url: "",
          provider: "anthropic",
          secret_reference: "",
        }),
        method: "POST",
      }),
    );
    expect(await screen.findByText("claude-sonnet-4-5")).toBeInTheDocument();
    expect(screen.getByText("claude-haiku-4-5")).toBeInTheDocument();
  });

  it("updates Settings model options from the saved provider models", async () => {
    const user = userEvent.setup();
    mockInitialState(
      {
        messages: [],
        providers: [],
        settings: {
          selected_model: "",
          selected_provider_id: "",
        },
      },
      ["gpt-5.1", "gpt-5.1-mini"],
    );
    render(<App />);

    await user.click(screen.getByRole("tab", { name: "Providers" }));
    await user.type(
      screen.getByRole("textbox", { name: "Provider name" }),
      "OpenAI",
    );
    await user.click(screen.getByRole("button", { name: "Fetch" }));
    expect(await screen.findByText("gpt-5.1-mini")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Save" }));
    await user.click(screen.getByRole("tab", { name: "Settings" }));
    await user.click(screen.getByRole("combobox", { name: "Provider" }));
    await user.click(screen.getByRole("option", { name: "OpenAI" }));
    await user.click(screen.getByRole("combobox", { name: "Model" }));

    expect(screen.getByRole("option", { name: "gpt-5.1" })).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: "gpt-5.1-mini" }),
    ).toBeInTheDocument();
  });

  it("switches to Settings and updates models for the selected provider", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("tab", { name: "Settings" }));

    expect(
      screen.getByRole("combobox", { name: "Provider" }),
    ).toHaveTextContent("No providers");
    expect(screen.getByRole("combobox", { name: "Provider" })).toBeDisabled();
    expect(screen.getByRole("combobox", { name: "Model" })).toHaveTextContent(
      "No models",
    );
    expect(screen.getByRole("combobox", { name: "Model" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
  });

  it("loads persisted providers when the app starts", async () => {
    mockInitialState({
      messages: [],
      providers: [
        {
          api_key: "",
          base_url: "",
          id: "provider-openai",
          models: ["gpt-5.1"],
          name: "OpenAI",
          type: "openai",
        },
      ],
      settings: {
        selected_model: "",
        selected_provider_id: "",
      },
    });

    render(<App />);
    await userEvent.click(
      await screen.findByRole("tab", { name: "Providers" }),
    );

    expect(screen.getByRole("button", { name: "OpenAI" })).toBeInTheDocument();
  });

  it("loads persisted Settings selection when the app starts", async () => {
    const user = userEvent.setup();
    mockInitialState({
      messages: [],
      providers: [
        {
          api_key: "",
          base_url: "",
          id: "provider-openai",
          models: ["gpt-5.1", "gpt-5.1-mini"],
          name: "OpenAI",
          type: "openai",
        },
      ],
      settings: {
        selected_model: "gpt-5.1-mini",
        selected_provider_id: "provider-openai",
      },
    });

    render(<App />);
    await user.click(await screen.findByRole("tab", { name: "Settings" }));

    expect(
      screen.getByRole("combobox", { name: "Provider" }),
    ).toHaveTextContent("OpenAI");
    expect(screen.getByRole("combobox", { name: "Model" })).toHaveTextContent(
      "gpt-5.1-mini",
    );
  });

  it("shows a tool step as soon as the assistant starts it", async () => {
    const user = userEvent.setup();
    const assistantStream = controlledToolTimelineResponse(
      { id: "tool-1", name: "read_file", title: "Reading notes.txt" },
      "The notes are ready.",
    );
    mockInitialState(selectedProviderState());
    vi.mocked(window.fetch).mockImplementation(async (input, init) => {
      if (input === "/api/workspace/respond" && init?.method === "POST") {
        return assistantStream.response;
      }
      if (input === "/api/state") {
        return new Response(JSON.stringify(selectedProviderState()), {
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
      return new Response("{}", {
        headers: { "Content-Type": "application/json" },
        status: 200,
      });
    });
    render(<App />);

    const composer = await screen.findByRole("textbox", {
      name: "Message Flowent",
    });
    await user.type(composer, "Read the notes");
    await user.click(screen.getByRole("button", { name: "Send message" }));

    expect(await screen.findByText("Reading notes.txt")).toBeInTheDocument();
    expect(screen.getByText("Running")).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent("The notes are ready.");
  });

  it("updates the running tool step when the tool completes", async () => {
    const user = userEvent.setup();
    const assistantStream = controlledToolTimelineResponse(
      { id: "tool-1", name: "read_file", title: "Reading notes.txt" },
      "The notes are ready.",
    );
    mockInitialState(selectedProviderState());
    vi.mocked(window.fetch).mockImplementation(async (input, init) => {
      if (input === "/api/workspace/respond" && init?.method === "POST") {
        return assistantStream.response;
      }
      if (input === "/api/state") {
        return new Response(JSON.stringify(selectedProviderState()), {
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
      return new Response("{}", {
        headers: { "Content-Type": "application/json" },
        status: 200,
      });
    });
    render(<App />);

    const composer = await screen.findByRole("textbox", {
      name: "Message Flowent",
    });
    await user.type(composer, "Read the notes");
    await user.click(screen.getByRole("button", { name: "Send message" }));

    await screen.findByText("Reading notes.txt");
    assistantStream.completeTool();

    expect(await screen.findByText("Done")).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent("The notes are ready.");
  });

  it("keeps the thinking indicator visible while a tool is running", async () => {
    const user = userEvent.setup();
    const assistantStream = controlledToolTimelineResponse(
      { id: "tool-1", name: "read_file", title: "Reading notes.txt" },
      "The notes are ready.",
    );
    mockInitialState(selectedProviderState());
    vi.mocked(window.fetch).mockImplementation(async (input, init) => {
      if (input === "/api/workspace/respond" && init?.method === "POST") {
        return assistantStream.response;
      }
      if (input === "/api/state") {
        return new Response(JSON.stringify(selectedProviderState()), {
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
      return new Response("{}", {
        headers: { "Content-Type": "application/json" },
        status: 200,
      });
    });
    render(<App />);

    const composer = await screen.findByRole("textbox", {
      name: "Message Flowent",
    });
    await user.type(composer, "Read the notes");
    await user.click(screen.getByRole("button", { name: "Send message" }));

    expect(await screen.findByText("Reading notes.txt")).toBeInTheDocument();
    expect(
      screen.getByRole("status", { name: "Thinking" }),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("response-cursor")).not.toBeInTheDocument();
  });

  it("keeps the thinking indicator visible while waiting after a tool completes", async () => {
    const user = userEvent.setup();
    const assistantStream = controlledToolTimelineResponse(
      { id: "tool-1", name: "read_file", title: "Reading notes.txt" },
      "The notes are ready.",
    );
    mockInitialState(selectedProviderState());
    vi.mocked(window.fetch).mockImplementation(async (input, init) => {
      if (input === "/api/workspace/respond" && init?.method === "POST") {
        return assistantStream.response;
      }
      if (input === "/api/state") {
        return new Response(JSON.stringify(selectedProviderState()), {
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
      return new Response("{}", {
        headers: { "Content-Type": "application/json" },
        status: 200,
      });
    });
    render(<App />);

    const composer = await screen.findByRole("textbox", {
      name: "Message Flowent",
    });
    await user.type(composer, "Read the notes");
    await user.click(screen.getByRole("button", { name: "Send message" }));

    await screen.findByText("Reading notes.txt");
    assistantStream.completeTool();

    expect(await screen.findByText("Done")).toBeInTheDocument();
    expect(
      screen.getByRole("status", { name: "Thinking" }),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("response-cursor")).not.toBeInTheDocument();
  });

  it("replaces the thinking indicator with the streaming cursor when text starts", async () => {
    const user = userEvent.setup();
    const assistantStream = controlledToolTextStreamResponse(
      { id: "tool-1", name: "read_file", title: "Reading notes.txt" },
      "The notes",
      "The notes are ready.",
    );
    mockInitialState(selectedProviderState());
    vi.mocked(window.fetch).mockImplementation(async (input, init) => {
      if (input === "/api/workspace/respond" && init?.method === "POST") {
        return assistantStream.response;
      }
      if (input === "/api/state") {
        return new Response(JSON.stringify(selectedProviderState()), {
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
      return new Response("{}", {
        headers: { "Content-Type": "application/json" },
        status: 200,
      });
    });
    render(<App />);

    const composer = await screen.findByRole("textbox", {
      name: "Message Flowent",
    });
    await user.type(composer, "Read the notes");
    await user.click(screen.getByRole("button", { name: "Send message" }));

    await screen.findByText("Reading notes.txt");
    assistantStream.completeTool();
    await screen.findByText("Done");
    assistantStream.startText();

    expect(await screen.findByTestId("response-cursor")).toBeInTheDocument();
    expect(
      screen.queryByRole("status", { name: "Thinking" }),
    ).not.toBeInTheDocument();
  });

  it("shows streamed text after a tool step as the next assistant output item", async () => {
    const user = userEvent.setup();
    const assistantStream = controlledToolTimelineResponse(
      { id: "tool-1", name: "read_file", title: "Reading notes.txt" },
      "The notes are ready.",
    );
    mockInitialState(selectedProviderState());
    vi.mocked(window.fetch).mockImplementation(async (input, init) => {
      if (input === "/api/workspace/respond" && init?.method === "POST") {
        return assistantStream.response;
      }
      if (input === "/api/state") {
        return new Response(JSON.stringify(selectedProviderState()), {
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
      return new Response("{}", {
        headers: { "Content-Type": "application/json" },
        status: 200,
      });
    });
    render(<App />);

    const composer = await screen.findByRole("textbox", {
      name: "Message Flowent",
    });
    await user.type(composer, "Read the notes");
    await user.click(screen.getByRole("button", { name: "Send message" }));

    const toolStep = await screen.findByText("Reading notes.txt");
    assistantStream.completeTool();
    await screen.findByText("Done");
    assistantStream.finish();
    const reply = await screen.findByText("The notes are ready.");

    expect(
      toolStep.compareDocumentPosition(reply) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.getAllByTestId("assistant-output-separator")).toHaveLength(1);
  });

  it("keeps tools from the same assistant output group together", async () => {
    const user = userEvent.setup();
    mockInitialState(selectedProviderState());
    vi.mocked(window.fetch).mockImplementation(async (input, init) => {
      if (input === "/api/workspace/respond" && init?.method === "POST") {
        return assistantToolBatchStreamResponse([
          [
            {
              id: "tool-1",
              name: "list_files",
              title: "Listed /project/flowent",
            },
            {
              id: "tool-2",
              name: "read_file",
              title: "Read README.md",
            },
          ],
        ]);
      }
      if (input === "/api/state") {
        return new Response(JSON.stringify(selectedProviderState()), {
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
      return new Response("{}", {
        headers: { "Content-Type": "application/json" },
        status: 200,
      });
    });
    render(<App />);

    const composer = await screen.findByRole("textbox", {
      name: "Message Flowent",
    });
    await user.type(composer, "Inspect the workspace");
    await user.click(screen.getByRole("button", { name: "Send message" }));

    expect(
      await screen.findByText("Listed /project/flowent"),
    ).toBeInTheDocument();
    expect(await screen.findByText("Read README.md")).toBeInTheDocument();
    expect(
      screen.queryByTestId("assistant-output-separator"),
    ).not.toBeInTheDocument();
  });

  it("separates tool batches from different assistant output groups", async () => {
    const user = userEvent.setup();
    mockInitialState(selectedProviderState());
    vi.mocked(window.fetch).mockImplementation(async (input, init) => {
      if (input === "/api/workspace/respond" && init?.method === "POST") {
        return assistantToolBatchStreamResponse([
          [
            {
              id: "tool-1",
              name: "list_files",
              title: "Listed /project/flowent",
            },
            {
              id: "tool-2",
              name: "read_file",
              title: "Read README.md",
            },
          ],
          [
            {
              id: "tool-3",
              name: "read_file",
              title: "Read package.json",
            },
          ],
        ]);
      }
      if (input === "/api/state") {
        return new Response(JSON.stringify(selectedProviderState()), {
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
      return new Response("{}", {
        headers: { "Content-Type": "application/json" },
        status: 200,
      });
    });
    render(<App />);

    const composer = await screen.findByRole("textbox", {
      name: "Message Flowent",
    });
    await user.type(composer, "Inspect the workspace");
    await user.click(screen.getByRole("button", { name: "Send message" }));

    expect(await screen.findByText("Read README.md")).toBeInTheDocument();
    expect(await screen.findByText("Read package.json")).toBeInTheDocument();
    expect(screen.getAllByTestId("assistant-output-separator")).toHaveLength(1);
  });

  it("separates persisted assistant tools from the final text", async () => {
    mockInitialState({
      messages: [
        {
          author: "assistant",
          content: "The notes are ready.",
          id: "message-1",
          tools: [
            {
              id: "tool-1",
              name: "list_files",
              status: "success",
              title: "Listed /project/flowent",
            },
            {
              id: "tool-2",
              name: "read_file",
              status: "success",
              title: "Read README.md",
            },
          ],
        },
      ],
      providers: [],
      settings: {
        selected_model: "",
        selected_provider_id: "",
      },
    });

    render(<App />);

    expect(await screen.findByText("Read README.md")).toBeInTheDocument();
    expect(screen.getAllByTestId("assistant-output-separator")).toHaveLength(1);
  });

  it("loads persisted assistant tools before the final text", async () => {
    mockInitialState({
      messages: [
        {
          author: "assistant",
          content: "The notes are ready.",
          id: "message-1",
          tools: [
            {
              id: "tool-1",
              name: "list_files",
              status: "success",
              title: "Listed /project/flowent",
            },
            {
              id: "tool-2",
              name: "read_file",
              status: "success",
              title: "Read README.md",
            },
          ],
        },
      ],
      providers: [],
      settings: {
        selected_model: "",
        selected_provider_id: "",
      },
    });

    render(<App />);

    const listed = await screen.findByText("Listed /project/flowent");
    const read = screen.getByText("Read README.md");
    const reply = screen.getByText("The notes are ready.");

    expect(
      listed.compareDocumentPosition(read) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      read.compareDocumentPosition(reply) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("does not add assistant output separators for a reply without tools", async () => {
    const user = userEvent.setup();
    mockInitialState(
      selectedProviderState(),
      ["gpt-5.1"],
      "The plan is ready.",
    );
    render(<App />);

    const composer = await screen.findByRole("textbox", {
      name: "Message Flowent",
    });
    await user.type(composer, "Draft a launch checklist");
    await user.click(screen.getByRole("button", { name: "Send message" }));

    await expectDocumentText("The plan is ready.");
    expect(
      screen.queryByTestId("assistant-output-separator"),
    ).not.toBeInTheDocument();
  });

  it("loads persisted Workspace messages when the app starts", async () => {
    mockInitialState({
      messages: [
        {
          author: "user",
          content: "Draft a launch checklist",
          id: "message-1",
        },
      ],
      providers: [],
      settings: {
        selected_model: "",
        selected_provider_id: "",
      },
    });

    render(<App />);

    expect(
      await screen.findByText("Draft a launch checklist"),
    ).toBeInTheDocument();
  });

  it("loads persisted assistant tool steps when the app starts", async () => {
    mockInitialState({
      messages: [
        {
          author: "assistant",
          content: "Plan updated.",
          id: "message-1",
          tools: [
            {
              id: "tool-1",
              name: "update_plan",
              status: "success",
              title: "Updating plan",
            },
          ],
        },
      ],
      providers: [],
      settings: {
        selected_model: "",
        selected_provider_id: "",
      },
    });

    render(<App />);

    expect(await screen.findByText("Updating plan")).toBeInTheDocument();
    expect(screen.getByText("Done")).toBeInTheDocument();
    expect(screen.getByText("Plan updated.")).toBeInTheDocument();
  });

  it("shows the Workspace Clear control in the floating control bar", async () => {
    mockInitialState({
      messages: [],
      providers: [],
      settings: {
        selected_model: "",
        selected_provider_id: "",
      },
    });

    render(<App />);

    expect(await screen.findByLabelText("Workspace controls")).toContainElement(
      screen.getByRole("button", { name: /Clear/ }),
    );
  });

  it("clears visible Workspace messages and returns to the empty state", async () => {
    const user = userEvent.setup();
    mockInitialState({
      messages: [
        {
          author: "user",
          content: "Draft a launch checklist",
          id: "message-1",
        },
      ],
      providers: [],
      settings: {
        selected_model: "",
        selected_provider_id: "",
      },
    });

    render(<App />);

    expect(
      await screen.findByText("Draft a launch checklist"),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Clear/ }));

    expect(
      screen.queryByText("Draft a launch checklist"),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Where should we begin?")).toBeInTheDocument();
  });

  it("persists an empty Workspace message list when Clear is clicked", async () => {
    const user = userEvent.setup();
    mockInitialState({
      messages: [
        {
          author: "user",
          content: "Draft a launch checklist",
          id: "message-1",
        },
      ],
      providers: [],
      settings: {
        selected_model: "",
        selected_provider_id: "",
      },
    });

    render(<App />);

    await screen.findByText("Draft a launch checklist");
    await user.click(screen.getByRole("button", { name: /Clear/ }));

    expect(window.fetch).toHaveBeenCalledWith(
      "/api/workspace/messages",
      expect.objectContaining({
        body: JSON.stringify({ messages: [] }),
        method: "PUT",
      }),
    );
  });

  it("clears the Workspace while a streamed reply is still running", async () => {
    const user = userEvent.setup();
    const assistantStream = controlledAssistantStreamResponse(
      ["First step", " is ready."],
      "First step is ready.",
    );
    mockInitialState(selectedProviderState());
    vi.mocked(window.fetch).mockImplementation(async (input, init) => {
      if (input === "/api/workspace/respond" && init?.method === "POST") {
        return assistantStream.response;
      }
      if (input === "/api/state") {
        return new Response(JSON.stringify(selectedProviderState()), {
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
      return new Response("{}", {
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
    await expectDocumentText("First step");

    await user.click(screen.getByRole("button", { name: /Clear/ }));
    assistantStream.finish();

    await waitFor(() => {
      expect(document.body).not.toHaveTextContent("Draft a launch checklist");
      expect(document.body).not.toHaveTextContent("First step");
      expect(document.body).not.toHaveTextContent("First step is ready.");
    });
    expect(screen.getByText("Where should we begin?")).toBeInTheDocument();
  });

  it("persists the model list when a provider is saved", async () => {
    const user = userEvent.setup();
    mockInitialState({
      messages: [],
      providers: [],
      settings: {
        selected_model: "",
        selected_provider_id: "",
      },
    });

    render(<App />);
    await user.click(await screen.findByRole("tab", { name: "Providers" }));
    await user.type(
      screen.getByRole("textbox", { name: "Provider name" }),
      "OpenAI",
    );
    await user.click(screen.getByRole("button", { name: "Fetch" }));
    expect(await screen.findByText("gpt-5.1")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(window.fetch).toHaveBeenCalledWith(
      "/api/providers",
      expect.objectContaining({
        body: expect.stringContaining('"models":["gpt-5.1"]'),
        method: "POST",
      }),
    );
  });
});
