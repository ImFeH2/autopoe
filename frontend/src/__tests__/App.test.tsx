import { render, screen, waitFor, within } from "@testing-library/react";
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

const assistantDeltaOnlyStreamResponse = (
  content: string,
  id = "message-assistant",
  chunks: string[] = [content],
) => {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
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

const runStartResponse = (runId = "run-1") =>
  new Response(JSON.stringify({ run_id: runId }), {
    headers: { "Content-Type": "application/json" },
    status: 200,
  });

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
};

type TestTool = {
  arguments?: Record<string, unknown> | null;
  data?: Record<string, unknown> | null;
  id: string;
  name: string;
  output?: string;
  status?: "failed" | "running" | "success" | "waiting";
  title: string;
};

type TestTelegramSession = {
  chat_id: string;
  display_name: string;
  recent_message: string;
  status: "approved" | "pending";
  updated_at: number;
  user_id: string;
  username: string;
};

type TestTelegramBot = {
  bot_token: string;
  enabled: boolean;
  error: string;
  sessions: TestTelegramSession[];
  status: "disabled" | "error" | "running" | "starting";
};

type TestMcpTool = {
  description?: string;
  input_schema?: Record<string, unknown>;
  name: string;
};

type TestMcpServer = {
  args: string[];
  command: string;
  config?: Record<string, unknown>;
  enabled: boolean;
  error: string;
  id: string;
  name: string;
  status: "disabled" | "error" | "ready" | "starting";
  tools: TestMcpTool[];
  type: "command" | "url";
  url: string;
};

type TestMcpImportPreview = {
  servers: TestMcpServer[];
};

type TestSkill = {
  description: string;
  enabled: boolean;
  error: string;
  id: string;
  name: string;
  path: string;
  scope: "project" | "user";
  slug: string;
};

type TestWritablePath = {
  created_at: number;
  path: string;
};

const controlledThinkingStreamResponse = (
  thinking: string,
  content: string,
  id = "message-assistant",
) => {
  const encoder = new TextEncoder();
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
          `event: thinking_delta\ndata: ${JSON.stringify({ content: thinking })}\n\n`,
        ),
      );
      await finish.promise;
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
              thinking,
            },
          })}\n\n`,
        ),
      );
      controller.close();
    },
  });

  return {
    finish: finish.resolve,
    response: new Response(stream, {
      headers: { "Content-Type": "text/event-stream" },
      status: 200,
    }),
  };
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

const abortableAssistantStreamResponse = (
  chunk: string,
  id = "message-assistant",
) => {
  const encoder = new TextEncoder();
  let isAborted = false;
  const aborted = deferred();
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
          `event: delta\ndata: ${JSON.stringify({ content: chunk })}\n\n`,
        ),
      );
      await aborted.promise;
      controller.close();
    },
  });

  return {
    aborted: aborted.promise,
    wasAborted: () => isAborted,
    response: (nextSignal?: AbortSignal) => {
      nextSignal?.addEventListener(
        "abort",
        () => {
          isAborted = true;
          aborted.resolve();
        },
        { once: true },
      );
      return new Response(stream, {
        headers: { "Content-Type": "text/event-stream" },
        status: 200,
      });
    },
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
  tool: TestTool,
  content: string,
  id = "message-assistant",
) => {
  const encoder = new TextEncoder();
  const { data, output, status, ...startTool } = tool;
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
            tool: { ...startTool, status: "running" },
          })}\n\n`,
        ),
      );
      controller.enqueue(
        encoder.encode(
          `event: tool_done\ndata: ${JSON.stringify({
            content: output ?? "tool output",
            data,
            id: tool.id,
            status: status ?? "success",
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

const assistantThinkingToolStreamResponse = (
  thinking: string,
  tool: TestTool,
  content: string,
  id = "message-assistant",
) => {
  const encoder = new TextEncoder();
  const { data, output, status, ...startTool } = tool;
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
          `event: thinking_delta\ndata: ${JSON.stringify({ content: thinking })}\n\n`,
        ),
      );
      controller.enqueue(
        encoder.encode(
          `event: tool_start\ndata: ${JSON.stringify({
            tool: { ...startTool, status: "running" },
          })}\n\n`,
        ),
      );
      controller.enqueue(
        encoder.encode(
          `event: tool_done\ndata: ${JSON.stringify({
            content: output ?? "tool output",
            data,
            id: tool.id,
            status: status ?? "success",
            title: tool.title,
          })}\n\n`,
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
              thinking,
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
  tool: TestTool,
  content: string,
  id = "message-assistant",
) => {
  const encoder = new TextEncoder();
  const completeTool = deferred();
  const finish = deferred();
  const { data, output, ...startTool } = tool;
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
            tool: { ...startTool, status: "running" },
          })}\n\n`,
        ),
      );
      await completeTool.promise;
      controller.enqueue(
        encoder.encode(
          `event: tool_done\ndata: ${JSON.stringify({
            content: output ?? "tool output",
            data,
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
  tool: TestTool,
  firstChunk: string,
  content: string,
  id = "message-assistant",
) => {
  const encoder = new TextEncoder();
  const completeTool = deferred();
  const startText = deferred();
  const finish = deferred();
  const { data, output, ...startTool } = tool;
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
            tool: { ...startTool, status: "running" },
          })}\n\n`,
        ),
      );
      await completeTool.promise;
      controller.enqueue(
        encoder.encode(
          `event: tool_done\ndata: ${JSON.stringify({
            content: output ?? "tool output",
            data,
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
  groups: TestTool[][],
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
          const { data, output, status, ...startTool } = tool;
          controller.enqueue(
            encoder.encode(
              `event: tool_start\ndata: ${JSON.stringify({
                tool: { ...startTool, status: "running" },
              })}\n\n`,
            ),
          );
          controller.enqueue(
            encoder.encode(
              `event: tool_done\ndata: ${JSON.stringify({
                content: output ?? "tool output",
                data,
                id: tool.id,
                status: status ?? "success",
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
  mcpImportPreview: Partial<
    Record<"claude_code" | "codex", TestMcpImportPreview>
  > = {
    codex: codexMcpImportPreview(),
  },
) => {
  vi.spyOn(window, "fetch").mockImplementation(async (input, init) => {
    if (input === "/api/state") {
      return new Response(
        JSON.stringify({
          mcp_servers: [],
          skills: [],
          telegram_bot: emptyTelegramBotState(),
          ...state,
        }),
        {
          headers: { "Content-Type": "application/json" },
          status: 200,
        },
      );
    }

    if (input === "/api/telegram-bot" && init?.method === "PUT") {
      return new Response(init.body, {
        headers: { "Content-Type": "application/json" },
        status: 200,
      });
    }

    if (
      input === "/api/permissions/writable-paths" &&
      init?.method === "DELETE"
    ) {
      const request = JSON.parse(String(init.body)) as { path: string };
      const writablePaths = (
        "writable_paths" in state ? state.writable_paths : []
      ) as TestWritablePath[];
      return new Response(
        JSON.stringify({
          writable_paths: writablePaths.filter(
            (writablePath) => writablePath.path !== request.path,
          ),
        }),
        {
          headers: { "Content-Type": "application/json" },
          status: 200,
        },
      );
    }

    if (input === "/api/telegram-bot/approve" && init?.method === "POST") {
      const request = JSON.parse(String(init.body)) as { chat_id: string };
      const telegramBot = (
        "telegram_bot" in state ? state.telegram_bot : emptyTelegramBotState()
      ) as ReturnType<typeof emptyTelegramBotState>;
      const session = telegramBot.sessions.find(
        (currentSession) => currentSession.chat_id === request.chat_id,
      );
      return new Response(
        JSON.stringify({
          ...(session ?? {
            chat_id: request.chat_id,
            display_name: "",
            recent_message: "",
            updated_at: 0,
            user_id: "",
            username: "",
          }),
          status: "approved",
        }),
        {
          headers: { "Content-Type": "application/json" },
          status: 200,
        },
      );
    }

    if (input === "/api/mcp/servers" && init?.method === "PUT") {
      const request = JSON.parse(String(init.body)) as TestMcpServer;
      return new Response(
        JSON.stringify({
          ...request,
          status: request.enabled ? "ready" : "disabled",
          tools: request.enabled
            ? [
                {
                  description: "Read a file",
                  input_schema: { type: "object" },
                  name: "read_file",
                },
              ]
            : [],
        }),
        {
          headers: { "Content-Type": "application/json" },
          status: 200,
        },
      );
    }

    if (input === "/api/mcp/import/preview" && init?.method === "POST") {
      const request = JSON.parse(String(init.body)) as {
        source: "claude_code" | "codex";
      };
      return new Response(
        JSON.stringify(mcpImportPreview[request.source] ?? { servers: [] }),
        {
          headers: { "Content-Type": "application/json" },
          status: 200,
        },
      );
    }

    if (input === "/api/mcp/import" && init?.method === "POST") {
      const request = JSON.parse(String(init.body)) as {
        server_id: string;
        source: "claude_code" | "codex";
      };
      const servers = (mcpImportPreview[request.source]?.servers ?? [])
        .filter((server) => server.id === request.server_id)
        .map((server) => ({
          ...server,
          status: server.enabled ? "ready" : "disabled",
        }));
      return new Response(JSON.stringify(servers), {
        headers: { "Content-Type": "application/json" },
        status: 200,
      });
    }

    if (
      typeof input === "string" &&
      input.startsWith("/api/mcp/servers/") &&
      input.endsWith("/reconnect") &&
      init?.method === "POST"
    ) {
      const mcpServers = (
        "mcp_servers" in state ? state.mcp_servers : []
      ) as TestMcpServer[];
      const serverId = input
        .replace("/api/mcp/servers/", "")
        .replace("/reconnect", "");
      const server = mcpServers.find((current) => current.id === serverId);
      return new Response(
        JSON.stringify({
          ...(server ?? commandMcpServer()),
          status: "ready",
          tools: [
            {
              description: "Read a file",
              input_schema: { type: "object" },
              name: "read_file",
            },
            {
              description: "Write a file",
              input_schema: { type: "object" },
              name: "write_file",
            },
          ],
        }),
        {
          headers: { "Content-Type": "application/json" },
          status: 200,
        },
      );
    }

    if (
      typeof input === "string" &&
      input.startsWith("/api/mcp/servers/") &&
      init?.method === "DELETE"
    ) {
      return new Response(JSON.stringify({ ok: true }), {
        headers: { "Content-Type": "application/json" },
        status: 200,
      });
    }

    if (
      typeof input === "string" &&
      input.startsWith("/api/skills/") &&
      init?.method === "PUT"
    ) {
      const request = JSON.parse(String(init.body)) as { enabled: boolean };
      const skillId = input.replace("/api/skills/", "");
      const skills = ("skills" in state ? state.skills : []) as TestSkill[];
      const skill = skills.find((current) => current.id === skillId);
      return new Response(
        JSON.stringify({
          ...(skill ?? projectSkill()),
          enabled: request.enabled,
        }),
        {
          headers: { "Content-Type": "application/json" },
          status: 200,
        },
      );
    }

    if (input === "/api/skills/reload" && init?.method === "POST") {
      return new Response(
        JSON.stringify(("skills" in state ? state.skills : []) as TestSkill[]),
        {
          headers: { "Content-Type": "application/json" },
          status: 200,
        },
      );
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

    if (input === "/api/workspace/compact" && init?.method === "POST") {
      return new Response(
        JSON.stringify({
          message: {
            author: "system",
            content: "Context compacted",
            id: "compact-message",
            tools: [],
          },
        }),
        {
          headers: { "Content-Type": "application/json" },
          status: 200,
        },
      );
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
  telegram_bot: emptyTelegramBotState(),
});

const emptyTelegramBotState = (): TestTelegramBot => ({
  bot_token: "",
  enabled: false,
  error: "",
  sessions: [],
  status: "disabled",
});

const commandMcpServer = (
  updates: Partial<TestMcpServer> = {},
): TestMcpServer => ({
  args: ["-y", "@modelcontextprotocol/server-filesystem", "/project"],
  command: "npx",
  config: {},
  enabled: true,
  error: "",
  id: "mcp-files",
  name: "Files",
  status: "ready",
  tools: [
    {
      description: "Read a file",
      input_schema: { type: "object" },
      name: "read_file",
    },
  ],
  type: "command",
  url: "",
  ...updates,
});

const codexMcpImportPreview = (): TestMcpImportPreview => {
  const server = commandMcpServer({
    args: ["-y", "@modelcontextprotocol/server-filesystem", "/project"],
    config: {
      args: ["-y", "@modelcontextprotocol/server-filesystem", "/project"],
      command: "npx",
    },
    id: "mcp-docs",
    name: "docs",
    status: "disabled",
    tools: [],
  });
  return {
    servers: [server],
  };
};

const codexMultiMcpImportPreview = (): TestMcpImportPreview => ({
  servers: [
    ...codexMcpImportPreview().servers,
    commandMcpServer({
      args: ["-y", "@modelcontextprotocol/server-memory"],
      config: {
        args: ["-y", "@modelcontextprotocol/server-memory"],
        command: "npx",
      },
      id: "mcp-memory",
      name: "memory",
      status: "disabled",
      tools: [],
    }),
  ],
});

const claudeCodeMcpImportPreview = (): TestMcpImportPreview => {
  const server = commandMcpServer({
    args: [],
    command: "",
    config: {
      headers: { "X-Team": "${TEAM_ID:-local}" },
      type: "http",
      url: "https://linear.example.com/mcp",
    },
    id: "mcp-linear",
    name: "Linear",
    status: "disabled",
    tools: [],
    type: "url",
    url: "https://linear.example.com/mcp",
  });
  return {
    servers: [server],
  };
};

const mixedMcpImportPreview = (): Partial<
  Record<"claude_code" | "codex", TestMcpImportPreview>
> => ({
  claude_code: claudeCodeMcpImportPreview(),
  codex: codexMcpImportPreview(),
});

const projectSkill = (updates: Partial<TestSkill> = {}): TestSkill => ({
  description: "Review project changes.",
  enabled: true,
  error: "",
  id: "skill-project-review",
  name: "Project Review",
  path: "/workspace/.flowent/skills/review/SKILL.md",
  scope: "project",
  slug: "project-review",
  ...updates,
});

const expectDocumentText = async (text: string) => {
  await waitFor(() => {
    expect(document.body).toHaveTextContent(text);
  });
};

const fetchWasCalledWith = (path: string, method: string) =>
  vi.mocked(window.fetch).mock.calls.some(([input, init]) => {
    return input === path && init?.method === method;
  });

const mockSelectedProviderWorkspaceResponse = (response: Response) => {
  mockInitialState(selectedProviderState());
  vi.mocked(window.fetch).mockImplementation(async (input, init) => {
    if (input === "/api/workspace/respond" && init?.method === "POST") {
      return response;
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

  it("scrolls to the bottom after a message is sent", async () => {
    const user = userEvent.setup();
    const originalScrollIntoView = window.HTMLElement.prototype.scrollIntoView;
    const scrollIntoView = vi.fn();
    window.HTMLElement.prototype.scrollIntoView = scrollIntoView;

    try {
      mockInitialState(selectedProviderState());
      render(<App />);

      const composer = await screen.findByRole("textbox", {
        name: "Message Flowent",
      });

      scrollIntoView.mockClear();
      await user.type(composer, "Draft a launch checklist");
      await user.click(screen.getByRole("button", { name: "Send message" }));

      await waitFor(() => {
        expect(scrollIntoView).toHaveBeenCalledWith({
          behavior: "smooth",
          block: "end",
        });
      });
    } finally {
      window.HTMLElement.prototype.scrollIntoView = originalScrollIntoView;
    }
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

  it("starts a workspace run and subscribes to its stream", async () => {
    const user = userEvent.setup();
    mockInitialState(selectedProviderState());
    vi.mocked(window.fetch).mockImplementation(async (input, init) => {
      if (input === "/api/workspace/runs" && init?.method === "POST") {
        return runStartResponse("run-checklist");
      }
      if (
        input === "/api/workspace/runs/run-checklist/stream?after=0" &&
        init?.method === "GET"
      ) {
        return assistantStreamResponse("The plan is ready.");
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

    await expectDocumentText("The plan is ready.");
    expect(window.fetch).toHaveBeenCalledWith(
      "/api/workspace/runs",
      expect.objectContaining({
        body: JSON.stringify({ content: "Draft a launch checklist" }),
        method: "POST",
      }),
    );
    expect(window.fetch).toHaveBeenCalledWith(
      "/api/workspace/runs/run-checklist/stream?after=0",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("reloads state and reconnects when a workspace run stream drops", async () => {
    const user = userEvent.setup();
    const droppedStream = new Response(
      new ReadableStream({
        start(controller) {
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
      active_run_event_index: 2,
      active_run_id: "run-reconnect",
      messages: [
        {
          author: "user",
          content: "Draft a launch checklist",
          id: "message-user",
        },
        {
          author: "assistant",
          content: "Partial",
          id: "message-assistant",
          status: "running",
        },
      ],
    };
    let stateRequests = 0;
    mockInitialState(selectedProviderState());
    vi.mocked(window.fetch).mockImplementation(async (input, init) => {
      if (input === "/api/workspace/runs" && init?.method === "POST") {
        return runStartResponse("run-reconnect");
      }
      if (
        input === "/api/workspace/runs/run-reconnect/stream?after=0" &&
        init?.method === "GET"
      ) {
        return droppedStream;
      }
      if (
        input === "/api/workspace/runs/run-reconnect/stream?after=2" &&
        init?.method === "GET"
      ) {
        return assistantDeltaOnlyStreamResponse(
          "Partial answer.",
          "message-assistant",
          [" answer."],
        );
      }
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

    await expectDocumentText("Partial answer.");
    expect(window.fetch).toHaveBeenCalledWith(
      "/api/workspace/runs/run-reconnect/stream?after=2",
      expect.objectContaining({ method: "GET" }),
    );
    expect(document.body).not.toHaveTextContent("Load failed");
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

  it("shows Stop in the composer while the assistant is responding", async () => {
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

    expect(await screen.findByRole("button", { name: "Stop" })).toBeEnabled();
    expect(
      screen.queryByRole("button", { name: "Send message" }),
    ).not.toBeInTheDocument();

    assistantStream.finish();
    await expectDocumentText("First step is ready.");
  });

  it("aborts the current workspace response when Stop is clicked", async () => {
    const user = userEvent.setup();
    const assistantStream =
      abortableAssistantStreamResponse("Partial response");
    mockInitialState(selectedProviderState());
    vi.mocked(window.fetch).mockImplementation(async (input, init) => {
      if (input === "/api/workspace/respond" && init?.method === "POST") {
        return assistantStream.response(init.signal as AbortSignal | undefined);
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
    await screen.findByText("Partial response");
    await user.click(screen.getByRole("button", { name: "Stop" }));

    await expect(assistantStream.aborted).resolves.toBeUndefined();
    expect(assistantStream.wasAborted()).toBe(true);
    await waitFor(() => {
      expect(
        screen.queryByRole("button", { name: "Stop" }),
      ).not.toBeInTheDocument();
    });
  });

  it("keeps the partial assistant response after Stop is clicked", async () => {
    const user = userEvent.setup();
    const assistantStream =
      abortableAssistantStreamResponse("Partial response");
    mockInitialState(selectedProviderState());
    vi.mocked(window.fetch).mockImplementation(async (input, init) => {
      if (input === "/api/workspace/respond" && init?.method === "POST") {
        return assistantStream.response(init.signal as AbortSignal | undefined);
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
    await screen.findByText("Partial response");
    await user.click(screen.getByRole("button", { name: "Stop" }));

    await waitFor(() => {
      expect(
        screen.queryByRole("button", { name: "Stop" }),
      ).not.toBeInTheDocument();
    });
    expect(screen.getByText("Partial response")).toBeInTheDocument();
  });

  it("does not show a sending error after Stop is clicked", async () => {
    const user = userEvent.setup();
    const assistantStream =
      abortableAssistantStreamResponse("Partial response");
    mockInitialState(selectedProviderState());
    vi.mocked(window.fetch).mockImplementation(async (input, init) => {
      if (input === "/api/workspace/respond" && init?.method === "POST") {
        return assistantStream.response(init.signal as AbortSignal | undefined);
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
    await screen.findByText("Partial response");
    await user.click(screen.getByRole("button", { name: "Stop" }));

    await waitFor(() => {
      expect(
        screen.queryByRole("button", { name: "Stop" }),
      ).not.toBeInTheDocument();
    });
    expect(document.body).not.toHaveTextContent("Message could not be sent.");
  });

  it("returns to Send after Stop and sends the next drafted message", async () => {
    const user = userEvent.setup();
    const firstStream = abortableAssistantStreamResponse("Partial response");
    let replyCount = 0;
    mockInitialState(selectedProviderState());
    vi.mocked(window.fetch).mockImplementation(async (input, init) => {
      if (input === "/api/workspace/respond" && init?.method === "POST") {
        replyCount += 1;
        if (replyCount === 1) {
          return firstStream.response(init.signal as AbortSignal | undefined);
        }
        return assistantStreamResponse("Second answer.");
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
    await screen.findByText("Partial response");
    await user.click(screen.getByRole("button", { name: "Stop" }));

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Send message" }),
      ).toBeDisabled();
    });
    await user.type(composer, "Continue");
    await user.click(screen.getByRole("button", { name: "Send message" }));

    await expectDocumentText("Second answer.");
    expect(replyCount).toBe(2);
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
          {
            arguments: { path: "notes.txt" },
            data: { path: "notes.txt" },
            id: "tool-1",
            name: "read_file",
            output: "Note contents",
            title: "Reading notes.txt",
          },
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
    expect(document.body).not.toHaveTextContent("ARGS");
    expect(document.body).not.toHaveTextContent("RESULT");
    await expectDocumentText("The notes are ready.");
  });

  it("shows automatic review details when a tool requests elevated access", async () => {
    const user = userEvent.setup();
    const toolStream = controlledToolTimelineResponse(
      {
        arguments: {
          additional_permissions: {
            file_system: { write: ["/workspace/.cache/pnpm"] },
          },
          command: "pnpm install",
          sandbox_permissions: "with_additional_permissions",
        },
        data: {
          approval: {
            action: "additional_permissions",
            decision: "approved",
            reason: "Needed for cache writes.",
            tool_name: "shell_command",
            write_paths: ["/workspace/.cache/pnpm"],
          },
          command: "pnpm install",
          exit_code: 0,
          stderr: "",
          stdout: "done",
        },
        id: "tool-1",
        name: "shell_command",
        output: "done",
        title: "Ran pnpm install",
      },
      "Dependencies are ready.",
    );
    mockInitialState(selectedProviderState());
    vi.mocked(window.fetch).mockImplementation(async (input, init) => {
      if (input === "/api/workspace/runs" && init?.method === "POST") {
        return runStartResponse("run-review");
      }
      if (
        input === "/api/workspace/runs/run-review/stream?after=0" &&
        init?.method === "GET"
      ) {
        return toolStream.response;
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
    await user.type(composer, "Install dependencies");
    await user.click(screen.getByRole("button", { name: "Send message" }));
    await user.click(
      await screen.findByRole("button", { name: /Ran pnpm install/ }),
    );
    toolStream.completeTool();

    expect(await screen.findByText("REVIEW")).toBeInTheDocument();
    expect(screen.getByText("Approved")).toBeInTheDocument();
    expect(screen.getByText("Needed for cache writes.")).toBeInTheDocument();
    expect(screen.getByText("/workspace/.cache/pnpm")).toBeInTheDocument();
    const resultBlock = screen.getByText("RESULT").parentElement;
    expect(resultBlock).toHaveTextContent('"command": "pnpm install"');
    expect(resultBlock).not.toHaveTextContent("Needed for cache writes.");
  });

  it("restores automatic review details from loaded tool data", async () => {
    const runningState = {
      ...selectedProviderState(),
      active_run_event_index: 4,
      active_run_id: "run-review",
      messages: [
        {
          author: "user",
          content: "Install dependencies",
          id: "message-user",
        },
        {
          author: "assistant",
          content: "",
          id: "message-assistant",
          status: "running",
          tools: [
            {
              content: "Outside the task scope.",
              data: {
                approval: {
                  action: "sandbox_failure",
                  decision: "denied",
                  reason: "Outside the task scope.",
                  tool_name: "shell_command",
                  write_paths: [],
                },
                command: "pnpm install",
                exit_code: 1,
                stderr: "Read-only file system",
                stdout: "",
              },
              id: "tool-1",
              name: "shell_command",
              status: "failed",
              title: "Ran pnpm install",
            },
          ],
        },
      ],
    };
    mockInitialState(runningState);
    vi.mocked(window.fetch).mockImplementation(async (input, init) => {
      if (input === "/api/state") {
        return new Response(JSON.stringify(runningState), {
          headers: { "Content-Type": "application/json" },
          status: 200,
        });
      }
      if (
        input === "/api/workspace/runs/run-review/stream?after=4" &&
        init?.method === "GET"
      ) {
        return new Response(
          new ReadableStream({
            start() {},
          }),
          {
            headers: { "Content-Type": "text/event-stream" },
            status: 200,
          },
        );
      }
      return new Response("{}", {
        headers: { "Content-Type": "application/json" },
        status: 200,
      });
    });

    render(<App />);

    expect(
      await screen.findByRole("button", { name: /Ran pnpm install/ }),
    ).toBeInTheDocument();
    expect(screen.getByText("REVIEW")).toBeInTheDocument();
    expect(screen.getByText("Denied")).toBeInTheDocument();
    expect(screen.getByText("Outside the task scope.")).toBeInTheDocument();
    const resultBlock = screen.getByText("RESULT").parentElement;
    expect(resultBlock).toHaveTextContent('"stderr": "Read-only file system"');
  });

  it("shows successful tool details after the tool row is opened", async () => {
    const user = userEvent.setup();
    mockInitialState(selectedProviderState());
    vi.mocked(window.fetch).mockImplementation(async (input, init) => {
      if (input === "/api/workspace/respond" && init?.method === "POST") {
        return assistantToolStreamResponse(
          {
            arguments: { path: "notes.txt" },
            data: { path: "notes.txt" },
            id: "tool-1",
            name: "read_file",
            output: "Note contents",
            title: "Reading notes.txt",
          },
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

    const toolDetails = await screen.findByRole("button", {
      name: /Reading notes\.txt/,
    });
    expect(document.body).not.toHaveTextContent("Note contents");

    await user.click(toolDetails);

    expect(screen.getByText("ARGS")).toBeInTheDocument();
    const resultBlock = screen.getByText("RESULT").parentElement;
    expect(resultBlock).toHaveTextContent('"content": "Note contents"');
    expect(resultBlock).toHaveTextContent('"data": {');
    expect(resultBlock).toHaveTextContent('"path": "notes.txt"');
  });

  it("keeps streaming assistant text after a failed tool step", async () => {
    const user = userEvent.setup();
    mockInitialState(selectedProviderState());
    vi.mocked(window.fetch).mockImplementation(async (input, init) => {
      if (input === "/api/workspace/respond" && init?.method === "POST") {
        return assistantToolStreamResponse(
          {
            data: { path: "missing.txt" },
            id: "tool-1",
            name: "read_file",
            output: "File not found",
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
    const resultBlock = screen.getByText("RESULT").parentElement;
    expect(resultBlock).toHaveTextContent('"content": "File not found"');
    expect(resultBlock).toHaveTextContent('"path": "missing.txt"');
    await expectDocumentText("I could not read it.");
  });

  it("shows shell command output and structured fields inside the tool result", async () => {
    const user = userEvent.setup();
    mockInitialState(selectedProviderState());
    vi.mocked(window.fetch).mockImplementation(async (input, init) => {
      if (input === "/api/workspace/respond" && init?.method === "POST") {
        return assistantToolStreamResponse(
          {
            arguments: { command: "printf done" },
            data: {
              command: "printf done",
              exit_code: 0,
              stderr: "",
              stdout: "done",
            },
            id: "tool-1",
            name: "shell_command",
            output: "done",
            title: "Ran printf done",
          },
          "Command finished.",
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
    await user.type(composer, "Run the command");
    await user.click(screen.getByRole("button", { name: "Send message" }));

    const toolDetails = await screen.findByRole("button", {
      name: /Ran printf done/,
    });
    await user.click(toolDetails);

    expect(screen.getByText("ARGS")).toBeInTheDocument();
    const resultBlock = screen.getByText("RESULT").parentElement;
    expect(resultBlock).toHaveTextContent('"content": "done"');
    expect(resultBlock).toHaveTextContent('"command": "printf done"');
    expect(resultBlock).toHaveTextContent('"exit_code": 0');
    expect(resultBlock).toHaveTextContent('"stdout": "done"');
    expect(resultBlock).toHaveTextContent('"stderr": ""');
  });

  it("shows content inside the tool result when no structured fields are returned", async () => {
    const user = userEvent.setup();
    mockInitialState(selectedProviderState());
    vi.mocked(window.fetch).mockImplementation(async (input, init) => {
      if (input === "/api/workspace/respond" && init?.method === "POST") {
        return assistantToolStreamResponse(
          {
            id: "tool-1",
            name: "update_plan",
            output: "Plan updated",
            title: "Updated plan",
          },
          "Plan is ready.",
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
    await user.type(composer, "Update the plan");
    await user.click(screen.getByRole("button", { name: "Send message" }));

    const toolDetails = await screen.findByRole("button", {
      name: /Updated plan/,
    });
    await user.click(toolDetails);

    expect(screen.getByText("RESULT").parentElement).toHaveTextContent(
      '"content": "Plan updated"',
    );
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

  it("does not apply inline code padding inside code blocks", async () => {
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

    expect(code.closest("pre")).not.toBeNull();
    expect(code).not.toHaveClass("px-1.5");
    expect(code).not.toHaveClass("py-0.5");
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
    expect(
      screen.getByRole("combobox", { name: "Reasoning" }),
    ).toHaveTextContent("Default");
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
        reasoning_effort: "xhigh",
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
    expect(
      screen.getByRole("combobox", { name: "Reasoning" }),
    ).toHaveTextContent("XHigh");
  });

  it("opens Channels as a global Telegram Bot page", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("tab", { name: "Channels" }));

    expect(
      screen.getByRole("form", { name: "Telegram Bot" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Enabled" })).toHaveTextContent(
      "Off",
    );
    expect(screen.getByLabelText("Bot secret")).toBeInTheDocument();
    expect(screen.getByText("Disabled")).toBeInTheDocument();
    expect(screen.getByText("Pending")).toBeInTheDocument();
    expect(screen.getByText("Approved")).toBeInTheDocument();
    expect(screen.getByText("No requests")).toBeInTheDocument();
    expect(screen.getByText("No conversations")).toBeInTheDocument();
  });

  it("opens Permissions from the sidebar", async () => {
    const user = userEvent.setup();
    mockInitialState(selectedProviderState());
    render(<App />);

    await user.click(screen.getByRole("tab", { name: "Permissions" }));

    expect(
      screen.getByRole("region", { name: "Permissions" }),
    ).toBeInTheDocument();
    expect(screen.getByText("No paths")).toBeInTheDocument();
  });

  it("lists saved writable paths in Permissions", async () => {
    const user = userEvent.setup();
    mockInitialState({
      ...selectedProviderState(),
      writable_paths: [
        {
          created_at: 1710000000,
          path: "/workspace/.cache/pnpm",
        },
      ],
    });
    render(<App />);

    await user.click(screen.getByRole("tab", { name: "Permissions" }));

    expect(screen.getByText("/workspace/.cache/pnpm")).toBeInTheDocument();
  });

  it("deletes a saved writable path from Permissions", async () => {
    const user = userEvent.setup();
    mockInitialState({
      ...selectedProviderState(),
      writable_paths: [
        {
          created_at: 1710000000,
          path: "/workspace/.cache/pnpm",
        },
      ],
    });
    render(<App />);

    await user.click(screen.getByRole("tab", { name: "Permissions" }));
    await user.click(screen.getByRole("button", { name: "Remove" }));

    await waitFor(() => {
      expect(
        screen.queryByText("/workspace/.cache/pnpm"),
      ).not.toBeInTheDocument();
    });
    expect(window.fetch).toHaveBeenCalledWith(
      "/api/permissions/writable-paths",
      expect.objectContaining({
        body: JSON.stringify({ path: "/workspace/.cache/pnpm" }),
        method: "DELETE",
      }),
    );
    expect(screen.getByText("No paths")).toBeInTheDocument();
  });

  it("saves the global Telegram Bot from Channels", async () => {
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

    await user.click(await screen.findByRole("tab", { name: "Channels" }));
    await user.type(screen.getByLabelText("Bot secret"), "bot-secret");
    await user.click(screen.getByRole("combobox", { name: "Enabled" }));
    await user.click(screen.getByRole("option", { name: "On" }));
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(window.fetch).toHaveBeenCalledWith(
      "/api/telegram-bot",
      expect.objectContaining({
        body: expect.stringContaining('"bot_token":"bot-secret"'),
        method: "PUT",
      }),
    );
    expect(window.fetch).toHaveBeenCalledWith(
      "/api/telegram-bot",
      expect.objectContaining({
        body: expect.stringContaining('"enabled":true'),
        method: "PUT",
      }),
    );
  });

  it("loads the persisted Telegram Bot when the app starts", async () => {
    const user = userEvent.setup();
    mockInitialState({
      messages: [],
      providers: [],
      settings: {
        selected_model: "",
        selected_provider_id: "",
      },
      telegram_bot: {
        bot_token: "bot-secret",
        enabled: true,
        error: "",
        sessions: [
          {
            chat_id: "2001",
            display_name: "Alice Example",
            recent_message: "Pair this chat",
            status: "pending",
            updated_at: 1,
            user_id: "1001",
            username: "alice",
          },
          {
            chat_id: "2002",
            display_name: "Launch Room",
            recent_message: "Draft the checklist",
            status: "approved",
            updated_at: 2,
            user_id: "1002",
            username: "bob",
          },
        ],
        status: "running",
      },
    });

    render(<App />);
    await user.click(await screen.findByRole("tab", { name: "Channels" }));

    expect(screen.getByLabelText("Bot secret")).toHaveValue("bot-secret");
    expect(screen.getByRole("combobox", { name: "Enabled" })).toHaveTextContent(
      "On",
    );
    expect(screen.getByText("Running")).toBeInTheDocument();
    expect(screen.getByText("Alice Example")).toBeInTheDocument();
    expect(screen.getByText("Launch Room")).toBeInTheDocument();
  });

  it("shows a Telegram Bot connection error in Channels", async () => {
    const user = userEvent.setup();
    mockInitialState({
      messages: [],
      providers: [],
      settings: {
        selected_model: "",
        selected_provider_id: "",
      },
      telegram_bot: {
        bot_token: "bot-secret",
        enabled: true,
        error: "Secret is invalid",
        sessions: [],
        status: "error",
      },
    });

    render(<App />);
    await user.click(await screen.findByRole("tab", { name: "Channels" }));

    expect(screen.getByText("Error")).toBeInTheDocument();
    expect(screen.getByText("Secret is invalid")).toBeInTheDocument();
  });

  it("shows pending Telegram conversations with request details", async () => {
    const user = userEvent.setup();
    mockInitialState({
      messages: [],
      providers: [],
      settings: {
        selected_model: "",
        selected_provider_id: "",
      },
      telegram_bot: {
        bot_token: "bot-secret",
        enabled: true,
        error: "",
        sessions: [
          {
            chat_id: "2001",
            display_name: "Alice Example",
            recent_message: "Can Flowent help here?",
            status: "pending",
            updated_at: 1,
            user_id: "1001",
            username: "alice",
          },
        ],
        status: "running",
      },
    });

    render(<App />);
    await user.click(await screen.findByRole("tab", { name: "Channels" }));

    expect(screen.getByText("Alice Example")).toBeInTheDocument();
    expect(
      screen.getByText("Chat 2001 · User 1001 · @alice"),
    ).toBeInTheDocument();
    expect(screen.getByText("Can Flowent help here?")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Approve" })).toBeInTheDocument();
  });

  it("approves a pending Telegram conversation from Channels", async () => {
    const user = userEvent.setup();
    mockInitialState({
      messages: [],
      providers: [],
      settings: {
        selected_model: "",
        selected_provider_id: "",
      },
      telegram_bot: {
        bot_token: "bot-secret",
        enabled: true,
        error: "",
        sessions: [
          {
            chat_id: "2001",
            display_name: "Alice Example",
            recent_message: "Can Flowent help here?",
            status: "pending",
            updated_at: 1,
            user_id: "1001",
            username: "alice",
          },
        ],
        status: "running",
      },
    });

    render(<App />);
    await user.click(await screen.findByRole("tab", { name: "Channels" }));
    await user.click(screen.getByRole("button", { name: "Approve" }));

    expect(window.fetch).toHaveBeenCalledWith(
      "/api/telegram-bot/approve",
      expect.objectContaining({
        body: JSON.stringify({ chat_id: "2001" }),
        method: "POST",
      }),
    );
    await waitFor(() => {
      expect(screen.getByText("No requests")).toBeInTheDocument();
    });
    expect(screen.getByText("Alice Example")).toBeInTheDocument();
    expect(screen.getAllByText("Approved").length).toBeGreaterThan(1);
  });

  it("opens MCP with an empty server list", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("tab", { name: "MCP" }));

    expect(
      screen.getByRole("complementary", { name: "MCP servers" }),
    ).toBeInTheDocument();
    expect(screen.getByText("No servers")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New" })).toBeInTheDocument();
    expect(
      screen.getByRole("form", { name: "MCP server" }),
    ).toBeInTheDocument();
  });

  it("saves a command MCP server from a pasted command", async () => {
    const user = userEvent.setup();
    mockInitialState(selectedProviderState());
    render(<App />);

    await user.click(await screen.findByRole("tab", { name: "MCP" }));
    await user.type(screen.getByLabelText("Name"), "Files");
    await user.type(
      screen.getByLabelText("Command line"),
      "npx -y @modelcontextprotocol/server-filesystem /project",
    );
    await user.click(screen.getByRole("button", { name: "Save" }));

    const saveCall = vi
      .mocked(window.fetch)
      .mock.calls.find(
        ([input, init]) =>
          input === "/api/mcp/servers" && init?.method === "PUT",
      );
    expect(saveCall).toBeDefined();
    expect(JSON.parse(String(saveCall?.[1]?.body))).toMatchObject({
      args: ["-y", "@modelcontextprotocol/server-filesystem", "/project"],
      command: "npx",
      enabled: true,
      name: "Files",
      type: "command",
    });
    await expectDocumentText("read_file");
  });

  it("adds a newly saved MCP server immediately while it connects", async () => {
    const user = userEvent.setup();
    let stateRequestCount = 0;
    vi.spyOn(window, "fetch").mockImplementation(async (input, init) => {
      if (input === "/api/state") {
        stateRequestCount += 1;
        return new Response(
          JSON.stringify({
            ...selectedProviderState(),
            mcp_servers:
              stateRequestCount > 1
                ? [
                    commandMcpServer({
                      status: stateRequestCount > 2 ? "ready" : "starting",
                      tools:
                        stateRequestCount > 2 ? commandMcpServer().tools : [],
                    }),
                  ]
                : [],
          }),
          {
            headers: { "Content-Type": "application/json" },
            status: 200,
          },
        );
      }

      if (input === "/api/mcp/servers" && init?.method === "PUT") {
        const request = JSON.parse(String(init.body)) as TestMcpServer;
        return new Response(
          JSON.stringify({
            ...request,
            status: "starting",
            tools: [],
          }),
          {
            headers: { "Content-Type": "application/json" },
            status: 200,
          },
        );
      }

      return new Response(JSON.stringify({ version: "test" }), {
        headers: { "Content-Type": "application/json" },
        status: 200,
      });
    });

    render(<App />);

    await user.click(await screen.findByRole("tab", { name: "MCP" }));
    await user.type(screen.getByLabelText("Name"), "Files");
    await user.type(
      screen.getByLabelText("Command line"),
      "npx -y @modelcontextprotocol/server-filesystem /project",
    );
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(
      await screen.findByRole("button", { name: "Files" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Starting")).toBeInTheDocument();

    await expectDocumentText("read_file");
    expect(screen.getByText("Ready")).toBeInTheDocument();
  });

  it("saves a URL MCP server", async () => {
    const user = userEvent.setup();
    mockInitialState(selectedProviderState());
    render(<App />);

    await user.click(await screen.findByRole("tab", { name: "MCP" }));
    await user.type(screen.getByLabelText("Name"), "Docs");
    await user.click(screen.getByRole("combobox", { name: "Type" }));
    await user.click(screen.getByRole("option", { name: "URL" }));
    await user.type(screen.getByLabelText("URL"), "https://example.com/mcp");
    await user.click(screen.getByRole("button", { name: "Save" }));

    const saveCall = vi
      .mocked(window.fetch)
      .mock.calls.find(
        ([input, init]) =>
          input === "/api/mcp/servers" && init?.method === "PUT",
      );
    expect(saveCall).toBeDefined();
    expect(JSON.parse(String(saveCall?.[1]?.body))).toMatchObject({
      args: [],
      command: "",
      name: "Docs",
      type: "url",
      url: "https://example.com/mcp",
    });
  });

  it("loads persisted MCP servers when the app starts", async () => {
    const user = userEvent.setup();
    mockInitialState({
      ...selectedProviderState(),
      mcp_servers: [commandMcpServer()],
    });

    render(<App />);
    await user.click(await screen.findByRole("tab", { name: "MCP" }));

    expect(screen.getByRole("button", { name: "Files" })).toBeInTheDocument();
    expect(screen.getByText("Ready")).toBeInTheDocument();
    expect(screen.getByText("read_file")).toBeInTheDocument();
  });

  it("does not show disabled MCP tools as ready", async () => {
    const user = userEvent.setup();
    mockInitialState({
      ...selectedProviderState(),
      mcp_servers: [
        commandMcpServer({
          enabled: false,
          status: "disabled",
          tools: [],
        }),
      ],
    });

    render(<App />);
    await user.click(await screen.findByRole("tab", { name: "MCP" }));

    expect(screen.getByText("Disabled")).toBeInTheDocument();
    expect(screen.getByText("No tools")).toBeInTheDocument();
  });

  it("reconnects the selected MCP server and refreshes its tools", async () => {
    const user = userEvent.setup();
    mockInitialState({
      ...selectedProviderState(),
      mcp_servers: [commandMcpServer()],
    });

    render(<App />);
    await user.click(await screen.findByRole("tab", { name: "MCP" }));
    await user.click(screen.getByRole("button", { name: "Reconnect" }));

    expect(window.fetch).toHaveBeenCalledWith(
      "/api/mcp/servers/mcp-files/reconnect",
      expect.objectContaining({ method: "POST" }),
    );
    await expectDocumentText("write_file");
  });

  it("removes the selected MCP server", async () => {
    const user = userEvent.setup();
    mockInitialState({
      ...selectedProviderState(),
      mcp_servers: [commandMcpServer()],
    });

    render(<App />);
    await user.click(await screen.findByRole("tab", { name: "MCP" }));
    await user.click(screen.getByRole("button", { name: "Remove" }));

    expect(window.fetch).toHaveBeenCalledWith(
      "/api/mcp/servers/mcp-files",
      expect.objectContaining({ method: "DELETE" }),
    );
    await waitFor(() => {
      expect(screen.getByText("No servers")).toBeInTheDocument();
    });
  });

  it("scans Codex MCP servers after choosing Codex", async () => {
    const user = userEvent.setup();
    mockInitialState(
      selectedProviderState(),
      ["gpt-5.1"],
      "Here is the checklist.",
      mixedMcpImportPreview(),
    );

    render(<App />);
    await user.click(await screen.findByRole("tab", { name: "MCP" }));
    await user.click(screen.getByRole("button", { name: "Import" }));
    await user.click(screen.getByRole("button", { name: "Codex" }));

    expect(window.fetch).toHaveBeenCalledWith(
      "/api/mcp/import/preview",
      expect.objectContaining({
        body: JSON.stringify({ source: "codex" }),
        method: "POST",
      }),
    );
    expect(await screen.findByText("docs")).toBeInTheDocument();
    expect(screen.getByText(/@modelcontextprotocol/)).toBeInTheDocument();
  });

  it("shows an Import button for each scanned MCP server", async () => {
    const user = userEvent.setup();
    mockInitialState(
      selectedProviderState(),
      ["gpt-5.1"],
      "Here is the checklist.",
      { codex: codexMultiMcpImportPreview() },
    );

    render(<App />);
    await user.click(await screen.findByRole("tab", { name: "MCP" }));
    await user.click(screen.getByRole("button", { name: "Import" }));
    await user.click(screen.getByRole("button", { name: "Codex" }));

    const importRegion = screen.getByRole("region", { name: "MCP import" });
    const docsRow = await within(importRegion).findByRole("listitem", {
      name: "docs",
    });
    const memoryRow = within(importRegion).getByRole("listitem", {
      name: "memory",
    });

    expect(
      within(docsRow).getByRole("button", { name: "Import" }),
    ).toBeInTheDocument();
    expect(
      within(memoryRow).getByRole("button", { name: "Import" }),
    ).toBeInTheDocument();
  });

  it("imports Claude Code MCP servers and opens the imported server", async () => {
    const user = userEvent.setup();
    mockInitialState(
      selectedProviderState(),
      ["gpt-5.1"],
      "Here is the checklist.",
      { claude_code: claudeCodeMcpImportPreview() },
    );

    render(<App />);
    await user.click(await screen.findByRole("tab", { name: "MCP" }));
    await user.click(screen.getByRole("button", { name: "Import" }));
    const importRegion = screen.getByRole("region", { name: "MCP import" });
    const linearRow = await within(importRegion).findByRole("listitem", {
      name: "Linear",
    });
    await user.click(within(linearRow).getByRole("button", { name: "Import" }));

    expect(window.fetch).toHaveBeenCalledWith(
      "/api/mcp/import",
      expect.objectContaining({
        body: JSON.stringify({
          server_id: "mcp-linear",
          source: "claude_code",
        }),
        method: "POST",
      }),
    );
    expect(
      await screen.findByRole("button", { name: "Linear" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("URL")).toHaveValue(
      "https://linear.example.com/mcp",
    );
  });

  it("imports one MCP server from its row", async () => {
    const user = userEvent.setup();
    mockInitialState(
      selectedProviderState(),
      ["gpt-5.1"],
      "Here is the checklist.",
      { codex: codexMultiMcpImportPreview() },
    );

    render(<App />);
    await user.click(await screen.findByRole("tab", { name: "MCP" }));
    await user.click(screen.getByRole("button", { name: "Import" }));
    await user.click(screen.getByRole("button", { name: "Codex" }));
    expect(await screen.findByText("memory")).toBeInTheDocument();

    const importRegion = screen.getByRole("region", { name: "MCP import" });
    const memoryRow = within(importRegion).getByRole("listitem", {
      name: "memory",
    });
    await user.click(within(memoryRow).getByRole("button", { name: "Import" }));

    expect(window.fetch).toHaveBeenCalledWith(
      "/api/mcp/import",
      expect.objectContaining({
        body: JSON.stringify({
          server_id: "mcp-memory",
          source: "codex",
        }),
        method: "POST",
      }),
    );
    expect(
      await screen.findByRole("button", { name: "memory" }),
    ).toBeInTheDocument();
  });

  it("shows loading only on the MCP server row being imported", async () => {
    const user = userEvent.setup();
    let resolveImport: (response: Response) => void = () => {};
    mockInitialState(
      selectedProviderState(),
      ["gpt-5.1"],
      "Here is the checklist.",
      { codex: codexMultiMcpImportPreview() },
    );
    const mockFetch = vi.mocked(window.fetch);
    const baseFetch = mockFetch.getMockImplementation();
    vi.mocked(window.fetch).mockImplementation(async (input, init) => {
      if (input === "/api/mcp/import" && init?.method === "POST") {
        return await new Promise<Response>((resolve) => {
          resolveImport = resolve;
        });
      }
      return baseFetch?.(input, init) ?? new Response(null, { status: 404 });
    });

    render(<App />);
    await user.click(await screen.findByRole("tab", { name: "MCP" }));
    await user.click(screen.getByRole("button", { name: "Import" }));
    await user.click(screen.getByRole("button", { name: "Codex" }));

    const importRegion = screen.getByRole("region", { name: "MCP import" });
    const docsRow = await within(importRegion).findByRole("listitem", {
      name: "docs",
    });
    const memoryRow = within(importRegion).getByRole("listitem", {
      name: "memory",
    });
    await user.click(within(docsRow).getByRole("button", { name: "Import" }));

    expect(
      within(docsRow).getByRole("button", { name: "Importing" }),
    ).toBeDisabled();
    expect(
      within(memoryRow).getByRole("button", { name: "Import" }),
    ).toBeDisabled();

    resolveImport(
      new Response(JSON.stringify(codexMcpImportPreview().servers), {
        headers: { "Content-Type": "application/json" },
        status: 200,
      }),
    );
  });

  it("shows an empty MCP import scan", async () => {
    const user = userEvent.setup();
    mockInitialState(
      selectedProviderState(),
      ["gpt-5.1"],
      "Here is the checklist.",
      { claude_code: { servers: [] } },
    );

    render(<App />);
    await user.click(await screen.findByRole("tab", { name: "MCP" }));
    await user.click(screen.getByRole("button", { name: "Import" }));

    const importRegion = screen.getByRole("region", { name: "MCP import" });
    expect(
      await within(importRegion).findByText("No servers"),
    ).toBeInTheDocument();
    expect(
      within(importRegion).queryByRole("button", { name: "Import" }),
    ).not.toBeInTheDocument();
  });

  it("shows successful MCP tool details after the tool row is opened", async () => {
    const user = userEvent.setup();
    mockInitialState(selectedProviderState());
    vi.mocked(window.fetch).mockImplementation(async (input, init) => {
      if (input === "/api/workspace/respond" && init?.method === "POST") {
        return assistantToolStreamResponse(
          {
            arguments: { path: "README.md" },
            data: {
              result: {
                content: [{ text: "MCP file content", type: "text" }],
                isError: false,
              },
              server: "Files",
              tool: "read_file",
            },
            id: "tool-1",
            name: "mcp__mcp-files__read_file",
            output: "MCP file content",
            title: "Calling Files.read_file",
          },
          "Used MCP.",
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
    await user.type(composer, "Read with MCP");
    await user.click(screen.getByRole("button", { name: "Send message" }));
    const toolDetails = await screen.findByRole("button", {
      name: /Calling Files\.read_file/,
    });
    await user.click(toolDetails);

    const resultBlock = screen.getByText("RESULT").parentElement;
    expect(resultBlock).toHaveTextContent('"server": "Files"');
    expect(resultBlock).toHaveTextContent('"tool": "read_file"');
    expect(resultBlock).toHaveTextContent("MCP file content");
    await expectDocumentText("Used MCP.");
  });

  it("shows failed MCP tool details when a server call fails", async () => {
    const user = userEvent.setup();
    mockInitialState(selectedProviderState());
    vi.mocked(window.fetch).mockImplementation(async (input, init) => {
      if (input === "/api/workspace/respond" && init?.method === "POST") {
        return assistantToolStreamResponse(
          {
            arguments: { path: "secret.txt" },
            data: {
              result: {
                content: [{ text: "Permission denied", type: "text" }],
                isError: true,
              },
              server: "Files",
              tool: "read_file",
            },
            id: "tool-1",
            name: "mcp__mcp-files__read_file",
            output: "Permission denied",
            status: "failed",
            title: "Calling Files.read_file",
          },
          "Could not use MCP.",
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
    await user.type(composer, "Read with MCP");
    await user.click(screen.getByRole("button", { name: "Send message" }));

    expect(await screen.findByText("Failed")).toBeInTheDocument();
    const resultBlock = screen.getByText("RESULT").parentElement;
    expect(resultBlock).toHaveTextContent("Permission denied");
    await expectDocumentText("Could not use MCP.");
  });

  it("saves the selected Settings reasoning effort", async () => {
    const user = userEvent.setup();
    mockInitialState(selectedProviderState());
    render(<App />);

    await user.click(await screen.findByRole("tab", { name: "Settings" }));
    await user.click(screen.getByRole("combobox", { name: "Reasoning" }));
    await user.click(screen.getByRole("option", { name: "XHigh" }));

    expect(
      screen.getByRole("combobox", { name: "Reasoning" }),
    ).toHaveTextContent("XHigh");
    expect(window.fetch).toHaveBeenCalledWith(
      "/api/settings",
      expect.objectContaining({
        body: JSON.stringify({
          agent_prompt: "",
          reasoning_effort: "xhigh",
          selected_model: "gpt-5.1",
          selected_provider_id: "provider-openai",
        }),
        method: "PUT",
      }),
    );
  });

  it("loads and saves the configured Agent prompt from Settings", async () => {
    const user = userEvent.setup();
    mockInitialState({
      ...selectedProviderState(),
      settings: {
        ...selectedProviderState().settings,
        agent_prompt: "Prefer careful implementation plans.",
      },
    });
    render(<App />);

    await user.click(await screen.findByRole("tab", { name: "Settings" }));
    const agentPrompt = screen.getByRole("textbox", {
      name: "Agent prompt",
    });

    expect(agentPrompt).toHaveValue("Prefer careful implementation plans.");

    await user.clear(agentPrompt);
    await user.type(agentPrompt, "Always inspect files before editing.");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(window.fetch).toHaveBeenCalledWith(
      "/api/settings",
      expect.objectContaining({
        body: JSON.stringify({
          agent_prompt: "Always inspect files before editing.",
          reasoning_effort: "default",
          selected_model: "gpt-5.1",
          selected_provider_id: "provider-openai",
        }),
        method: "PUT",
      }),
    );
  });

  it("defaults Settings reasoning effort when persisted state has no value", async () => {
    const user = userEvent.setup();
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
        selected_model: "gpt-5.1",
        selected_provider_id: "provider-openai",
      },
    });

    render(<App />);
    await user.click(await screen.findByRole("tab", { name: "Settings" }));

    expect(
      screen.getByRole("combobox", { name: "Reasoning" }),
    ).toHaveTextContent("Default");
  });

  it("shows a tool step as soon as the assistant starts it", async () => {
    const user = userEvent.setup();
    const assistantStream = controlledToolTimelineResponse(
      {
        arguments: { path: "notes.txt" },
        id: "tool-1",
        name: "read_file",
        title: "Reading notes.txt",
      },
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

  it("keeps a running tool collapsed until it is opened", async () => {
    const user = userEvent.setup();
    const assistantStream = controlledToolTimelineResponse(
      {
        arguments: { path: "notes.txt" },
        id: "tool-1",
        name: "read_file",
        title: "Reading notes.txt",
      },
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

    const toolDetails = await screen.findByRole("button", {
      name: /Reading notes\.txt/,
    });
    expect(screen.getByText("Running")).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent("ARGS");

    await user.click(toolDetails);

    expect(screen.getByText("ARGS")).toBeInTheDocument();
    expect(screen.getByText(/"path": "notes\.txt"/)).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent("The notes are ready.");
  });

  it("opens a running tool with null payloads without crashing", async () => {
    const user = userEvent.setup();
    const assistantStream = controlledToolTimelineResponse(
      {
        arguments: null,
        data: null,
        id: "tool-1",
        name: "shell_command",
        title: "Running npm test",
      },
      "Tests are ready.",
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
    await user.type(composer, "Run tests");
    await user.click(screen.getByRole("button", { name: "Send message" }));

    const toolDetails = await screen.findByRole("button", {
      name: /Running npm test/,
    });
    expect(screen.getByText("Running")).toBeInTheDocument();

    await user.click(toolDetails);

    expect(toolDetails).toHaveAttribute("aria-expanded", "true");
    expect(document.body).not.toHaveTextContent("ARGS");
    expect(document.body).not.toHaveTextContent("RESULT");
    expect(document.body).not.toHaveTextContent("Tests are ready.");
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

  it("shows streamed thought process content while the assistant is thinking", async () => {
    const user = userEvent.setup();
    const assistantStream = controlledThinkingStreamResponse(
      "Checking the workspace.",
      "The answer is ready.",
    );
    mockSelectedProviderWorkspaceResponse(assistantStream.response);
    render(<App />);

    const composer = await screen.findByRole("textbox", {
      name: "Message Flowent",
    });
    await user.type(composer, "Inspect the workspace");
    await user.click(screen.getByRole("button", { name: "Send message" }));

    expect(await screen.findByText("Thinking...")).toBeInTheDocument();
    expect(screen.getByText("Checking the workspace.")).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent("The answer is ready.");
    assistantStream.finish();
    expect(await screen.findByText("The answer is ready.")).toBeInTheDocument();
  });

  it("collapses completed thought process content until it is opened", async () => {
    const user = userEvent.setup();
    const assistantStream = controlledThinkingStreamResponse(
      "Checked the current files.",
      "The answer is ready.",
    );
    mockSelectedProviderWorkspaceResponse(assistantStream.response);
    render(<App />);

    const composer = await screen.findByRole("textbox", {
      name: "Message Flowent",
    });
    await user.type(composer, "Inspect the workspace");
    await user.click(screen.getByRole("button", { name: "Send message" }));
    await screen.findByText("Thinking...");
    assistantStream.finish();

    const thoughtProcess = await screen.findByRole("button", {
      name: "Thought Process",
    });
    expect(screen.getByText("The answer is ready.")).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent("Checked the current files.");

    await user.click(thoughtProcess);

    expect(screen.getByText("Checked the current files.")).toBeInTheDocument();
  });

  it("uses the same expandable process row for completed thought details", async () => {
    const user = userEvent.setup();
    const assistantStream = controlledThinkingStreamResponse(
      "Checked the current files.",
      "The answer is ready.",
    );
    mockSelectedProviderWorkspaceResponse(assistantStream.response);
    render(<App />);

    const composer = await screen.findByRole("textbox", {
      name: "Message Flowent",
    });
    await user.type(composer, "Inspect the workspace");
    await user.click(screen.getByRole("button", { name: "Send message" }));
    await screen.findByText("Thinking...");
    assistantStream.finish();

    const thoughtDetails = await screen.findByRole("button", {
      name: "Thought Process",
    });
    expect(thoughtDetails).toHaveAttribute("aria-expanded", "false");

    await user.click(thoughtDetails);

    expect(thoughtDetails).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Checked the current files.")).toBeInTheDocument();
  });

  it("keeps thought process, tools, and final text in the same assistant output group", async () => {
    const user = userEvent.setup();
    mockSelectedProviderWorkspaceResponse(
      assistantThinkingToolStreamResponse(
        "Checking files.",
        { id: "tool-1", name: "list_files", title: "Listed /project/flowent" },
        "The workspace is Flowent.",
      ),
    );
    render(<App />);

    const composer = await screen.findByRole("textbox", {
      name: "Message Flowent",
    });
    await user.type(composer, "Inspect the workspace");
    await user.click(screen.getByRole("button", { name: "Send message" }));

    const thoughtProcess = await screen.findByRole("button", {
      name: "Thought Process",
    });
    const toolStep = screen.getByText("Listed /project/flowent");
    const reply = screen.getByText("The workspace is Flowent.");

    expect(
      thoughtProcess.compareDocumentPosition(toolStep) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      toolStep.compareDocumentPosition(reply) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      screen.queryByTestId("assistant-output-separator"),
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

  it("loads persisted assistant thought process collapsed until it is opened", async () => {
    const user = userEvent.setup();
    mockInitialState({
      messages: [
        {
          author: "assistant",
          content: "The workspace is Flowent.",
          id: "message-1",
          thinking: "Read the saved context.",
          tools: [],
        },
      ],
      providers: [],
      settings: {
        selected_model: "",
        selected_provider_id: "",
      },
    });

    render(<App />);

    const thoughtProcess = await screen.findByRole("button", {
      name: "Thought Process",
    });
    expect(screen.getByText("The workspace is Flowent.")).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent("Read the saved context.");

    await user.click(thoughtProcess);

    expect(screen.getByText("Read the saved context.")).toBeInTheDocument();
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

  it("shows the command menu with Clear when a slash is typed", async () => {
    const user = userEvent.setup();
    mockInitialState(selectedProviderState());
    render(<App />);

    const composer = await screen.findByRole("textbox", {
      name: "Message Flowent",
    });
    await user.type(composer, "/");

    expect(screen.getByRole("listbox", { name: "Commands" })).toBeVisible();
    expect(screen.getByRole("option", { name: /\/clear/ })).toBeVisible();
    expect(screen.getByRole("option", { name: /\/compact/ })).toBeVisible();
  });

  it("filters the command menu to Clear when a matching prefix is typed", async () => {
    const user = userEvent.setup();
    mockInitialState(selectedProviderState());
    render(<App />);

    const composer = await screen.findByRole("textbox", {
      name: "Message Flowent",
    });
    await user.type(composer, "/cl");

    expect(screen.getAllByRole("option")).toHaveLength(1);
    expect(screen.getByRole("option", { name: /\/clear/ })).toBeVisible();
  });

  it("filters the command menu to Compact when a matching prefix is typed", async () => {
    const user = userEvent.setup();
    mockInitialState(selectedProviderState());
    render(<App />);

    const composer = await screen.findByRole("textbox", {
      name: "Message Flowent",
    });
    await user.type(composer, "/co");

    expect(screen.getAllByRole("option")).toHaveLength(1);
    expect(screen.getByRole("option", { name: /\/compact/ })).toBeVisible();
  });

  it("completes the selected command when Tab is pressed", async () => {
    const user = userEvent.setup();
    mockInitialState(selectedProviderState());
    render(<App />);

    const composer = await screen.findByRole("textbox", {
      name: "Message Flowent",
    });
    await user.type(composer, "/cl");
    await user.keyboard("{Tab}");

    expect(composer).toHaveValue("/clear");
  });

  it("closes the command menu with Escape and keeps the draft", async () => {
    const user = userEvent.setup();
    mockInitialState(selectedProviderState());
    render(<App />);

    const composer = await screen.findByRole("textbox", {
      name: "Message Flowent",
    });
    await user.type(composer, "/cl");
    expect(screen.getByRole("listbox", { name: "Commands" })).toBeVisible();
    await user.keyboard("{Escape}");

    expect(screen.queryByRole("listbox", { name: "Commands" })).toBeNull();
    expect(composer).toHaveValue("/cl");
  });

  it("runs Clear from the command menu without requesting an assistant reply", async () => {
    const user = userEvent.setup();
    mockInitialState({
      messages: [
        {
          author: "user",
          content: "Draft a launch checklist",
          id: "message-1",
        },
      ],
      providers: selectedProviderState().providers,
      settings: selectedProviderState().settings,
    });
    render(<App />);

    const composer = await screen.findByRole("textbox", {
      name: "Message Flowent",
    });
    await screen.findByText("Draft a launch checklist");
    await user.type(composer, "/clear");
    await user.keyboard("{Enter}");

    expect(screen.queryByText("Draft a launch checklist")).toBeNull();
    expect(screen.getByText("Where should we begin?")).toBeInTheDocument();
    expect(composer).toHaveValue("");
    expect(window.fetch).toHaveBeenCalledWith(
      "/api/workspace/messages",
      expect.objectContaining({
        body: JSON.stringify({ messages: [] }),
        method: "PUT",
      }),
    );
    expect(fetchWasCalledWith("/api/workspace/respond", "POST")).toBe(false);
  });

  it("runs Clear from the command menu while a streamed reply is still running", async () => {
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

    await user.type(composer, "/clear");
    await user.keyboard("{Enter}");
    assistantStream.finish();

    await waitFor(() => {
      expect(document.body).not.toHaveTextContent("Draft a launch checklist");
      expect(document.body).not.toHaveTextContent("First step");
      expect(document.body).not.toHaveTextContent("First step is ready.");
    });
    expect(screen.getByText("Where should we begin?")).toBeInTheDocument();
  });

  it("sends a leading-space clear command as a regular message", async () => {
    const user = userEvent.setup();
    mockInitialState(selectedProviderState());
    render(<App />);

    const composer = await screen.findByRole("textbox", {
      name: "Message Flowent",
    });
    await user.type(composer, " /clear");
    await user.keyboard("{Enter}");

    expect(window.fetch).toHaveBeenCalledWith(
      "/api/workspace/respond",
      expect.objectContaining({
        body: JSON.stringify({ content: " /clear" }),
        method: "POST",
      }),
    );
    expect(screen.getByText("/clear")).toBeInTheDocument();
  });

  it("keeps an unrecognized command in the composer and does not send it", async () => {
    const user = userEvent.setup();
    mockInitialState(selectedProviderState());
    render(<App />);

    const composer = await screen.findByRole("textbox", {
      name: "Message Flowent",
    });
    await user.type(composer, "/missing");
    await user.keyboard("{Enter}");

    expect(composer).toHaveValue("/missing");
    expect(screen.getByText("Command not found.")).toBeInTheDocument();
    expect(fetchWasCalledWith("/api/workspace/respond", "POST")).toBe(false);
  });

  it("runs Compact without requesting an assistant reply", async () => {
    const user = userEvent.setup();
    mockInitialState({
      messages: [
        {
          author: "user",
          content: "Draft a launch checklist",
          id: "message-1",
        },
      ],
      providers: selectedProviderState().providers,
      settings: selectedProviderState().settings,
    });
    render(<App />);

    const composer = await screen.findByRole("textbox", {
      name: "Message Flowent",
    });
    await user.type(composer, "/compact");
    await user.keyboard("{Enter}");

    expect(window.fetch).toHaveBeenCalledWith(
      "/api/workspace/compact",
      expect.objectContaining({ method: "POST" }),
    );
    expect(fetchWasCalledWith("/api/workspace/respond", "POST")).toBe(false);
  });

  it("shows the compacted context marker after Compact succeeds", async () => {
    const user = userEvent.setup();
    mockInitialState(selectedProviderState());
    render(<App />);

    const composer = await screen.findByRole("textbox", {
      name: "Message Flowent",
    });
    await user.type(composer, "/compact");
    await user.keyboard("{Enter}");

    expect(await screen.findByText("Context compacted")).toBeInTheDocument();
  });

  it("keeps compacted context available for the next message", async () => {
    const user = userEvent.setup();
    mockInitialState(selectedProviderState());
    render(<App />);

    const composer = await screen.findByRole("textbox", {
      name: "Message Flowent",
    });
    await user.type(composer, "/compact");
    await user.keyboard("{Enter}");
    await screen.findByText("Context compacted");

    await user.type(composer, "Continue from there");
    await user.keyboard("{Enter}");

    expect(window.fetch).toHaveBeenCalledWith(
      "/api/workspace/respond",
      expect.objectContaining({
        body: JSON.stringify({ content: "Continue from there" }),
        method: "POST",
      }),
    );
    expect(screen.getByText("Context compacted")).toBeInTheDocument();
  });

  it("keeps Compact unavailable while a streamed reply is still running", async () => {
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
      if (input === "/api/workspace/compact" && init?.method === "POST") {
        return new Response("{}", {
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

    await user.type(composer, "/compact");
    await user.keyboard("{Enter}");

    expect(composer).toHaveValue("/compact");
    expect(
      screen.getByText("Compact is unavailable while Flowent is responding."),
    ).toBeInTheDocument();
    expect(fetchWasCalledWith("/api/workspace/compact", "POST")).toBe(false);
    assistantStream.finish();
  });

  it("keeps the conversation unchanged when Compact fails", async () => {
    const user = userEvent.setup();
    mockInitialState({
      messages: [
        {
          author: "user",
          content: "Draft a launch checklist",
          id: "message-1",
        },
      ],
      providers: selectedProviderState().providers,
      settings: selectedProviderState().settings,
    });
    vi.mocked(window.fetch).mockImplementation(async (input, init) => {
      if (input === "/api/state") {
        return new Response(
          JSON.stringify({
            messages: [
              {
                author: "user",
                content: "Draft a launch checklist",
                id: "message-1",
              },
            ],
            providers: selectedProviderState().providers,
            settings: selectedProviderState().settings,
          }),
          {
            headers: { "Content-Type": "application/json" },
            status: 200,
          },
        );
      }
      if (input === "/api/workspace/compact" && init?.method === "POST") {
        return new Response(
          JSON.stringify({ detail: "Context could not be compacted." }),
          {
            headers: { "Content-Type": "application/json" },
            status: 500,
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
    await screen.findByText("Draft a launch checklist");
    await user.type(composer, "/compact");
    await user.keyboard("{Enter}");

    expect(
      await screen.findByText("Context could not be compacted."),
    ).toBeInTheDocument();
    expect(screen.getByText("Draft a launch checklist")).toBeInTheDocument();
    expect(screen.queryByText("Context compacted")).toBeNull();
  });

  it("shows the configuration prompt when Compact has no selected model", async () => {
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
      if (input === "/api/workspace/compact" && init?.method === "POST") {
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
    await user.type(composer, "/compact");
    await user.keyboard("{Enter}");

    expect(
      await screen.findByText("Choose a provider and model before sending."),
    ).toBeInTheDocument();
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

  it("shows an empty Skills page when no skills are available", async () => {
    const user = userEvent.setup();
    mockInitialState(selectedProviderState());
    render(<App />);

    await user.click(await screen.findByRole("tab", { name: "Skills" }));

    expect(screen.getAllByText("No skills").length).toBeGreaterThan(0);
  });

  it("lists available skills with their scope and description", async () => {
    const user = userEvent.setup();
    mockInitialState({
      ...selectedProviderState(),
      skills: [projectSkill()],
    });
    render(<App />);

    await user.click(await screen.findByRole("tab", { name: "Skills" }));

    expect(screen.getAllByText("Project Review").length).toBeGreaterThan(0);
    expect(screen.getByText("Review project changes.")).toBeInTheDocument();
    expect(screen.getByText("Project")).toBeInTheDocument();
    expect(screen.getByText("$project-review")).toBeInTheDocument();
  });

  it("shows invalid skill errors without hiding the skill", async () => {
    const user = userEvent.setup();
    mockInitialState({
      ...selectedProviderState(),
      skills: [
        projectSkill({
          description: "",
          error: "Skill needs a name and description.",
          name: "Broken Skill",
          slug: "broken-skill",
        }),
      ],
    });
    render(<App />);

    await user.click(await screen.findByRole("tab", { name: "Skills" }));

    expect(screen.getAllByText("Broken Skill").length).toBeGreaterThan(0);
    expect(
      screen.getByText("Skill needs a name and description."),
    ).toBeInTheDocument();
  });

  it("updates a skill when its enabled state changes", async () => {
    const user = userEvent.setup();
    mockInitialState({
      ...selectedProviderState(),
      skills: [projectSkill()],
    });
    render(<App />);

    await user.click(await screen.findByRole("tab", { name: "Skills" }));
    await user.click(await screen.findByRole("button", { name: "Off" }));

    expect(window.fetch).toHaveBeenCalledWith(
      "/api/skills/skill-project-review",
      expect.objectContaining({
        body: JSON.stringify({ enabled: false }),
        method: "PUT",
      }),
    );
  });

  it("reloads the Skills page from the current skill set", async () => {
    const user = userEvent.setup();
    const initialState = selectedProviderState();
    let skills: TestSkill[] = [];
    mockInitialState({ ...initialState, skills });
    vi.mocked(window.fetch).mockImplementation(async (input, init) => {
      if (input === "/api/state") {
        return new Response(JSON.stringify({ ...initialState, skills }), {
          headers: { "Content-Type": "application/json" },
          status: 200,
        });
      }
      if (input === "/api/skills/reload" && init?.method === "POST") {
        skills = [projectSkill()];
        return new Response(JSON.stringify(skills), {
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

    await user.click(await screen.findByRole("tab", { name: "Skills" }));
    await waitFor(() => {
      expect(screen.getAllByText("No skills").length).toBeGreaterThan(0);
    });
    await user.click(screen.getByRole("button", { name: "Reload" }));

    await waitFor(() => {
      expect(screen.getAllByText("Project Review").length).toBeGreaterThan(0);
    });
  });

  it("shows skill suggestions when the composer starts a skill reference", async () => {
    const user = userEvent.setup();
    mockInitialState({
      ...selectedProviderState(),
      skills: [projectSkill()],
    });
    render(<App />);

    const composer = await screen.findByRole("textbox", {
      name: "Message Flowent",
    });
    await user.type(composer, "$");

    expect(screen.getByRole("listbox", { name: "Skills" })).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: /\$project-review/ }),
    ).toBeInTheDocument();
  });

  it("inserts the selected skill reference into the composer", async () => {
    const user = userEvent.setup();
    mockInitialState({
      ...selectedProviderState(),
      skills: [projectSkill()],
    });
    render(<App />);

    const composer = await screen.findByRole("textbox", {
      name: "Message Flowent",
    });
    await user.type(composer, "$");
    await user.click(screen.getByRole("option", { name: /\$project-review/ }));

    expect(composer).toHaveValue("$project-review ");
  });

  it("does not suggest disabled skills in the composer", async () => {
    const user = userEvent.setup();
    mockInitialState({
      ...selectedProviderState(),
      skills: [projectSkill({ enabled: false })],
    });
    render(<App />);

    const composer = await screen.findByRole("textbox", {
      name: "Message Flowent",
    });
    await user.type(composer, "$");

    expect(
      screen.queryByRole("listbox", { name: "Skills" }),
    ).not.toBeInTheDocument();
    expect(document.body).not.toHaveTextContent("$project-review");
  });
});
