import type { ApiMessage } from "@/app/api/types";
import {
  streamErrorFromMessage,
  WorkspaceStreamError,
  type WorkspaceToolUpdate,
} from "@/app/workspace/messages";
import type {
  AssistantOutputItem,
  ContextUsageInfo,
  Message,
  ToolItem,
} from "@/components/flowent/types";

export type WorkspaceStreamEvent =
  | {
      data: {
        id: string;
      };
      event: "start";
    }
  | {
      data: {
        index: number;
      };
      event: "output_start";
    }
  | {
      data: {
        index: number;
      };
      event: "output_done";
    }
  | {
      data: {
        content: string;
      };
      event: "delta";
    }
  | {
      data: {
        content: string;
      };
      event: "thinking_delta";
    }
  | {
      data: {
        message: ApiMessage;
      };
      event: "snapshot";
    }
  | {
      data: {
        message: ApiMessage;
      };
      event: "done";
    }
  | {
      data: {
        message: ApiMessage;
        usage_info?: ContextUsageInfo;
      };
      event: "context_optimized";
    }
  | {
      data: {
        usage_info: ContextUsageInfo;
      };
      event: "usage";
    }
  | {
      data: {
        tool: ToolItem;
      };
      event: "tool_start";
    }
  | {
      data: WorkspaceToolUpdate;
      event: "tool_update";
    }
  | {
      data: WorkspaceToolUpdate;
      event: "tool_done" | "tool_error";
    }
  | {
      data: {
        error?: Extract<AssistantOutputItem, { type: "error" }>;
        message: string;
      };
      event: "error";
    };

export type WorkspaceStreamEventEnvelope = WorkspaceStreamEvent & {
  eventIndex?: number;
};

export type WorkspaceStreamHandlers = {
  onEventIndex: (eventIndex: number) => void;
  onContextOptimized: (message: ApiMessage) => void;
  onDelta: (content: string) => void;
  onDone: (message: ApiMessage) => void;
  onError: (
    error: Extract<AssistantOutputItem, { type: "error" }>,
  ) => Message | null | void;
  onOutputDone: () => void;
  onOutputStart: (index: number) => void;
  onSnapshot: (message: ApiMessage) => void;
  onStart: (id: string) => void;
  onThinkingDelta: (content: string) => void;
  onToolDone: (tool: WorkspaceToolUpdate) => void;
  onToolStart: (tool: ToolItem) => void;
  onUsage: (usageInfo: ContextUsageInfo) => void;
};

export const parseWorkspaceStreamEvent = (
  rawEvent: string,
): WorkspaceStreamEventEnvelope => {
  const lines = rawEvent.split("\n");
  const id = lines.find((line) => line.startsWith("id: "))?.slice(4);
  const event = lines
    .find((line) => line.startsWith("event: "))
    ?.slice("event: ".length);
  const data = lines
    .find((line) => line.startsWith("data: "))
    ?.slice("data: ".length);

  if (!event || !data) {
    throw new Error("Message could not be sent.");
  }

  const eventIndex = id ? Number(id) : undefined;
  return {
    data: JSON.parse(data) as WorkspaceStreamEvent["data"],
    event,
    eventIndex: Number.isSafeInteger(eventIndex) ? eventIndex : undefined,
  } as WorkspaceStreamEventEnvelope;
};

export const readWorkspaceStream = async (
  response: Response,
  handlers: WorkspaceStreamHandlers,
) => {
  if (!response.body) {
    throw new Error("Message could not be sent.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const events = buffer.split("\n\n");
    buffer = events.pop() ?? "";

    for (const rawEvent of events) {
      if (!rawEvent.trim()) {
        continue;
      }

      const streamEvent = parseWorkspaceStreamEvent(rawEvent);
      if (streamEvent.eventIndex !== undefined) {
        handlers.onEventIndex(streamEvent.eventIndex);
      }
      if (streamEvent.event === "start") {
        handlers.onStart(streamEvent.data.id);
      }
      if (streamEvent.event === "output_start") {
        handlers.onOutputStart(streamEvent.data.index);
      }
      if (streamEvent.event === "output_done") {
        handlers.onOutputDone();
      }
      if (streamEvent.event === "delta") {
        handlers.onDelta(streamEvent.data.content);
      }
      if (streamEvent.event === "thinking_delta") {
        handlers.onThinkingDelta(streamEvent.data.content);
      }
      if (streamEvent.event === "snapshot") {
        handlers.onSnapshot(streamEvent.data.message);
      }
      if (streamEvent.event === "context_optimized") {
        if (streamEvent.data.usage_info) {
          handlers.onUsage(streamEvent.data.usage_info);
        }
        handlers.onContextOptimized(streamEvent.data.message);
      }
      if (streamEvent.event === "usage") {
        handlers.onUsage(streamEvent.data.usage_info);
      }
      if (streamEvent.event === "done") {
        handlers.onDone(streamEvent.data.message);
        return;
      }
      if (streamEvent.event === "tool_start") {
        handlers.onToolStart(streamEvent.data.tool);
      }
      if (
        streamEvent.event === "tool_update" ||
        streamEvent.event === "tool_done" ||
        streamEvent.event === "tool_error"
      ) {
        handlers.onToolDone(streamEvent.data);
      }
      if (streamEvent.event === "error") {
        const outputError =
          streamEvent.data.error ??
          streamErrorFromMessage(streamEvent.data.message, "");
        const errorMessage = handlers.onError(outputError) ?? null;
        throw new WorkspaceStreamError(
          streamEvent.data.message,
          outputError,
          errorMessage,
        );
      }
    }

    if (done) {
      break;
    }
  }

  throw new Error("Message could not be sent.");
};
