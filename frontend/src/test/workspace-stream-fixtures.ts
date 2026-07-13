import type { TestTool } from "@/test/app-fixtures";

export const assistantToolStreamResponse = (
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
