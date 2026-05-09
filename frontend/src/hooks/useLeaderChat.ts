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
  clearNodeChatRequest,
  dispatchNodeMessageRequest,
  fetchNodeDetail,
  interruptNode,
  retryNodeMessageRequest,
  uploadImageAssetRequest,
} from "@/lib/api";
import {
  useAgentActivityRuntime,
  useAgentConnectionRuntime,
  useAgentHistoryRuntime,
  useAgentNodesRuntime,
  useAgentTabsRuntime,
  useAgentUI,
} from "@/context/AgentContext";
import { removePendingAssistantMessage } from "@/context/agentRuntimeState";
import {
  clearConversationHistory,
  mergeHistoryWithDeltas,
} from "@/lib/history";
import { contentPartsToText, normalizeContentParts } from "@/lib/contentParts";
import {
  appendChatInputHistoryEntry,
  getChatInputHistorySnapshot,
  subscribeChatInputHistory,
} from "@/lib/chatInputHistory";
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
import { getWorkflowLeaderNode } from "@/lib/workflow";
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

interface UseLeaderChatOptions {
  bottomInset?: number;
}

export function useLeaderChat(options: UseLeaderChatOptions = {}) {
  const { bottomInset = 0 } = options;
  const { agents } = useAgentNodesRuntime();
  const { tabs } = useAgentTabsRuntime();
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
  const { activeTabId } = useAgentUI();
  const activeTab = activeTabId ? (tabs.get(activeTabId) ?? null) : null;
  const leaderNode = useMemo(
    () => getWorkflowLeaderNode(agents, activeTab),
    [activeTab, agents],
  );
  const leaderId = leaderNode?.id ?? activeTab?.leader_id ?? null;
  const inputHistoryScope = activeTabId
    ? `leader:${activeTabId}`
    : "leader:none";
  const [detail, setDetail] = useState<NodeDetail | null>(null);
  const [fetchedAt, setFetchedAt] = useState(0);
  const [input, setInputState] = useState("");
  const [draftImages, setDraftImages] = useState<DraftChatImage[]>([]);
  const [historyCursor, setHistoryCursor] = useState<number | null>(null);
  const [clearing, setClearing] = useState(false);
  const [sending, setSending] = useState(false);
  const [retryingMessageId, setRetryingMessageId] = useState<string | null>(
    null,
  );
  const [pendingMessages, setPendingMessages] = useState<
    PendingAssistantChatMessage[]
  >([]);
  const [pendingSends, setPendingSends] = useState<
    Map<string, PendingSendChatMessage>
  >(() => new Map());
  const scrollRef = useRef<HTMLDivElement>(null);
  const autoScrollRef = useRef(true);
  const draftImagesRef = useRef<DraftChatImage[]>([]);
  const pendingSendsRef = useRef<Map<string, PendingSendChatMessage>>(
    new Map(),
  );
  const autoSendingPendingSendIdsRef = useRef(new Set<string>());
  const supportsInputImage = leaderNode?.capabilities?.input_image ?? false;
  const historyClearedAtMs = leaderId
    ? (historyClearedAt.get(leaderId) ?? 0)
    : 0;
  const historyInvalidatedAtMs = leaderId
    ? (historyInvalidatedAt.get(leaderId) ?? 0)
    : 0;
  const historySnapshot = leaderId
    ? (historySnapshots.get(leaderId) ?? null)
    : null;
  const hasUploadingImages = draftImages.some(
    (image) => image.status === "uploading",
  );
  const readyImages = draftImages.filter(isReadyDraftImage);
  const inputHistoryEntries = useSyncExternalStore(
    (listener) => subscribeChatInputHistory(inputHistoryScope, listener),
    () => getChatInputHistorySnapshot(inputHistoryScope),
    () => getChatInputHistorySnapshot(inputHistoryScope),
  );
  const currentHistoryEntry =
    historyCursor !== null
      ? (inputHistoryEntries[historyCursor] ?? null)
      : null;
  const isBrowsingInputHistory =
    currentHistoryEntry !== null &&
    input === currentHistoryEntry.text &&
    draftImagesMatchHistoryEntry(draftImages, currentHistoryEntry);
  const leaderState = leaderNode?.state ?? detail?.state ?? null;

  const submitParts = useCallback(
    async (input: {
      content: string;
      parts: ContentPart[];
      targetId: string;
      visiblePending?: boolean;
      history: {
        scope: string;
        entry: {
          text: string;
          images: AssistantInputHistoryImage[];
          timestamp: number;
        };
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
      const visiblePending = input.visiblePending ?? true;

      setSending(true);
      if (visiblePending) {
        setPendingMessages((current) => [...current, pendingMessage]);
      }

      try {
        const response = await dispatchNodeMessageRequest(input.targetId, {
          content: input.content,
          parts: input.parts,
        });
        if (visiblePending && response.status === "command_executed") {
          setPendingMessages((current) =>
            removePendingAssistantMessage(current, {
              content: input.content,
              timestamp: pendingAt,
            }),
          );
        } else if (visiblePending) {
          setPendingMessages((current) =>
            current.map((message) =>
              message.id === pendingMessage.id
                ? {
                    ...message,
                    message_id: response.message_id ?? null,
                  }
                : message,
            ),
          );
        }
        appendChatInputHistoryEntry(input.history.scope, input.history.entry);
        if (input.restoreDraft) {
          revokeDraftImageUrls(input.restoreDraft.images);
        }
        return true;
      } catch (error) {
        if (visiblePending) {
          setPendingMessages((current) =>
            current.filter((message) => message.id !== pendingMessage.id),
          );
        }
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
    pendingSendsRef.current = pendingSends;
  }, [pendingSends]);

  useEffect(
    () => () => {
      revokeDraftImageUrls(draftImagesRef.current);
    },
    [],
  );

  useEffect(() => {
    revokeDraftImageUrls(draftImagesRef.current);
    setInputState("");
    setDraftImages([]);
    setHistoryCursor(null);
    setPendingMessages([]);
    setRetryingMessageId(null);
  }, [inputHistoryScope]);

  useEffect(() => {
    if (!historyClearedAtMs) {
      return;
    }

    setPendingMessages([]);
    if (leaderId) {
      setPendingSends((current) => {
        if (!current.has(leaderId)) {
          return current;
        }
        const next = new Map(current);
        next.delete(leaderId);
        return next;
      });
    }
    setDetail((current) =>
      current
        ? {
            ...current,
            history: clearConversationHistory(current.history),
          }
        : current,
    );
    setFetchedAt(Date.now());
  }, [historyClearedAtMs, leaderId]);

  useEffect(() => {
    if (!historyInvalidatedAtMs || !historySnapshot) {
      return;
    }

    setDetail((current) =>
      current
        ? {
            ...current,
            history: historySnapshot,
          }
        : current,
    );
    setFetchedAt(Date.now());
  }, [historyInvalidatedAtMs, historySnapshot]);

  useEffect(() => {
    if (pendingSendsRef.current.size === 0) {
      return;
    }

    setPendingSends((pending) => {
      let next: Map<string, PendingSendChatMessage> | null = null;

      for (const [targetId, pendingSend] of pending) {
        if (pendingSend.send_failed) {
          continue;
        }
        const targetState =
          targetId === leaderId
            ? leaderState
            : (agents.get(targetId)?.state ?? pendingSend.target_state ?? null);
        if (pendingSend.target_state === targetState) {
          continue;
        }
        next ??= new Map(pending);
        next.set(targetId, { ...pendingSend, target_state: targetState });
      }

      return next ?? pending;
    });
  }, [agents, leaderId, leaderState, pendingSends]);

  useEffect(() => {
    if (pendingSendsRef.current.size === 0 || sending) {
      return;
    }

    for (const [targetId, current] of pendingSendsRef.current) {
      if (current.send_failed) {
        continue;
      }

      const targetState =
        targetId === leaderId
          ? leaderState
          : (agents.get(targetId)?.state ?? current.target_state ?? null);

      if (
        targetState !== "idle" ||
        autoSendingPendingSendIdsRef.current.has(targetId)
      ) {
        continue;
      }

      autoSendingPendingSendIdsRef.current.add(targetId);
      setPendingSends((pending) => {
        if (!pending.has(targetId)) {
          return pending;
        }
        const next = new Map(pending);
        next.delete(targetId);
        return next;
      });

      void submitParts({
        content: current.content,
        parts: current.parts ?? [],
        targetId,
        visiblePending: targetId === leaderId,
        history: {
          scope: current.history_entry_scope,
          entry: current.history_entry,
        },
        pendingMessageTimestamp: current.timestamp,
      })
        .then((sent) => {
          autoSendingPendingSendIdsRef.current.delete(targetId);
          if (!sent) {
            setPendingSends((pending) => {
              const next = new Map(pending);
              next.set(targetId, {
                ...current,
                send_failed: true,
                target_state: "error",
              });
              return next;
            });
          }
        })
        .catch(() => {
          autoSendingPendingSendIdsRef.current.delete(targetId);
          setPendingSends((pending) => {
            const next = new Map(pending);
            next.set(targetId, {
              ...current,
              send_failed: true,
              target_state: "error",
            });
            return next;
          });
        });
    }
  }, [agents, leaderId, leaderState, pendingSends, sending, submitParts]);

  useEffect(() => {
    if (!connected || !leaderId) {
      setDetail(null);
      return;
    }

    const controller = new AbortController();
    let cancelled = false;

    const load = async () => {
      clearAgentHistory(leaderId);
      try {
        const data = await fetchNodeDetail(leaderId, controller.signal);
        if (cancelled || !data) {
          return;
        }
        setDetail(data);
        setFetchedAt(Date.now());
        clearHistorySnapshot(leaderId);
      } catch {
        if (!cancelled && !controller.signal.aborted) {
          toast.error("Failed to load Leader history");
        }
      }
    };

    void load();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [
    clearAgentHistory,
    clearHistorySnapshot,
    connected,
    historyClearedAtMs,
    historyInvalidatedAtMs,
    leaderId,
  ]);

  const mergedHistory = useMemo(() => {
    if (!leaderId) {
      return [];
    }
    return mergeHistoryWithDeltas({
      history: historySnapshot ?? detail?.history ?? [],
      incremental: agentHistories.get(leaderId),
      deltas: streamingDeltas.get(leaderId),
      fetchedAt: fetchedAt || Date.now(),
    });
  }, [
    agentHistories,
    detail,
    fetchedAt,
    historySnapshot,
    leaderId,
    streamingDeltas,
  ]);

  useEffect(() => {
    if (!leaderId || pendingMessages.length === 0) {
      return;
    }

    const confirmedMessageIds = new Set(
      mergedHistory
        .filter(
          (entry) =>
            entry.type === "ReceivedMessage" &&
            entry.from_id === "human" &&
            typeof entry.message_id === "string",
        )
        .map((entry) => entry.message_id as string),
    );

    if (confirmedMessageIds.size === 0) {
      return;
    }

    setPendingMessages((current) =>
      current.filter(
        (message) =>
          !message.message_id || !confirmedMessageIds.has(message.message_id),
      ),
    );
  }, [leaderId, mergedHistory, pendingMessages.length]);

  const currentPendingSend = leaderId
    ? (pendingSends.get(leaderId) ?? null)
    : null;

  const timelineItems = useMemo<AssistantChatItem[]>(
    () => [
      ...mergedHistory,
      ...(currentPendingSend ? [{ ...currentPendingSend }] : []),
      ...pendingMessages.map((message) => ({ ...message })),
    ],
    [currentPendingSend, mergedHistory, pendingMessages],
  );

  const leaderActivity = useMemo(() => {
    const pendingCount = pendingMessages.length + (currentPendingSend ? 1 : 0);
    const deltas = leaderId ? (streamingDeltas.get(leaderId) ?? []) : [];
    const running =
      connected &&
      Boolean(
        leaderId &&
        (pendingCount > 0 ||
          leaderNode?.state === "running" ||
          leaderNode?.state === "sleeping" ||
          activeToolCalls.has(leaderId) ||
          deltas.length > 0),
      );
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
    const activeToolName = leaderId
      ? (activeToolCalls.get(leaderId) ?? null)
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
    connected,
    leaderId,
    leaderNode?.state,
    currentPendingSend,
    pendingMessages.length,
    streamingDeltas,
    timelineItems,
  ]);

  const runningHintKey = leaderActivity.runningHint
    ? `${leaderActivity.runningHint.label}:${leaderActivity.runningHint.toolName ?? ""}`
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
    if (!leaderId) {
      return;
    }

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
      pendingSendsRef.current.has(leaderId) &&
      (leaderState === "error" || leaderState === "terminated");

    if (
      options.deferWhenBusy &&
      (leaderState === "running" ||
        leaderState === "sleeping" ||
        replacingBlockedPending)
    ) {
      setPendingSends((current) => {
        const next = new Map(current);
        next.set(
          leaderId,
          createPendingSendMessage({
            content: normalizedContent,
            historyEntry,
            historyScope: inputHistoryScope,
            parts,
            targetId: leaderId,
            targetState: leaderState,
            timestamp: submittedAt,
          }),
        );
        return next;
      });
      setHistoryCursor(null);
      setInputState("");
      setDraftImages([]);
      revokeDraftImageUrls(previousDraftImages);
      return;
    }

    if (leaderState === "error" || leaderState === "terminated") {
      toast.error("Resolve the current chat before sending");
      return;
    }

    setHistoryCursor(null);
    setInputState("");
    setDraftImages([]);
    await submitParts({
      content: normalizedContent,
      parts,
      targetId: leaderId,
      history: {
        scope: inputHistoryScope,
        entry: historyEntry,
      },
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

  const stopLeader = useCallback(async () => {
    if (!leaderId) {
      return;
    }

    if (leaderNode?.state !== "running" && leaderNode?.state !== "sleeping") {
      return;
    }

    await interruptNode(leaderId);

    for (let attempt = 0; attempt < 25; attempt += 1) {
      const data = await fetchNodeDetail(leaderId);
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

    throw new Error("Leader did not stop in time");
  }, [leaderId, leaderNode?.state]);

  const clearChat = async () => {
    if (!leaderId || clearing) {
      return;
    }

    setClearing(true);
    try {
      await clearNodeChatRequest(leaderId);
      setPendingMessages([]);
      setPendingSends((current) => {
        if (!current.has(leaderId)) {
          return current;
        }
        const next = new Map(current);
        next.delete(leaderId);
        return next;
      });
      clearAgentHistory(leaderId);
      const data = await fetchNodeDetail(leaderId);
      if (data) {
        setDetail(data);
        setFetchedAt(Date.now());
        clearHistorySnapshot(leaderId);
      }
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to clear chat",
      );
    } finally {
      setClearing(false);
    }
  };

  const retryMessage = useCallback(
    async (messageId: string) => {
      if (!leaderId || !messageId || retryingMessageId) {
        return;
      }

      setRetryingMessageId(messageId);
      try {
        try {
          await stopLeader();
          await retryNodeMessageRequest(leaderId, messageId);
        } catch (error) {
          toast.error(
            error instanceof Error
              ? error.message
              : "Failed to retry Leader message",
          );
          return;
        }

        clearAgentHistory(leaderId);
        try {
          const data = await fetchNodeDetail(leaderId);
          if (data) {
            setDetail(data);
            setFetchedAt(Date.now());
            clearHistorySnapshot(leaderId);
          }
        } catch {
          return;
        }
      } finally {
        setRetryingMessageId(null);
      }
    },
    [
      clearAgentHistory,
      clearHistorySnapshot,
      leaderId,
      retryingMessageId,
      stopLeader,
    ],
  );

  const cancelPendingSend = useCallback((pendingId: string) => {
    setPendingSends((current) => {
      const entry = Array.from(current.entries()).find(
        ([, pending]) => pending.id === pendingId,
      );
      if (!entry) {
        return current;
      }
      const next = new Map(current);
      next.delete(entry[0]);
      return next;
    });
  }, []);

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
    activeTab,
    addImages,
    cancelPendingSend,
    connected,
    clearChat,
    clearing,
    draftImages,
    handleKeyDown,
    hasUploadingImages,
    input,
    isBrowsingInputHistory,
    leaderActivity,
    leaderNode,
    navigateInputHistory,
    onMessagesScroll,
    removeImage,
    retryMessage,
    retryingMessageId,
    scrollRef,
    sendMessage,
    sending,
    setInput,
    stopLeader,
    supportsInputImage,
    timelineItems,
  };
}
