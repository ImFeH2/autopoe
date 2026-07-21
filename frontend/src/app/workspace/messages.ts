import type { ApiMessage } from "@/app/api/types";
import type { ContextUsageInfo } from "@/features/workspace/model/context-usage-types";
import type {
  AssistantOutputGroup,
  AssistantOutputItem,
  Message,
  ToolItem,
} from "@/features/workspace/model/message-types";
import i18n from "@/i18n/i18n";
import { enWorkspace } from "@/i18n/locales/en/workspace";
import { zhCNWorkspace } from "@/i18n/locales/zh-CN/workspace";
import { createClientId } from "@/lib/utils";

const knownWorkspaceErrorCopy = new Set<string>([
  ...Object.values(enWorkspace.errors),
  ...Object.values(zhCNWorkspace.errors),
]);

export const assistantGroupsFromMessage = (
  message: Message,
): AssistantOutputGroup[] => {
  if (message.groups?.length) {
    return message.groups;
  }

  const thinkingItem: AssistantOutputItem | null = message.thinking
    ? {
        content: message.thinking,
        id: `${message.id}-thinking-existing`,
        isStreaming: false,
        type: "thinking",
      }
    : null;
  const toolItems: AssistantOutputItem[] = (message.tools ?? []).map(
    (tool) => ({
      id: `tool-${tool.id}`,
      tool,
      type: "tool",
    }),
  );
  const groups: AssistantOutputGroup[] = [];
  const processItems = [...(thinkingItem ? [thinkingItem] : []), ...toolItems];

  if (processItems.length) {
    groups.push({
      id: `${message.id}-process-existing`,
      items: processItems,
    });
  }
  if (message.content) {
    groups.push({
      id: `${message.id}-content-existing`,
      items: [
        {
          content: message.content,
          id: `${message.id}-text-existing`,
          type: "text",
        },
      ],
    });
  }

  return groups;
};

export const countAssistantOutputItems = (
  groups: AssistantOutputGroup[],
  type: AssistantOutputItem["type"],
) =>
  groups.flatMap((group) => group.items).filter((item) => item.type === type)
    .length;

export const latestAssistantOutputItem = (groups: AssistantOutputGroup[]) => {
  for (let groupIndex = groups.length - 1; groupIndex >= 0; groupIndex -= 1) {
    const items = groups[groupIndex]?.items ?? [];
    for (let itemIndex = items.length - 1; itemIndex >= 0; itemIndex -= 1) {
      const item = items[itemIndex];
      if (item) {
        return item;
      }
    }
  }

  return null;
};

export const trimAssistantMessageAtError = (
  message: Message,
  errorId: string,
): Message | null => {
  const nextGroups: AssistantOutputGroup[] = [];
  let foundError = false;
  for (const group of assistantGroupsFromMessage(message)) {
    const nextItems: AssistantOutputItem[] = [];
    for (const item of group.items) {
      if (item.type === "error" && item.id === errorId) {
        foundError = true;
        break;
      }
      nextItems.push(item);
    }
    if (foundError) {
      if (nextItems.length > 0) {
        nextGroups.push({ ...group, items: nextItems });
      }
      break;
    }
    nextGroups.push(group);
  }

  if (!foundError) {
    return null;
  }

  return {
    ...message,
    content: nextGroups
      .flatMap((group) => group.items)
      .filter((item) => item.type === "text")
      .map((item) => item.content)
      .join(""),
    groups: nextGroups,
    isStreamingText: false,
    isStreamingThinking: false,
    status: "running",
    thinking: nextGroups
      .flatMap((group) => group.items)
      .filter((item) => item.type === "thinking")
      .map((item) => item.content)
      .join(""),
    tools: nextGroups
      .flatMap((group) => group.items)
      .filter((item) => item.type === "tool")
      .map((item) => item.tool),
  };
};

export const streamErrorFromMessage = (
  message: string,
  assistantId: string,
): Extract<AssistantOutputItem, { type: "error" }> => ({
  id: `${assistantId || "assistant"}-error-1`,
  message,
  title: i18n.t("workspace.errors.responseInterrupted"),
  type: "error",
});

export const createWorkspaceErrorItem = (
  detail: string,
  id: string,
): Extract<AssistantOutputItem, { type: "error" }> => {
  const message = i18n.t("workspace.errors.requestFailedMessage");
  const title = i18n.t("workspace.errors.requestFailedTitle");

  return {
    id,
    message,
    title,
    type: "error",
    ...(detail && !knownWorkspaceErrorCopy.has(detail) ? { detail } : {}),
  };
};

export const createWorkspaceErrorMessage = (
  detail: string,
  id = createClientId("message"),
): Message => ({
  author: "assistant",
  content: "",
  groups: [
    {
      id: `${id}-errors`,
      items: [createWorkspaceErrorItem(detail, `${id}-error-1`)],
    },
  ],
  id,
  status: "failed",
});

export const appendWorkspaceErrorToMessage = (
  message: Message,
  detail: string,
  errorId: string,
): Message => ({
  ...message,
  active_output: null,
  groups: [
    ...(message.groups ?? []),
    {
      id: `${message.id}-errors`,
      items: [createWorkspaceErrorItem(detail, errorId)],
    },
  ],
  isStreamingText: false,
  isStreamingThinking: false,
  status: "failed",
});

export const createWorkspaceStreamErrorMessage = (
  outputError: Extract<AssistantOutputItem, { type: "error" }>,
  id = createClientId("message"),
): Message => ({
  author: "assistant",
  content: "",
  groups: [
    {
      id: `${id}-errors`,
      items: [
        {
          ...outputError,
          id: outputError.id || `${id}-error-1`,
        },
      ],
    },
  ],
  id,
  status: "failed",
});

export const messageHasErrorBlock = (message: Message) =>
  (message.groups ?? [])
    .flatMap((group) => group.items)
    .some((item) => item.type === "error");

export const messagesIncludeErrorBlockFrom = (
  messages: Message[],
  startIndex: number,
) =>
  messages
    .slice(startIndex)
    .some(
      (message) =>
        message.author === "assistant" && messageHasErrorBlock(message),
    );

export const latestUsageInfoFromMessages = (
  messages: ApiMessage[],
): ContextUsageInfo | null => {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const currentUsageInfo = messages[index]?.usage_info;
    if (currentUsageInfo) {
      return currentUsageInfo;
    }
  }
  return null;
};

export const isAbortError = (error: unknown) =>
  typeof error === "object" &&
  error !== null &&
  "name" in error &&
  error.name === "AbortError";

export class WorkspaceRequestError extends Error {}

export class WorkspaceStreamError extends Error {
  errorMessage: Message | null;
  outputError: Extract<AssistantOutputItem, { type: "error" }>;

  constructor(
    message: string,
    outputError: Extract<AssistantOutputItem, { type: "error" }>,
    errorMessage: Message | null,
  ) {
    super(message);
    this.errorMessage = errorMessage;
    this.outputError = outputError;
  }
}

export const previousUserMessage = (messages: Message[], fromIndex: number) => {
  for (let index = fromIndex; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.author === "user") {
      return message;
    }
  }
  return null;
};

export type WorkspaceToolUpdate = Pick<ToolItem, "id" | "status"> &
  Partial<ToolItem>;
