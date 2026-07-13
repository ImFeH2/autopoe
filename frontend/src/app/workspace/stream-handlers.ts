import type { ApiMessage } from "@/app/api/types";
import {
  assistantGroupsFromMessage,
  countAssistantOutputItems,
  latestAssistantOutputItem,
} from "@/app/workspace/messages";
import type { WorkspaceStreamHandlers } from "@/app/workspace/stream";
import type { ContextUsageInfo } from "@/features/workspace/model/context-usage-types";
import type {
  AssistantOutputGroup,
  AssistantOutputItem,
  Message,
  ToolItem,
} from "@/features/workspace/model/message-types";
import { createClientId } from "@/lib/utils";

type MutableValue<T> = {
  current: T;
};

type SetTrackedUsageInfo = (nextUsageInfo: ContextUsageInfo | null) => void;

type CreateWorkspaceStreamHandlersOptions = {
  baseMessages: Message[];
  messagesRef: MutableValue<Message[]>;
  responseEventIndexRef: MutableValue<number>;
  responseRun: number;
  responseRunRef: MutableValue<number>;
  setIsResponding: (isResponding: boolean) => void;
  setMessages: (messages: Message[]) => void;
  setTrackedUsageInfo: SetTrackedUsageInfo;
  usageInfoRef: MutableValue<ContextUsageInfo | null>;
};

export const createWorkspaceStreamHandlers = ({
  baseMessages,
  messagesRef,
  responseEventIndexRef,
  responseRun,
  responseRunRef,
  setIsResponding,
  setMessages,
  setTrackedUsageInfo,
  usageInfoRef,
}: CreateWorkspaceStreamHandlersOptions): WorkspaceStreamHandlers => {
  const latestMessage = baseMessages.at(-1);
  const existingAssistant =
    latestMessage?.author === "assistant" ? latestMessage : null;
  let assistantMessage: Message | null = existingAssistant;
  let assistantContent = existingAssistant?.content ?? "";
  let assistantId = existingAssistant?.id ?? "";
  let assistantThinking = existingAssistant?.thinking ?? "";
  let assistantThinkingItemId = "";
  let assistantThinkingItemIndex = 0;
  let assistantGroups: AssistantOutputGroup[] = existingAssistant
    ? assistantGroupsFromMessage(existingAssistant)
    : [];
  let assistantTextItemId =
    assistantGroups
      .flatMap((group) => group.items)
      .reverse()
      .find((item) => item.type === "text")?.id ?? "";
  let assistantTextItemIndex = countAssistantOutputItems(
    assistantGroups,
    "text",
  );
  let assistantIsStreamingThinking = false;
  let assistantIsStreamingText = false;
  let assistantTools: ToolItem[] = existingAssistant?.tools ?? [];
  let latestUsageInfo = usageInfoRef.current;
  let pendingAssistantUpdateFrame: number | null = null;
  const nextMessages = existingAssistant
    ? baseMessages.slice(0, -1)
    : baseMessages;
  const isCurrentResponse = () => responseRunRef.current === responseRun;
  const setAssistantMessages = () => {
    const nextState = assistantMessage
      ? [...nextMessages, assistantMessage]
      : [...nextMessages];
    messagesRef.current = nextState;
    setMessages(nextState);
  };
  const cancelPendingAssistantUpdate = () => {
    if (pendingAssistantUpdateFrame === null) {
      return;
    }
    window.cancelAnimationFrame(pendingAssistantUpdateFrame);
    pendingAssistantUpdateFrame = null;
  };
  const flushAssistantUpdate = () => {
    cancelPendingAssistantUpdate();
    setAssistantMessages();
  };
  const scheduleAssistantUpdate = () => {
    if (!isCurrentResponse()) {
      return;
    }
    if (pendingAssistantUpdateFrame !== null) {
      return;
    }
    pendingAssistantUpdateFrame = window.requestAnimationFrame(() => {
      pendingAssistantUpdateFrame = null;
      if (!isCurrentResponse()) {
        return;
      }
      setAssistantMessages();
    });
  };
  const appendSystemMessage = (message: ApiMessage) => {
    if (!isCurrentResponse()) {
      return;
    }
    flushAssistantUpdate();
    nextMessages.push(message);
    if (assistantMessage) {
      setAssistantMessages();
      return;
    }
    setAssistantMessages();
  };
  const updateAssistantMessage = (options: { immediate?: boolean } = {}) => {
    if (!assistantId || !isCurrentResponse()) {
      return;
    }
    assistantMessage = {
      author: "assistant",
      content: assistantContent,
      id: assistantId,
      groups: assistantGroups,
      thinking: assistantThinking,
      isStreamingThinking: assistantIsStreamingThinking,
      tools: assistantTools,
      isStreamingText: assistantIsStreamingText,
      usage_info: latestUsageInfo,
    };
    if (options.immediate) {
      flushAssistantUpdate();
      return;
    }
    scheduleAssistantUpdate();
  };
  const finishAssistantThinking = () => {
    if (!assistantIsStreamingThinking) {
      return;
    }
    assistantIsStreamingThinking = false;
    assistantGroups = assistantGroups.map((group) => ({
      ...group,
      items: group.items.map((item) =>
        item.type === "thinking" ? { ...item, isStreaming: false } : item,
      ),
    }));
  };
  const createAssistantGroup = (index: number) => {
    const groupId = `${assistantId || "assistant"}-group-${index}`;
    if (assistantGroups.at(-1)?.id === groupId) {
      return;
    }
    finishAssistantThinking();
    assistantTextItemId = "";
    assistantIsStreamingText = false;
    assistantGroups = [...assistantGroups, { id: groupId, items: [] }];
  };
  const ensureAssistantGroup = () => {
    if (assistantGroups.length === 0) {
      createAssistantGroup(1);
    }
  };
  const updateCurrentAssistantGroupItems = (
    updater: (items: AssistantOutputItem[]) => AssistantOutputItem[],
  ) => {
    ensureAssistantGroup();
    const currentGroupIndex = assistantGroups.length - 1;
    assistantGroups = assistantGroups.map((group, index) =>
      index === currentGroupIndex
        ? { ...group, items: updater(group.items) }
        : group,
    );
  };
  const appendAssistantThinking = (content: string) => {
    assistantTextItemId = "";
    assistantIsStreamingText = false;
    if (!assistantThinkingItemId) {
      assistantThinkingItemIndex += 1;
      assistantThinkingItemId = `${assistantId}-thinking-${assistantThinkingItemIndex}`;
      updateCurrentAssistantGroupItems((items) => [
        ...items,
        {
          content: "",
          id: assistantThinkingItemId,
          isStreaming: true,
          type: "thinking",
        },
      ]);
    }

    assistantThinking += content;
    assistantIsStreamingThinking = true;
    updateCurrentAssistantGroupItems((items) =>
      items.map((item) =>
        item.type === "thinking" && item.id === assistantThinkingItemId
          ? {
              ...item,
              content: item.content + content,
              isStreaming: true,
            }
          : item,
      ),
    );
    updateAssistantMessage();
  };
  const appendAssistantText = (content: string) => {
    finishAssistantThinking();
    if (!assistantTextItemId) {
      assistantTextItemIndex += 1;
      assistantTextItemId = `${assistantId}-text-${assistantTextItemIndex}`;
      updateCurrentAssistantGroupItems((items) => [
        ...items,
        {
          content: "",
          id: assistantTextItemId,
          type: "text",
        },
      ]);
    }

    assistantContent += content;
    updateCurrentAssistantGroupItems((items) =>
      items.map((item) =>
        item.type === "text" && item.id === assistantTextItemId
          ? { ...item, content: item.content + content }
          : item,
      ),
    );
    assistantIsStreamingText = true;
    updateAssistantMessage();
  };
  const appendAssistantError = (
    error: Extract<AssistantOutputItem, { type: "error" }>,
  ) => {
    finishAssistantThinking();
    assistantTextItemId = "";
    assistantIsStreamingText = false;
    const isErrorAlreadyApplied =
      Boolean(error.id) &&
      assistantGroups
        .flatMap((group) => group.items)
        .some((item) => item.type === "error" && item.id === error.id);
    if (!isErrorAlreadyApplied) {
      updateCurrentAssistantGroupItems((items) => [...items, error]);
    }
    if (!isCurrentResponse()) {
      return null;
    }
    const resolvedAssistantId = assistantId || createClientId("message");
    assistantId = resolvedAssistantId;
    const hasTextItem = assistantGroups
      .flatMap((group) => group.items)
      .some((item) => item.type === "text");
    if (assistantContent && !hasTextItem) {
      assistantGroups = [
        {
          id: `${resolvedAssistantId}-content`,
          items: [
            {
              content: assistantContent,
              id: `${resolvedAssistantId}-text-1`,
              type: "text",
            },
          ],
        },
        ...assistantGroups,
      ];
    }
    assistantMessage = {
      author: "assistant",
      content: assistantContent,
      groups: assistantGroups,
      id: resolvedAssistantId,
      isStreamingText: false,
      isStreamingThinking: false,
      status: "failed",
      thinking: assistantThinking,
      tools: assistantTools,
      usage_info: latestUsageInfo,
    };
    flushAssistantUpdate();
    return assistantMessage;
  };
  const updateAssistantTool = (
    toolId: string,
    updater: (tool: ToolItem) => ToolItem,
  ) => {
    let updatedTool: ToolItem | null = null;
    assistantTools = assistantTools.map((currentTool) => {
      if (currentTool.id !== toolId) {
        return currentTool;
      }
      updatedTool = updater(currentTool);
      return updatedTool;
    });
    assistantGroups = assistantGroups.map((group) => ({
      ...group,
      items: group.items.map((item) =>
        item.type === "tool" && item.tool.id === toolId
          ? { ...item, tool: updatedTool ?? updater(item.tool) }
          : item,
      ),
    }));
  };
  const assistantGroupsThinking = () =>
    assistantGroups
      .flatMap((group) => group.items)
      .filter((item) => item.type === "thinking")
      .map((item) => item.content)
      .join("");
  const assistantGroupsText = () =>
    assistantGroups
      .flatMap((group) => group.items)
      .filter((item) => item.type === "text")
      .map((item) => item.content)
      .join("");
  const lastAssistantItemId = (type: AssistantOutputItem["type"]) =>
    assistantGroups
      .flatMap((group) => group.items)
      .reverse()
      .find((item) => item.type === type)?.id ?? "";
  const applyAssistantSnapshot = (
    message: ApiMessage,
    streaming = message.author === "assistant" && message.status === "running",
  ) => {
    if (!isCurrentResponse() || message.author !== "assistant") {
      return;
    }
    assistantId = message.id;
    assistantContent = message.content;
    assistantThinking = message.thinking ?? "";
    assistantGroups = assistantGroupsFromMessage(message);
    assistantTools = message.tools ?? [];
    latestUsageInfo = message.usage_info ?? latestUsageInfo;
    if (message.usage_info) {
      setTrackedUsageInfo(message.usage_info);
    }
    assistantTextItemId = lastAssistantItemId("text");
    assistantThinkingItemId = lastAssistantItemId("thinking");
    assistantTextItemIndex = countAssistantOutputItems(assistantGroups, "text");
    assistantThinkingItemIndex = countAssistantOutputItems(
      assistantGroups,
      "thinking",
    );
    assistantIsStreamingText =
      message.active_output === "text" &&
      streaming &&
      latestAssistantOutputItem(assistantGroups)?.type === "text";
    assistantIsStreamingThinking =
      message.active_output === "thinking" &&
      streaming &&
      assistantThinking.length > 0;
    assistantGroups = assistantGroups.map((group) => ({
      ...group,
      items: group.items.map((item) =>
        item.type === "thinking"
          ? { ...item, isStreaming: assistantIsStreamingThinking }
          : item,
      ),
    }));
    assistantMessage = {
      ...message,
      groups: assistantGroups,
      isStreamingThinking: assistantIsStreamingThinking,
      isStreamingText: assistantIsStreamingText,
      thinking: assistantThinking,
      tools: assistantTools,
      usage_info: latestUsageInfo,
    };
    flushAssistantUpdate();
  };
  const hasAssistantOutputSnapshot = (message: ApiMessage) =>
    Boolean(
      message.groups?.length ||
        message.items?.length ||
        message.tools?.length ||
        (message.status && message.status !== "completed"),
    );
  const finishAssistantFromLegacyDone = (message: ApiMessage) => {
    if (hasAssistantOutputSnapshot(message) || assistantGroups.length === 0) {
      applyAssistantSnapshot(message, false);
      return;
    }
    assistantId = message.id;
    assistantContent = message.content;
    const messageThinking = message.thinking ?? "";
    assistantThinking = messageThinking || assistantThinking;
    finishAssistantThinking();
    const streamedThinking = assistantGroupsThinking();
    if (messageThinking && streamedThinking !== messageThinking) {
      const missingThinking = messageThinking.startsWith(streamedThinking)
        ? messageThinking.slice(streamedThinking.length)
        : messageThinking;
      assistantThinkingItemIndex += 1;
      updateCurrentAssistantGroupItems((items) => [
        ...items,
        {
          content: missingThinking,
          id: `${message.id}-thinking-${assistantThinkingItemIndex}`,
          isStreaming: false,
          type: "thinking",
        },
      ]);
    }
    const streamedText = assistantGroupsText();
    if (message.content && streamedText !== message.content) {
      assistantTextItemIndex += 1;
      updateCurrentAssistantGroupItems((items) => [
        ...items,
        {
          content: message.content.startsWith(streamedText)
            ? message.content.slice(streamedText.length)
            : message.content,
          id: `${message.id}-text-${assistantTextItemIndex}`,
          type: "text",
        },
      ]);
    }
    assistantMessage = {
      ...message,
      groups: assistantGroups,
      isStreamingThinking: false,
      isStreamingText: false,
      thinking: assistantThinking,
      tools: assistantTools,
      usage_info: message.usage_info ?? latestUsageInfo,
    };
    flushAssistantUpdate();
  };

  return {
    onContextOptimized: appendSystemMessage,
    onDelta: (content) => {
      if (!isCurrentResponse()) {
        return;
      }
      appendAssistantText(content);
    },
    onDone: (message) => {
      if (!isCurrentResponse()) {
        return;
      }
      finishAssistantFromLegacyDone(message);
      cancelPendingAssistantUpdate();
      responseEventIndexRef.current = 0;
      setIsResponding(false);
    },
    onError: (error) => {
      if (!isCurrentResponse()) {
        return;
      }
      return appendAssistantError(
        error.id ? error : { ...error, id: `${assistantId}-error-1` },
      );
    },
    onOutputDone: () => {
      if (!isCurrentResponse()) {
        return;
      }
      finishAssistantThinking();
      assistantTextItemId = "";
      assistantIsStreamingText = false;
      updateAssistantMessage({ immediate: true });
    },
    onOutputStart: (index) => {
      if (!isCurrentResponse()) {
        return;
      }
      createAssistantGroup(index);
      updateAssistantMessage();
    },
    onSnapshot: applyAssistantSnapshot,
    onStart: (id) => {
      if (!isCurrentResponse()) {
        return;
      }
      assistantId = id;
      updateAssistantMessage();
    },
    onThinkingDelta: (content) => {
      if (!isCurrentResponse()) {
        return;
      }
      appendAssistantThinking(content);
    },
    onToolDone: (tool) => {
      if (!isCurrentResponse()) {
        return;
      }
      finishAssistantThinking();
      assistantTextItemId = "";
      assistantIsStreamingText = false;
      updateAssistantTool(tool.id, (currentTool) => ({
        ...currentTool,
        ...tool,
      }));
      updateAssistantMessage();
    },
    onToolStart: (tool) => {
      if (!isCurrentResponse()) {
        return;
      }
      finishAssistantThinking();
      assistantTextItemId = "";
      assistantIsStreamingText = false;
      assistantTools = [...assistantTools, tool];
      updateCurrentAssistantGroupItems((items) => [
        ...items,
        {
          id: `tool-${tool.id}`,
          tool,
          type: "tool",
        },
      ]);
      updateAssistantMessage();
    },
    onUsage: (nextUsageInfo) => {
      if (!isCurrentResponse()) {
        return;
      }
      latestUsageInfo = nextUsageInfo;
      setTrackedUsageInfo(nextUsageInfo);
      updateAssistantMessage({ immediate: true });
    },
    onEventIndex: (eventIndex) => {
      if (!isCurrentResponse()) {
        return;
      }
      responseEventIndexRef.current = eventIndex;
    },
  };
};
