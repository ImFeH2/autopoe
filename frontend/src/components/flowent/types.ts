export type ViewId = "workspace" | "providers" | "settings";

export type ProviderKind =
  | "openai"
  | "openai_responses"
  | "anthropic"
  | "gemini";

export type ProviderOption = {
  id: ProviderKind;
  label: string;
};

export type Provider = {
  id: string;
  name: string;
  type: ProviderKind;
  baseUrl: string;
  apiKey: string;
  models: string[];
};

export type ToolItemStatus = "failed" | "running" | "success";

export type ToolItem = {
  arguments?: Record<string, unknown>;
  content?: string;
  data?: Record<string, unknown>;
  id: string;
  name: string;
  status: ToolItemStatus;
  title: string;
};

export type AssistantOutputItem =
  | {
      content: string;
      id: string;
      type: "text";
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
  content: string;
  groups?: AssistantOutputGroup[];
  id: string;
  isStreamingText?: boolean;
  items?: AssistantOutputItem[];
  tools?: ToolItem[];
};

export type WorkspaceCommandId = "clear" | "compact";

export type WorkspaceCommand = {
  description: string;
  id: WorkspaceCommandId;
  label: string;
  name: string;
};
