import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { contextWindowFromLimit } from "@/app/api/mappers";
import type { ApiMessage, ApiState } from "@/app/api/types";
import {
  createWorkspaceErrorMessage,
  createWorkspaceStreamErrorMessage,
  appendWorkspaceErrorToMessage,
  isAbortError,
  latestUsageInfoFromMessages,
  messagesIncludeErrorBlockFrom,
  previousUserMessage,
  trimAssistantMessageAtError,
  WorkspaceRequestError,
  WorkspaceStreamError,
} from "@/app/workspace/messages";
import {
  clearWorkspace,
  compactWorkspaceRequest,
  editWorkspaceMessage,
  requestWorkspaceResponse,
  retryWorkspaceError,
  stopWorkspaceResponse,
  streamWorkspaceResponse,
} from "@/app/workspace/requests";
import { createWorkspaceStreamHandlers as createWorkspaceStreamHandlersForResponse } from "@/app/workspace/stream-handlers";
import {
  readWorkspaceStream,
  type WorkspaceStreamHandlers,
} from "@/app/workspace/stream";
import type {
  WorkspaceCommand,
  WorkspaceCommandId,
} from "@/features/workspace/model/command-types";
import type { ContextUsageInfo } from "@/features/workspace/model/context-usage-types";
import type {
  Message,
  MessageActionRequest,
  MessageErrorRetryRequest,
} from "@/features/workspace/model/message-types";
import i18n from "@/i18n/i18n";
import { enWorkspace } from "@/i18n/locales/en/workspace";
import { createClientId } from "@/lib/utils";

type TrackedUsageInfoUpdate =
  | ContextUsageInfo
  | null
  | ((currentUsageInfo: ContextUsageInfo | null) => ContextUsageInfo | null);

type UseWorkspaceControllerOptions = {
  refreshAppState: () => Promise<ApiState | null>;
  showError: (message: string) => void;
};

type LoadWorkspaceStateOptions = {
  reconnectIfResponding?: boolean;
};

export function useWorkspaceController({
  refreshAppState,
  showError,
}: UseWorkspaceControllerOptions) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [usageInfo, setUsageInfo] = useState<ContextUsageInfo | null>(null);
  const usageInfoRef = useRef<ContextUsageInfo | null>(null);
  const [isResponding, setIsResponding] = useState(false);
  const [isRefiningContext, setIsRefiningContext] = useState(false);
  const responseAbortRef = useRef<AbortController | null>(null);
  const responseEventIndexRef = useRef(0);
  const messagesRef = useRef<Message[]>([]);
  const responseRunRef = useRef(0);
  const [streamReconnectKey, setStreamReconnectKey] = useState(0);

  const setTrackedUsageInfo = useCallback(
    (nextUsageInfo: TrackedUsageInfoUpdate) => {
      if (typeof nextUsageInfo !== "function") {
        usageInfoRef.current = nextUsageInfo;
        setUsageInfo(nextUsageInfo);
        return;
      }
      setUsageInfo((currentUsageInfo) => {
        const resolvedUsageInfo = nextUsageInfo(currentUsageInfo);
        usageInfoRef.current = resolvedUsageInfo;
        return resolvedUsageInfo;
      });
    },
    [],
  );

  const setContextWindowLimit = useCallback(
    (nextContextWindowLimit: number | null) => {
      setTrackedUsageInfo((currentUsageInfo) =>
        contextWindowFromLimit(currentUsageInfo, nextContextWindowLimit),
      );
    },
    [setTrackedUsageInfo],
  );

  const loadState = useCallback(
    (state: ApiState, options: LoadWorkspaceStateOptions = {}) => {
      const shouldResumeResponse = Boolean(state.is_responding);
      setMessages(state.messages);
      setTrackedUsageInfo(
        contextWindowFromLimit(
          state.usage_info ?? latestUsageInfoFromMessages(state.messages),
          state.settings.context_window_limit ?? null,
        ),
      );
      responseEventIndexRef.current = state.response_event_index ?? 0;
      setIsResponding(shouldResumeResponse);
      setIsRefiningContext(Boolean(state.is_compacting));
      if (options.reconnectIfResponding && shouldResumeResponse) {
        setStreamReconnectKey((current) => current + 1);
      }
      return { shouldResumeResponse };
    },
    [setTrackedUsageInfo],
  );

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    if (!isRefiningContext) {
      return;
    }

    const intervalId = window.setInterval(() => {
      void refreshAppState().catch(() => undefined);
    }, 1000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [isRefiningContext, refreshAppState]);

  const showWorkspaceNotification = useCallback(
    (message: string) => {
      showError(message);
    },
    [showError],
  );

  const createWorkspaceStreamHandlers = useCallback(
    (baseMessages: Message[], responseRun: number): WorkspaceStreamHandlers =>
      createWorkspaceStreamHandlersForResponse({
        baseMessages,
        messagesRef,
        responseEventIndexRef,
        responseRun,
        responseRunRef,
        setIsResponding,
        setMessages,
        setTrackedUsageInfo,
        usageInfoRef,
      }),
    [setTrackedUsageInfo],
  );

  useEffect(() => {
    if (streamReconnectKey === 0) {
      return;
    }

    const responseRun = responseRunRef.current || 1;
    responseRunRef.current = responseRun;
    const responseAbortController = new AbortController();
    responseAbortRef.current = responseAbortController;
    setIsResponding(true);

    const streamCurrentResponse = async () => {
      const handlers = createWorkspaceStreamHandlers(
        messagesRef.current,
        responseRun,
      );
      try {
        await streamWorkspaceResponse({
          after: responseEventIndexRef.current,
          handlers,
          signal: responseAbortController.signal,
        });
      } catch (error) {
        if (
          responseRunRef.current !== responseRun ||
          responseAbortController.signal.aborted
        ) {
          return;
        }
        const state = await refreshAppState().catch(() => null);
        if (state?.is_responding) {
          setStreamReconnectKey((current) => current + 1);
          return;
        }
        responseEventIndexRef.current = 0;
        setIsResponding(false);
        showWorkspaceNotification(
          error instanceof Error
            ? error.message
            : i18n.t("workspace.errors.messageCouldNotBeSent"),
        );
      } finally {
        if (responseRunRef.current === responseRun) {
          responseAbortRef.current = null;
        }
      }
    };

    void streamCurrentResponse();

    return () => {
      responseAbortController.abort();
    };
  }, [
    createWorkspaceStreamHandlers,
    refreshAppState,
    showWorkspaceNotification,
    streamReconnectKey,
  ]);

  const compactWorkspace = async () => {
    setIsRefiningContext(true);
    const compactErrorStartIndex = messages.length;

    const appendCompactMessage = (message: ApiMessage) => {
      setMessages((currentMessages) =>
        currentMessages.some(
          (currentMessage) => currentMessage.id === message.id,
        )
          ? currentMessages
          : [...currentMessages, message],
      );
    };
    const appendCompactSnapshot = (message: ApiMessage) => {
      setMessages((currentMessages) => {
        const messageIndex = currentMessages.findIndex(
          (currentMessage) => currentMessage.id === message.id,
        );
        if (messageIndex >= 0) {
          return currentMessages.map((currentMessage, index) =>
            index === messageIndex ? message : currentMessage,
          );
        }
        return [...currentMessages, message];
      });
    };

    try {
      const response = await compactWorkspaceRequest();

      await readWorkspaceStream(response, {
        onEventIndex: () => undefined,
        onContextOptimized: appendCompactMessage,
        onDelta: () => undefined,
        onDone: appendCompactMessage,
        onError: () => undefined,
        onOutputDone: () => undefined,
        onOutputStart: () => undefined,
        onSnapshot: appendCompactSnapshot,
        onStart: () => undefined,
        onThinkingDelta: () => undefined,
        onToolDone: () => undefined,
        onToolStart: () => undefined,
        onUsage: setTrackedUsageInfo,
      });
      setIsRefiningContext(false);
    } catch (error) {
      if (isAbortError(error)) {
        void refreshAppState().catch(() => undefined);
        return;
      }
      if (error instanceof WorkspaceStreamError) {
        setIsRefiningContext(false);
        return;
      }
      const detail =
        error instanceof Error
          ? error.message
          : i18n.t("workspace.errors.contextCouldNotBeCompacted");
      setMessages((currentMessages) =>
        messagesIncludeErrorBlockFrom(currentMessages, compactErrorStartIndex)
          ? currentMessages
          : [...currentMessages, createWorkspaceErrorMessage(detail)],
      );
      setIsRefiningContext(false);
    }
  };

  const workspaceCommands: WorkspaceCommand[] = useMemo(
    () => [
      {
        description: t("workspace.commands.clearDescription"),
        id: "clear",
        label: "/clear",
        name: "clear",
      },
      {
        description: t("workspace.commands.compactDescription"),
        id: "compact",
        label: "/compact",
        name: "compact",
      },
    ],
    [t],
  );

  const clearMessages = async () => {
    const previousMessages = messages;
    const previousUsageInfo = usageInfo;

    responseAbortRef.current?.abort();
    responseAbortRef.current = null;
    responseEventIndexRef.current = 0;
    responseRunRef.current += 1;
    setMessages([]);
    setTrackedUsageInfo(null);
    setIsResponding(false);

    try {
      const clearedState = await clearWorkspace();
      if (Array.isArray(clearedState.messages)) {
        setMessages(clearedState.messages);
      }
      setTrackedUsageInfo(clearedState.usage_info ?? null);
    } catch {
      setMessages(previousMessages);
      setTrackedUsageInfo(previousUsageInfo);
      showWorkspaceNotification(
        i18n.t("workspace.notifications.conversationCouldNotBeCleared"),
      );
    }
  };

  const runCommand = (commandId: WorkspaceCommandId) => {
    if (commandId === "clear") {
      void clearMessages();
      return true;
    }
    if (commandId === "compact") {
      if (isResponding) {
        showWorkspaceNotification(
          t("workspace.notifications.compactUnavailable"),
        );
        return false;
      }
      void compactWorkspace();
      return true;
    }
    return false;
  };

  const handleCommandError = (message: string) => {
    showWorkspaceNotification(message);
  };

  const workspaceErrorDetail = (error: unknown, fallback: string) =>
    error instanceof Error ? error.message : fallback;

  const appendWorkspaceErrorMessage = (
    baseMessages: Message[],
    error: unknown,
    fallback: string,
  ) => [
    ...baseMessages,
    createWorkspaceErrorMessage(workspaceErrorDetail(error, fallback)),
  ];

  const appendWorkspaceErrorToExistingMessage = (
    baseMessages: Message[],
    message: Message,
    errorId: string,
    error: unknown,
    fallback: string,
  ) => [
    ...baseMessages,
    appendWorkspaceErrorToMessage(
      message,
      workspaceErrorDetail(error, fallback),
      errorId,
    ),
  ];

  const stopResponse = () => {
    if (isResponding) {
      void stopWorkspaceResponse();
    }
    responseRunRef.current += 1;
    responseEventIndexRef.current = 0;
    responseAbortRef.current?.abort();
    responseAbortRef.current = null;
    setIsResponding(false);
  };

  const sendMessage = async (
    submittedDraft = draft,
    baseMessages = messages,
    options: { clearDraft?: boolean } = {},
  ) => {
    if (submittedDraft.length === 0 || isResponding || isRefiningContext) {
      return;
    }
    const shouldClearDraft = options.clearDraft ?? baseMessages === messages;

    const responseRun = responseRunRef.current + 1;
    const responseAbortController = new AbortController();
    responseAbortRef.current = responseAbortController;
    responseRunRef.current = responseRun;
    responseEventIndexRef.current = 0;
    const userContent = submittedDraft;
    const userMessageId = createClientId("message");
    const nextMessages: Message[] = [
      ...baseMessages,
      {
        author: "user",
        content: userContent,
        id: userMessageId,
      },
    ];
    setIsResponding(true);
    setMessages(nextMessages);
    if (shouldClearDraft) {
      setDraft("");
    }

    try {
      const handlers = createWorkspaceStreamHandlers(nextMessages, responseRun);
      await requestWorkspaceResponse({
        content: userContent,
        handlers,
        messageId: userMessageId,
        signal: responseAbortController.signal,
      });
    } catch (error) {
      if (responseRunRef.current !== responseRun) {
        return;
      }
      if (
        error instanceof DOMException &&
        error.name === "AbortError" &&
        responseAbortController.signal.aborted
      ) {
        return;
      }
      if (
        error instanceof Error &&
        (error.message === enWorkspace.errors.responseInProgress ||
          error.message === i18n.t("workspace.errors.responseInProgress"))
      ) {
        setMessages(baseMessages);
        if (shouldClearDraft) {
          setDraft(userContent);
        }
        setIsResponding(false);
        showWorkspaceNotification(error.message);
        return;
      }
      if (!(error instanceof WorkspaceRequestError)) {
        const state = await refreshAppState().catch(() => null);
        if (state?.is_responding) {
          setStreamReconnectKey((current) => current + 1);
          return;
        }
        if (
          state?.messages &&
          messagesIncludeErrorBlockFrom(state.messages, baseMessages.length)
        ) {
          setMessages(state.messages);
          setIsResponding(false);
          return;
        }
      }
      if (error instanceof WorkspaceStreamError) {
        setMessages([
          ...nextMessages,
          error.errorMessage ??
            createWorkspaceStreamErrorMessage(error.outputError),
        ]);
        setIsResponding(false);
        return;
      }
      setMessages((currentMessages) =>
        messagesIncludeErrorBlockFrom(currentMessages, baseMessages.length)
          ? currentMessages
          : appendWorkspaceErrorMessage(
              nextMessages,
              error,
              i18n.t("workspace.errors.messageCouldNotBeSent"),
            ),
      );
      setIsResponding(false);
    } finally {
      if (responseRunRef.current === responseRun) {
        responseAbortRef.current = null;
      }
    }
  };

  const startEditedResponse = (nextMessages: Message[]) => {
    responseRunRef.current += 1;
    responseEventIndexRef.current = 0;
    setMessages(nextMessages);
    setIsResponding(true);
    setStreamReconnectKey((current) => current + 1);
  };

  const retryMessage = async (messageId: string) => {
    if (isResponding) {
      return;
    }

    const messageIndex = messages.findIndex(
      (message) => message.id === messageId,
    );
    if (messageIndex < 0) {
      return;
    }

    const message = messages[messageIndex];
    const userMessage =
      message.author === "user"
        ? message
        : previousUserMessage(messages, messageIndex - 1);
    if (!userMessage) {
      return;
    }
    const userMessageIndex = messages.findIndex(
      (currentMessage) => currentMessage.id === userMessage.id,
    );

    setIsResponding(true);

    try {
      const result = await editWorkspaceMessage({
        action: "resend",
        content: userMessage.content,
        messageId: userMessage.id,
      });
      if (!result.is_responding) {
        throw new Error(i18n.t("workspace.errors.messageCouldNotBeSent"));
      }
      startEditedResponse(result.messages);
    } catch (error) {
      setMessages(
        appendWorkspaceErrorMessage(
          messages.slice(0, userMessageIndex + 1),
          error,
          i18n.t("workspace.errors.messageCouldNotBeUpdated"),
        ),
      );
      setIsResponding(false);
    }
  };

  const retryError = async ({
    errorId,
    messageId,
  }: MessageErrorRetryRequest) => {
    if (isResponding) {
      return;
    }

    const messageIndex = messages.findIndex(
      (message) => message.id === messageId,
    );
    if (messageIndex < 0 || messages[messageIndex].author !== "assistant") {
      return;
    }

    const trimmedMessage = trimAssistantMessageAtError(
      messages[messageIndex],
      errorId,
    );
    if (!trimmedMessage) {
      return;
    }

    const optimisticMessages = [
      ...messages.slice(0, messageIndex),
      trimmedMessage,
    ];
    setIsResponding(true);
    setMessages(optimisticMessages);

    try {
      const result = await retryWorkspaceError({ errorId, messageId });
      if (!result.is_responding) {
        throw new Error(i18n.t("workspace.errors.messageCouldNotBeSent"));
      }
      startEditedResponse(result.messages);
    } catch (error) {
      setMessages(
        appendWorkspaceErrorToExistingMessage(
          messages.slice(0, messageIndex),
          trimmedMessage,
          errorId,
          error,
          i18n.t("workspace.errors.messageCouldNotBeSent"),
        ),
      );
      setIsResponding(false);
    }
  };

  const editMessage = async ({
    action,
    content,
    messageId,
  }: MessageActionRequest) => {
    if (isResponding) {
      return;
    }

    const messageIndex = messages.findIndex(
      (message) => message.id === messageId,
    );
    if (messageIndex < 0 || messages[messageIndex].author !== "user") {
      return;
    }

    const previousMessages = messages;
    if (action === "resend") {
      setIsResponding(true);
    }

    try {
      const result = await editWorkspaceMessage({ action, content, messageId });
      if (action === "resend") {
        if (!result.is_responding) {
          throw new Error(i18n.t("workspace.errors.messageCouldNotBeSent"));
        }
        startEditedResponse(result.messages);
        return;
      }
      setMessages(result.messages);
    } catch (error) {
      setMessages(
        action === "resend"
          ? appendWorkspaceErrorMessage(
              [
                ...previousMessages.slice(0, messageIndex),
                {
                  ...previousMessages[messageIndex],
                  content,
                },
              ],
              error,
              i18n.t("workspace.errors.messageCouldNotBeUpdated"),
            )
          : previousMessages,
      );
      if (action === "resend") {
        setIsResponding(false);
      }
      if (action !== "resend") {
        showWorkspaceNotification(
          workspaceErrorDetail(
            error,
            i18n.t("workspace.errors.messageCouldNotBeUpdated"),
          ),
        );
      }
    }
  };

  return {
    commands: workspaceCommands,
    draft,
    editMessage,
    handleCommandError,
    isRefiningContext,
    isResponding,
    loadState,
    messages,
    retryError,
    retryMessage,
    runCommand,
    sendMessage,
    setContextWindowLimit,
    setDraft,
    stopResponse,
    usageInfo,
  };
}
