import {
  type FormEvent,
  startTransition,
  useEffect,
  useRef,
  useState,
} from "react";
import { AppSidebar, type WorkspaceView } from "@/components/layout";
import { AgentsPage } from "@/features/agents";
import { DiscussionsPage } from "@/features/discussions";
import { MembersPage } from "@/features/members";
import { SettingsPage } from "@/features/settings";
import {
  type AgentMember,
  backend,
  type OrganizationSnapshot,
} from "@/lib/backend";

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
  const [workspaceView, setWorkspaceView] =
    useState<WorkspaceView>("discussions");
  const [isCreatingDiscussion, setIsCreatingDiscussion] = useState(false);
  const [agentName, setAgentName] = useState("");
  const [topic, setTopic] = useState("");
  const [selectedMemberIds, setSelectedMemberIds] = useState<number[]>([]);
  const [messageBody, setMessageBody] = useState("");
  const [messageMentionIds, setMessageMentionIds] = useState<number[]>([]);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const agentNameInputRef = useRef<HTMLInputElement>(null);
  const messageInputRef = useRef<HTMLTextAreaElement>(null);
  const restoreAgentFocusRef = useRef(false);
  const restoreMessageFocusRef = useRef(false);
  const focusMessageAfterDialogRef = useRef(false);

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
    if (isSaving) {
      return;
    }
    if (restoreAgentFocusRef.current) {
      restoreAgentFocusRef.current = false;
      agentNameInputRef.current?.focus();
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
      setAgentName("");
    }
  }

  async function handleRetryAgent(agentId: number) {
    const nextSnapshot = await mutate(() => backend.retryAgent(agentId));
    if (nextSnapshot) {
      restoreAgentFocusRef.current = true;
    }
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
      setMessageMentionIds([]);
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
        messageMentionIds,
      ),
    );
    if (nextSnapshot) {
      restoreMessageFocusRef.current = true;
      setMessageBody("");
      setMessageMentionIds([]);
    }
  }

  function toggleMember(memberId: number) {
    setSelectedMemberIds((current) => toggleId(current, memberId));
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

  function toggleMessageMention(memberId: number) {
    setMessageMentionIds((current) => toggleId(current, memberId));
  }

  function selectDiscussion(discussionId: number) {
    setSelectedDiscussionId(discussionId);
    setWorkspaceView("discussions");
    setIsCreatingDiscussion(false);
    setMessageBody("");
    setMessageMentionIds([]);
    requestAnimationFrame(() => messageInputRef.current?.focus());
  }

  function selectWorkspaceView(view: WorkspaceView) {
    setWorkspaceView(view);
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
        agentCount={agents.length}
        discussionCount={snapshot.discussions.length}
        memberCount={snapshot.members.length}
        onSelectView={selectWorkspaceView}
        view={workspaceView}
        workingDirectory={snapshot.working_directory}
      />

      <section className="workspace-main bg-surface">
        {workspaceView === "members" ? (
          <MembersPage members={snapshot.members} />
        ) : null}
        {workspaceView === "settings" ? <SettingsPage /> : null}
        {workspaceView === "agents" ? (
          <AgentsPage
            agentName={agentName}
            agentNameInputRef={agentNameInputRef}
            agents={agents}
            disabled={isSaving}
            onAgentNameChange={setAgentName}
            onCreateAgent={handleCreateAgent}
            onRetryAgent={handleRetryAgent}
          />
        ) : null}
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
            messageMentionIds={messageMentionIds}
            onCreateDiscussion={handleCreateDiscussion}
            onDialogCloseAutoFocus={focusAfterDiscussionDialogClose}
            onDialogOpenChange={changeDiscussionDialog}
            onMessageChange={setMessageBody}
            onMentionToggle={toggleMessageMention}
            onSelectAgents={() => {
              selectWorkspaceView("agents");
              requestAnimationFrame(() => agentNameInputRef.current?.focus());
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

        {mutationError && !isCreatingDiscussion ? (
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
