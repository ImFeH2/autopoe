import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import App from "@/App";

class TestResizeObserver {
  disconnect() {}
  observe() {}
  unobserve() {}
}

globalThis.ResizeObserver =
  globalThis.ResizeObserver ??
  (TestResizeObserver as unknown as typeof ResizeObserver);

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

const controlledAssistantSnapshotStreamResponse = (
  message: Record<string, unknown>,
  firstEventIndex = 1,
) => {
  const encoder = new TextEncoder();
  const release = deferred();
  const stream = new ReadableStream({
    async start(controller) {
      controller.enqueue(
        encoder.encode(
          `id: ${firstEventIndex}\nevent: snapshot\ndata: ${JSON.stringify({ message })}\n\n`,
        ),
      );
      await release.promise;
      controller.enqueue(
        encoder.encode(
          `id: ${firstEventIndex + 1}\nevent: done\ndata: ${JSON.stringify({ message })}\n\n`,
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

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
};

type TestTool = {
  arguments?: Record<string, unknown> | null;
  id: string;
  name: string;
  output?: string;
  result?: Record<string, unknown> | null;
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

type TestWorkflowNode = {
  data: Record<string, unknown>;
  description: string;
  id: string;
  name: string;
  position: {
    x: number;
    y: number;
  };
  type: "agent" | "code" | "input" | "merge" | "output" | "timer";
};

type TestWorkflowEdge = {
  id: string;
  label: string;
  source: string;
  source_handle: string;
  target: string;
  target_handle: string;
};

type TestWorkflow = {
  created_at: number;
  definition: {
    edges: TestWorkflowEdge[];
    nodes: TestWorkflowNode[];
    version: number;
  };
  id: string;
  name: string;
  updated_at: number;
};

type TestWorkflowRunResult = {
  node_results: Array<{
    error: string;
    id: string;
    output: string;
    status: "failed" | "pending" | "running" | "success";
  }>;
  outputs: Record<string, string>;
  status: "failed" | "success";
  workflow_id: string;
};

const workflowUuid = "00000000-0000-4000-8000-000000000000";

type TestProvider = {
  api_key: string;
  base_url: string;
  id: string;
  models: string[];
  name: string;
  type: "anthropic" | "gemini" | "openai" | "openai_responses";
};

type TestContextUsage = {
  cached_input_tokens: number;
  input_tokens: number;
  output_tokens: number;
  reasoning_output_tokens: number;
  total_tokens: number;
};

type TestContextUsageInfo = {
  last_token_usage: TestContextUsage;
  model_context_window?: number | null;
  total_token_usage: TestContextUsage;
};

const contextUsage = (totalTokens: number): TestContextUsage => ({
  cached_input_tokens: 0,
  input_tokens: 0,
  output_tokens: 0,
  reasoning_output_tokens: 0,
  total_tokens: totalTokens,
});

const contextUsageInfo = (
  totalTokens: number,
  modelContextWindow = 120_000,
): TestContextUsageInfo => ({
  last_token_usage: contextUsage(totalTokens),
  model_context_window: modelContextWindow,
  total_token_usage: contextUsage(totalTokens),
});

const compactStreamResponse = (
  usageInfo?: TestContextUsageInfo,
  id = "compact-message",
) => {
  const encoder = new TextEncoder();
  const message = {
    author: "system",
    content: "Context compacted",
    id,
    summary: "Keep the launch checklist and provider setup decisions.",
    tools: [],
    usage_info: usageInfo,
  };
  const stream = new ReadableStream({
    start(controller) {
      if (usageInfo) {
        controller.enqueue(
          encoder.encode(
            `event: usage\ndata: ${JSON.stringify({ usage_info: usageInfo })}\n\n`,
          ),
        );
      }
      controller.enqueue(
        encoder.encode(
          `event: context_optimized\ndata: ${JSON.stringify({
            message,
            usage_info: usageInfo,
          })}\n\n`,
        ),
      );
      controller.enqueue(
        encoder.encode(`event: done\ndata: ${JSON.stringify({ message })}\n\n`),
      );
      controller.close();
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream" },
    status: 200,
  });
};

const compactStructuredErrorStreamResponse = (error: {
  detail?: string;
  id: string;
  message: string;
  title: string;
  type: "error";
}) => {
  const encoder = new TextEncoder();
  const message = {
    author: "assistant",
    content: "",
    groups: [
      {
        id: "compact-message-errors",
        items: [error],
      },
    ],
    id: "compact-message",
    status: "failed",
    tools: [],
  };
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(
        encoder.encode(
          `event: snapshot\ndata: ${JSON.stringify({ message })}\n\n`,
        ),
      );
      controller.enqueue(
        encoder.encode(
          `event: error\ndata: ${JSON.stringify({ error, message: error.message })}\n\n`,
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

const persistedAssistantErrorMessage = (
  detail = "Old provider failure.",
  id = "message-old-error",
) => ({
  author: "assistant",
  content: "",
  groups: [
    {
      id: `${id}-errors`,
      items: [
        {
          detail,
          id: `${id}-error-1`,
          message: "Check the model connection settings and try again.",
          title: "Request failed",
          type: "error",
        },
      ],
    },
  ],
  id,
  status: "failed",
  tools: [],
});

const controlledCompactUsageStreamResponse = (
  usageInfo: TestContextUsageInfo,
  id = "compact-message",
) => {
  const encoder = new TextEncoder();
  const release = deferred();
  const message = {
    author: "system",
    content: "Context compacted",
    id,
    summary: "Keep the launch checklist and provider setup decisions.",
    tools: [],
    usage_info: usageInfo,
  };
  const stream = new ReadableStream({
    async start(controller) {
      controller.enqueue(
        encoder.encode(
          `event: usage\ndata: ${JSON.stringify({ usage_info: usageInfo })}\n\n`,
        ),
      );
      await release.promise;
      controller.enqueue(
        encoder.encode(
          `event: context_optimized\ndata: ${JSON.stringify({
            message,
            usage_info: usageInfo,
          })}\n\n`,
        ),
      );
      controller.enqueue(
        encoder.encode(`event: done\ndata: ${JSON.stringify({ message })}\n\n`),
      );
      controller.close();
    },
  });
  return {
    release: release.resolve,
    response: new Response(stream, {
      headers: { "Content-Type": "text/event-stream" },
      status: 200,
    }),
  };
};

const assistantOptimizedContextStreamResponse = (
  content: string,
  id = "message-assistant",
  usageInfo?: TestContextUsageInfo,
) => {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(
        encoder.encode(
          `event: context_optimized\ndata: ${JSON.stringify({
            message: {
              author: "system",
              content: "Context optimized",
              id: "context-optimized",
              summary: "Keep the latest optimized context.",
              usage_info: usageInfo,
            },
            usage_info: usageInfo,
          })}\n\n`,
        ),
      );
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

const assistantUsageStreamResponse = (
  content: string,
  usageInfo: TestContextUsageInfo,
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
          `event: delta\ndata: ${JSON.stringify({ content })}\n\n`,
        ),
      );
      controller.enqueue(
        encoder.encode(
          `event: usage\ndata: ${JSON.stringify({ usage_info: usageInfo })}\n\n`,
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

const assistantStructuredErrorStreamResponse = (
  error: {
    detail?: string;
    id: string;
    message: string;
    title: string;
    type: "error";
  },
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
      if (firstChunk) {
        controller.enqueue(
          encoder.encode(
            `event: delta\ndata: ${JSON.stringify({ content: firstChunk })}\n\n`,
          ),
        );
      }
      controller.enqueue(
        encoder.encode(
          `event: error\ndata: ${JSON.stringify({ error, message: error.message })}\n\n`,
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
  const { output, result, status, ...startTool } = tool;
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
            id: tool.id,
            result: result ?? { text: output ?? "tool output", type: "text" },
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
  const { output, result, status, ...startTool } = tool;
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
            id: tool.id,
            result: result ?? { text: output ?? "tool output", type: "text" },
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
  const { output, result, ...startTool } = tool;
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
            id: tool.id,
            result: result ?? { text: output ?? "tool output", type: "text" },
            status: tool.status ?? "success",
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

const controlledToolUpdateTimelineResponse = (
  tool: TestTool,
  update: Pick<TestTool, "id" | "result" | "status">,
  content: string,
  id = "message-assistant",
) => {
  const encoder = new TextEncoder();
  const completeTool = deferred();
  const finish = deferred();
  const { output, result, ...startTool } = tool;
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
      controller.enqueue(
        encoder.encode(
          `event: tool_update\ndata: ${JSON.stringify(update)}\n\n`,
        ),
      );
      await completeTool.promise;
      controller.enqueue(
        encoder.encode(
          `event: tool_done\ndata: ${JSON.stringify({
            id: tool.id,
            result: result ?? { text: output ?? "tool output", type: "text" },
            status: tool.status ?? "success",
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
  const { output, result, ...startTool } = tool;
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
            id: tool.id,
            result: result ?? { text: output ?? "tool output", type: "text" },
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
          const { output, result, status, ...startTool } = tool;
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
                id: tool.id,
                result: result ?? {
                  text: output ?? "tool output",
                  type: "text",
                },
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

    if (
      input === "/api/permissions/writable-paths" &&
      init?.method === "POST"
    ) {
      const request = JSON.parse(String(init.body)) as { path: string };
      const writablePaths = (
        "writable_paths" in state ? state.writable_paths : []
      ) as TestWritablePath[];
      return new Response(
        JSON.stringify({
          created_at: 1710000010,
          path: request.path,
          writable_paths: [
            ...writablePaths,
            {
              created_at: 1710000010,
              path: request.path,
            },
          ],
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

    if (input === "/api/workflows" && init?.method === "PUT") {
      const request = JSON.parse(String(init.body)) as TestWorkflow;
      const savedWorkflow: TestWorkflow = {
        ...request,
        created_at: request.created_at || 1710000020,
        updated_at: 1710000030,
      };
      state.workflows = [
        savedWorkflow,
        ...((state.workflows as TestWorkflow[] | undefined) ?? []).filter(
          (workflow) => workflow.id !== savedWorkflow.id,
        ),
      ];
      return new Response(JSON.stringify(savedWorkflow), {
        headers: { "Content-Type": "application/json" },
        status: 200,
      });
    }

    if (
      typeof input === "string" &&
      input.startsWith("/api/workflows/") &&
      input.endsWith("/run") &&
      init?.method === "POST"
    ) {
      const workflowId = input
        .replace("/api/workflows/", "")
        .replace("/run", "");
      const request = init.body
        ? (JSON.parse(String(init.body)) as {
            inputs?: Record<string, string>;
            timer_id?: string;
          })
        : {};
      const result: TestWorkflowRunResult = {
        node_results: [
          {
            error: "",
            id: "input",
            output: request.inputs?.input || "launch checklist",
            status: "success",
          },
          {
            error: "",
            id: "output",
            output: request.timer_id
              ? "Timer fired."
              : request.inputs?.input || "Ready to ship.",
            status: "success",
          },
        ],
        outputs: request.timer_id
          ? { final_result: "Timer fired." }
          : {
              final_result: request.inputs?.input || "Ready to ship.",
              summary: request.inputs?.["input-window"] || "Summary ready.",
            },
        status: "success",
        workflow_id: workflowId,
      };
      return new Response(JSON.stringify(result), {
        headers: { "Content-Type": "application/json" },
        status: 200,
      });
    }

    if (
      typeof input === "string" &&
      input.startsWith("/api/workflows/") &&
      init?.method === "DELETE"
    ) {
      return new Response(JSON.stringify({ ok: true }), {
        headers: { "Content-Type": "application/json" },
        status: 200,
      });
    }

    if (
      typeof input === "string" &&
      input.startsWith("/api/providers/") &&
      init?.method === "DELETE"
    ) {
      return new Response(JSON.stringify({ ok: true }), {
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

    if (input === "/api/workspace/clear" && init?.method === "POST") {
      return new Response(
        JSON.stringify({
          is_responding: false,
          messages: [],
          usage_info: null,
        }),
        {
          headers: { "Content-Type": "application/json" },
          status: 200,
        },
      );
    }

    if (input === "/api/workspace/compact" && init?.method === "POST") {
      return compactStreamResponse();
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

const setScrollMetrics = (
  element: Element,
  metrics: { clientHeight: number; scrollHeight: number; scrollTop: number },
) => {
  Object.defineProperty(element, "clientHeight", {
    configurable: true,
    value: metrics.clientHeight,
  });
  Object.defineProperty(element, "scrollHeight", {
    configurable: true,
    value: metrics.scrollHeight,
  });
  Object.defineProperty(element, "scrollTop", {
    configurable: true,
    value: metrics.scrollTop,
    writable: true,
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

const savedWorkflow = (updates: Partial<TestWorkflow> = {}): TestWorkflow => ({
  created_at: 1710000020,
  definition: {
    edges: [
      {
        id: "edge-input-output",
        label: "",
        source: "input",
        source_handle: "out",
        target: "output",
        target_handle: "in",
      },
    ],
    nodes: [
      {
        data: { default_value: "launch checklist", input_type: "text" },
        description: "",
        id: "input",
        name: "Input",
        position: { x: 0, y: 0 },
        type: "input",
      },
      {
        data: { output_key: "final_result", transform: "" },
        description: "",
        id: "output",
        name: "Output",
        position: { x: 260, y: 0 },
        type: "output",
      },
    ],
    version: 1,
  },
  id: "workflow-1",
  name: "Launch Workflow",
  updated_at: 1710000030,
  ...updates,
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

const expectWorkspaceMessagePost = (path: string, content: string) => {
  const request = vi.mocked(window.fetch).mock.calls.find(([input, init]) => {
    if (input !== path || init?.method !== "POST") {
      return false;
    }
    try {
      const body = JSON.parse(String(init.body)) as { content?: unknown };
      return body.content === content;
    } catch {
      return false;
    }
  });
  expect(request).toBeDefined();
  const body = JSON.parse(String(request?.[1]?.body)) as {
    content?: unknown;
    message_id?: unknown;
  };
  expect(body).toEqual({
    content,
    message_id: expect.stringMatching(/^message-/),
  });
};

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

  it("opens a new workflow from the top Workflows item", async () => {
    const user = userEvent.setup();
    mockInitialState({
      ...selectedProviderState(),
      workflows: [],
    });
    render(<App />);

    expect(screen.getByText("Workflow")).toBeInTheDocument();
    expect(screen.getByText("No workflow yet.")).toBeInTheDocument();

    await user.click(await screen.findByRole("tab", { name: "Workflows" }));

    expect(screen.getByDisplayValue("Untitled Workflow")).toBeInTheDocument();
    expect(screen.queryByText("My Workflows")).not.toBeInTheDocument();
    expect(
      screen.getByText(
        "Drag nodes from the palette to start building your workflow.",
      ),
    ).toBeInTheDocument();
  });

  it("saves new workflows with an unprefixed UUID", async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue(workflowUuid);
    mockInitialState({
      ...selectedProviderState(),
      workflows: [],
    });
    render(<App />);

    await user.click(await screen.findByRole("tab", { name: "Workflows" }));
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(window.location.pathname).toBe(`/workflows/${workflowUuid}`);
    });

    expect(window.fetch).toHaveBeenCalledWith(
      "/api/workflows",
      expect.objectContaining({
        body: expect.stringContaining(`"id":"${workflowUuid}"`),
        method: "PUT",
      }),
    );
    expect(window.fetch).not.toHaveBeenCalledWith(
      "/api/workflows",
      expect.objectContaining({
        body: expect.stringContaining(`"id":"workflow-${workflowUuid}"`),
        method: "PUT",
      }),
    );
  });

  it("saves edited workflow node properties", async () => {
    const user = userEvent.setup();
    mockInitialState({
      ...selectedProviderState(),
      workflows: [savedWorkflow()],
    });
    render(<App />);

    await user.click(
      await screen.findByRole("button", { name: /Launch Workflow/ }),
    );
    const inputNodeLabel = screen
      .getAllByText("Input")
      .find((element) => element.closest(".react-flow__node"));
    expect(inputNodeLabel).toBeTruthy();
    fireEvent.click(inputNodeLabel!);
    await user.clear(screen.getByLabelText("Default Value"));
    await user.type(screen.getByLabelText("Default Value"), "release plan");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(window.fetch).toHaveBeenCalledWith(
        "/api/workflows",
        expect.objectContaining({
          body: expect.stringContaining('"default_value":"release plan"'),
          method: "PUT",
        }),
      );
    });
  });

  it("adds a code node and saves its Python code", async () => {
    const user = userEvent.setup();
    mockInitialState({
      ...selectedProviderState(),
      workflows: [],
    });
    render(<App />);

    await user.click(await screen.findByRole("tab", { name: "Workflows" }));
    await user.click(screen.getByRole("button", { name: "Code Python step" }));
    const codeNodeLabel = screen
      .getAllByText("Code")
      .find((element) => element.closest(".react-flow__node"));
    expect(codeNodeLabel).toBeTruthy();
    fireEvent.click(codeNodeLabel!);
    await user.clear(screen.getByLabelText("Python Code"));
    await user.type(
      screen.getByLabelText("Python Code"),
      "output = input.upper()",
    );
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(window.fetch).toHaveBeenCalledWith(
        "/api/workflows",
        expect.objectContaining({
          body: expect.stringContaining('"type":"code"'),
          method: "PUT",
        }),
      );
    });
    expect(window.fetch).toHaveBeenCalledWith(
      "/api/workflows",
      expect.objectContaining({
        body: expect.stringContaining('"code":"output = input.upper()"'),
        method: "PUT",
      }),
    );
  });

  it("adds a timer node and saves its schedule", async () => {
    const user = userEvent.setup();
    mockInitialState({
      ...selectedProviderState(),
      workflows: [],
    });
    render(<App />);

    await user.click(await screen.findByRole("tab", { name: "Workflows" }));
    await user.click(
      screen.getByRole("button", { name: "Timer Scheduled trigger" }),
    );
    const timerNodeLabel = screen
      .getAllByText("Timer")
      .find((element) => element.closest(".react-flow__node"));
    expect(timerNodeLabel).toBeTruthy();
    fireEvent.click(timerNodeLabel!);
    await user.clear(screen.getByLabelText("Interval Seconds"));
    await user.type(screen.getByLabelText("Interval Seconds"), "10");
    await user.clear(screen.getByLabelText("Payload"));
    await user.type(screen.getByLabelText("Payload"), "tick");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(window.fetch).toHaveBeenCalledWith(
        "/api/workflows",
        expect.objectContaining({
          body: expect.stringContaining('"type":"timer"'),
          method: "PUT",
        }),
      );
    });
    expect(window.fetch).toHaveBeenCalledWith(
      "/api/workflows",
      expect.objectContaining({
        body: expect.stringContaining('"interval_seconds":"10"'),
        method: "PUT",
      }),
    );
    expect(window.fetch).toHaveBeenCalledWith(
      "/api/workflows",
      expect.objectContaining({
        body: expect.stringContaining('"payload":"tick"'),
        method: "PUT",
      }),
    );
  });

  it("runs a saved workflow and shows node results", async () => {
    const user = userEvent.setup();
    mockInitialState({
      ...selectedProviderState(),
      workflows: [savedWorkflow()],
    });
    render(<App />);

    await user.click(
      await screen.findByRole("button", { name: /Launch Workflow/ }),
    );
    await user.click(screen.getByRole("button", { name: "Run" }));

    expect(await screen.findByText("final_result")).toBeInTheDocument();
    expect(screen.getByText("Ready to ship.")).toBeInTheDocument();
    expect(screen.getByText("summary")).toBeInTheDocument();
    expect(fetchWasCalledWith("/api/workflows/workflow-1/run", "POST")).toBe(
      true,
    );
    expect(screen.getAllByLabelText("success").length).toBeGreaterThan(0);
  });

  it("collects multiple workflow inputs before running", async () => {
    const user = userEvent.setup();
    const workflow = savedWorkflow({
      definition: {
        ...savedWorkflow().definition,
        nodes: [
          ...savedWorkflow().definition.nodes,
          {
            data: { default_value: "default window", input_type: "text" },
            description: "",
            id: "input-window",
            name: "Window",
            position: { x: 0, y: 120 },
            type: "input",
          },
        ],
      },
    });
    mockInitialState({
      ...selectedProviderState(),
      workflows: [workflow],
    });
    render(<App />);

    await user.click(
      await screen.findByRole("button", { name: /Launch Workflow/ }),
    );
    await user.click(screen.getByRole("button", { name: "Run" }));
    expect(await screen.findByText("Workflow Input")).toBeInTheDocument();
    await user.type(screen.getByLabelText("Input"), "release blockers");
    await user.type(screen.getByLabelText("Window"), "next week");
    await user.click(screen.getByRole("button", { name: "Start" }));

    await screen.findByText("release blockers");
    const runRequest = vi
      .mocked(window.fetch)
      .mock.calls.find(
        ([input, init]) =>
          input === "/api/workflows/workflow-1/run" && init?.method === "POST",
      );
    expect(runRequest).toBeDefined();
    expect(JSON.parse(String(runRequest?.[1]?.body))).toMatchObject({
      inputs: {
        input: "release blockers",
        "input-window": "next week",
      },
    });
  });

  it("keeps a timer workflow running until it is stopped", async () => {
    const user = userEvent.setup();
    const workflow = savedWorkflow({
      definition: {
        edges: [
          {
            id: "edge-timer-output",
            label: "",
            source: "timer",
            source_handle: "out",
            target: "output",
            target_handle: "in",
          },
        ],
        nodes: [
          {
            data: {
              interval_seconds: 5,
              mode: "interval",
              payload: "Timer fired.",
            },
            description: "",
            id: "timer",
            name: "Timer",
            position: { x: 0, y: 0 },
            type: "timer",
          },
          {
            data: { output_key: "final_result", transform: "" },
            description: "",
            id: "output",
            name: "Output",
            position: { x: 260, y: 0 },
            type: "output",
          },
        ],
        version: 1,
      },
    });
    mockInitialState({
      ...selectedProviderState(),
      workflows: [workflow],
    });
    render(<App />);

    await user.click(
      await screen.findByRole("button", { name: /Launch Workflow/ }),
    );
    await user.click(screen.getByRole("button", { name: "Run" }));

    expect(
      await screen.findByRole("button", { name: "Stop" }),
    ).toBeInTheDocument();
    expect(await screen.findByText("Timer fired.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Stop" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Run" })).toBeInTheDocument();
    });
  });

  it("focuses the composer when tabbing from navigation into the Workspace", async () => {
    const user = userEvent.setup();
    mockInitialState({
      ...selectedProviderState(),
      messages: [
        {
          author: "user",
          content: "Review the launch plan.",
          id: "message-focus-user",
        },
        {
          author: "assistant",
          content: "The launch plan is ready.",
          id: "message-focus-assistant",
        },
      ],
    });
    render(<App />);

    await screen.findByText("Review the launch plan.");
    const workspaceTab = screen.getByRole("tab", { name: "Workspace" });
    const composer = screen.getByRole("textbox", {
      name: "Message Flowent",
    });

    workspaceTab.focus();
    await user.tab();

    expect(composer).toHaveFocus();
  });

  it("shows context capacity in the composer tray", () => {
    render(<App />);

    const composer = screen.getByRole("form", {
      name: "Workspace composer",
    });
    const capacityStatus = within(composer).getByRole("progressbar", {
      name: "Context capacity status",
    });

    expect(within(composer).getByText("Context")).toBeInTheDocument();
    expect(within(composer).getByText("0 / 120k")).toBeInTheDocument();
    expect(within(composer).getByText("0%")).toBeInTheDocument();
    expect(capacityStatus).toHaveAttribute("aria-valuenow", "0");
  });

  it("shows formatted context usage beside the capacity bar", async () => {
    const highCapacityContent = "A".repeat(360_000);
    mockInitialState({
      ...selectedProviderState(),
      messages: [
        {
          author: "user",
          content: highCapacityContent,
          id: "message-high-capacity",
        },
      ],
    });
    render(<App />);

    expect(await screen.findByText("90k / 120k")).toBeInTheDocument();
    expect(screen.getByText("72%")).toBeInTheDocument();
  });

  it("uses model-reported context usage from loaded state before local estimates", async () => {
    mockInitialState({
      ...selectedProviderState(),
      messages: [
        {
          author: "user",
          content: "A".repeat(360_000),
          id: "message-history-before-usage",
        },
      ],
      usage_info: contextUsageInfo(12_000, 48_000),
    });
    render(<App />);

    expect(await screen.findByText("12k / 48k")).toBeInTheDocument();
    expect(screen.getByText("0%")).toBeInTheDocument();
    expect(screen.queryByText("90k / 120k")).toBeNull();
  });

  it("falls back to local context estimates when loaded state has no usage info", async () => {
    mockInitialState({
      ...selectedProviderState(),
      messages: [
        {
          author: "user",
          content: "A".repeat(360_000),
          id: "message-local-estimate-fallback",
        },
      ],
    });
    render(<App />);

    expect(await screen.findByText("90k / 120k")).toBeInTheDocument();
    expect(screen.getByText("72%")).toBeInTheDocument();
  });

  it("adds the current draft to the model-reported context baseline", async () => {
    mockInitialState({
      ...selectedProviderState(),
      usage_info: contextUsageInfo(20_000, 100_000),
    });
    render(<App />);

    expect(await screen.findByText("20k / 100k")).toBeInTheDocument();

    fireEvent.change(screen.getByRole("textbox", { name: "Message Flowent" }), {
      target: { value: "A".repeat(4_000) },
    });

    expect(await screen.findByText("21k / 100k")).toBeInTheDocument();
    expect(screen.getByText("10%")).toBeInTheDocument();
  });

  it("continues counting messages after the latest saved usage marker", async () => {
    mockInitialState({
      ...selectedProviderState(),
      messages: [
        {
          author: "assistant",
          content: "Baseline reply",
          id: "message-usage-baseline",
          usage_info: contextUsageInfo(30_000, 100_000),
        },
        {
          author: "user",
          content: "A".repeat(4_000),
          id: "message-after-usage-baseline",
        },
      ],
    });
    render(<App />);

    expect(await screen.findByText("31k / 100k")).toBeInTheDocument();
    expect(screen.getByText("21%")).toBeInTheDocument();
  });

  it("uses a warning tone when context capacity is nearly full", async () => {
    const highCapacityContent = "A".repeat(384_000);
    mockInitialState({
      ...selectedProviderState(),
      messages: [
        {
          author: "user",
          content: highCapacityContent,
          id: "message-high-capacity",
        },
      ],
    });
    render(<App />);

    const capacityStatus = screen.getByRole("progressbar", {
      name: "Context capacity status",
    });

    await waitFor(() => {
      expect(capacityStatus).toHaveAttribute("aria-valuenow", "77");
    });
    if (!(capacityStatus.firstElementChild instanceof HTMLElement)) {
      throw new Error("Capacity indicator was not rendered.");
    }
    expect(capacityStatus.firstElementChild).toHaveClass("bg-amber-500");
    expect(screen.getByText("96k / 120k")).toBeInTheDocument();
    expect(screen.getByText("77%")).toHaveClass("text-amber-400");
  });

  it("keeps context capacity compact on narrow screens", () => {
    render(<App />);

    const composer = screen.getByRole("form", {
      name: "Workspace composer",
    });
    const capacityLabel = within(composer).getByText("Context");
    const capacityTrack = within(composer).getByLabelText(
      "Context capacity status",
    );

    expect(capacityLabel).toHaveClass("hidden", "sm:inline");
    expect(within(composer).getByText("0 / 120k")).toBeInTheDocument();
    expect(capacityTrack).toHaveClass("w-16", "sm:w-24");
  });

  it("does not expose technical wording in the context capacity tray", () => {
    render(<App />);

    const composer = screen.getByRole("form", {
      name: "Workspace composer",
    });

    expect(within(composer).queryByText(/token/i)).not.toBeInTheDocument();
  });

  it("uses a wider conversation layout without changing the composer width", async () => {
    mockInitialState({
      ...selectedProviderState(),
      messages: [
        {
          author: "user",
          content: "Please make the report easier to scan",
          id: "message-user-layout",
        },
        {
          author: "assistant",
          content: "The report can use wider reading space.",
          id: "message-assistant-layout",
        },
      ],
    });
    render(<App />);

    const userMessage = await screen.findByText(
      "Please make the report easier to scan",
      { selector: "p" },
    );
    const messageRow = userMessage.closest("article");
    const composer = screen.getByRole("form", {
      name: "Workspace composer",
    });

    expect(messageRow).toHaveClass("max-w-4xl");
    expect(composer.parentElement).toHaveClass("max-w-[640px]");
  });

  it("shows message shortcuts for conversation messages on desktop", async () => {
    mockInitialState({
      ...selectedProviderState(),
      messages: [
        {
          author: "user",
          content: "Plan the launch checklist",
          id: "message-user-anchor",
        },
        {
          author: "assistant",
          content: "Here is a focused launch plan.",
          id: "message-assistant-anchor",
        },
        {
          author: "system",
          content: "Context optimized",
          id: "message-system-anchor",
        },
      ],
    });
    render(<App />);

    const shortcuts = await screen.findByRole("navigation", {
      name: "Conversation shortcuts",
    });

    expect(
      within(shortcuts).getByRole("button", {
        name: "Jump to You: Plan the launch checklist",
      }),
    ).toBeInTheDocument();
    expect(
      within(shortcuts).getByRole("button", {
        name: "Jump to Flowent: Here is a focused launch plan.",
      }),
    ).toBeInTheDocument();
    expect(
      within(shortcuts).queryByRole("button", {
        name: /Context optimized/,
      }),
    ).not.toBeInTheDocument();
  });

  it("orders message shortcuts from oldest to newest", async () => {
    mockInitialState({
      ...selectedProviderState(),
      messages: [
        {
          author: "user",
          content: "First planning note",
          id: "message-shortcut-first",
        },
        {
          author: "assistant",
          content: "Second planning note",
          id: "message-shortcut-second",
        },
        {
          author: "user",
          content: "Third planning note",
          id: "message-shortcut-third",
        },
      ],
    });
    render(<App />);

    const shortcuts = await screen.findByRole("navigation", {
      name: "Conversation shortcuts",
    });
    const shortcutList = shortcuts.firstElementChild;

    if (!shortcutList) {
      throw new Error("Conversation shortcut list was not rendered.");
    }

    expect(shortcutList).toHaveClass("flex-col");
    expect(shortcutList).not.toHaveClass("flex-col-reverse");
    expect(
      within(shortcuts)
        .getAllByRole("button")
        .map((shortcut) => shortcut.getAttribute("aria-label")),
    ).toEqual([
      "Jump to You: First planning note",
      "Jump to Flowent: Second planning note",
      "Jump to You: Third planning note",
    ]);
  });

  it("keeps the first message as the first shortcut", async () => {
    mockInitialState({
      ...selectedProviderState(),
      messages: [
        {
          author: "user",
          content: "Oldest message in this conversation",
          id: "message-shortcut-oldest",
        },
        {
          author: "assistant",
          content: "Middle message in this conversation",
          id: "message-shortcut-middle",
        },
        {
          author: "user",
          content: "Newest message in this conversation",
          id: "message-shortcut-newest",
        },
      ],
    });
    render(<App />);

    const shortcuts = await screen.findByRole("navigation", {
      name: "Conversation shortcuts",
    });

    expect(within(shortcuts).getAllByRole("button")[0]).toHaveAccessibleName(
      "Jump to You: Oldest message in this conversation",
    );
  });

  it("keeps the last message as the last shortcut", async () => {
    mockInitialState({
      ...selectedProviderState(),
      messages: [
        {
          author: "user",
          content: "Oldest message for final shortcut check",
          id: "message-shortcut-final-oldest",
        },
        {
          author: "assistant",
          content: "Middle message for final shortcut check",
          id: "message-shortcut-final-middle",
        },
        {
          author: "assistant",
          content: "Newest message for final shortcut check",
          id: "message-shortcut-final-newest",
        },
      ],
    });
    render(<App />);

    const shortcuts = await screen.findByRole("navigation", {
      name: "Conversation shortcuts",
    });
    const shortcutButtons = within(shortcuts).getAllByRole("button");

    expect(shortcutButtons.at(-1)).toHaveAccessibleName(
      "Jump to Flowent: Newest message for final shortcut check",
    );
  });

  it("jumps to the selected message from a message shortcut", async () => {
    const user = userEvent.setup();
    const originalScrollIntoView = window.HTMLElement.prototype.scrollIntoView;
    const scrollIntoView = vi.fn();
    window.HTMLElement.prototype.scrollIntoView = scrollIntoView;

    try {
      mockInitialState({
        ...selectedProviderState(),
        messages: [
          {
            author: "user",
            content: "Find the setup notes",
            id: "message-user-jump",
          },
          {
            author: "assistant",
            content: "The setup notes are ready.",
            id: "message-assistant-jump",
          },
        ],
      });
      render(<App />);

      await user.click(
        await screen.findByRole("button", {
          name: "Jump to Flowent: The setup notes are ready.",
        }),
      );

      expect(scrollIntoView).toHaveBeenCalledWith({
        behavior: "smooth",
        block: "start",
      });
    } finally {
      window.HTMLElement.prototype.scrollIntoView = originalScrollIntoView;
    }
  });

  it("uses top-aligned message shortcut jumps", async () => {
    const user = userEvent.setup();
    const originalScrollIntoView = window.HTMLElement.prototype.scrollIntoView;
    const scrollIntoView = vi.fn();
    window.HTMLElement.prototype.scrollIntoView = scrollIntoView;

    try {
      mockInitialState({
        ...selectedProviderState(),
        messages: [
          {
            author: "user",
            content: "Open this note near the top",
            id: "message-user-top-jump",
          },
        ],
      });
      render(<App />);

      await user.click(
        await screen.findByRole("button", {
          name: "Jump to You: Open this note near the top",
        }),
      );

      expect(scrollIntoView).toHaveBeenCalledWith({
        behavior: "smooth",
        block: "start",
      });
    } finally {
      window.HTMLElement.prototype.scrollIntoView = originalScrollIntoView;
    }
  });

  it("keeps message rows offset from the very top after shortcut jumps", async () => {
    mockInitialState({
      ...selectedProviderState(),
      messages: [
        {
          author: "user",
          content: "Keep some room above this message",
          id: "message-user-scroll-margin",
        },
      ],
    });
    render(<App />);

    const message = await screen.findByText(
      "Keep some room above this message",
      {
        selector: "p",
      },
    );

    expect(message.closest("article")).toHaveClass("scroll-mt-12");
  });

  it("shows a message summary when hovering a shortcut", async () => {
    const user = userEvent.setup();
    mockInitialState({
      ...selectedProviderState(),
      messages: [
        {
          author: "user",
          content: "Review the deployment plan",
          id: "message-user-hover",
        },
      ],
    });
    render(<App />);

    const shortcut = await screen.findByRole("button", {
      name: "Jump to You: Review the deployment plan",
    });

    expect(shortcut).toHaveClass("cursor-pointer");
    expect(
      within(shortcut).queryByText("Review the deployment plan"),
    ).not.toBeInTheDocument();
    await user.hover(shortcut);
    expect(
      within(shortcut).getByText("Review the deployment plan").parentElement,
    ).toHaveClass("opacity-100");
  });

  it("allows long message shortcuts to scroll in their own list", async () => {
    mockInitialState({
      ...selectedProviderState(),
      messages: Array.from({ length: 32 }, (_, index) => ({
        author: index % 2 === 0 ? "user" : "assistant",
        content: `Conversation checkpoint ${index + 1}`,
        id: `message-shortcut-long-${index + 1}`,
      })),
    });
    render(<App />);

    const shortcuts = await screen.findByRole("navigation", {
      name: "Conversation shortcuts",
    });
    const shortcutList = shortcuts.firstElementChild;

    if (!shortcutList) {
      throw new Error("Conversation shortcut list was not rendered.");
    }

    expect(within(shortcuts).getAllByRole("button")).toHaveLength(32);
    expect(shortcutList).toHaveClass("overflow-y-auto");
    expect(shortcutList).toHaveClass("overscroll-contain");
    expect(shortcutList).toHaveClass("flowent-hidden-scrollbar");
    expect(shortcutList).not.toHaveClass("flowent-shortcut-scrollbar");
    expect(shortcutList).toHaveClass("rounded-2xl");
    expect(shortcutList).not.toHaveClass("rounded-full");
    expect(shortcutList.className).not.toContain(
      "group-hover/shortcut-rail:rounded",
    );
  });

  it("syncs the shortcut list near the middle of the conversation scroll", async () => {
    mockInitialState({
      ...selectedProviderState(),
      messages: Array.from({ length: 40 }, (_, index) => ({
        author: index % 2 === 0 ? "user" : "assistant",
        content: `Synchronized checkpoint ${index + 1}`,
        id: `message-shortcut-sync-middle-${index + 1}`,
      })),
    });
    render(<App />);

    const messageList = await screen.findByLabelText("Conversation messages");
    const shortcuts = await screen.findByRole("navigation", {
      name: "Conversation shortcuts",
    });
    const shortcutList = shortcuts.firstElementChild;

    if (!shortcutList) {
      throw new Error("Conversation shortcut list was not rendered.");
    }

    setScrollMetrics(messageList, {
      clientHeight: 500,
      scrollHeight: 2500,
      scrollTop: 1000,
    });
    setScrollMetrics(shortcutList, {
      clientHeight: 200,
      scrollHeight: 600,
      scrollTop: 0,
    });

    fireEvent.scroll(messageList);

    expect(shortcutList.scrollTop).toBeCloseTo(200);
  });

  it("keeps consecutive assistant replies as separate messages", async () => {
    const user = userEvent.setup();
    let replyCount = 0;
    mockInitialState(selectedProviderState());
    vi.mocked(window.fetch).mockImplementation(async (input, init) => {
      if (input === "/api/workspace/respond" && init?.method === "POST") {
        replyCount += 1;
        return assistantStreamResponse(
          replyCount === 1 ? "First answer." : "Second answer.",
          `message-assistant-${replyCount}`,
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
    await user.type(composer, "First request");
    await user.click(screen.getByRole("button", { name: "Send message" }));
    await expectDocumentText("First answer.");
    await user.type(composer, "Second request");
    await user.click(screen.getByRole("button", { name: "Send message" }));
    await expectDocumentText("Second answer.");

    const messageIds = Array.from(
      document.querySelectorAll<HTMLElement>(".flowent-message-row"),
      (row) => row.id,
    );
    expect(new Set(messageIds).size).toBe(messageIds.length);
    expect(screen.getAllByLabelText("Assistant response")).toHaveLength(2);
  });

  it("syncs the shortcut list near the bottom of the conversation scroll", async () => {
    mockInitialState({
      ...selectedProviderState(),
      messages: Array.from({ length: 40 }, (_, index) => ({
        author: index % 2 === 0 ? "user" : "assistant",
        content: `Bottom synchronized checkpoint ${index + 1}`,
        id: `message-shortcut-sync-bottom-${index + 1}`,
      })),
    });
    render(<App />);

    const messageList = await screen.findByLabelText("Conversation messages");
    const shortcuts = await screen.findByRole("navigation", {
      name: "Conversation shortcuts",
    });
    const shortcutList = shortcuts.firstElementChild;

    if (!shortcutList) {
      throw new Error("Conversation shortcut list was not rendered.");
    }

    setScrollMetrics(messageList, {
      clientHeight: 500,
      scrollHeight: 2500,
      scrollTop: 2000,
    });
    setScrollMetrics(shortcutList, {
      clientHeight: 200,
      scrollHeight: 600,
      scrollTop: 0,
    });

    fireEvent.scroll(messageList);

    expect(shortcutList.scrollTop).toBeCloseTo(400);
  });

  it("pauses shortcut scroll sync while the rail is hovered", async () => {
    const user = userEvent.setup();
    mockInitialState({
      ...selectedProviderState(),
      messages: Array.from({ length: 40 }, (_, index) => ({
        author: index % 2 === 0 ? "user" : "assistant",
        content: `Hover pause checkpoint ${index + 1}`,
        id: `message-shortcut-hover-pause-${index + 1}`,
      })),
    });
    render(<App />);

    const messageList = await screen.findByLabelText("Conversation messages");
    const shortcuts = await screen.findByRole("navigation", {
      name: "Conversation shortcuts",
    });
    const shortcutList = shortcuts.firstElementChild;

    if (!shortcutList) {
      throw new Error("Conversation shortcut list was not rendered.");
    }

    setScrollMetrics(messageList, {
      clientHeight: 500,
      scrollHeight: 2500,
      scrollTop: 1000,
    });
    setScrollMetrics(shortcutList, {
      clientHeight: 200,
      scrollHeight: 600,
      scrollTop: 120,
    });

    await user.hover(shortcuts);
    await waitFor(() => {
      expect(shortcutList.scrollTop).toBeCloseTo(200);
    });
    messageList.scrollTop = 1800;
    fireEvent.scroll(messageList);

    expect(shortcutList.scrollTop).toBeCloseTo(200);
  });

  it("resumes shortcut scroll sync after leaving the rail", async () => {
    const user = userEvent.setup();
    mockInitialState({
      ...selectedProviderState(),
      messages: Array.from({ length: 40 }, (_, index) => ({
        author: index % 2 === 0 ? "user" : "assistant",
        content: `Resume sync checkpoint ${index + 1}`,
        id: `message-shortcut-resume-sync-${index + 1}`,
      })),
    });
    render(<App />);

    const messageList = await screen.findByLabelText("Conversation messages");
    const shortcuts = await screen.findByRole("navigation", {
      name: "Conversation shortcuts",
    });
    const shortcutList = shortcuts.firstElementChild;

    if (!shortcutList) {
      throw new Error("Conversation shortcut list was not rendered.");
    }

    setScrollMetrics(messageList, {
      clientHeight: 500,
      scrollHeight: 2500,
      scrollTop: 1000,
    });
    setScrollMetrics(shortcutList, {
      clientHeight: 200,
      scrollHeight: 600,
      scrollTop: 120,
    });

    await user.hover(shortcuts);
    await waitFor(() => {
      expect(shortcutList.scrollTop).toBeCloseTo(200);
    });
    messageList.scrollTop = 1500;
    fireEvent.scroll(messageList);
    expect(shortcutList.scrollTop).toBeCloseTo(200);

    fireEvent.mouseLeave(shortcuts);

    await waitFor(() => {
      expect(shortcutList.scrollTop).toBeCloseTo(300);
    });
  });

  it("pauses shortcut scroll sync while the rail has focus", async () => {
    const user = userEvent.setup();
    mockInitialState({
      ...selectedProviderState(),
      messages: Array.from({ length: 40 }, (_, index) => ({
        author: index % 2 === 0 ? "user" : "assistant",
        content: `Focus pause checkpoint ${index + 1}`,
        id: `message-shortcut-focus-pause-${index + 1}`,
      })),
    });
    render(<App />);

    const messageList = await screen.findByLabelText("Conversation messages");
    const shortcuts = await screen.findByRole("navigation", {
      name: "Conversation shortcuts",
    });
    const shortcutList = shortcuts.firstElementChild;

    if (!shortcutList) {
      throw new Error("Conversation shortcut list was not rendered.");
    }

    setScrollMetrics(messageList, {
      clientHeight: 500,
      scrollHeight: 2500,
      scrollTop: 1000,
    });
    setScrollMetrics(shortcutList, {
      clientHeight: 200,
      scrollHeight: 600,
      scrollTop: 0,
    });

    const shortcut = within(shortcuts).getByRole("button", {
      name: "Jump to You: Focus pause checkpoint 1",
    });

    await user.tab();
    shortcut.focus();

    await waitFor(() => {
      expect(shortcutList.scrollTop).toBeCloseTo(200);
    });

    messageList.scrollTop = 1800;
    fireEvent.scroll(messageList);

    expect(shortcutList.scrollTop).toBeCloseTo(200);
  });

  it("leaves shortcut scroll position unchanged when the list does not need scrolling", async () => {
    mockInitialState({
      ...selectedProviderState(),
      messages: Array.from({ length: 4 }, (_, index) => ({
        author: index % 2 === 0 ? "user" : "assistant",
        content: `Short shortcut checkpoint ${index + 1}`,
        id: `message-shortcut-short-sync-${index + 1}`,
      })),
    });
    render(<App />);

    const messageList = await screen.findByLabelText("Conversation messages");
    const shortcuts = await screen.findByRole("navigation", {
      name: "Conversation shortcuts",
    });
    const shortcutList = shortcuts.firstElementChild;

    if (!shortcutList) {
      throw new Error("Conversation shortcut list was not rendered.");
    }

    setScrollMetrics(messageList, {
      clientHeight: 500,
      scrollHeight: 2500,
      scrollTop: 1000,
    });
    setScrollMetrics(shortcutList, {
      clientHeight: 600,
      scrollHeight: 600,
      scrollTop: 0,
    });

    fireEvent.scroll(messageList);

    expect(shortcutList.scrollTop).toBe(0);
  });

  it("keeps message summaries available inside the scrollable shortcut list", async () => {
    const user = userEvent.setup();
    mockInitialState({
      ...selectedProviderState(),
      messages: Array.from({ length: 12 }, (_, index) => ({
        author: index % 2 === 0 ? "user" : "assistant",
        content: `Inspect release note ${index + 1}`,
        id: `message-shortcut-summary-scroll-${index + 1}`,
      })),
    });
    render(<App />);

    const shortcuts = await screen.findByRole("navigation", {
      name: "Conversation shortcuts",
    });
    const shortcutList = shortcuts.firstElementChild;
    const shortcut = within(shortcuts).getByRole("button", {
      name: "Jump to Flowent: Inspect release note 12",
    });

    if (!shortcutList) {
      throw new Error("Conversation shortcut list was not rendered.");
    }

    expect(shortcutList).toHaveClass("overflow-y-auto");
    expect(shortcutList).toHaveClass("flowent-hidden-scrollbar");
    expect(
      within(shortcut).queryByText("Inspect release note 12"),
    ).not.toBeInTheDocument();

    await user.hover(shortcut);

    expect(
      within(shortcut).getByText("Inspect release note 12"),
    ).toBeInTheDocument();
  });

  it("keeps shortcut list scrolling separate from message jump behavior", async () => {
    const user = userEvent.setup();
    const originalScrollIntoView = window.HTMLElement.prototype.scrollIntoView;
    const scrollIntoView = vi.fn();
    window.HTMLElement.prototype.scrollIntoView = scrollIntoView;

    try {
      mockInitialState({
        ...selectedProviderState(),
        messages: Array.from({ length: 24 }, (_, index) => ({
          author: index % 2 === 0 ? "user" : "assistant",
          content: `Jump target message ${index + 1}`,
          id: `message-shortcut-jump-scroll-${index + 1}`,
        })),
      });
      render(<App />);

      const shortcuts = await screen.findByRole("navigation", {
        name: "Conversation shortcuts",
      });
      const shortcutList = shortcuts.firstElementChild;

      if (!shortcutList) {
        throw new Error("Conversation shortcut list was not rendered.");
      }

      expect(shortcutList).toHaveClass("overflow-y-auto");
      expect(shortcutList).toHaveClass("flowent-hidden-scrollbar");
      await user.click(
        within(shortcuts).getByRole("button", {
          name: "Jump to Flowent: Jump target message 24",
        }),
      );

      expect(scrollIntoView).toHaveBeenCalledWith({
        behavior: "smooth",
        block: "start",
      });
    } finally {
      window.HTMLElement.prototype.scrollIntoView = originalScrollIntoView;
    }
  });

  it("resyncs shortcuts near the selected message after a shortcut jump", async () => {
    const user = userEvent.setup();
    const originalScrollIntoView = window.HTMLElement.prototype.scrollIntoView;
    const scrollIntoView = vi.fn();
    window.HTMLElement.prototype.scrollIntoView = scrollIntoView;

    try {
      mockInitialState({
        ...selectedProviderState(),
        messages: Array.from({ length: 30 }, (_, index) => ({
          author: index % 2 === 0 ? "user" : "assistant",
          content: `Selected shortcut checkpoint ${index + 1}`,
          id: `message-shortcut-selected-sync-${index + 1}`,
        })),
      });
      render(<App />);

      const messageList = await screen.findByLabelText("Conversation messages");
      const shortcuts = await screen.findByRole("navigation", {
        name: "Conversation shortcuts",
      });
      const shortcutList = shortcuts.firstElementChild;

      if (!shortcutList) {
        throw new Error("Conversation shortcut list was not rendered.");
      }

      setScrollMetrics(messageList, {
        clientHeight: 500,
        scrollHeight: 2500,
        scrollTop: 0,
      });
      setScrollMetrics(shortcutList, {
        clientHeight: 200,
        scrollHeight: 600,
        scrollTop: 0,
      });

      await user.hover(shortcuts);
      await user.click(
        within(shortcuts).getByRole("button", {
          name: "Jump to Flowent: Selected shortcut checkpoint 20",
        }),
      );

      expect(scrollIntoView).toHaveBeenCalledWith({
        behavior: "smooth",
        block: "start",
      });

      messageList.scrollTop = 1200;
      fireEvent.scroll(messageList);
      expect(shortcutList.scrollTop).toBe(0);

      await user.unhover(shortcuts);

      expect(shortcutList.scrollTop).toBeCloseTo(240);
    } finally {
      window.HTMLElement.prototype.scrollIntoView = originalScrollIntoView;
    }
  });

  it("hides the message shortcuts on narrow screens", async () => {
    mockInitialState({
      ...selectedProviderState(),
      messages: [
        {
          author: "user",
          content: "Keep the narrow layout clear",
          id: "message-user-narrow",
        },
      ],
    });
    render(<App />);

    const shortcuts = await screen.findByRole("navigation", {
      name: "Conversation shortcuts",
    });

    expect(shortcuts).toHaveClass("max-[1180px]:hidden");
  });

  it("updates message shortcuts when new conversation messages are added", async () => {
    const user = userEvent.setup();
    mockInitialState(selectedProviderState());
    render(<App />);

    const composer = await screen.findByRole("textbox", {
      name: "Message Flowent",
    });
    await user.type(composer, "Draft a launch checklist");
    await user.click(screen.getByRole("button", { name: "Send message" }));

    const shortcuts = await screen.findByRole("navigation", {
      name: "Conversation shortcuts",
    });
    await within(shortcuts).findByRole("button", {
      name: "Jump to You: Draft a launch checklist",
    });
    await within(shortcuts).findByRole("button", {
      name: "Jump to Flowent: Here is the checklist.",
    });
    expect(within(shortcuts).getAllByRole("button")).toHaveLength(2);
  });

  it("keeps system and process-only entries out of message shortcuts", async () => {
    mockInitialState({
      ...selectedProviderState(),
      messages: [
        {
          author: "user",
          content: "Summarize the work",
          id: "message-user-filtered-anchor",
        },
        {
          author: "system",
          content: "Context compacted",
          id: "message-system-filtered-anchor",
        },
        {
          author: "assistant",
          content: "",
          id: "message-process-filtered-anchor",
          thinking: "Reading project files",
          tools: [
            {
              id: "tool-filtered-anchor",
              name: "read_file",
              status: "success",
              title: "Read file",
            },
          ],
        },
        {
          author: "assistant",
          content: "The work is summarized.",
          id: "message-assistant-filtered-anchor",
        },
      ],
    });
    render(<App />);

    const shortcuts = await screen.findByRole("navigation", {
      name: "Conversation shortcuts",
    });

    expect(within(shortcuts).getAllByRole("button")).toHaveLength(2);
    expect(within(shortcuts).queryByText("Context compacted")).toBeNull();
    expect(within(shortcuts).queryByText("Reading project files")).toBeNull();
    expect(within(shortcuts).queryByText("Read file")).toBeNull();
  });

  it("does not expose internal wording in message shortcuts", async () => {
    mockInitialState({
      ...selectedProviderState(),
      messages: [
        {
          author: "user",
          content: "Review the launch plan",
          id: "message-user-wording-anchor",
        },
        {
          author: "assistant",
          content: "The launch plan is ready.",
          id: "message-assistant-wording-anchor",
        },
      ],
    });
    render(<App />);

    const shortcuts = await screen.findByRole("navigation", {
      name: "Conversation shortcuts",
    });

    expect(within(shortcuts).queryByText(/token/i)).not.toBeInTheDocument();
    expect(within(shortcuts).queryByText(/backend/i)).not.toBeInTheDocument();
    expect(within(shortcuts).queryByText(/API/)).not.toBeInTheDocument();
  });

  it("shows a refining state in the composer tray while Compact is running", async () => {
    const user = userEvent.setup();
    const compactRequest = deferred();
    mockInitialState(selectedProviderState());
    vi.mocked(window.fetch).mockImplementation(async (input, init) => {
      if (input === "/api/state") {
        return new Response(JSON.stringify(selectedProviderState()), {
          headers: { "Content-Type": "application/json" },
          status: 200,
        });
      }
      if (input === "/api/workspace/compact" && init?.method === "POST") {
        await compactRequest.promise;
        return compactStreamResponse();
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
    await user.type(composer, "/compact");
    await user.keyboard("{Enter}");

    const composerForm = screen.getByRole("form", {
      name: "Workspace composer",
    });
    expect(within(composerForm).getByText("Context")).toBeInTheDocument();
    expect(within(composerForm).getByText("Refining...")).toHaveClass(
      "animate-pulse",
      "text-zinc-300",
    );
    expect(within(composerForm).queryByText("0 / 120k")).toBeNull();
    expect(
      within(composerForm).getByRole("progressbar", {
        name: "Context capacity status",
      }).firstElementChild,
    ).toHaveClass("flowent-context-refining-indicator");

    compactRequest.resolve();
    await screen.findByText("Context compacted");
  });

  it("keeps the draft editable but prevents sending while Compact is refining context", async () => {
    const user = userEvent.setup();
    const compactRequest = deferred();
    mockInitialState(selectedProviderState());
    vi.mocked(window.fetch).mockImplementation(async (input, init) => {
      if (input === "/api/state") {
        return new Response(JSON.stringify(selectedProviderState()), {
          headers: { "Content-Type": "application/json" },
          status: 200,
        });
      }
      if (input === "/api/workspace/compact" && init?.method === "POST") {
        await compactRequest.promise;
        return compactStreamResponse();
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
    await screen.findByText("Refining...");

    expect(composer).toBeEnabled();
    expect(screen.getByRole("button", { name: "Send message" })).toBeDisabled();
    await user.type(composer, "Keep writing");
    expect(composer).toHaveValue("Keep writing");
    await user.keyboard("{Enter}");
    expect(composer).toHaveValue("Keep writing");
    expect(fetchWasCalledWith("/api/workspace/respond", "POST")).toBe(false);

    compactRequest.resolve();
    await screen.findByText("Context compacted");
  });

  it("restores the regular context capacity tray after Compact finishes", async () => {
    const user = userEvent.setup();
    const compactRequest = deferred();
    mockInitialState(selectedProviderState());
    vi.mocked(window.fetch).mockImplementation(async (input, init) => {
      if (input === "/api/state") {
        return new Response(JSON.stringify(selectedProviderState()), {
          headers: { "Content-Type": "application/json" },
          status: 200,
        });
      }
      if (input === "/api/workspace/compact" && init?.method === "POST") {
        await compactRequest.promise;
        return compactStreamResponse();
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
    await screen.findByText("Refining...");

    compactRequest.resolve();

    await waitFor(() => {
      expect(screen.queryByText("Refining...")).toBeNull();
    });
    const composerForm = screen.getByRole("form", {
      name: "Workspace composer",
    });
    expect(within(composerForm).getByText("5 / 120k")).toBeInTheDocument();
    expect(within(composerForm).getByText("0%")).toBeInTheDocument();
    expect(
      within(composerForm).getByRole("progressbar", {
        name: "Context capacity status",
      }),
    ).toHaveAttribute("aria-valuenow", "0");
    expect(screen.getByText("Context compacted")).toBeInTheDocument();
  });

  it("restores a refining state from the loaded workspace state", async () => {
    mockInitialState({
      ...selectedProviderState(),
      is_compacting: true,
      usage_info: contextUsageInfo(90_000, 120_000),
    });
    render(<App />);

    const composerForm = await screen.findByRole("form", {
      name: "Workspace composer",
    });

    expect(within(composerForm).getByText("Context")).toBeInTheDocument();
    expect(within(composerForm).getByText("Refining...")).toHaveClass(
      "animate-pulse",
      "text-zinc-300",
    );
    expect(within(composerForm).queryByText("90k / 120k")).toBeNull();
    expect(
      within(composerForm).getByRole("progressbar", {
        name: "Context capacity status",
      }).firstElementChild,
    ).toHaveClass("flowent-context-refining-indicator");
  });

  it("polls the workspace state until restored refining finishes", async () => {
    const initialState = {
      ...selectedProviderState(),
      is_compacting: true,
      usage_info: contextUsageInfo(90_000, 120_000),
    };
    const finishedState = {
      ...selectedProviderState(),
      is_compacting: false,
      messages: [
        {
          author: "system",
          content: "Context compacted",
          id: "compact-message",
          tools: [],
        },
      ],
      usage_info: contextUsageInfo(12_000, 120_000),
    };
    let stateRequests = 0;
    vi.spyOn(window, "fetch").mockImplementation(async (input) => {
      if (input === "/api/state") {
        stateRequests += 1;
        return new Response(
          JSON.stringify(stateRequests === 1 ? initialState : finishedState),
          {
            headers: { "Content-Type": "application/json" },
            status: 200,
          },
        );
      }
      if (input === "/api/about") {
        return new Response(JSON.stringify({ version: "0.0.0-test" }), {
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

    expect(await screen.findByText("Refining...")).toBeInTheDocument();

    await waitFor(
      () => {
        expect(screen.queryByText("Refining...")).toBeNull();
      },
      { timeout: 2500 },
    );
    expect(screen.getByText("Context compacted")).toBeInTheDocument();
    expect(screen.getByText("12k / 120k")).toBeInTheDocument();
    expect(screen.getByText("0%")).toBeInTheDocument();
    expect(stateRequests).toBeGreaterThanOrEqual(2);
  });

  it("restores refining after the Compact request is cancelled", async () => {
    const user = userEvent.setup();
    const initialState = selectedProviderState();
    const refiningState = {
      ...selectedProviderState(),
      is_compacting: true,
      usage_info: contextUsageInfo(90_000, 120_000),
    };
    const finishedState = {
      ...selectedProviderState(),
      is_compacting: false,
      messages: [
        {
          author: "system",
          content: "Context compacted",
          id: "compact-message",
          tools: [],
        },
      ],
      usage_info: contextUsageInfo(12_000, 120_000),
    };
    let stateRequests = 0;
    vi.spyOn(window, "fetch").mockImplementation(async (input, init) => {
      if (input === "/api/state") {
        stateRequests += 1;
        const state =
          stateRequests === 1
            ? initialState
            : stateRequests === 2
              ? refiningState
              : finishedState;
        return new Response(JSON.stringify(state), {
          headers: { "Content-Type": "application/json" },
          status: 200,
        });
      }
      if (input === "/api/about") {
        return new Response(JSON.stringify({ version: "0.0.0-test" }), {
          headers: { "Content-Type": "application/json" },
          status: 200,
        });
      }
      if (input === "/api/workspace/compact" && init?.method === "POST") {
        const error = new Error("The operation was aborted.");
        error.name = "AbortError";
        throw error;
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

    expect(await screen.findByText("Refining...")).toBeInTheDocument();

    await waitFor(
      () => {
        expect(screen.queryByText("Refining...")).toBeNull();
      },
      { timeout: 2500 },
    );
    expect(screen.getByText("Context compacted")).toBeInTheDocument();
    expect(screen.getByText("12k / 120k")).toBeInTheDocument();
    expect(screen.getByText("0%")).toBeInTheDocument();
    expect(stateRequests).toBeGreaterThanOrEqual(3);
  });

  it("updates context usage from a compact stream", async () => {
    const user = userEvent.setup();
    mockInitialState({
      ...selectedProviderState(),
      usage_info: contextUsageInfo(90_000, 120_000),
    });
    vi.mocked(window.fetch).mockImplementation(async (input, init) => {
      if (input === "/api/state") {
        return new Response(
          JSON.stringify({
            ...selectedProviderState(),
            usage_info: contextUsageInfo(90_000, 120_000),
          }),
          {
            headers: { "Content-Type": "application/json" },
            status: 200,
          },
        );
      }
      if (input === "/api/workspace/compact" && init?.method === "POST") {
        const usageInfo = contextUsageInfo(12_000, 120_000);
        return compactStreamResponse(usageInfo);
      }
      return new Response("{}", {
        headers: { "Content-Type": "application/json" },
        status: 200,
      });
    });
    render(<App />);

    expect(await screen.findByText("90k / 120k")).toBeInTheDocument();

    const composer = screen.getByRole("textbox", { name: "Message Flowent" });
    await user.type(composer, "/compact");
    await user.keyboard("{Enter}");

    await screen.findByText("Context compacted");
    expect(await screen.findByText("12k / 120k")).toBeInTheDocument();
    expect(screen.getByText("0%")).toBeInTheDocument();
    expect(screen.queryByText("90k / 120k")).toBeNull();
  });

  it("updates context usage while the Compact stream is still running", async () => {
    const user = userEvent.setup();
    const compactStream = controlledCompactUsageStreamResponse(
      contextUsageInfo(12_000, 120_000),
    );
    mockInitialState({
      ...selectedProviderState(),
      usage_info: contextUsageInfo(90_000, 120_000),
    });
    vi.mocked(window.fetch).mockImplementation(async (input, init) => {
      if (input === "/api/state") {
        return new Response(
          JSON.stringify({
            ...selectedProviderState(),
            usage_info: contextUsageInfo(90_000, 120_000),
          }),
          {
            headers: { "Content-Type": "application/json" },
            status: 200,
          },
        );
      }
      if (input === "/api/workspace/compact" && init?.method === "POST") {
        return compactStream.response;
      }
      return new Response("{}", {
        headers: { "Content-Type": "application/json" },
        status: 200,
      });
    });
    render(<App />);

    expect(await screen.findByText("90k / 120k")).toBeInTheDocument();

    const composer = screen.getByRole("textbox", { name: "Message Flowent" });
    await user.type(composer, "/compact");
    await user.keyboard("{Enter}");

    await screen.findByText("Refining...");
    await waitFor(() => {
      expect(
        screen.getByRole("progressbar", {
          name: "Context capacity status",
        }),
      ).toHaveAttribute("aria-valuenow", "0");
    });
    expect(screen.queryByText("Context compacted")).toBeNull();

    compactStream.release();
    await screen.findByText("Context compacted");
    expect(screen.getByText("12k / 120k")).toBeInTheDocument();
  });

  it("updates context usage from automatic context optimization", async () => {
    const user = userEvent.setup();
    mockInitialState({
      ...selectedProviderState(),
      usage_info: contextUsageInfo(90_000, 120_000),
    });
    vi.mocked(window.fetch).mockImplementation(async (input, init) => {
      if (input === "/api/state") {
        return new Response(
          JSON.stringify({
            ...selectedProviderState(),
            usage_info: contextUsageInfo(90_000, 120_000),
          }),
          {
            headers: { "Content-Type": "application/json" },
            status: 200,
          },
        );
      }
      if (input === "/api/workspace/respond" && init?.method === "POST") {
        return assistantOptimizedContextStreamResponse(
          "Continuing.",
          "message-optimized-usage",
          contextUsageInfo(10_000, 120_000),
        );
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

    expect(await screen.findByText("90k / 120k")).toBeInTheDocument();

    const composer = screen.getByRole("textbox", { name: "Message Flowent" });
    await user.type(composer, "Continue from there");
    await user.click(screen.getByRole("button", { name: "Send message" }));

    await screen.findByText("Context optimized");
    expect(await screen.findByText("10k / 120k")).toBeInTheDocument();
    expect(screen.getByText("0%")).toBeInTheDocument();
    expect(screen.queryByText("90k / 120k")).toBeNull();
  });

  it("updates context usage from streaming usage events", async () => {
    const user = userEvent.setup();
    mockInitialState(selectedProviderState());
    vi.mocked(window.fetch).mockImplementation(async (input, init) => {
      if (input === "/api/state") {
        return new Response(JSON.stringify(selectedProviderState()), {
          headers: { "Content-Type": "application/json" },
          status: 200,
        });
      }
      if (input === "/api/workspace/respond" && init?.method === "POST") {
        return assistantUsageStreamResponse(
          "Done with measured usage.",
          contextUsageInfo(24_000, 60_000),
          "message-usage-event",
        );
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

    expect(await screen.findByText("0 / 120k")).toBeInTheDocument();

    const composer = screen.getByRole("textbox", { name: "Message Flowent" });
    await user.type(composer, "Measure this response");
    await user.click(screen.getByRole("button", { name: "Send message" }));

    await screen.findByText("Done with measured usage.");
    expect(await screen.findByText("24k / 60k")).toBeInTheDocument();
    expect(screen.getByText("25%")).toBeInTheDocument();
    expect(screen.queryByText("0 / 120k")).toBeNull();
  });

  it("updates context usage from the completed assistant message", async () => {
    const user = userEvent.setup();
    const eventUsageInfo = contextUsageInfo(24_000, 60_000);
    const doneUsageInfo = contextUsageInfo(26_000, 60_000);
    mockInitialState(selectedProviderState());
    vi.mocked(window.fetch).mockImplementation(async (input, init) => {
      if (input === "/api/state") {
        return new Response(JSON.stringify(selectedProviderState()), {
          headers: { "Content-Type": "application/json" },
          status: 200,
        });
      }
      if (input === "/api/workspace/respond" && init?.method === "POST") {
        const encoder = new TextEncoder();
        const stream = new ReadableStream({
          start(controller) {
            controller.enqueue(
              encoder.encode(
                `event: start\ndata: ${JSON.stringify({ id: "message-done-usage" })}\n\n`,
              ),
            );
            controller.enqueue(
              encoder.encode(
                `event: usage\ndata: ${JSON.stringify({ usage_info: eventUsageInfo })}\n\n`,
              ),
            );
            controller.enqueue(
              encoder.encode(
                `event: done\ndata: ${JSON.stringify({
                  message: {
                    author: "assistant",
                    content: "Done with final usage.",
                    id: "message-done-usage",
                    usage_info: doneUsageInfo,
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

    const composer = screen.getByRole("textbox", { name: "Message Flowent" });
    await user.type(composer, "Measure final response");
    await user.click(screen.getByRole("button", { name: "Send message" }));

    await screen.findByText("Done with final usage.");
    expect(await screen.findByText("26k / 60k")).toBeInTheDocument();
    expect(screen.queryByText("24k / 60k")).toBeNull();
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

  it("navigates sent prompt history with Up and Down", async () => {
    const user = userEvent.setup();
    mockInitialState({
      ...selectedProviderState(),
      messages: [
        {
          author: "user",
          content: "First request",
          id: "message-1",
        },
        {
          author: "assistant",
          content: "First answer.",
          id: "message-2",
        },
        {
          author: "user",
          content: "Second request",
          id: "message-3",
        },
      ],
    });
    render(<App />);

    const composer = await screen.findByRole("textbox", {
      name: "Message Flowent",
    });
    await user.click(composer);
    await user.keyboard("{ArrowUp}");
    expect(composer).toHaveValue("Second request");

    await user.keyboard("{ArrowUp}");
    expect(composer).toHaveValue("First request");

    await user.keyboard("{ArrowDown}");
    expect(composer).toHaveValue("Second request");

    await user.keyboard("{ArrowDown}");
    expect(composer).toHaveValue("");
  });

  it("restores the unsent composer draft after leaving prompt history", async () => {
    const user = userEvent.setup();
    mockInitialState({
      ...selectedProviderState(),
      messages: [
        {
          author: "user",
          content: "Earlier request",
          id: "message-1",
        },
        {
          author: "user",
          content: "Latest request",
          id: "message-2",
        },
      ],
    });
    render(<App />);

    const composer = await screen.findByRole("textbox", {
      name: "Message Flowent",
    });
    await user.type(composer, "Unsent draft");
    await user.keyboard("{ArrowUp}");
    expect(composer).toHaveValue("Latest request");

    await user.keyboard("{ArrowDown}");
    expect(composer).toHaveValue("Unsent draft");
  });

  it("keeps command menu navigation ahead of prompt history", async () => {
    const user = userEvent.setup();
    mockInitialState({
      ...selectedProviderState(),
      messages: [
        {
          author: "user",
          content: "Earlier request",
          id: "message-1",
        },
      ],
    });
    render(<App />);

    const composer = await screen.findByRole("textbox", {
      name: "Message Flowent",
    });
    await user.type(composer, "/");
    await user.keyboard("{ArrowDown}");

    expect(composer).toHaveValue("/");
    expect(screen.getByRole("option", { name: /\/compact/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("keeps skill menu navigation ahead of prompt history", async () => {
    const user = userEvent.setup();
    mockInitialState({
      ...selectedProviderState(),
      messages: [
        {
          author: "user",
          content: "Earlier request",
          id: "message-1",
        },
      ],
      skills: [
        projectSkill(),
        projectSkill({
          description: "Plan project work.",
          id: "skill-project-plan",
          name: "Project Plan",
          slug: "project-plan",
        }),
      ],
    });
    render(<App />);

    const composer = await screen.findByRole("textbox", {
      name: "Message Flowent",
    });
    await user.type(composer, "$");
    await user.keyboard("{ArrowDown}");

    expect(composer).toHaveValue("$");
    expect(
      screen.getByRole("option", { name: /\$project-plan/ }),
    ).toHaveAttribute("aria-selected", "true");
  });

  it("keeps multiline drafts unchanged when Up is pressed below the first line", async () => {
    const user = userEvent.setup();
    mockInitialState({
      ...selectedProviderState(),
      messages: [
        {
          author: "user",
          content: "Earlier request",
          id: "message-1",
        },
      ],
    });
    render(<App />);

    const composer = await screen.findByRole("textbox", {
      name: "Message Flowent",
    });
    await user.type(composer, "Line one");
    await user.keyboard("{Shift>}{Enter}{/Shift}");
    await user.type(composer, "Line two");
    await user.keyboard("{ArrowUp}");

    expect(composer).toHaveValue("Line one\nLine two");
  });

  it("skips consecutive duplicate prompts in prompt history", async () => {
    const user = userEvent.setup();
    mockInitialState({
      ...selectedProviderState(),
      messages: [
        {
          author: "user",
          content: "First request",
          id: "message-1",
        },
        {
          author: "user",
          content: "Repeat request",
          id: "message-2",
        },
        {
          author: "user",
          content: "Repeat request",
          id: "message-3",
        },
      ],
    });
    render(<App />);

    const composer = await screen.findByRole("textbox", {
      name: "Message Flowent",
    });
    await user.click(composer);
    await user.keyboard("{ArrowUp}");
    expect(composer).toHaveValue("Repeat request");

    await user.keyboard("{ArrowUp}");
    expect(composer).toHaveValue("First request");
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

    expectWorkspaceMessagePost(
      "/api/workspace/respond",
      "Draft a launch checklist",
    );
    await expectDocumentText("The plan is ready.");
  });

  it("starts a workspace response and reads its stream", async () => {
    const user = userEvent.setup();
    const assistantSnapshot = controlledAssistantSnapshotStreamResponse({
      author: "assistant",
      content: "The plan is ready.",
      groups: [
        {
          id: "message-assistant-group-1",
          items: [
            {
              content: "The plan is ready.",
              id: "message-assistant-text-1",
              type: "text",
            },
          ],
        },
      ],
      id: "message-assistant",
      status: "running",
    });
    mockInitialState(selectedProviderState());
    vi.mocked(window.fetch).mockImplementation(async (input, init) => {
      if (input === "/api/workspace/respond" && init?.method === "POST") {
        return assistantSnapshot.response;
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
    assistantSnapshot.finish();
    expectWorkspaceMessagePost(
      "/api/workspace/respond",
      "Draft a launch checklist",
    );
  });

  it("reloads state and reconnects when a workspace response stream drops", async () => {
    const user = userEvent.setup();
    const assistantSnapshot = controlledAssistantSnapshotStreamResponse(
      {
        author: "assistant",
        content: "Partial answer.",
        groups: [
          {
            id: "message-assistant-group-1",
            items: [
              {
                content: "Partial answer.",
                id: "message-assistant-text-1",
                type: "text",
              },
            ],
          },
        ],
        id: "message-assistant",
        status: "running",
      },
      3,
    );
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
      is_responding: true,
      response_event_index: 2,
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
      if (input === "/api/workspace/respond" && init?.method === "POST") {
        return droppedStream;
      }
      if (input === "/api/workspace/stream?after=2" && init?.method === "GET") {
        return assistantSnapshot.response;
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
    assistantSnapshot.finish();
    expect(window.fetch).toHaveBeenCalledWith(
      "/api/workspace/stream?after=2",
      expect.objectContaining({ method: "GET" }),
    );
    expect(document.body).not.toHaveTextContent("Load failed");
  });

  it("uses server event indexes when reconnecting a workspace response stream", async () => {
    const user = userEvent.setup();
    const assistantSnapshot = controlledAssistantSnapshotStreamResponse(
      {
        author: "assistant",
        content: "Continued from snapshot.",
        groups: [
          {
            id: "message-assistant-group-1",
            items: [
              {
                content: "Continued from snapshot.",
                id: "message-assistant-text-1",
                type: "text",
              },
            ],
          },
        ],
        id: "message-assistant",
        status: "running",
      },
      2,
    );
    const droppedStream = new Response(
      new ReadableStream({
        start(controller) {
          const encoder = new TextEncoder();
          controller.enqueue(
            encoder.encode(
              `id: 1\nevent: context_optimized\ndata: ${JSON.stringify({
                message: {
                  author: "system",
                  content: "Context optimized",
                  id: "context-optimized",
                  usage_info: contextUsageInfo(10_000, 120_000),
                },
                usage_info: contextUsageInfo(10_000, 120_000),
              })}\n\n`,
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
      is_responding: true,
      response_event_index: 1,
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
          usage_info: contextUsageInfo(10_000, 120_000),
        },
      ],
      usage_info: contextUsageInfo(10_000, 120_000),
    };
    let stateRequests = 0;
    mockInitialState(selectedProviderState());
    vi.mocked(window.fetch).mockImplementation(async (input, init) => {
      if (input === "/api/workspace/respond" && init?.method === "POST") {
        return droppedStream;
      }
      if (input === "/api/workspace/stream?after=1" && init?.method === "GET") {
        return assistantSnapshot.response;
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
    await user.type(composer, "Continue from there");
    await user.click(screen.getByRole("button", { name: "Send message" }));

    await expectDocumentText("Continued from snapshot.");
    assistantSnapshot.finish();
    expect(window.fetch).toHaveBeenCalledWith(
      "/api/workspace/stream?after=1",
      expect.objectContaining({ method: "GET" }),
    );
    expect(window.fetch).not.toHaveBeenCalledWith(
      "/api/workspace/stream?after=2",
      expect.objectContaining({ method: "GET" }),
    );
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
    const firstStream = abortableAssistantStreamResponse(
      "Partial response",
      "message-assistant-first",
    );
    let replyCount = 0;
    mockInitialState(selectedProviderState());
    vi.mocked(window.fetch).mockImplementation(async (input, init) => {
      if (input === "/api/workspace/respond" && init?.method === "POST") {
        replyCount += 1;
        if (replyCount === 1) {
          return firstStream.response(init.signal as AbortSignal | undefined);
        }
        return assistantStreamResponse(
          "Second answer.",
          "message-assistant-second",
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

    expectWorkspaceMessagePost(
      "/api/workspace/respond",
      "Draft a launch checklist",
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
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Response interrupted");
    expect(alert).toHaveTextContent("Connection lost.");
    expect(alert.textContent?.match(/Connection lost\./g)).toHaveLength(1);
    expect(
      screen.queryByRole("status", { name: "Thinking" }),
    ).not.toBeInTheDocument();
  });

  it("renders persisted assistant error blocks from loaded state", async () => {
    mockInitialState({
      ...selectedProviderState(),
      messages: [
        {
          author: "assistant",
          content: "",
          groups: [
            {
              id: "message-assistant-errors",
              items: [
                {
                  detail: "HTML response returned.",
                  id: "message-assistant-error-1",
                  message: "Check the model connection settings and try again.",
                  title: "Request failed",
                  type: "error",
                },
              ],
            },
          ],
          id: "message-assistant",
          status: "failed",
        },
      ],
    });

    render(<App />);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Request failed");
    expect(alert).toHaveTextContent(
      "Check the model connection settings and try again.",
    );
    expect(alert).toHaveTextContent("HTML response returned.");
  });

  it("renders a structured stream error in the assistant turn", async () => {
    const user = userEvent.setup();
    mockInitialState(selectedProviderState());
    vi.mocked(window.fetch).mockImplementation(async (input, init) => {
      if (input === "/api/workspace/respond" && init?.method === "POST") {
        return assistantStructuredErrorStreamResponse(
          {
            detail: "HTML response returned.",
            id: "message-assistant-error-1",
            message: "Check the model connection settings and try again.",
            title: "Request failed",
            type: "error",
          },
          "",
        );
      }
      if (input === "/api/state") {
        return new Response(JSON.stringify(selectedProviderState()), {
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

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Request failed");
    expect(alert).toHaveTextContent(
      "Check the model connection settings and try again.",
    );
    expect(alert).toHaveTextContent("HTML response returned.");
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
            id: "tool-1",
            name: "read_file",
            output: "Note contents",
            result: { path: "notes.txt", text: "Note contents", type: "text" },
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
        result: {
          approval: {
            action: "additional_permissions",
            decision: "approved",
            reason: "Needed for cache writes.",
            tool_name: "shell_command",
            write_paths: ["/workspace/.cache/pnpm"],
          },
          command: "pnpm install",
          exit_code: 0,
          output: "done",
          stderr: "",
          stdout: "done",
          type: "command",
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
      if (input === "/api/workspace/respond" && init?.method === "POST") {
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
    expect(document.body).not.toHaveTextContent("FAILURE");
    expect(screen.queryByText("RESULT")).not.toBeInTheDocument();
    expect(screen.getByText("STDOUT").parentElement).toHaveTextContent("done");
    expect(screen.queryByText("STDERR")).not.toBeInTheDocument();
    expect(screen.queryByText("EXIT CODE")).not.toBeInTheDocument();
    expect(screen.getByText("Exit 0")).toBeInTheDocument();
    expect(screen.getByText("STDOUT").parentElement).not.toHaveTextContent(
      "Needed for cache writes.",
    );
  });

  it("shows first sandbox failure output after a reviewed retry succeeds", async () => {
    const user = userEvent.setup();
    const firstFailureOutput =
      "mkdir: cannot create directory '/root/.local/state/fnm_multishells': Read-only file system";
    const toolStream = controlledToolTimelineResponse(
      {
        arguments: { command: "pnpm test" },
        result: {
          approval: {
            action: "sandbox_failure",
            decision: "approved",
            reason: "Retry matches the current task.",
            tool_name: "shell_command",
            tool_result: firstFailureOutput,
            write_paths: [],
          },
          command: "pnpm test",
          exit_code: 0,
          output: "all tests passed",
          stderr: "",
          stdout: "all tests passed",
          type: "command",
        },
        id: "tool-1",
        name: "shell_command",
        output: "all tests passed",
        title: "Ran pnpm test",
      },
      "Tests passed.",
    );
    mockInitialState(selectedProviderState());
    vi.mocked(window.fetch).mockImplementation(async (input, init) => {
      if (input === "/api/workspace/respond" && init?.method === "POST") {
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
    await user.type(composer, "Run tests");
    await user.click(screen.getByRole("button", { name: "Send message" }));
    await user.click(
      await screen.findByRole("button", { name: /Ran pnpm test/ }),
    );
    toolStream.completeTool();

    expect(await screen.findByText("REVIEW")).toBeInTheDocument();
    expect(screen.getByText("Approved")).toBeInTheDocument();
    expect(
      screen.getByText("Retry matches the current task."),
    ).toBeInTheDocument();
    expect(screen.getByText("FAILURE")).toBeInTheDocument();
    expect(screen.getByText(firstFailureOutput)).toBeInTheDocument();
    expect(screen.queryByText("RESULT")).not.toBeInTheDocument();
    expect(screen.getByText("STDOUT").parentElement).toHaveTextContent(
      "all tests passed",
    );
    expect(screen.queryByText("STDERR")).not.toBeInTheDocument();
    expect(screen.queryByText("EXIT CODE")).not.toBeInTheDocument();
    expect(screen.getByText("Exit 0")).toBeInTheDocument();
    expect(screen.getByText("STDOUT").parentElement).not.toHaveTextContent(
      firstFailureOutput,
    );
  });

  it("restores automatic review details from loaded tool result", async () => {
    const user = userEvent.setup();
    const runningState = {
      ...selectedProviderState(),
      is_responding: true,
      response_event_index: 4,
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
              result: {
                approval: {
                  action: "sandbox_failure",
                  decision: "denied",
                  reason: "Outside the task scope.",
                  tool_name: "shell_command",
                  tool_result: "failed to write file: Read-only file system",
                  write_paths: [],
                },
                command: "pnpm install",
                exit_code: 1,
                output: "Outside the task scope.",
                stderr: "Read-only file system",
                stdout: "",
                type: "command",
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
      if (input === "/api/workspace/stream?after=4" && init?.method === "GET") {
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

    const toolDetails = await screen.findByRole("button", {
      name: /Ran pnpm install/,
    });
    expect(toolDetails).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("REVIEW")).not.toBeInTheDocument();
    expect(screen.queryByText("FAILURE")).not.toBeInTheDocument();

    await user.click(toolDetails);

    expect(screen.getByText("REVIEW")).toBeInTheDocument();
    expect(screen.getByText("Denied")).toBeInTheDocument();
    expect(screen.getByText("Outside the task scope.")).toBeInTheDocument();
    expect(screen.getByText("FAILURE")).toBeInTheDocument();
    expect(
      screen.getByText("failed to write file: Read-only file system"),
    ).toBeInTheDocument();
    expect(screen.queryByText("RESULT")).not.toBeInTheDocument();
    expect(screen.queryByText("STDOUT")).not.toBeInTheDocument();
    expect(screen.getByText("STDERR").parentElement).toHaveTextContent(
      "Read-only file system",
    );
    expect(screen.queryByText("EXIT CODE")).not.toBeInTheDocument();
    expect(screen.getByText("Exit 1")).toBeInTheDocument();
  });

  it("shows multiline sandbox failure output in review details", async () => {
    const user = userEvent.setup();
    const firstFailureOutput =
      "mkdir: cannot create directory '/root/.local/state/fnm_multishells': Permission denied\n" +
      "touch: cannot touch '/root/.local/state/fnm_multishells/123': Read-only file system";
    mockInitialState(selectedProviderState());
    vi.mocked(window.fetch).mockImplementation(async (input, init) => {
      if (input === "/api/workspace/respond" && init?.method === "POST") {
        return assistantToolStreamResponse(
          {
            arguments: { command: "pnpm lint" },
            result: {
              approval: {
                action: "sandbox_failure",
                decision: "denied",
                reason: "Path access was not approved.",
                tool_name: "shell_command",
                tool_result: firstFailureOutput,
                write_paths: [],
              },
              command: "pnpm lint",
              exit_code: 1,
              output: "Path access was not approved.",
              stderr: "Read-only file system",
              stdout: "",
              type: "command",
            },
            id: "tool-1",
            name: "shell_command",
            output: "Path access was not approved.",
            status: "failed",
            title: "Ran pnpm lint",
          },
          "Lint could not run.",
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
    await user.type(composer, "Run lint");
    await user.click(screen.getByRole("button", { name: "Send message" }));

    const toolDetails = await screen.findByRole("button", {
      name: /Ran pnpm lint/,
    });
    expect(await screen.findByText("Failed")).toBeInTheDocument();
    expect(toolDetails).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("REVIEW")).not.toBeInTheDocument();
    expect(screen.queryByText("FAILURE")).not.toBeInTheDocument();

    await user.click(toolDetails);

    expect(screen.getByText("REVIEW")).toBeInTheDocument();
    const outputBlock = screen.getByText("FAILURE").parentElement;
    expect(outputBlock).toHaveTextContent(
      "mkdir: cannot create directory '/root/.local/state/fnm_multishells': Permission denied",
    );
    expect(outputBlock).toHaveTextContent(
      "touch: cannot touch '/root/.local/state/fnm_multishells/123': Read-only file system",
    );
  });

  it("shows successful tool details after the tool row is opened", async () => {
    const user = userEvent.setup();
    mockInitialState(selectedProviderState());
    vi.mocked(window.fetch).mockImplementation(async (input, init) => {
      if (input === "/api/workspace/respond" && init?.method === "POST") {
        return assistantToolStreamResponse(
          {
            arguments: { path: "notes.txt" },
            id: "tool-1",
            name: "read_file",
            output: "Note contents",
            result: { path: "notes.txt", text: "Note contents", type: "text" },
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
    expect(resultBlock).toHaveTextContent("Note contents");
    expect(resultBlock).not.toHaveTextContent('"content"');
    expect(resultBlock).not.toHaveTextContent('"data"');
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
            output: "File not found",
            result: {
              path: "missing.txt",
              text: "File not found",
              type: "text",
            },
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

    const toolDetails = await screen.findByRole("button", {
      name: /Reading missing\.txt/,
    });
    expect(await screen.findByText("Failed")).toBeInTheDocument();
    expect(toolDetails).toHaveAttribute("aria-expanded", "false");
    expect(document.body).not.toHaveTextContent("RESULT");
    expect(document.body).not.toHaveTextContent("File not found");

    await user.click(toolDetails);

    const resultBlock = screen.getByText("RESULT").parentElement;
    expect(resultBlock).toHaveTextContent("File not found");
    expect(resultBlock).not.toHaveTextContent('"content"');
    await expectDocumentText("I could not read it.");
  });

  it("lets users collapse failed tool details after opening them", async () => {
    const user = userEvent.setup();
    mockInitialState(selectedProviderState());
    vi.mocked(window.fetch).mockImplementation(async (input, init) => {
      if (input === "/api/workspace/respond" && init?.method === "POST") {
        return assistantToolStreamResponse(
          {
            id: "tool-1",
            name: "read_file",
            output: "File not found",
            result: {
              path: "missing.txt",
              text: "File not found",
              type: "text",
            },
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

    const toolDetails = await screen.findByRole("button", {
      name: /Reading missing\.txt/,
    });
    expect(await screen.findByText("Failed")).toBeInTheDocument();

    await user.click(toolDetails);

    expect(toolDetails).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("RESULT")).toBeInTheDocument();

    await user.click(toolDetails);

    expect(toolDetails).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("RESULT")).not.toBeInTheDocument();
  });

  it("shows shell command output and structured fields inside the tool result", async () => {
    const user = userEvent.setup();
    mockInitialState(selectedProviderState());
    vi.mocked(window.fetch).mockImplementation(async (input, init) => {
      if (input === "/api/workspace/respond" && init?.method === "POST") {
        return assistantToolStreamResponse(
          {
            arguments: { command: "printf done" },
            result: {
              command: "printf done",
              exit_code: 0,
              output: "done",
              stderr: "",
              stdout: "done",
              type: "command",
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
    expect(screen.queryByText("RESULT")).not.toBeInTheDocument();
    expect(screen.getByText("STDOUT").parentElement).toHaveTextContent("done");
    expect(screen.queryByText("STDERR")).not.toBeInTheDocument();
    expect(screen.queryByText("EXIT CODE")).not.toBeInTheDocument();
    expect(screen.getByText("Exit 0")).toBeInTheDocument();
  });

  it("shows a compact exit status when command output is empty", async () => {
    const user = userEvent.setup();
    mockInitialState(selectedProviderState());
    vi.mocked(window.fetch).mockImplementation(async (input, init) => {
      if (input === "/api/workspace/respond" && init?.method === "POST") {
        return assistantToolStreamResponse(
          {
            arguments: { command: "true" },
            result: {
              command: "true",
              exit_code: 0,
              output: "",
              stderr: "",
              stdout: "",
              type: "command",
            },
            id: "tool-1",
            name: "shell_command",
            output: "",
            title: "Ran true",
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
    await user.type(composer, "Run the silent command");
    await user.click(screen.getByRole("button", { name: "Send message" }));

    const toolDetails = await screen.findByRole("button", {
      name: /Ran true/,
    });
    await user.click(toolDetails);

    expect(screen.queryByText("RESULT")).not.toBeInTheDocument();
    expect(screen.queryByText("STDOUT")).not.toBeInTheDocument();
    expect(screen.queryByText("STDERR")).not.toBeInTheDocument();
    expect(screen.getByText("Exit 0")).toBeInTheDocument();
    await expectDocumentText("Command finished.");
  });

  it("streams shell command stdout and stderr into the open tool result", async () => {
    const user = userEvent.setup();
    const toolStream = controlledToolUpdateTimelineResponse(
      {
        arguments: { command: "pnpm test" },
        result: {
          command: "pnpm test",
          exit_code: 0,
          output: "Installing\nWarning\nDone\n",
          output_chunks: [
            { content: "Installing\n", stream: "stdout" },
            { content: "Warning\n", stream: "stderr" },
            { content: "Done\n", stream: "stdout" },
          ],
          stderr: "Warning\n",
          stdout: "Installing\nDone\n",
          type: "command",
        },
        id: "tool-1",
        name: "shell_command",
        title: "Ran pnpm test",
      },
      {
        id: "tool-1",
        result: {
          command: "pnpm test",
          output: "Installing\nWarning\n",
          output_chunks: [
            { content: "Installing\n", stream: "stdout" },
            { content: "Warning\n", stream: "stderr" },
          ],
          stderr: "Warning\n",
          stdout: "Installing\n",
          type: "command",
        },
        status: "running",
      },
      "Command finished.",
    );
    mockInitialState(selectedProviderState());
    vi.mocked(window.fetch).mockImplementation(async (input, init) => {
      if (input === "/api/workspace/respond" && init?.method === "POST") {
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
    await user.type(composer, "Run tests");
    await user.click(screen.getByRole("button", { name: "Send message" }));

    const toolDetails = await screen.findByRole("button", {
      name: /Ran pnpm test/,
    });
    await user.click(toolDetails);

    expect(toolDetails).toHaveTextContent("Running");
    expect(screen.queryByText("RESULT")).not.toBeInTheDocument();
    expect(screen.getByText("STDOUT").parentElement).toHaveTextContent(
      "Installing",
    );
    expect(screen.getByText("STDERR").parentElement).toHaveTextContent(
      "Warning",
    );
    expect(screen.queryByText("EXIT CODE")).not.toBeInTheDocument();
    expect(screen.queryByText(/^Exit /)).not.toBeInTheDocument();

    toolStream.completeTool();

    await waitFor(() => expect(toolDetails).toHaveTextContent("Done"));
    expect(screen.getByText("STDOUT").parentElement).toHaveTextContent(
      /Installing\s*Done/,
    );
    expect(screen.getByText("STDERR").parentElement).toHaveTextContent(
      "Warning",
    );
    expect(screen.getByText("Exit 0")).toBeInTheDocument();
    toolStream.finish();
    await expectDocumentText("Command finished.");
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
      "Plan updated",
    );
  });

  it("shows plan updates as work steps", async () => {
    const user = userEvent.setup();
    mockInitialState(selectedProviderState());
    vi.mocked(window.fetch).mockImplementation(async (input, init) => {
      if (input === "/api/workspace/respond" && init?.method === "POST") {
        return assistantToolStreamResponse(
          {
            result: {
              items: [
                { status: "completed", step: "Inspect warnings" },
                { status: "in_progress", step: "Apply focused fixes" },
                { status: "pending", step: "Verify the result" },
              ],
              output: "Plan updated.",
              type: "plan",
            },
            id: "tool-1",
            name: "update_plan",
            title: "Updating plan",
          },
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
    const composerForm = screen.getByRole("form", {
      name: "Workspace composer",
    });
    const planToggle = await within(composerForm).findByRole("button", {
      name: "Plan · 1/3 done",
    });
    expect(planToggle.closest("form")).toBe(composerForm);
    expect(planToggle).toHaveAttribute("aria-expanded", "false");
    await user.click(planToggle);
    expect(planToggle).toHaveAttribute("aria-expanded", "true");

    const planTasks = within(composerForm).getByRole("list", {
      name: "Plan tasks",
    });
    expect(planTasks.parentElement).toHaveAttribute(
      "data-slot",
      "plan-tasks-panel",
    );
    expect(planTasks.parentElement).toHaveClass("overflow-hidden");
    expect(within(planTasks).getByText("Inspect warnings")).toBeInTheDocument();
    expect(
      within(planTasks).getByText("Apply focused fixes"),
    ).toBeInTheDocument();
    expect(
      within(planTasks).getByText("Verify the result"),
    ).toBeInTheDocument();
    expect(within(planTasks).getByText("Doing")).toBeInTheDocument();
    await expectDocumentText("Plan updated.");
  });

  it("collapses an open plan when users leave it or dismiss it", async () => {
    const user = userEvent.setup();
    mockInitialState({
      ...selectedProviderState(),
      messages: [
        {
          author: "assistant",
          content: "Plan ready.",
          id: "message-plan",
          tools: [
            {
              result: {
                items: [
                  { status: "completed", step: "Inspect warnings" },
                  { status: "in_progress", step: "Apply focused fixes" },
                  { status: "pending", step: "Verify the result" },
                ],
                output: "Plan ready.",
                type: "plan",
              },
              id: "tool-plan",
              name: "update_plan",
              status: "success",
              title: "Updating plan",
            },
          ],
        },
      ],
    });
    render(<App />);

    const composerForm = await screen.findByRole("form", {
      name: "Workspace composer",
    });
    const planToggle = await within(composerForm).findByRole("button", {
      name: "Plan · 1/3 done",
    });

    await user.click(planToggle);
    expect(planToggle).toHaveAttribute("aria-expanded", "true");
    const planTasks = within(composerForm).getByRole("list", {
      name: "Plan tasks",
    });
    const planContainer = planToggle.parentElement;
    expect(planContainer).not.toBeNull();

    fireEvent.pointerLeave(planContainer as HTMLElement, {
      pointerType: "mouse",
    });
    expect(planToggle).toHaveAttribute("aria-expanded", "false");

    await user.click(planToggle);
    expect(planToggle).toHaveAttribute("aria-expanded", "true");
    fireEvent.pointerDown(planTasks, { pointerType: "touch" });
    expect(planToggle).toHaveAttribute("aria-expanded", "true");

    fireEvent.pointerDown(screen.getByLabelText("Message Flowent"), {
      pointerType: "touch",
    });
    expect(planToggle).toHaveAttribute("aria-expanded", "false");

    await user.click(planToggle);
    expect(planToggle).toHaveAttribute("aria-expanded", "true");
    await user.keyboard("{Escape}");
    expect(planToggle).toHaveAttribute("aria-expanded", "false");
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

  it("shows a new sending error when earlier history already has an error block", async () => {
    const user = userEvent.setup();
    const messages = [persistedAssistantErrorMessage()];
    mockInitialState({
      messages,
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
            messages,
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
    expect(
      await screen.findByText("Old provider failure."),
    ).toBeInTheDocument();

    await user.type(composer, "Draft a launch checklist");
    await user.click(screen.getByRole("button", { name: "Send message" }));

    await waitFor(() => expect(screen.getAllByRole("alert")).toHaveLength(2));
    const alerts = screen.getAllByRole("alert");
    expect(alerts[0]).toHaveTextContent("Old provider failure.");
    expect(alerts[1]).toHaveTextContent("Request failed");
    expect(alerts[1]).toHaveTextContent(
      "Choose a provider and model before sending.",
    );
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

    expectWorkspaceMessagePost("/api/workspace/respond", "   ");
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

  it("removes a saved provider and selects the nearest provider in the editor", async () => {
    const user = userEvent.setup();
    mockInitialState({
      messages: [],
      providers: [
        {
          api_key: "sk-local",
          base_url: "https://api.example.test/v1",
          id: "provider-openai",
          models: ["gpt-5.1"],
          name: "OpenAI",
          type: "openai",
        },
        {
          api_key: "sk-anthropic",
          base_url: "",
          id: "provider-anthropic",
          models: ["claude-sonnet-4-5"],
          name: "Anthropic",
          type: "anthropic",
        },
        {
          api_key: "sk-gemini",
          base_url: "",
          id: "provider-gemini",
          models: ["gemini-3-pro"],
          name: "Gemini",
          type: "gemini",
        },
      ] satisfies TestProvider[],
      settings: {
        reasoning_effort: "default",
        selected_model: "gemini-3-pro",
        selected_provider_id: "provider-gemini",
      },
    });

    render(<App />);
    await user.click(await screen.findByRole("tab", { name: "Providers" }));
    await user.click(screen.getByRole("button", { name: "OpenAI" }));
    await user.click(screen.getByRole("button", { name: "Remove" }));

    await waitFor(() => {
      expect(
        screen.queryByRole("button", { name: "OpenAI" }),
      ).not.toBeInTheDocument();
    });
    expect(
      screen.getByRole("button", { name: "Anthropic" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Gemini" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Provider name" })).toHaveValue(
      "Anthropic",
    );
    expect(screen.getByRole("button", { name: "Remove" })).toBeInTheDocument();
    expect(window.fetch).toHaveBeenCalledWith(
      "/api/providers/provider-openai",
      expect.objectContaining({ method: "DELETE" }),
    );
    expect(window.fetch).not.toHaveBeenCalledWith(
      "/api/settings",
      expect.objectContaining({
        body: JSON.stringify({
          agent_prompt: "",
          context_window_limit: null,
          reasoning_effort: "default",
          selected_model: "",
          selected_provider_id: "",
        }),
        method: "PUT",
      }),
    );
    await user.click(screen.getByRole("tab", { name: "Settings" }));

    expect(
      screen.getByRole("combobox", { name: "Provider" }),
    ).toHaveTextContent("Gemini");
    expect(screen.getByRole("combobox", { name: "Model" })).toHaveTextContent(
      "gemini-3-pro",
    );
  });

  it("selects the nearest Settings provider and its first model when the active provider is removed", async () => {
    const user = userEvent.setup();
    mockInitialState({
      messages: [],
      providers: [
        {
          api_key: "sk-local",
          base_url: "https://api.example.test/v1",
          id: "provider-openai",
          models: ["gpt-5.1"],
          name: "OpenAI",
          type: "openai",
        },
        {
          api_key: "sk-anthropic",
          base_url: "",
          id: "provider-anthropic",
          models: ["claude-sonnet-4-5", "claude-haiku-4-5"],
          name: "Anthropic",
          type: "anthropic",
        },
      ] satisfies TestProvider[],
      settings: {
        reasoning_effort: "default",
        selected_model: "gpt-5.1",
        selected_provider_id: "provider-openai",
      },
    });

    render(<App />);
    await user.click(await screen.findByRole("tab", { name: "Providers" }));
    await user.click(screen.getByRole("button", { name: "OpenAI" }));
    await user.click(screen.getByRole("button", { name: "Remove" }));

    await waitFor(() => {
      expect(
        screen.queryByRole("button", { name: "OpenAI" }),
      ).not.toBeInTheDocument();
    });
    expect(screen.getByRole("textbox", { name: "Provider name" })).toHaveValue(
      "Anthropic",
    );
    await user.click(screen.getByRole("tab", { name: "Settings" }));

    expect(
      screen.getByRole("combobox", { name: "Provider" }),
    ).toHaveTextContent("Anthropic");
    expect(screen.getByRole("combobox", { name: "Model" })).toHaveTextContent(
      "claude-sonnet-4-5",
    );
    expect(window.fetch).toHaveBeenCalledWith(
      "/api/providers/provider-openai",
      expect.objectContaining({ method: "DELETE" }),
    );
    expect(window.fetch).toHaveBeenCalledWith(
      "/api/settings",
      expect.objectContaining({
        body: JSON.stringify({
          agent_prompt: "",
          context_window_limit: null,
          reasoning_effort: "default",
          selected_model: "claude-sonnet-4-5",
          selected_provider_id: "provider-anthropic",
        }),
        method: "PUT",
      }),
    );
  });

  it("selects the previous Settings provider when the removed active provider is last", async () => {
    const user = userEvent.setup();
    mockInitialState({
      messages: [],
      providers: [
        {
          api_key: "sk-openai",
          base_url: "https://api.example.test/v1",
          id: "provider-openai",
          models: ["gpt-5.1"],
          name: "OpenAI",
          type: "openai",
        },
        {
          api_key: "sk-anthropic",
          base_url: "",
          id: "provider-anthropic",
          models: ["claude-sonnet-4-5"],
          name: "Anthropic",
          type: "anthropic",
        },
      ] satisfies TestProvider[],
      settings: {
        reasoning_effort: "default",
        selected_model: "claude-sonnet-4-5",
        selected_provider_id: "provider-anthropic",
      },
    });

    render(<App />);
    await user.click(await screen.findByRole("tab", { name: "Providers" }));
    await user.click(screen.getByRole("button", { name: "Anthropic" }));
    await user.click(screen.getByRole("button", { name: "Remove" }));

    await waitFor(() => {
      expect(
        screen.queryByRole("button", { name: "Anthropic" }),
      ).not.toBeInTheDocument();
    });
    expect(screen.getByRole("textbox", { name: "Provider name" })).toHaveValue(
      "OpenAI",
    );
    await user.click(screen.getByRole("tab", { name: "Settings" }));

    expect(
      screen.getByRole("combobox", { name: "Provider" }),
    ).toHaveTextContent("OpenAI");
    expect(screen.getByRole("combobox", { name: "Model" })).toHaveTextContent(
      "gpt-5.1",
    );
    expect(window.fetch).toHaveBeenCalledWith(
      "/api/settings",
      expect.objectContaining({
        body: JSON.stringify({
          agent_prompt: "",
          context_window_limit: null,
          reasoning_effort: "default",
          selected_model: "gpt-5.1",
          selected_provider_id: "provider-openai",
        }),
        method: "PUT",
      }),
    );
  });

  it("clears the Settings provider and model when the last provider is removed", async () => {
    const user = userEvent.setup();
    mockInitialState(selectedProviderState());

    render(<App />);
    await user.click(await screen.findByRole("tab", { name: "Providers" }));
    await user.click(screen.getByRole("button", { name: "OpenAI" }));
    await user.click(screen.getByRole("button", { name: "Remove" }));

    await waitFor(() => {
      expect(screen.getByText("No providers")).toBeInTheDocument();
    });
    expect(screen.getByRole("textbox", { name: "Provider name" })).toHaveValue(
      "",
    );
    await user.click(screen.getByRole("tab", { name: "Settings" }));

    expect(
      screen.getByRole("combobox", { name: "Provider" }),
    ).toHaveTextContent("No providers");
    expect(screen.getByRole("combobox", { name: "Provider" })).toBeDisabled();
    expect(screen.getByRole("combobox", { name: "Model" })).toHaveTextContent(
      "No models",
    );
    expect(screen.getByRole("combobox", { name: "Model" })).toBeDisabled();
    expect(window.fetch).toHaveBeenCalledWith(
      "/api/providers/provider-openai",
      expect.objectContaining({ method: "DELETE" }),
    );
    expect(window.fetch).toHaveBeenCalledWith(
      "/api/settings",
      expect.objectContaining({
        body: JSON.stringify({
          agent_prompt: "",
          context_window_limit: null,
          reasoning_effort: "default",
          selected_model: "",
          selected_provider_id: "",
        }),
        method: "PUT",
      }),
    );
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

  it("adds a writable path from Permissions", async () => {
    const user = userEvent.setup();
    mockInitialState(selectedProviderState());
    render(<App />);

    await user.click(screen.getByRole("tab", { name: "Permissions" }));
    await user.type(
      screen.getByLabelText("Directory path"),
      "/workspace/.cache/pnpm",
    );
    await user.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() => {
      expect(screen.getByText("/workspace/.cache/pnpm")).toBeInTheDocument();
    });
    expect(window.fetch).toHaveBeenCalledWith(
      "/api/permissions/writable-paths",
      expect.objectContaining({
        body: JSON.stringify({ path: "/workspace/.cache/pnpm" }),
        method: "POST",
      }),
    );
    expect(screen.getByLabelText("Directory path")).toHaveValue("");
    expect(screen.queryByText("No paths")).not.toBeInTheDocument();
  });

  it("blocks duplicate writable paths from Permissions", async () => {
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
    await user.type(
      screen.getByLabelText("Directory path"),
      " /workspace/.cache/pnpm ",
    );
    await user.click(screen.getByRole("button", { name: "Add" }));

    expect(screen.getByText("Path already exists")).toBeInTheDocument();
    expect(window.fetch).not.toHaveBeenCalledWith(
      "/api/permissions/writable-paths",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("keeps Add disabled when the writable path input is empty", async () => {
    const user = userEvent.setup();
    mockInitialState(selectedProviderState());
    render(<App />);

    await user.click(screen.getByRole("tab", { name: "Permissions" }));

    expect(screen.getByRole("button", { name: "Add" })).toBeDisabled();

    await user.type(screen.getByLabelText("Directory path"), "   ");

    expect(screen.getByRole("button", { name: "Add" })).toBeDisabled();
    expect(window.fetch).not.toHaveBeenCalledWith(
      "/api/permissions/writable-paths",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("shows an error when a writable path cannot be added", async () => {
    const user = userEvent.setup();
    mockInitialState(selectedProviderState());
    vi.mocked(window.fetch).mockImplementation(async (input, init) => {
      if (input === "/api/state") {
        return new Response(JSON.stringify(selectedProviderState()), {
          headers: { "Content-Type": "application/json" },
          status: 200,
        });
      }

      if (
        input === "/api/permissions/writable-paths" &&
        init?.method === "POST"
      ) {
        return new Response(null, { status: 500 });
      }

      return new Response(null, { status: 404 });
    });
    render(<App />);

    await user.click(screen.getByRole("tab", { name: "Permissions" }));
    await user.type(screen.getByLabelText("Directory path"), "/tmp/cache");
    await user.click(screen.getByRole("button", { name: "Add" }));

    expect(
      await screen.findByText("Directory could not be added."),
    ).toBeInTheDocument();
    expect(screen.queryByText("/tmp/cache")).not.toBeInTheDocument();
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
    await waitFor(() => {
      expect(
        screen.getByRole("combobox", { name: "Enabled" }),
      ).toHaveTextContent("On");
    });
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

  it("shows the selected Telegram Bot enabled value", async () => {
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
    await user.click(screen.getByRole("combobox", { name: "Enabled" }));
    await user.click(screen.getByRole("option", { name: "On" }));

    await waitFor(() => {
      expect(
        screen.getByRole("combobox", { name: "Enabled" }),
      ).toHaveTextContent("On");
    });
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
    await waitFor(() => {
      expect(screen.getByRole("combobox", { name: "Type" })).toHaveTextContent(
        "URL",
      );
    });
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

  it("shows the selected MCP server type", async () => {
    const user = userEvent.setup();
    mockInitialState(selectedProviderState());
    render(<App />);

    await user.click(await screen.findByRole("tab", { name: "MCP" }));
    await user.click(screen.getByRole("combobox", { name: "Type" }));
    await user.click(screen.getByRole("option", { name: "URL" }));

    await waitFor(() => {
      expect(screen.getByRole("combobox", { name: "Type" })).toHaveTextContent(
        "URL",
      );
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
            result: {
              output: "MCP file content",
              raw_result: {
                content: [{ text: "MCP file content", type: "text" }],
                isError: false,
              },
              server: "Files",
              tool: "read_file",
              type: "mcp",
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
            result: {
              output: "Permission denied",
              raw_result: {
                content: [{ text: "Permission denied", type: "text" }],
                isError: true,
              },
              server: "Files",
              tool: "read_file",
              type: "mcp",
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

    const toolDetails = await screen.findByRole("button", {
      name: /Calling Files\.read_file/,
    });
    expect(await screen.findByText("Failed")).toBeInTheDocument();
    expect(toolDetails).toHaveAttribute("aria-expanded", "false");
    expect(document.body).not.toHaveTextContent("RESULT");
    expect(document.body).not.toHaveTextContent("Permission denied");

    await user.click(toolDetails);

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
          context_window_limit: null,
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
          context_window_limit: null,
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
        id: "tool-1",
        name: "shell_command",
        result: null,
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

  it("keeps a tool collapsed when it changes from running to failed", async () => {
    const user = userEvent.setup();
    const assistantStream = controlledToolTimelineResponse(
      {
        id: "tool-1",
        name: "read_file",
        output: "File not found",
        result: { path: "missing.txt", text: "File not found", type: "text" },
        status: "failed",
        title: "Reading missing.txt",
      },
      "I could not read it.",
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
    await user.type(composer, "Read the file");
    await user.click(screen.getByRole("button", { name: "Send message" }));

    const toolDetails = await screen.findByRole("button", {
      name: /Reading missing\.txt/,
    });
    expect(screen.getByText("Running")).toBeInTheDocument();
    expect(toolDetails).toHaveAttribute("aria-expanded", "false");

    assistantStream.completeTool();

    expect(await screen.findByText("Failed")).toBeInTheDocument();
    expect(toolDetails).toHaveAttribute("aria-expanded", "false");
    expect(document.body).not.toHaveTextContent("RESULT");
    expect(document.body).not.toHaveTextContent("File not found");
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

  it("loads persisted assistant output groups with separators", async () => {
    mockInitialState({
      messages: [
        {
          author: "assistant",
          content: "The notes are ready.",
          groups: [
            {
              id: "message-1-group-1",
              items: [
                {
                  id: "tool-tool-1",
                  tool: {
                    id: "tool-1",
                    name: "list_files",
                    status: "success",
                    title: "Listed /project/flowent",
                  },
                  type: "tool",
                },
              ],
            },
            {
              id: "message-1-group-2",
              items: [
                {
                  id: "tool-tool-2",
                  tool: {
                    id: "tool-2",
                    name: "read_file",
                    status: "success",
                    title: "Read README.md",
                  },
                  type: "tool",
                },
              ],
            },
            {
              id: "message-1-group-3",
              items: [
                {
                  content: "The notes are ready.",
                  id: "message-1-text-1",
                  type: "text",
                },
              ],
            },
          ],
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
    expect(screen.getAllByTestId("assistant-output-separator")).toHaveLength(2);
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

  it("clears loaded context usage when Clear runs from the command menu", async () => {
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
      usage_info: contextUsageInfo(24_000, 120_000),
    });

    render(<App />);

    expect(await screen.findByText("24k / 120k")).toBeInTheDocument();
    const composer = await screen.findByRole("textbox", {
      name: "Message Flowent",
    });
    await user.type(composer, "/clear");
    await user.keyboard("{Enter}");

    expect(await screen.findByText("0 / 120k")).toBeInTheDocument();
    expect(screen.queryByText("24k / 120k")).toBeNull();
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

  it("keeps focus in the composer when command completion uses Tab", async () => {
    const user = userEvent.setup();
    mockInitialState(selectedProviderState());
    render(<App />);

    const composer = await screen.findByRole("textbox", {
      name: "Message Flowent",
    });
    await user.type(composer, "/cl");
    await user.keyboard("{Tab}");

    expect(composer).toHaveFocus();
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
      "/api/workspace/clear",
      expect.objectContaining({ method: "POST" }),
    );
    expect(fetchWasCalledWith("/api/workspace/respond", "POST")).toBe(false);
  });

  it("shows a notification and keeps messages when Clear fails", async () => {
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
      if (input === "/api/workspace/clear" && init?.method === "POST") {
        return new Response("{}", {
          headers: { "Content-Type": "application/json" },
          status: 500,
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
    await screen.findByText("Draft a launch checklist");
    await user.type(composer, "/clear");
    await user.keyboard("{Enter}");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Conversation could not be cleared.",
    );
    expect(screen.getByText("Draft a launch checklist")).toBeInTheDocument();
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
      if (input === "/api/workspace/clear" && init?.method === "POST") {
        return new Response(
          JSON.stringify({ messages: [], usage_info: null }),
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
    await expectDocumentText("First step");

    await user.type(composer, "/clear");
    await user.keyboard("{Enter}");
    assistantStream.finish();

    await waitFor(() => {
      expect(document.body).not.toHaveTextContent("Draft a launch checklist");
      expect(document.body).not.toHaveTextContent("First step");
      expect(document.body).not.toHaveTextContent("First step is ready.");
    });
    expect(window.fetch).toHaveBeenCalledWith(
      "/api/workspace/clear",
      expect.objectContaining({ method: "POST" }),
    );
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

    expectWorkspaceMessagePost("/api/workspace/respond", " /clear");
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
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Command not found.",
    );
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

  it("shows the compacted context block after Compact succeeds", async () => {
    const user = userEvent.setup();
    mockInitialState(selectedProviderState());
    render(<App />);

    const composer = await screen.findByRole("textbox", {
      name: "Message Flowent",
    });
    await user.type(composer, "/compact");
    await user.keyboard("{Enter}");

    const compactBlock = await screen.findByRole("button", {
      name: "Context compacted",
    });

    expect(compactBlock).toHaveAttribute("aria-expanded", "false");
    expect(
      screen.queryByText(
        "Keep the launch checklist and provider setup decisions.",
      ),
    ).toBeNull();

    await user.click(compactBlock);

    expect(compactBlock).toHaveAttribute("aria-expanded", "true");
    expect(
      await screen.findByText(
        "Keep the launch checklist and provider setup decisions.",
      ),
    ).toBeInTheDocument();
  });

  it("shows the optimized context block after automatic context optimization", async () => {
    const user = userEvent.setup();
    mockInitialState(selectedProviderState());
    vi.mocked(window.fetch).mockImplementation(async (input, init) => {
      if (input === "/api/workspace/respond" && init?.method === "POST") {
        return assistantOptimizedContextStreamResponse("Continuing.");
      }
      if (input === "/api/state") {
        return new Response(JSON.stringify(selectedProviderState()), {
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
    await user.type(composer, "Continue from there");
    await user.click(screen.getByRole("button", { name: "Send message" }));

    const optimizedBlock = await screen.findByRole("button", {
      name: "Context optimized",
    });
    expect(optimizedBlock).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Keep the latest optimized context.")).toBeNull();

    await user.click(optimizedBlock);

    expect(optimizedBlock).toHaveAttribute("aria-expanded", "true");
    expect(
      await screen.findByText("Keep the latest optimized context."),
    ).toBeInTheDocument();
    expect(await screen.findByText("Continuing.")).toBeInTheDocument();
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
    await screen.findByRole("button", { name: "Context compacted" });

    await user.type(composer, "Continue from there");
    await user.keyboard("{Enter}");

    expectWorkspaceMessagePost("/api/workspace/respond", "Continue from there");
    expect(
      screen.getByRole("button", { name: "Context compacted" }),
    ).toBeInTheDocument();
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
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Compact is unavailable while Flowent is responding.",
    );
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
        return compactStructuredErrorStreamResponse({
          detail: "provider stopped",
          id: "compact-message-error-1",
          message: "Context could not be compacted.",
          title: "Request failed",
          type: "error",
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
    await screen.findByText("Draft a launch checklist");
    await user.type(composer, "/compact");
    await user.keyboard("{Enter}");

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Request failed");
    expect(alert).toHaveTextContent("Context could not be compacted.");
    expect(alert).toHaveTextContent("provider stopped");
    expect(within(alert).getByRole("button", { name: "Retry" })).toBeEnabled();
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

  it("keeps focus in the composer when skill completion uses Tab", async () => {
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
    await user.keyboard("{Tab}");

    expect(composer).toHaveFocus();
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
