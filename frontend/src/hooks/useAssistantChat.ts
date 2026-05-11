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
  createPendingSendMessage,
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
  AssistantInputHistoryImage,
  ContentPart,
  HistoryEntry,
  NodeDetail,
  PendingAssistantChatMessage,
  PendingSendChatMessage,
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
  const [pendingSend, setPendingSend] = useState<PendingSendChatMessage | null>(
    null,
  );
  const scrollRef = useRef<HTMLDivElement>(null);
  const autoScrollRef = useRef(true);
  const draftImagesRef = useRef<DraftChatImage[]>([]);
  const pendingSendRef = useRef<PendingSendChatMessage | null>(null);
  const autoSendingPendingSendRef = useRef(false);
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
  const assistantState = assistantNode?.state ?? detail?.state ?? null;

  const submitParts = useCallback(
    async (input: {
      content: string;
      parts: ContentPart[];
      history: {
        text: string;
        images: AssistantInputHistoryImage[];
        timestamp: number;
      };
      pendingMessageTimestamp?: number;
      restoreDraft?: {
        input: string;
        images: DraftChatImage[];
        historyCursor: number | null;
      };
    }) => {
      const pendingAt = input.pendingMessageTimestamp ?? Date.now();
      const pendingMessage = createPendingHumanMessage(
        input.content,
        input.parts,
        pendingAt,
      );

      setSending(true);
      setPendingAssistantMessages((current) => [...current, pendingMessage]);

      try {
        const response = await sendAssistantMessageRequest({
          content: input.content,
          parts: input.parts,
        });
        if (response.status === "command_executed") {
          setPendingAssistantMessages((current) =>
            removePendingAssistantMessage(current, {
              content: input.content,
              timestamp: pendingAt,
            }),
          );
        } else if (response.message_id) {
          setPendingAssistantMessages((current) =>
            current.map((message) =>
              message.timestamp === pendingAt &&
              message.content === input.content
                ? { ...message, message_id: response.message_id }
                : message,
            ),
          );
        }
        appendAssistantInputHistoryEntry(input.history);
        if (input.restoreDraft) {
          revokeDraftImageUrls(input.restoreDraft.images);
        }
        return true;
      } catch (error) {
        setPendingAssistantMessages((current) =>
          removePendingAssistantMessage(current, {
            content: input.content,
            timestamp: pendingAt,
          }),
        );
        if (input.restoreDraft) {
          setInputState(input.restoreDraft.input);
          setDraftImages(input.restoreDraft.images);
          setHistoryCursor(input.restoreDraft.historyCursor);
        }
        toast.error(
          error instanceof Error ? error.message : "Failed to send message",
        );
        return false;
      } finally {
        setSending(false);
      }
    },
    [],
  );

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

  useEffect(() => {
    pendingSendRef.current = pendingSend;
  }, [pendingSend]);

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
    setPendingSend(null);
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
    const current = pendingSendRef.current;
    if (!current || current.send_failed || current.target_id !== assistantId) {
      return;
    }

    if (assistantState === current.target_state) {
      return;
    }

    setPendingSend({ ...current, target_state: assistantState });
  }, [assistantId, assistantState]);

  useEffect(() => {
    const current = pendingSendRef.current;
    if (
      !current ||
      current.send_failed ||
      !assistantId ||
      current.target_id !== assistantId ||
      assistantState !== "idle" ||
      sending ||
      autoSendingPendingSendRef.current
    ) {
      return;
    }

    autoSendingPendingSendRef.current = true;
    setPendingSend(null);
    void submitParts({
      content: current.content,
      parts: current.parts ?? [],
      history: current.history_entry,
      pendingMessageTimestamp: current.timestamp,
    })
      .then((sent) => {
        autoSendingPendingSendRef.current = false;
        if (!sent) {
          setPendingSend({
            ...current,
            send_failed: true,
            target_state: "error",
          });
        }
      })
      .catch(() => {
        autoSendingPendingSendRef.current = false;
        setPendingSend({
          ...current,
          send_failed: true,
          target_state: "error",
        });
      });
  }, [assistantId, assistantState, sending, submitParts]);

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
      ...(pendingSend ? [{ ...pendingSend }] : []),
      ...pendingAssistantMessages.map((message) => ({ ...message })),
    ],
    [mergedHistory, pendingAssistantMessages, pendingSend],
  );

  const assistantActivity = useMemo(() => {
    const pendingCount =
      pendingAssistantMessages.length + (pendingSend ? 1 : 0);
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
    pendingSend,
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

  const sendMessage = async (options: { deferWhenBusy?: boolean } = {}) => {
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
    const historyEntry = {
      text: previousInput,
      images: toInputHistoryImages(previousDraftImages),
      timestamp: submittedAt,
    };
    const replacingBlockedPending =
      options.deferWhenBusy &&
      assistantId &&
      pendingSendRef.current?.target_id === assistantId &&
      (assistantState === "error" || assistantState === "terminated");
    if (
      options.deferWhenBusy &&
      assistantId &&
      (assistantState === "running" ||
        assistantState === "sleeping" ||
        replacingBlockedPending)
    ) {
      setPendingSend(
        createPendingSendMessage({
          content: normalizedContent,
          historyEntry,
          historyScope: "assistant",
          parts,
          targetId: assistantId,
          targetState: assistantState,
          timestamp: submittedAt,
        }),
      );
      setHistoryCursor(null);
      setInputState("");
      setDraftImages([]);
      revokeDraftImageUrls(previousDraftImages);
      return;
    }

    if (assistantState === "terminated") {
      toast.error("Resolve the current chat before sending");
      return;
    }

    setHistoryCursor(null);
    setInputState("");
    setDraftImages([]);
    await submitParts({
      content: normalizedContent,
      parts,
      history: historyEntry,
      pendingMessageTimestamp: submittedAt,
      restoreDraft: {
        input: previousInput,
        images: previousDraftImages,
        historyCursor: previousHistoryCursor,
      },
    });
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
      setPendingSend(null);
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

  const cancelPendingSend = useCallback((pendingId: string) => {
    setPendingSend((current) => (current?.id === pendingId ? null : current));
  }, []);

  const sendPendingSend = useCallback(
    async (pendingId: string) => {
      const current = pendingSendRef.current;
      if (
        !current ||
        current.id !== pendingId ||
        !assistantId ||
        current.target_id !== assistantId ||
        sending ||
        autoSendingPendingSendRef.current ||
        assistantState === "terminated"
      ) {
        return;
      }

      setPendingSend(null);
      const sent = await submitParts({
        content: current.content,
        parts: current.parts ?? [],
        history: current.history_entry,
        pendingMessageTimestamp: current.timestamp,
      });
      if (!sent) {
        setPendingSend({
          ...current,
          send_failed: true,
          target_state: "error",
        });
      }
    },
    [assistantId, assistantState, sending, submitParts],
  );

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Tab" && !event.shiftKey) {
      if (input.trim() || readyImages.length > 0) {
        event.preventDefault();
        void sendMessage({ deferWhenBusy: true });
      }
      return;
    }

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
    cancelPendingSend,
    sendPendingSend,
    sendMessage,
    setInput,
    stopAssistant,
    supportsInputImage,
    timelineItems,
    assistantActivity,
  };
}
