import {
  useSyncExternalStore,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type UIEvent,
} from "react";
import { toast } from "sonner";
import {
  clearAssistantChatRequest,
  fetchNodeDetail,
  interruptNode,
  retryAssistantMessageRequest,
  sendAssistantMessageRequest,
  uploadImageAssetRequest,
} from "@/lib/api";
import {
  useAgentActivityRuntime,
  useAgentConnectionRuntime,
  useAgentHistoryRuntime,
  useAgentNodesRuntime,
} from "@/context/AgentContext";
import { removePendingAssistantMessage } from "@/context/agentRuntimeState";
import { getAssistantNodeId } from "@/lib/assistant";
import {
  clearConversationHistory,
  mergeHistoryWithDeltas,
} from "@/lib/history";
import { contentPartsToText, normalizeContentParts } from "@/lib/contentParts";
import {
  appendAssistantInputHistoryEntry,
  getAssistantInputHistorySnapshot,
  subscribeAssistantInputHistory,
} from "@/lib/assistantInputHistory";
import {
  buildMessageParts,
  createPendingHumanMessage,
  createUploadingImageDrafts,
  draftImagesMatchHistoryEntry,
  isReadyDraftImage,
  isScrolledToBottom,
  revokeDraftImageUrl,
  revokeDraftImageUrls,
  toDraftImagesFromHistory,
  toInputHistoryImages,
  type DraftChatImage,
} from "@/hooks/chat/shared";
import type {
  AssistantChatItem,
  AssistantInputHistoryEntry,
  ContentPart,
  HistoryEntry,
  NodeDetail,
  PendingAssistantChatMessage,
} from "@/types";

interface UseAssistantChatOptions {
  bottomInset?: number;
}

export function useAssistantChat(options: UseAssistantChatOptions = {}) {
  const { bottomInset = 0 } = options;
  const { agents } = useAgentNodesRuntime();
  const { connected } = useAgentConnectionRuntime();
  const {
    agentHistories,
    clearAgentHistory,
    clearHistorySnapshot,
    historyInvalidatedAt,
    historyClearedAt,
    historySnapshots,
    streamingDeltas,
  } = useAgentHistoryRuntime();
  const { activeToolCalls } = useAgentActivityRuntime();
  const [detail, setDetail] = useState<NodeDetail | null>(null);
  const [fetchedAt, setFetchedAt] = useState(0);
  const [input, setInputState] = useState("");
  const [draftImages, setDraftImages] = useState<DraftChatImage[]>([]);
  const [historyCursor, setHistoryCursor] = useState<number | null>(null);
  const [clearing, setClearing] = useState(false);
  const [retryingMessageId, setRetryingMessageId] = useState<string | null>(
    null,
  );
  const [sending, setSending] = useState(false);
  const [pendingAssistantMessages, setPendingAssistantMessages] = useState<
    PendingAssistantChatMessage[]
  >([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const autoScrollRef = useRef(true);
  const draftImagesRef = useRef<DraftChatImage[]>([]);
  const assistantId = useMemo(() => getAssistantNodeId(agents), [agents]);
  const assistantNode = useMemo(
    () => (assistantId ? (agents.get(assistantId) ?? null) : null),
    [agents, assistantId],
  );
  const supportsInputImage = assistantNode?.capabilities?.input_image ?? false;
  const assistantHistoryClearedAt = assistantId
    ? (historyClearedAt.get(assistantId) ?? 0)
    : 0;
  const assistantHistoryInvalidatedAt = assistantId
    ? (historyInvalidatedAt.get(assistantId) ?? 0)
    : 0;
  const assistantHistorySnapshot = assistantId
    ? (historySnapshots.get(assistantId) ?? null)
    : null;
  const hasUploadingImages = draftImages.some(
    (image) => image.status === "uploading",
  );
  const readyImages = draftImages.filter(isReadyDraftImage);
  const inputHistoryEntries = useSyncExternalStore(
    subscribeAssistantInputHistory,
    getAssistantInputHistorySnapshot,
    getAssistantInputHistorySnapshot,
  );
  const currentHistoryEntry =
    historyCursor !== null
      ? (inputHistoryEntries[historyCursor] ?? null)
      : null;
  const isBrowsingInputHistory =
    currentHistoryEntry !== null &&
    input === currentHistoryEntry.text &&
    draftImagesMatchHistoryEntry(draftImages, currentHistoryEntry);

  const restoreHistoryEntry = useCallback(
    (entry: AssistantInputHistoryEntry | null, cursor: number | null) => {
      setHistoryCursor(cursor);
      setInputState(entry?.text ?? "");
      setDraftImages(entry ? toDraftImagesFromHistory(entry) : []);
    },
    [],
  );

  const setInput = useCallback((value: string) => {
    setHistoryCursor(null);
    setInputState(value);
  }, []);

  useEffect(() => {
    draftImagesRef.current = draftImages;
  }, [draftImages]);

  useEffect(
    () => () => {
      revokeDraftImageUrls(draftImagesRef.current);
    },
    [],
  );

  useEffect(() => {
    if (!assistantHistoryClearedAt) {
      return;
    }

    setPendingAssistantMessages([]);
    setDetail((current) =>
      current
        ? {
            ...current,
            history: clearConversationHistory(current.history),
          }
        : current,
    );
    setFetchedAt(Date.now());
  }, [assistantHistoryClearedAt]);

  useEffect(() => {
    if (!assistantHistoryInvalidatedAt) {
      return;
    }

    setPendingAssistantMessages([]);
    if (!assistantHistorySnapshot) {
      return;
    }
    setDetail((current) =>
      current
        ? {
            ...current,
            history: assistantHistorySnapshot,
          }
        : current,
    );
    setFetchedAt(Date.now());
  }, [assistantHistoryInvalidatedAt, assistantHistorySnapshot]);

  useEffect(() => {
    if (!connected || !assistantId) {
      setDetail(null);
      return;
    }

    const controller = new AbortController();
    let cancelled = false;

    const load = async () => {
      clearAgentHistory(assistantId);
      try {
        const data = await fetchNodeDetail(assistantId, controller.signal);
        if (cancelled || !data) {
          return;
        }
        setDetail(data);
        setFetchedAt(Date.now());
        clearHistorySnapshot(assistantId);
      } catch {
        if (!cancelled && !controller.signal.aborted) {
          toast.error("Failed to load Assistant history");
        }
      }
    };

    void load();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [
    assistantHistoryClearedAt,
    assistantHistoryInvalidatedAt,
    assistantId,
    clearAgentHistory,
    clearHistorySnapshot,
    connected,
  ]);

  const mergedHistory = useMemo(() => {
    if (!assistantId) {
      return [];
    }
    return mergeHistoryWithDeltas({
      history: assistantHistorySnapshot ?? detail?.history ?? [],
      incremental: agentHistories.get(assistantId),
      deltas: streamingDeltas.get(assistantId),
      fetchedAt: fetchedAt || Date.now(),
    });
  }, [
    agentHistories,
    assistantHistorySnapshot,
    detail,
    fetchedAt,
    streamingDeltas,
    assistantId,
  ]);

  useEffect(() => {
    if (!assistantId || pendingAssistantMessages.length === 0) {
      return;
    }

    const confirmedMessages = mergedHistory.filter(
      (entry): entry is HistoryEntry & { type: "ReceivedMessage" } =>
        entry.type === "ReceivedMessage" &&
        entry.from_id === "human" &&
        (Boolean(entry.content) ||
          Boolean(entry.message_id) ||
          Boolean(entry.parts?.length)),
    );

    if (confirmedMessages.length === 0) {
      return;
    }

    setPendingAssistantMessages((current) =>
      confirmedMessages.reduce(
        (messages, entry) =>
          removePendingAssistantMessage(messages, {
            content:
              entry.content ?? contentPartsToText(entry.parts, entry.content),
            messageId: entry.message_id,
          }),
        current,
      ),
    );
  }, [assistantId, mergedHistory, pendingAssistantMessages.length]);

  const timelineItems = useMemo<AssistantChatItem[]>(
    () => [
      ...mergedHistory,
      ...pendingAssistantMessages.map((message) => ({ ...message })),
    ],
    [mergedHistory, pendingAssistantMessages],
  );

  const assistantActivity = useMemo(() => {
    const pendingCount = pendingAssistantMessages.length;
    const deltas = assistantId ? (streamingDeltas.get(assistantId) ?? []) : [];
    const running =
      connected &&
      (pendingCount > 0 ||
        assistantNode?.state === "running" ||
        assistantNode?.state === "sleeping" ||
        activeToolCalls.has(assistantId ?? "") ||
        deltas.length > 0);
    const lastHumanIndex = [...timelineItems]
      .map((item, index) => ({ item, index }))
      .reverse()
      .find(({ item }) =>
        item.type === "PendingHumanMessage"
          ? true
          : item.type === "ReceivedMessage" &&
            item.from_id === "human" &&
            normalizeContentParts(item.parts, item.content).length > 0,
      )?.index;
    const turnItems =
      lastHumanIndex === undefined
        ? []
        : timelineItems.slice(lastHumanIndex + 1);
    const hasAssistantText = turnItems.some(
      (item) =>
        item.type === "AssistantText" &&
        normalizeContentParts(item.parts, item.content).length > 0,
    );
    const runningToolCall = [...turnItems]
      .reverse()
      .find(
        (item): item is HistoryEntry & { type: "ToolCall" } =>
          item.type === "ToolCall" && item.streaming === true,
      );
    const activeToolName = assistantId
      ? (activeToolCalls.get(assistantId) ?? null)
      : null;
    const toolName = activeToolName ?? runningToolCall?.tool_name ?? null;

    return {
      running,
      runningHint:
        running && lastHumanIndex !== undefined && !hasAssistantText
          ? {
              label: toolName ? "Running tools..." : "Thinking...",
              toolName,
            }
          : null,
    };
  }, [
    activeToolCalls,
    assistantId,
    assistantNode?.state,
    connected,
    pendingAssistantMessages.length,
    streamingDeltas,
    timelineItems,
  ]);

  const runningHintKey = assistantActivity.runningHint
    ? `${assistantActivity.runningHint.label}:${assistantActivity.runningHint.toolName ?? ""}`
    : "";

  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!element || !autoScrollRef.current) {
      return;
    }
    element.scrollTop = element.scrollHeight;
  }, [bottomInset, runningHintKey, timelineItems]);

  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!element || typeof ResizeObserver === "undefined") {
      return;
    }

    const observer = new ResizeObserver(() => {
      if (!autoScrollRef.current) {
        return;
      }
      element.scrollTop = element.scrollHeight;
    });

    observer.observe(element);

    return () => {
      observer.disconnect();
    };
  }, []);

  const onMessagesScroll = (event: UIEvent<HTMLDivElement>) => {
    autoScrollRef.current = isScrolledToBottom(event.currentTarget);
  };

  const sendMessage = async () => {
    const content = input.trim();
    if (
      (!content && readyImages.length === 0) ||
      hasUploadingImages ||
      sending
    ) {
      return;
    }

    const parts: ContentPart[] = buildMessageParts(content, readyImages);

    const previousInput = input;
    const previousDraftImages = draftImages;
    const previousHistoryCursor = historyCursor;
    const submittedAt = Date.now();
    const normalizedContent = content || contentPartsToText(parts);
    const pendingMessage = createPendingHumanMessage(
      normalizedContent,
      parts,
      submittedAt,
    );
    setSending(true);
    setHistoryCursor(null);
    setInputState("");
    setDraftImages([]);
    setPendingAssistantMessages((current) => [...current, pendingMessage]);

    try {
      const response = await sendAssistantMessageRequest({
        content: normalizedContent,
        parts,
      });
      if (response.status === "command_executed") {
        setPendingAssistantMessages((current) =>
          removePendingAssistantMessage(current, {
            content: normalizedContent,
            timestamp: submittedAt,
          }),
        );
      } else if (response.message_id) {
        setPendingAssistantMessages((current) =>
          current.map((message) =>
            message.timestamp === submittedAt &&
            message.content === normalizedContent
              ? { ...message, message_id: response.message_id }
              : message,
          ),
        );
      }
      appendAssistantInputHistoryEntry({
        text: previousInput,
        images: toInputHistoryImages(previousDraftImages),
        timestamp: submittedAt,
      });
      revokeDraftImageUrls(previousDraftImages);
    } catch (error) {
      setPendingAssistantMessages((current) =>
        removePendingAssistantMessage(current, {
          content: normalizedContent,
          timestamp: submittedAt,
        }),
      );
      setInputState(previousInput);
      setDraftImages(previousDraftImages);
      setHistoryCursor(previousHistoryCursor);
      toast.error(
        error instanceof Error ? error.message : "Failed to send message",
      );
    } finally {
      setSending(false);
    }
  };

  const addImages = useCallback(
    async (files: FileList | File[]) => {
      setHistoryCursor(null);
      if (!supportsInputImage) {
        toast.error("Current model does not support image input");
        return;
      }
      const selectedFiles = Array.from(files).filter((file) =>
        file.type.startsWith("image/"),
      );
      if (selectedFiles.length === 0) {
        return;
      }

      const drafts = await createUploadingImageDrafts(selectedFiles);

      setDraftImages((current) => [...current, ...drafts]);

      await Promise.all(
        drafts.map(async (draft, index) => {
          const file = selectedFiles[index];
          if (!file) {
            return;
          }
          try {
            const asset = await uploadImageAssetRequest(file);
            setDraftImages((current) =>
              current.map((image) =>
                image.id === draft.id
                  ? {
                      ...image,
                      assetId: asset.id,
                      mimeType: asset.mime_type,
                      width:
                        typeof asset.width === "number"
                          ? asset.width
                          : image.width,
                      height:
                        typeof asset.height === "number"
                          ? asset.height
                          : image.height,
                      status: "ready",
                    }
                  : image,
              ),
            );
          } catch (error) {
            revokeDraftImageUrl(draft);
            setDraftImages((current) =>
              current.filter((image) => image.id !== draft.id),
            );
            toast.error(
              error instanceof Error ? error.message : "Failed to upload image",
            );
          }
        }),
      );
    },
    [supportsInputImage],
  );

  const removeImage = useCallback((imageId: string) => {
    setHistoryCursor(null);
    setDraftImages((current) => {
      const image = current.find((item) => item.id === imageId);
      if (image) {
        revokeDraftImageUrl(image);
      }
      return current.filter((item) => item.id !== imageId);
    });
  }, []);

  const navigateInputHistory = useCallback(
    (
      direction: -1 | 1,
      selection: {
        start: number | null;
        end: number | null;
      },
    ) => {
      if (inputHistoryEntries.length === 0) {
        return false;
      }

      const selectionStart = selection.start;
      const selectionEnd = selection.end;
      const isBlankDraft = input.length === 0 && draftImages.length === 0;
      const isBoundarySelection =
        typeof selectionStart === "number" &&
        typeof selectionEnd === "number" &&
        selectionStart === selectionEnd &&
        (selectionStart === 0 || selectionStart === input.length);
      const canContinueHistory =
        currentHistoryEntry !== null &&
        isBrowsingInputHistory &&
        isBoundarySelection;

      if (!isBlankDraft && !canContinueHistory) {
        return false;
      }

      if (historyCursor === null) {
        if (direction !== -1) {
          return false;
        }

        const nextIndex = inputHistoryEntries.length - 1;
        restoreHistoryEntry(inputHistoryEntries[nextIndex] ?? null, nextIndex);
        return true;
      }

      if (direction === -1) {
        const nextIndex = Math.max(historyCursor - 1, 0);
        restoreHistoryEntry(inputHistoryEntries[nextIndex] ?? null, nextIndex);
        return true;
      }

      if (historyCursor >= inputHistoryEntries.length - 1) {
        restoreHistoryEntry(null, null);
        return true;
      }

      const nextIndex = historyCursor + 1;
      restoreHistoryEntry(inputHistoryEntries[nextIndex] ?? null, nextIndex);
      return true;
    },
    [
      currentHistoryEntry,
      draftImages,
      historyCursor,
      input,
      inputHistoryEntries,
      isBrowsingInputHistory,
      restoreHistoryEntry,
    ],
  );

  const clearChat = async () => {
    if (!assistantId || clearing) {
      return;
    }

    setClearing(true);
    try {
      await clearAssistantChatRequest(assistantId);
      setPendingAssistantMessages([]);
      clearAgentHistory(assistantId);
      const data = await fetchNodeDetail(assistantId);
      setDetail(data);
      setFetchedAt(Date.now());
      clearHistorySnapshot(assistantId);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to clear assistant chat",
      );
    } finally {
      setClearing(false);
    }
  };

  const waitForAssistantRetryInterrupt = useCallback(async () => {
    if (!assistantId) {
      return;
    }

    if (
      assistantNode?.state !== "running" &&
      assistantNode?.state !== "sleeping"
    ) {
      return;
    }

    await interruptNode(assistantId);

    for (let attempt = 0; attempt < 25; attempt += 1) {
      const data = await fetchNodeDetail(assistantId);
      if (!data) {
        break;
      }
      setDetail(data);
      setFetchedAt(Date.now());
      if (data.state !== "running" && data.state !== "sleeping") {
        return;
      }
      await new Promise((resolve) => window.setTimeout(resolve, 120));
    }

    throw new Error("Assistant did not stop in time");
  }, [assistantId, assistantNode?.state]);

  const retryMessage = async (messageId: string) => {
    if (!assistantId || !messageId || retryingMessageId) {
      return;
    }

    setRetryingMessageId(messageId);
    try {
      try {
        await waitForAssistantRetryInterrupt();
        await retryAssistantMessageRequest(messageId);
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : "Failed to retry Assistant message",
        );
        return;
      }

      clearAgentHistory(assistantId);
      try {
        const data = await fetchNodeDetail(assistantId);
        if (data) {
          setDetail(data);
          setFetchedAt(Date.now());
          clearHistorySnapshot(assistantId);
        }
      } catch {
        return;
      }
    } finally {
      setRetryingMessageId(null);
    }
  };

  const stopAssistant = useCallback(async () => {
    if (!assistantId) {
      return;
    }

    await interruptNode(assistantId);
    setPendingAssistantMessages([]);
    clearAgentHistory(assistantId);
    const data = await fetchNodeDetail(assistantId);
    if (data) {
      setDetail(data);
      setFetchedAt(Date.now());
      clearHistorySnapshot(assistantId);
    }
  }, [assistantId, clearAgentHistory, clearHistorySnapshot]);

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void sendMessage();
    }
  };

  return {
    addImages,
    connected,
    draftImages,
    handleKeyDown,
    hasUploadingImages,
    input,
    isBrowsingInputHistory,
    navigateInputHistory,
    onMessagesScroll,
    removeImage,
    retryMessage,
    retryingMessageId,
    scrollRef,
    clearing,
    sending,
    clearChat,
    sendMessage,
    setInput,
    stopAssistant,
    supportsInputImage,
    timelineItems,
    assistantActivity,
  };
}
