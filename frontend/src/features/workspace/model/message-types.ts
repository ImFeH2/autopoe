import type { ContextUsageInfo } from "@/features/workspace/model/context-usage-types";

export type ToolItemStatus = "failed" | "running" | "success" | "waiting";

export type ToolItem = {
  arguments?: Record<string, unknown> | null;
  id: string;
  name: string;
  result?: Record<string, unknown> | null;
  status: ToolItemStatus;
  title: string;
};

export type AssistantOutputItem =
  | {
      content: string;
      id: string;
      isStreaming?: boolean;
      type: "thinking";
    }
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
      tool: ToolItem;
      type: "tool";
    };

export type AssistantOutputGroup = {
  id: string;
  items: AssistantOutputItem[];
};

export type Message = {
  author: "assistant" | "system" | "user";
  active_output?: "text" | "thinking" | null;
  content: string;
  groups?: AssistantOutputGroup[];
  id: string;
  isStreamingThinking?: boolean;
  isStreamingText?: boolean;
  items?: AssistantOutputItem[];
  status?: "completed" | "failed" | "interrupted" | "running";
  summary?: string;
  thinking?: string;
  tools?: ToolItem[];
  usage_info?: ContextUsageInfo | null;
};

export type MessageEditAction = "resend" | "save";

export type MessageActionRequest = {
  action: MessageEditAction;
  content: string;
  messageId: string;
};

export type MessageErrorRetryRequest = {
  errorId: string;
  messageId: string;
};
