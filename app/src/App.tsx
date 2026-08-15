import {
  type FormEvent,
  startTransition,
  useEffect,
  useRef,
  useState,
} from "react";
import { AppSidebar, type WorkspaceView } from "@/components/layout";
import {
  DiscussionsPage,
  type DraftMention,
  getDraftMentionIds,
} from "@/features/discussions";
import { MembersPage } from "@/features/members";
import { SettingsPage } from "@/features/settings";
import {
  type AgentHistory,
  type AgentMember,
  applyAgentHistoryEvent,
  backend,
  type OrganizationSnapshot,
} from "@/lib/backend";

type RequestState =
  | { status: "loading" }
  | { status: "ready"; snapshot: OrganizationSnapshot }
  | { status: "error"; message: string };

export type AgentHistoryRequestState =
  | { status: "loading" }
  | { status: "ready"; history: AgentHistory }
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
  const [agentHistories, setAgentHistories] = useState<
    Record<number, AgentHistoryRequestState>
  >({});
  const [isSaving, setIsSaving] = useState(false);
  const messageInputRef = useRef<HTMLTextAreaElement>(null);
  const restoreMessageFocusRef = useRef(false);
  const focusMessageAfterDialogRef = useRef(false);
  const selectedAgentId =
    requestState.status === "ready" &&
    requestState.snapshot.members.find(
      (member) => member.id === selectedMemberId,
    )?.type === "agent"
      ? selectedMemberId
      : null;

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function refresh() {
      try {
        const snapshot = await backend.getOrganization();
        if (active) {
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
    if (selectedAgentId === null) {
      return;
    }
    let active = true;
    setAgentHistories((current) =>
      current[selectedAgentId]
        ? current
        : { ...current, [selectedAgentId]: { status: "loading" } },
    );
    void backend
      .getAgentHistory(selectedAgentId)
      .then((history) => {
        if (active) {
          setAgentHistories((current) => ({
            ...current,
            [selectedAgentId]: { status: "ready", history },
          }));
        }
      })
      .catch((error) => {
        if (active) {
          setAgentHistories((current) => ({
            ...current,
            [selectedAgentId]: {
              status: "error",
              message: errorMessage(error),
            },
          }));
        }
      });
    return () => {
      active = false;
    };
  }, [selectedAgentId]);

  useEffect(() => {
    let active = true;
    const unsubscribe = backend.onAgentHistoryEvent((event) => {
      setAgentHistories((current) => {
        const existing = current[event.agent_id];
        const history =
          existing?.status === "ready"
            ? existing.history
            : { agent_id: event.agent_id, runs: [] };
        return {
          ...current,
          [event.agent_id]: {
            status: "ready",
            history: applyAgentHistoryEvent(history, event),
          },
        };
      });
      if (event.type === "run_completed" || event.type === "run_failed") {
        void backend
          .getAgentHistory(event.agent_id)
          .then((history) => {
            if (active) {
              setAgentHistories((current) => ({
                ...current,
                [event.agent_id]: { status: "ready", history },
              }));
            }
          })
          .catch((error) => {
            if (active) {
              setAgentHistories((current) => ({
                ...current,
                [event.agent_id]: {
                  status: "error",
                  message: errorMessage(error),
                },
              }));
            }
          });
      }
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (isSaving) {
      return;
    }
    if (restoreMessageFocusRef.current) {
      restoreMessageFocusRef.current = false;
      messageInputRef.current?.focus();
    }
  }, [isSaving]);

  if (requestState.status === "loading") {
    return <StatusPage label="Starting Flowent" />;
  }

  if (requestState.status === "error") {
    return <StatusPage label={requestState.message} tone="error" />;
  }

  const { snapshot } = requestState;
  const selectedDiscussion = snapshot.discussions.find(
    (discussion) => discussion.id === selectedDiscussionId,
  );
  const selectedMember = snapshot.members.find(
    (member) => member.id === selectedMemberId,
  );

  function commit(nextSnapshot: OrganizationSnapshot) {
    startTransition(() => {
      setRequestState({ status: "ready", snapshot: nextSnapshot });
    });
  }

  async function mutate(action: () => Promise<OrganizationSnapshot>) {
    setIsSaving(true);
    setMutationError(null);
    try {
      const nextSnapshot = await action();
      commit(nextSnapshot);
      return nextSnapshot;
    } catch (error) {
      setMutationError(errorMessage(error));
      return null;
    } finally {
      setIsSaving(false);
    }
  }

  async function handleCreateAgent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextSnapshot = await mutate(() => backend.createAgent(agentName));
    if (nextSnapshot) {
      const created = nextSnapshot.members[nextSnapshot.members.length - 1];
      setAgentName("");
      setSelectedMemberId(created?.type === "agent" ? created.id : null);
      setIsCreatingAgent(false);
    }
  }

  async function handleRetryAgent(agentId: number) {
    await mutate(() => backend.retryAgent(agentId));
  }

  async function handleCreateDiscussion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextSnapshot = await mutate(() =>
      backend.createDiscussion(topic, selectedMemberIds),
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

  async function handleSendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedDiscussion) {
      return;
    }
    const nextSnapshot = await mutate(() =>
      backend.sendMessage(
        selectedDiscussion.id,
        messageBody,
        getDraftMentionIds(messageMentions),
      ),
    );
    if (nextSnapshot) {
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
    setSelectedDiscussionId(discussionId);
    setWorkspaceView("discussions");
    setIsCreatingDiscussion(false);
    setMessageBody("");
    setMessageMentions([]);
    requestAnimationFrame(() => messageInputRef.current?.focus());
  }

  function selectWorkspaceView(view: WorkspaceView) {
    setWorkspaceView(view);
    setIsCreatingAgent(false);
    setIsCreatingDiscussion(false);
    setTopic("");
    setSelectedMemberIds([]);
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
        workingDirectory={snapshot.working_directory}
      />

      <section className="workspace-main bg-surface">
        {workspaceView === "members" ? (
          <MembersPage
            agentName={agentName}
            disabled={isSaving}
            error={isCreatingAgent ? mutationError : null}
            history={
              selectedMember?.type === "agent"
                ? (agentHistories[selectedMember.id] ?? { status: "loading" })
                : undefined
            }
            isCreatingAgent={isCreatingAgent}
            members={snapshot.members}
            onAgentDialogOpenChange={changeAgentDialog}
            onAgentNameChange={setAgentName}
            onCreateAgent={handleCreateAgent}
            onRetryAgent={handleRetryAgent}
            onSelectMember={setSelectedMemberId}
            selectedMember={selectedMember}
          />
        ) : null}
        {workspaceView === "settings" ? <SettingsPage /> : null}
        {workspaceView === "discussions" ? (
          <DiscussionsPage
            agents={agents}
            disabled={isSaving}
            discussions={snapshot.discussions}
            error={mutationError}
            isCreating={isCreatingDiscussion}
            members={snapshot.members}
            messageBody={messageBody}
            messageInputRef={messageInputRef}
            messageMentions={messageMentions}
            onCreateDiscussion={handleCreateDiscussion}
            onDialogCloseAutoFocus={focusAfterDiscussionDialogClose}
            onDialogOpenChange={changeDiscussionDialog}
            onMessageChange={changeMessageDraft}
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
