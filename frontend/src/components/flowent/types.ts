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

export type ContextUsage = {
  cached_input_tokens: number;
  input_tokens: number;
  output_tokens: number;
  reasoning_output_tokens: number;
  total_tokens: number;
};

export type ContextUsageInfo = {
  last_token_usage: ContextUsage;
  model_context_window?: number | null;
  total_token_usage: ContextUsage;
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

export type WorkspaceCommandId = "clear" | "compact";

export type WorkspaceCommand = {
  description: string;
  id: WorkspaceCommandId;
  label: string;
  name: string;
};
