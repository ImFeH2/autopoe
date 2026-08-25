import {
  type FormEvent,
  startTransition,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { AppSidebar, type WorkspaceView } from "@/components/layout";
import {
  DiscussionsPage,
  type DraftMention,
  humanUnreadForDiscussion,
} from "@/features/discussions";
import {
  type AgentHistoryCache,
  createAgentHistoryCache,
  mergeAgentHistoryPage,
} from "@/features/incremental/agent-history-cache";
import {
  cachedDiscussionMessages,
  createDiscussionMessageCache,
  type DiscussionMessageCache,
  mergeDiscussionMessagePage,
} from "@/features/incremental/discussion-message-cache";
import { MembersPage } from "@/features/members";
import {
  memberNameErrorMessage,
  memberNameValidationMessage,
} from "@/features/members/member-name-policy";
import { SettingsPage } from "@/features/settings";
import {
  type AgentMember,
  backend,
  type OrganizationSnapshot,
} from "@/lib/backend";
import { FlowentRequestError } from "@/lib/flowent";

type DiscussionSource = {
  discussionId: number;
  triggerKey: string;
};

type RequestState =
  | { status: "loading" }
  | { status: "ready"; snapshot: OrganizationSnapshot }
  | { status: "error"; message: string };

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function toggleId(ids: number[], id: number) {
  return ids.includes(id)
    ? ids.filter((current) => current !== id)
    : [...ids, id];
}

function App() {
  const [requestState, setRequestState] = useState<RequestState>({
    status: "loading",
  });
  const [selectedDiscussionId, setSelectedDiscussionId] = useState<
    number | null
  >(null);
  const [selectedMemberId, setSelectedMemberId] = useState<number | null>(null);
  const [discussionSource, setDiscussionSource] =
    useState<DiscussionSource | null>(null);
  const [workspaceView, setWorkspaceView] =
    useState<WorkspaceView>("discussions");
  const [isCreatingAgent, setIsCreatingAgent] = useState(false);
  const [isCreatingDiscussion, setIsCreatingDiscussion] = useState(false);
  const [agentName, setAgentName] = useState("");
  const [topic, setTopic] = useState("");
  const [selectedMemberIds, setSelectedMemberIds] = useState<number[]>([]);
  const [messageBody, setMessageBody] = useState("");
  const [messageMentions, setMessageMentions] = useState<DraftMention[]>([]);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [discussionCaches, setDiscussionCaches] = useState<
    Record<number, DiscussionMessageCache>
  >({});
  const discussionRequestTokensRef = useRef<Record<number, number>>({});
  const [agentHistoryCaches, setAgentHistoryCaches] = useState<
    Record<number, AgentHistoryCache>
  >({});
  const agentHistoryRequestTokensRef = useRef<Record<number, number>>({});
  const [isSaving, setIsSaving] = useState(false);
  const mutationQueueRef = useRef<Promise<void>>(Promise.resolve());
  const pendingMutationsRef = useRef(0);
  const messageInputRef = useRef<HTMLTextAreaElement>(null);
  const restoreMessageFocusRef = useRef(false);
  const focusMessageAfterDialogRef = useRef(false);
  const focusMemberDetailRef = useRef(false);
  const restoreDiscussionFocusRef = useRef<DiscussionSource | null>(null);
  const selectedAgentId =
    requestState.status === "ready" &&
    requestState.snapshot.members.find(
      (member) => member.id === selectedMemberId,
    )?.type === "agent"
      ? selectedMemberId
      : null;
  const requestedHumanMemberId =
    requestState.status === "ready"
      ? requestState.snapshot.organization.current_human_member_id
      : null;
  const openMemberFromDiscussion = useCallback(
    (memberId: number, discussionId: number, triggerKey: string) => {
      focusMemberDetailRef.current = true;
      restoreDiscussionFocusRef.current = null;
      setDiscussionSource({ discussionId, triggerKey });
      setSelectedMemberId(memberId);
      setWorkspaceView("members");
      setIsCreatingAgent(false);
      setIsCreatingDiscussion(false);
    },
    [],
  );

  const loadDiscussionPage = useCallback(
    async (
      discussionId: number,
      cursor: {
        before_message_id?: number;
        after_message_id?: number;
        anchor_message_id?: number;
      } = {},
    ) => {
      if (requestState.status !== "ready") return;
      const token = (discussionRequestTokensRef.current[discussionId] ?? 0) + 1;
      discussionRequestTokensRef.current[discussionId] = token;
      setDiscussionCaches((current) => ({
        ...current,
        [discussionId]: {
          ...(current[discussionId] ?? createDiscussionMessageCache()),
          loading: true,
          error: null,
        },
      }));
      try {
        const page = await backend.getDiscussionMessagesPage(
          requestState.snapshot.organization.current_human_member_id,
          discussionId,
          requestState.snapshot.members,
          cursor,
        );
        if (discussionRequestTokensRef.current[discussionId] !== token) return;
        setDiscussionCaches((current) => ({
          ...current,
          [discussionId]: mergeDiscussionMessagePage(
            current[discussionId] ?? createDiscussionMessageCache(),
            page,
          ),
        }));
      } catch (error) {
        if (discussionRequestTokensRef.current[discussionId] !== token) return;
        setDiscussionCaches((current) => ({
          ...current,
          [discussionId]: {
            ...(current[discussionId] ?? createDiscussionMessageCache()),
            loading: false,
            error: errorMessage(error),
          },
        }));
      }
    },
    [requestState],
  );

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function refresh() {
      try {
        const snapshot = await backend.getOrganization();
        if (active && pendingMutationsRef.current === 0) {
          setRequestState({ status: "ready", snapshot });
        }
      } catch (error) {
        if (active) {
          setRequestState({ status: "error", message: errorMessage(error) });
        }
      } finally {
        if (active) {
          timer = setTimeout(() => void refresh(), 250);
        }
      }
    }

    void refresh();
    return () => {
      active = false;
      if (timer) {
        clearTimeout(timer);
      }
    };
  }, []);

  useEffect(() => {
    if (selectedDiscussionId === null || requestState.status !== "ready")
      return;
    const cache = discussionCaches[selectedDiscussionId];
    if (!cache?.loaded && !cache?.loading)
      void loadDiscussionPage(selectedDiscussionId);
  }, [
    discussionCaches,
    loadDiscussionPage,
    requestState.status,
    selectedDiscussionId,
  ]);

  useEffect(() => {
    if (requestState.status !== "ready") return;
    const summary = requestState.snapshot.discussions.find(
      (item) => item.id === selectedDiscussionId,
    );
    const cache =
      selectedDiscussionId === null
        ? undefined
        : discussionCaches[selectedDiscussionId];
    if (
      summary?.latest_message_id &&
      cache?.loaded &&
      cache.followsLatest &&
      !cache.loading &&
      (cache.newestMessageId ?? 0) < summary.latest_message_id
    ) {
      void loadDiscussionPage(summary.id, {
        after_message_id: cache.newestMessageId ?? undefined,
      });
    }
  }, [
    discussionCaches,
    loadDiscussionPage,
    requestState,
    selectedDiscussionId,
  ]);

  useEffect(() => {
    if (requestState.status !== "ready" || selectedDiscussionId === null)
      return;
    const summary = requestState.snapshot.discussions.find(
      (item) => item.id === selectedDiscussionId,
    );
    const activity = summary?.human_activity?.find(
      (item) => item.member_id === requestedHumanMemberId,
    );
    const target =
      activity?.first_unread_message_id ??
      activity?.next_human_mention_message_id;
    const cache = discussionCaches[selectedDiscussionId];
    if (
      target &&
      cache?.loaded &&
      !cache.loading &&
      !cache.messagesById[target]
    ) {
      void loadDiscussionPage(selectedDiscussionId, {
        anchor_message_id: target,
      });
    }
  }, [
    discussionCaches,
    loadDiscussionPage,
    requestState,
    requestedHumanMemberId,
    selectedDiscussionId,
  ]);

  const loadAgentHistoryPage = useCallback(
    async (agentId: number, beforeSequence: number | null = null) => {
      const token = (agentHistoryRequestTokensRef.current[agentId] ?? 0) + 1;
      agentHistoryRequestTokensRef.current[agentId] = token;
      setAgentHistoryCaches((current) => ({
        ...current,
        [agentId]: {
          ...(current[agentId] ?? createAgentHistoryCache()),
          loading: true,
          error: null,
        },
      }));
      try {
        const page = await backend.getAgentHistoryPage(agentId, beforeSequence);
        if (agentHistoryRequestTokensRef.current[agentId] !== token) return;
        setAgentHistoryCaches((current) => ({
          ...current,
          [agentId]: mergeAgentHistoryPage(
            current[agentId] ?? createAgentHistoryCache(),
            page,
          ),
        }));
      } catch (error) {
        if (agentHistoryRequestTokensRef.current[agentId] !== token) return;
        setAgentHistoryCaches((current) => ({
          ...current,
          [agentId]: {
            ...(current[agentId] ?? createAgentHistoryCache()),
            loading: false,
            error: errorMessage(error),
          },
        }));
      }
    },
    [],
  );

  const loadAgentHistoryRun = useCallback(
    async (agentId: number, runId: string) => {
      const detail = await backend.getAgentHistoryRun(agentId, runId);
      setAgentHistoryCaches((current) => {
        const cache = current[agentId] ?? createAgentHistoryCache();
        return {
          ...current,
          [agentId]: {
            ...cache,
            detailByRunId: { ...cache.detailByRunId, [runId]: detail },
          },
        };
      });
    },
    [],
  );

  const loadAgentHistoryEntry = useCallback(
    async (agentId: number, runId: string, entryId: string) => {
      const detail = await backend.getAgentHistoryEntry(
        agentId,
        runId,
        entryId,
        0,
        16_000,
      );
      setAgentHistoryCaches((current) => {
        const cache = current[agentId] ?? createAgentHistoryCache();
        const run = cache.detailByRunId[runId];
        if (!run) return current;
        return {
          ...current,
          [agentId]: {
            ...cache,
            expandedIds: cache.expandedIds.includes(entryId)
              ? cache.expandedIds
              : [...cache.expandedIds, entryId],
            detailByRunId: {
              ...cache.detailByRunId,
              [runId]: {
                ...run,
                entries: run.entries.map((entry) =>
                  entry.id === entryId
                    ? {
                        ...entry,
                        content: detail.content,
                        content_length: detail.content_length,
                        content_truncated: detail.truncated,
                        paired_entry_id: detail.paired_entry_id,
                      }
                    : entry,
                ),
              },
            },
          },
        };
      });
    },
    [],
  );

  useEffect(() => {
    if (requestState.status !== "ready" || selectedDiscussionId === null)
      return;
    const summary = requestState.snapshot.discussions.find(
      (item) => item.id === selectedDiscussionId,
    );
    const cache = discussionCaches[selectedDiscussionId];
    if (!summary || !cache?.loaded || cache.loading || cache.error) return;
    const activity = summary.human_activity?.find(
      (item) => item.member_id === requestedHumanMemberId,
    );
    const missingTarget = [
      activity?.first_unread_message_id,
      activity?.next_human_mention_message_id,
    ].find(
      (messageId): messageId is number =>
        messageId !== null &&
        messageId !== undefined &&
        !cache.messagesById[messageId],
    );
    if (missingTarget !== undefined)
      void loadDiscussionPage(selectedDiscussionId, {
        anchor_message_id: missingTarget,
      });
  }, [
    discussionCaches,
    loadDiscussionPage,
    requestState,
    requestedHumanMemberId,
    selectedDiscussionId,
  ]);

  useEffect(() => {
    if (selectedAgentId === null) return;
    const cache = agentHistoryCaches[selectedAgentId];
    if (!cache?.loaded && !cache?.loading)
      void loadAgentHistoryPage(selectedAgentId);
  }, [agentHistoryCaches, loadAgentHistoryPage, selectedAgentId]);

  useEffect(
    () =>
      backend.onAgentHistoryEvent((event) => {
        const cache = agentHistoryCaches[event.agent_id];
        if (
          event.type === "run_started" ||
          event.type === "run_completed" ||
          event.type === "run_failed"
        ) {
          void loadAgentHistoryPage(event.agent_id);
        }
        if (cache?.detailByRunId[event.run_id])
          void loadAgentHistoryRun(event.agent_id, event.run_id);
      }),
    [agentHistoryCaches, loadAgentHistoryPage, loadAgentHistoryRun],
  );

  useEffect(() => {
    if (isSaving) {
      return;
    }
    if (restoreMessageFocusRef.current) {
      restoreMessageFocusRef.current = false;
      messageInputRef.current?.focus();
    }
  }, [isSaving]);

  useEffect(() => {
    if (
      requestState.status === "ready" &&
      discussionSource !== null &&
      !requestState.snapshot.discussions.some(
        (discussion) => discussion.id === discussionSource.discussionId,
      )
    ) {
      focusMemberDetailRef.current = workspaceView === "members";
      setDiscussionSource(null);
    }
  }, [discussionSource, requestState, workspaceView]);

  useEffect(() => {
    if (
      workspaceView !== "members" ||
      selectedMemberId === null ||
      !focusMemberDetailRef.current
    ) {
      return;
    }
    const frame = requestAnimationFrame(() => {
      const back = discussionSource
        ? document.querySelector<HTMLElement>("[data-member-return-focus]")
        : null;
      const target =
        back ??
        document.querySelector<HTMLElement>("[data-member-overview-focus]");
      if (target) {
        focusMemberDetailRef.current = false;
        target.focus();
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [discussionSource, selectedMemberId, workspaceView]);

  useEffect(() => {
    const source = restoreDiscussionFocusRef.current;
    if (
      workspaceView !== "discussions" ||
      source === null ||
      selectedDiscussionId !== source.discussionId
    ) {
      return;
    }
    const frame = requestAnimationFrame(() => {
      const trigger = [
        ...document.querySelectorAll<HTMLElement>(
          "[data-member-navigation-key]",
        ),
      ].find(
        (element) => element.dataset.memberNavigationKey === source.triggerKey,
      );
      const fallback = document.querySelector<HTMLElement>(
        `[data-discussion-focus-id="${source.discussionId}"]`,
      );
      const target = trigger ?? fallback;
      if (target) {
        restoreDiscussionFocusRef.current = null;
        target.focus();
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [selectedDiscussionId, workspaceView]);

  if (requestState.status === "loading") {
    return <StatusPage label="Starting Flowent" />;
  }

  if (requestState.status === "error") {
    return <StatusPage label={requestState.message} tone="error" />;
  }

  const { snapshot } = requestState;
  const selectedDiscussionSummary = snapshot.discussions.find(
    (discussion) => discussion.id === selectedDiscussionId,
  );
  const selectedDiscussionCache =
    selectedDiscussionId === null
      ? undefined
      : discussionCaches[selectedDiscussionId];
  const selectedDiscussion = selectedDiscussionSummary
    ? {
        ...selectedDiscussionSummary,
        messages: selectedDiscussionCache
          ? cachedDiscussionMessages(selectedDiscussionCache)
          : [],
      }
    : undefined;
  const selectedMember = snapshot.members.find(
    (member) => member.id === selectedMemberId,
  );
  const sourceDiscussion = snapshot.discussions.find(
    (discussion) => discussion.id === discussionSource?.discussionId,
  );
  const currentHumanMember = snapshot.members.find(
    (member) => member.id === snapshot.organization.current_human_member_id,
  );
  if (!currentHumanMember) {
    return (
      <StatusPage label="Current Human Member is unavailable" tone="error" />
    );
  }
  const currentHumanMemberId = currentHumanMember.id;

  function commit(nextSnapshot: OrganizationSnapshot) {
    startTransition(() => {
      setRequestState({ status: "ready", snapshot: nextSnapshot });
    });
  }

  async function mutate(
    action: () => Promise<OrganizationSnapshot>,
    formatMutationError: (error: unknown) => string = errorMessage,
    rethrow = false,
  ) {
    pendingMutationsRef.current += 1;
    setIsSaving(true);
    setMutationError(null);
    const run = mutationQueueRef.current.then(async () => {
      try {
        const nextSnapshot = await action();
        commit(nextSnapshot);
        return nextSnapshot;
      } catch (error) {
        setMutationError(formatMutationError(error));
        if (rethrow) {
          throw error;
        }
        return null;
      } finally {
        pendingMutationsRef.current -= 1;
        if (pendingMutationsRef.current === 0) {
          setIsSaving(false);
        }
      }
    });
    mutationQueueRef.current = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  async function handleCreateAgent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const validationError = memberNameValidationMessage(
      agentName,
      snapshot.member_name_policy,
    );
    if (validationError) {
      setMutationError(validationError);
      return;
    }
    const nextSnapshot = await mutate(
      () => backend.createAgent(agentName),
      (error) =>
        error instanceof FlowentRequestError
          ? (memberNameErrorMessage(error.code, snapshot.member_name_policy) ??
            error.message)
          : errorMessage(error),
    );
    if (nextSnapshot) {
      const created = nextSnapshot.members[nextSnapshot.members.length - 1];
      setAgentName("");
      setSelectedMemberId(created?.type === "agent" ? created.id : null);
      setIsCreatingAgent(false);
    }
  }

  async function handleRenameMember(memberId: number, name: string) {
    await mutate(
      () => backend.renameMember(memberId, name),
      (error) =>
        error instanceof FlowentRequestError
          ? (memberNameErrorMessage(error.code, snapshot.member_name_policy) ??
            error.message)
          : errorMessage(error),
      true,
    );
  }

  async function handleCreateDiscussion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextSnapshot = await mutate(() =>
      backend.createDiscussion(currentHumanMemberId, topic, selectedMemberIds),
    );
    if (nextSnapshot) {
      const created =
        nextSnapshot.discussions[nextSnapshot.discussions.length - 1];
      setTopic("");
      setSelectedMemberIds([]);
      setMessageBody("");
      setMessageMentions([]);
      focusMessageAfterDialogRef.current = true;
      setSelectedDiscussionId(created?.id ?? null);
      setWorkspaceView("discussions");
      setIsCreatingDiscussion(false);
    }
  }

  async function handleDeleteAgent(agentId: number) {
    const nextSnapshot = await mutate(() => backend.deleteAgent(agentId));
    if (nextSnapshot) {
      setSelectedMemberId((current) => (current === agentId ? null : current));
      setSelectedDiscussionId((current) =>
        current !== null &&
        !nextSnapshot.discussions.some(
          (discussion) => discussion.id === current,
        )
          ? null
          : current,
      );
      setAgentHistoryCaches((current) => {
        const next = { ...current };
        delete next[agentId];
        return next;
      });
      delete agentHistoryRequestTokensRef.current[agentId];
      setMessageBody("");
      setMessageMentions([]);
    }
  }

  async function handleRenameAgent(memberId: number, name: string) {
    await mutate(
      () => backend.renameMember(memberId, name),
      (error) =>
        error instanceof FlowentRequestError
          ? (memberNameErrorMessage(error.code, snapshot.member_name_policy) ??
            error.message)
          : errorMessage(error),
      true,
    );
  }

  async function handlePauseAgent(agentId: number) {
    await mutate(() => backend.pauseAgent(agentId));
  }

  async function handleResumeAgent(agentId: number) {
    await mutate(() => backend.resumeAgent(agentId));
  }

  async function handleDeleteDiscussion(discussionId: number) {
    const nextSnapshot = await mutate(() =>
      backend.deleteDiscussion(discussionId),
    );
    if (nextSnapshot) {
      setDiscussionCaches((current) => {
        const next = { ...current };
        delete next[discussionId];
        return next;
      });
      delete discussionRequestTokensRef.current[discussionId];
    }
    if (nextSnapshot && selectedDiscussionId === discussionId) {
      setSelectedDiscussionId(null);
      setMessageBody("");
      setMessageMentions([]);
    }
    if (nextSnapshot && discussionSource?.discussionId === discussionId) {
      focusMemberDetailRef.current = workspaceView === "members";
      restoreDiscussionFocusRef.current = null;
      setDiscussionSource(null);
    }
  }

  async function handleMessagesSeen(
    discussionId: number,
    messageIds: number[],
  ) {
    const nextSnapshot = await mutate(() =>
      backend.seeHumanMessages(currentHumanMemberId, discussionId, messageIds),
    );
    if (nextSnapshot) {
      setDiscussionCaches((current) => {
        const currentCache = current[discussionId];
        if (!currentCache) return current;
        const messagesById = { ...currentCache.messagesById };
        for (const messageId of messageIds) {
          const message = messagesById[messageId];
          if (message)
            messagesById[messageId] = {
              ...message,
              human_mentions: message.human_mentions?.map((mention) =>
                mention.member_id === currentHumanMemberId
                  ? { ...mention, status: "read" }
                  : mention,
              ),
            };
        }
        return {
          ...current,
          [discussionId]: { ...currentCache, messagesById },
        };
      });
    }
  }

  async function handleMarkAllRead(
    discussionId: number,
    throughMessageId: number,
  ) {
    return Boolean(
      await mutate(() =>
        backend.markAllHumanMessagesRead(
          currentHumanMemberId,
          discussionId,
          throughMessageId,
        ),
      ),
    );
  }

  async function handleAcknowledgeHumanMention(
    discussionId: number,
    messageId: number,
  ) {
    await mutate(() =>
      backend.ackHumanMention(currentHumanMemberId, discussionId, messageId),
    );
  }

  async function handleSendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedDiscussion) {
      return;
    }
    const nextSnapshot = await mutate(() =>
      backend.sendMessage(
        currentHumanMemberId,
        selectedDiscussion.id,
        messageBody,
      ),
    );
    if (nextSnapshot) {
      const latestMessageId = nextSnapshot.discussions.find(
        (discussion) => discussion.id === selectedDiscussion.id,
      )?.latest_message_id;
      await loadDiscussionPage(
        selectedDiscussion.id,
        latestMessageId ? { anchor_message_id: latestMessageId } : {},
      );
      restoreMessageFocusRef.current = true;
      setMessageBody("");
      setMessageMentions([]);
    }
  }

  function toggleMember(memberId: number) {
    setSelectedMemberIds((current) => toggleId(current, memberId));
  }

  function changeAgentDialog(open: boolean) {
    if (isSaving) {
      return;
    }
    setMutationError(null);
    setAgentName("");
    setIsCreatingAgent(open);
  }

  function changeDiscussionDialog(open: boolean) {
    if (isSaving) {
      return;
    }
    setMutationError(null);
    setTopic("");
    setSelectedMemberIds([]);
    setIsCreatingDiscussion(open);
  }

  function focusAfterDiscussionDialogClose() {
    if (!focusMessageAfterDialogRef.current) {
      return false;
    }
    focusMessageAfterDialogRef.current = false;
    requestAnimationFrame(() => messageInputRef.current?.focus());
    return true;
  }

  function changeMessageDraft(body: string, mentions: DraftMention[]) {
    setMessageBody(body);
    setMessageMentions(mentions);
  }

  function selectDiscussion(discussionId: number) {
    focusMemberDetailRef.current = false;
    restoreDiscussionFocusRef.current = null;
    setDiscussionSource(null);
    setSelectedDiscussionId(discussionId);
    setWorkspaceView("discussions");
    setIsCreatingDiscussion(false);
    setMessageBody("");
    setMessageMentions([]);
    const discussion = snapshot.discussions.find(
      (candidate) => candidate.id === discussionId,
    );
    if (
      !discussion ||
      humanUnreadForDiscussion(discussion, currentHumanMemberId).unreadCount ===
        0
    ) {
      requestAnimationFrame(() => messageInputRef.current?.focus());
    }
  }

  function selectWorkspaceView(view: WorkspaceView) {
    focusMemberDetailRef.current = false;
    restoreDiscussionFocusRef.current = null;
    setDiscussionSource(null);
    setWorkspaceView(view);
    setIsCreatingAgent(false);
    setIsCreatingDiscussion(false);
    setTopic("");
    setSelectedMemberIds([]);
  }

  function returnToSourceDiscussion() {
    if (!sourceDiscussion || !discussionSource) {
      focusMemberDetailRef.current = true;
      setDiscussionSource(null);
      return;
    }
    restoreDiscussionFocusRef.current = discussionSource;
    setSelectedDiscussionId(sourceDiscussion.id);
    setWorkspaceView("discussions");
    setDiscussionSource(null);
    setIsCreatingAgent(false);
  }

  const agents = snapshot.members.filter(
    (member): member is AgentMember => member.type === "agent",
  );
  return (
    <main className="app-shell bg-canvas text-text-primary">
      <AppSidebar
        discussionCount={snapshot.discussions.length}
        memberCount={snapshot.members.length}
        onSelectView={selectWorkspaceView}
        view={workspaceView}
      />

      <section className="workspace-main bg-surface">
        {workspaceView === "members" ? (
          <MembersPage
            agentName={agentName}
            disabled={isSaving}
            discussions={snapshot.discussions}
            error={isCreatingAgent ? mutationError : null}
            historyCache={
              selectedMember?.type === "agent"
                ? (agentHistoryCaches[selectedMember.id] ??
                  createAgentHistoryCache())
                : undefined
            }
            onLoadEarlierHistory={(agentId, beforeSequence) =>
              loadAgentHistoryPage(agentId, beforeSequence)
            }
            onLoadHistoryRun={loadAgentHistoryRun}
            onToggleHistoryEntry={async (agentId, runId, entryId, open) => {
              if (open) await loadAgentHistoryEntry(agentId, runId, entryId);
              else
                setAgentHistoryCaches((current) => {
                  const cache = current[agentId] ?? createAgentHistoryCache();
                  return {
                    ...current,
                    [agentId]: {
                      ...cache,
                      expandedIds: cache.expandedIds.filter(
                        (id) => id !== entryId,
                      ),
                    },
                  };
                });
            }}
            onHistoryScrollState={(agentId, scrollTop, followsLatest) =>
              setAgentHistoryCaches((current) => ({
                ...current,
                [agentId]: {
                  ...(current[agentId] ?? createAgentHistoryCache()),
                  scrollTop,
                  followsLatest,
                  newRunCount: followsLatest
                    ? 0
                    : (current[agentId]?.newRunCount ?? 0),
                },
              }))
            }
            isCreatingAgent={isCreatingAgent}
            members={snapshot.members}
            namePolicy={snapshot.member_name_policy}
            onAgentDialogOpenChange={changeAgentDialog}
            onAgentNameChange={setAgentName}
            onCreateAgent={handleCreateAgent}
            onDeleteAgent={handleDeleteAgent}
            onPauseAgent={handlePauseAgent}
            onRenameAgent={handleRenameAgent}
            onRenameMember={handleRenameMember}
            onResumeAgent={handleResumeAgent}
            onBackToDiscussion={
              sourceDiscussion ? returnToSourceDiscussion : undefined
            }
            onSelectMember={setSelectedMemberId}
            selectedMember={selectedMember}
            sourceDiscussionTopic={sourceDiscussion?.topic}
          />
        ) : null}
        {workspaceView === "settings" ? <SettingsPage /> : null}
        {workspaceView === "discussions" ? (
          <DiscussionsPage
            agents={agents}
            currentHumanMemberId={currentHumanMemberId}
            disabled={isSaving}
            discussions={snapshot.discussions}
            error={mutationError}
            isCreating={isCreatingDiscussion}
            members={snapshot.members}
            messageBody={messageBody}
            messageInputRef={messageInputRef}
            messageMentions={messageMentions}
            mentionSyntax={snapshot.mention_syntax}
            onCreateDiscussion={handleCreateDiscussion}
            onDialogCloseAutoFocus={focusAfterDiscussionDialogClose}
            onDialogOpenChange={changeDiscussionDialog}
            onDeleteDiscussion={handleDeleteDiscussion}
            onMessageChange={changeMessageDraft}
            onMessagesSeen={(discussionId, messageIds) =>
              void handleMessagesSeen(discussionId, messageIds)
            }
            onRequestMessage={
              selectedDiscussionId !== null
                ? (messageId) =>
                    loadDiscussionPage(selectedDiscussionId, {
                      anchor_message_id: messageId,
                    })
                : undefined
            }
            onLoadNewMessages={
              selectedDiscussionId !== null
                ? () =>
                    loadDiscussionPage(selectedDiscussionId, {
                      after_message_id:
                        selectedDiscussionCache?.newestMessageId ?? undefined,
                    })
                : undefined
            }
            unloadedNewMessageCount={
              selectedDiscussionSummary?.latest_message_id &&
              selectedDiscussionCache?.newestMessageId &&
              selectedDiscussionSummary.latest_message_id >
                selectedDiscussionCache.newestMessageId &&
              !selectedDiscussionCache.followsLatest
                ? 1
                : 0
            }
            onLoadEarlier={
              selectedDiscussionCache?.hasEarlier &&
              selectedDiscussionId !== null
                ? () =>
                    loadDiscussionPage(selectedDiscussionId, {
                      before_message_id:
                        selectedDiscussionCache.oldestMessageId ?? undefined,
                    })
                : undefined
            }
            messagePageLoading={selectedDiscussionCache?.loading}
            messagePageError={selectedDiscussionCache?.error}
            initialScrollTop={
              selectedDiscussionCache?.loaded
                ? selectedDiscussionCache.scrollTop
                : undefined
            }
            onMessageScrollState={(scrollTop, followsLatest) => {
              if (!selectedDiscussionId) return;
              setDiscussionCaches((current) => ({
                ...current,
                [selectedDiscussionId]: {
                  ...(current[selectedDiscussionId] ??
                    createDiscussionMessageCache()),
                  scrollTop,
                  followsLatest,
                },
              }));
            }}
            onMarkAllRead={handleMarkAllRead}
            onAcknowledgeHumanMention={(discussionId, messageId) =>
              void handleAcknowledgeHumanMention(discussionId, messageId)
            }
            onOpenMember={openMemberFromDiscussion}
            onCreateAgent={() => {
              selectWorkspaceView("members");
              setIsCreatingAgent(true);
            }}
            onSelectDiscussion={selectDiscussion}
            onSend={handleSendMessage}
            onToggleMember={toggleMember}
            selectedDiscussion={selectedDiscussion}
            selectedMemberIds={selectedMemberIds}
            setTopic={setTopic}
            topic={topic}
          />
        ) : null}

        {mutationError && !isCreatingAgent && !isCreatingDiscussion ? (
          <p
            className="caption-text mutation-error m-0 border border-danger bg-surface px-3 py-2 text-danger"
            role="alert"
          >
            {mutationError}
          </p>
        ) : null}
      </section>
    </main>
  );
}

function StatusPage({
  label,
  tone = "default",
}: {
  label: string;
  tone?: "default" | "error";
}) {
  return (
    <main className="grid h-svh place-items-center bg-canvas">
      <p className={tone === "error" ? "text-danger" : "text-text-secondary"}>
        {label}
      </p>
    </main>
  );
}

export default App;
