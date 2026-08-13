import {
  type FormEvent,
  type KeyboardEvent,
  startTransition,
  useEffect,
  useRef,
  useState,
} from "react";
import { AppSidebar, type WorkspaceView } from "@/components/layout";
import { Button, Checkbox, Input, Plus, Textarea } from "@/components/ui";
import {
  type AgentMember,
  backend,
  type Discussion,
  type Member,
  type ModelProvider,
  type ModelSettings,
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

export function shouldSubmitMessage({
  isComposing,
  key,
  shiftKey,
}: {
  isComposing: boolean;
  key: string;
  shiftKey: boolean;
}) {
  return key === "Enter" && !shiftKey && !isComposing;
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
  const selectedDiscussion =
    snapshot.discussions.find(
      (discussion) => discussion.id === selectedDiscussionId,
    ) ?? snapshot.discussions[0];

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
            isCreating={isCreatingDiscussion}
            members={snapshot.members}
            messageBody={messageBody}
            messageInputRef={messageInputRef}
            messageMentionIds={messageMentionIds}
            onCreateDiscussion={handleCreateDiscussion}
            onMessageChange={setMessageBody}
            onMentionToggle={toggleMessageMention}
            onSelectDiscussion={selectDiscussion}
            onStartCreate={() => setIsCreatingDiscussion(true)}
            onSend={handleSendMessage}
            onToggleMember={toggleMember}
            selectedDiscussion={selectedDiscussion}
            selectedMemberIds={selectedMemberIds}
            setTopic={setTopic}
            topic={topic}
          />
        ) : null}

        {mutationError ? (
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

function PageHeading({ count, title }: { count?: number; title: string }) {
  return (
    <header className="page-heading border-border border-b">
      <h2 className="page-title m-0 font-semibold">{title}</h2>
      {count !== undefined ? (
        <span className="meta-text font-mono text-text-tertiary">{count}</span>
      ) : null}
    </header>
  );
}

function MembersPage({ members }: { members: Member[] }) {
  return (
    <section className="page-pane">
      <PageHeading count={members.length} title="Members" />
      <ul className="entity-list">
        {members.map((member) => (
          <li key={member.id}>
            <span className="entity-mark" aria-hidden="true">
              {member.name.slice(0, 1).toUpperCase()}
            </span>
            <span className="entity-copy">
              <strong>{member.name}</strong>
              <span>{member.type === "human" ? "Human" : "Agent"}</span>
            </span>
            <span className="meta-text font-mono text-text-tertiary">
              {member.type === "agent" ? member.status.toUpperCase() : "ACTIVE"}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

type AgentsPageProps = {
  agentName: string;
  agentNameInputRef: React.RefObject<HTMLInputElement | null>;
  agents: AgentMember[];
  disabled: boolean;
  onAgentNameChange: (name: string) => void;
  onCreateAgent: (event: FormEvent<HTMLFormElement>) => void;
  onRetryAgent: (agentId: number) => void;
};

function AgentsPage({
  agentName,
  agentNameInputRef,
  agents,
  disabled,
  onAgentNameChange,
  onCreateAgent,
  onRetryAgent,
}: AgentsPageProps) {
  return (
    <section className="page-pane page-pane--agents">
      <PageHeading count={agents.length} title="Agents" />
      <form
        className="entity-create-form border-border border-b"
        aria-label="Create Agent"
        onSubmit={onCreateAgent}
      >
        <Input
          aria-label="Agent name"
          disabled={disabled}
          onChange={(event) => onAgentNameChange(event.target.value)}
          placeholder="Agent name"
          ref={agentNameInputRef}
          required
          value={agentName}
        />
        <Button disabled={disabled} type="submit" variant="primary">
          New
        </Button>
      </form>
      {agents.length === 0 ? (
        <div className="page-empty">
          <p className="body-compact m-0 text-text-tertiary">No Agents</p>
        </div>
      ) : (
        <ul className="entity-list">
          {agents.map((agent) => (
            <li key={agent.id}>
              <span
                className="entity-mark entity-mark--agent"
                aria-hidden="true"
              >
                {agent.name.slice(0, 1).toUpperCase()}
              </span>
              <span className="entity-copy">
                <strong>{agent.name}</strong>
                <span>Agent {agent.id}</span>
              </span>
              <span className="meta-text font-mono text-text-tertiary">
                {agent.status.toUpperCase()}
              </span>
              {agent.error ? (
                <div className="entity-error">
                  <span className="caption-text text-danger" role="alert">
                    {agent.error}
                  </span>
                  <Button
                    aria-label={`Retry ${agent.name}`}
                    disabled={disabled}
                    onClick={() => onRetryAgent(agent.id)}
                    size="compact"
                    variant="quiet"
                  >
                    Retry
                  </Button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

const providerOptions: Array<{ label: string; value: ModelProvider }> = [
  { label: "OpenAI", value: "openai" },
  { label: "Anthropic", value: "anthropic" },
  { label: "Google", value: "google" },
];

function SettingsPage() {
  const [settings, setSettings] = useState<ModelSettings | null>(null);
  const [provider, setProvider] = useState<ModelProvider>("openai");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [status, setStatus] = useState<
    "loading" | "ready" | "saving" | "saved"
  >("loading");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void backend
      .getModelSettings()
      .then((current) => {
        if (!active) {
          return;
        }
        setSettings(current);
        setProvider(current.provider);
        setBaseUrl(current.base_url);
        setModel(current.model);
        setStatus("ready");
      })
      .catch((reason) => {
        if (active) {
          setError(errorMessage(reason));
          setStatus("ready");
        }
      });
    return () => {
      active = false;
    };
  }, []);

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("saving");
    setError(null);
    try {
      const current = await backend.updateModelSettings({
        provider,
        base_url: baseUrl,
        api_key: apiKey,
        model,
      });
      setSettings(current);
      setProvider(current.provider);
      setBaseUrl(current.base_url);
      setApiKey("");
      setModel(current.model);
      setStatus("saved");
    } catch (reason) {
      setError(errorMessage(reason));
      setStatus("ready");
    }
  }

  const disabled = status === "loading" || status === "saving";
  const hasApiKey = settings?.has_api_key ?? false;

  return (
    <section className="page-pane page-pane--settings">
      <PageHeading title="Settings" />
      <form
        className="settings-form"
        aria-label="Model settings"
        onSubmit={handleSave}
      >
        <fieldset className="settings-provider">
          <legend>Provider</legend>
          <div>
            {providerOptions.map((option) => (
              <Button
                aria-pressed={provider === option.value}
                disabled={disabled}
                key={option.value}
                onClick={() => setProvider(option.value)}
                size="compact"
                variant={provider === option.value ? "secondary" : "quiet"}
              >
                {option.label}
              </Button>
            ))}
          </div>
        </fieldset>
        <label className="settings-field" htmlFor="model-base-url">
          <span>Base URL</span>
          <Input
            aria-label="Base URL"
            id="model-base-url"
            autoComplete="url"
            disabled={disabled}
            onChange={(event) => setBaseUrl(event.target.value)}
            placeholder="https://api.example.com"
            required
            type="url"
            value={baseUrl}
          />
        </label>
        <label className="settings-field" htmlFor="model-api-key">
          <span>API key</span>
          <Input
            aria-label="API key"
            id="model-api-key"
            autoComplete="new-password"
            disabled={disabled}
            onChange={(event) => setApiKey(event.target.value)}
            placeholder={hasApiKey ? "Saved" : "API key"}
            required={!hasApiKey}
            type="password"
            value={apiKey}
          />
        </label>
        <label className="settings-field" htmlFor="model-name">
          <span>Model</span>
          <Input
            aria-label="Model"
            id="model-name"
            autoComplete="off"
            disabled={disabled}
            onChange={(event) => setModel(event.target.value)}
            placeholder="Model"
            required
            value={model}
          />
        </label>
        <div className="settings-actions">
          <Button disabled={disabled} type="submit" variant="primary">
            {status === "saving" ? "Saving" : "Save"}
          </Button>
          {status === "saved" ? <span role="status">Saved</span> : null}
        </div>
        {error ? (
          <p className="caption-text m-0 text-danger" role="alert">
            {error}
          </p>
        ) : null}
      </form>
    </section>
  );
}

type DiscussionsPageProps = {
  agents: AgentMember[];
  disabled: boolean;
  discussions: Discussion[];
  isCreating: boolean;
  members: Member[];
  messageBody: string;
  messageInputRef: React.RefObject<HTMLTextAreaElement | null>;
  messageMentionIds: number[];
  onCreateDiscussion: (event: FormEvent<HTMLFormElement>) => void;
  onMessageChange: (body: string) => void;
  onMentionToggle: (memberId: number) => void;
  onSelectDiscussion: (discussionId: number) => void;
  onStartCreate: () => void;
  onSend: (event: FormEvent<HTMLFormElement>) => void;
  onToggleMember: (memberId: number) => void;
  selectedDiscussion?: Discussion;
  selectedMemberIds: number[];
  setTopic: (topic: string) => void;
  topic: string;
};

function DiscussionsPage({
  agents,
  disabled,
  discussions,
  isCreating,
  members,
  messageBody,
  messageInputRef,
  messageMentionIds,
  onCreateDiscussion,
  onMessageChange,
  onMentionToggle,
  onSelectDiscussion,
  onStartCreate,
  onSend,
  onToggleMember,
  selectedDiscussion,
  selectedMemberIds,
  setTopic,
  topic,
}: DiscussionsPageProps) {
  return (
    <section className="discussions-workspace">
      <aside className="discussion-list-pane" aria-label="Discussion list">
        <header>
          <h2>Discussions</h2>
          <div className="discussion-list-actions">
            <span className="font-mono">{discussions.length}</span>
            <Button
              aria-label="New discussion"
              disabled={agents.length === 0 || disabled}
              onClick={onStartCreate}
              size="compact"
              variant="primary"
            >
              <Plus aria-hidden="true" size={14} />
              New
            </Button>
          </div>
        </header>
        {discussions.length === 0 ? (
          <p className="discussion-list-empty">No discussions</p>
        ) : (
          <div className="discussion-list-items">
            {discussions.map((discussion) => {
              const selected =
                !isCreating && selectedDiscussion?.id === discussion.id;
              return (
                <Button
                  aria-current={selected ? "page" : undefined}
                  aria-label={`Open ${discussion.topic}`}
                  className="discussion-list-button"
                  key={discussion.id}
                  onClick={() => onSelectDiscussion(discussion.id)}
                  variant={selected ? "secondary" : "quiet"}
                >
                  <span>{discussion.topic}</span>
                  <span>{discussion.messages.length} messages</span>
                </Button>
              );
            })}
          </div>
        )}
      </aside>
      <div className="discussion-detail-pane">
        {isCreating || !selectedDiscussion ? (
          <DiscussionStart>
            <DiscussionForm
              agents={agents}
              disabled={disabled}
              onSubmit={onCreateDiscussion}
              onToggleMember={onToggleMember}
              selectedMemberIds={selectedMemberIds}
              setTopic={setTopic}
              topic={topic}
            />
          </DiscussionStart>
        ) : (
          <section className="discussion-pane">
            <DiscussionView
              discussion={selectedDiscussion}
              key={selectedDiscussion.id}
              disabled={disabled}
              members={members}
              messageBody={messageBody}
              messageInputRef={messageInputRef}
              messageMentionIds={messageMentionIds}
              onMessageChange={onMessageChange}
              onMentionToggle={onMentionToggle}
              onSend={onSend}
            />
          </section>
        )}
      </div>
    </section>
  );
}

function DiscussionStart({ children }: { children: React.ReactNode }) {
  return (
    <section className="page-pane">
      <PageHeading title="New discussion" />
      <div className="discussion-start">{children}</div>
    </section>
  );
}

type DiscussionFormProps = {
  agents: Array<{ id: number; name: string }>;
  disabled: boolean;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onToggleMember: (memberId: number) => void;
  selectedMemberIds: number[];
  setTopic: (topic: string) => void;
  topic: string;
};

function DiscussionForm({
  agents,
  disabled,
  onSubmit,
  onToggleMember,
  selectedMemberIds,
  setTopic,
  topic,
}: DiscussionFormProps) {
  return (
    <form
      className="discussion-form"
      aria-label="Create Discussion"
      onSubmit={onSubmit}
    >
      <label
        className="section-label mb-2 block font-medium text-text-secondary"
        htmlFor="topic"
      >
        Topic
      </label>
      <Input
        disabled={disabled}
        id="topic"
        onChange={(event) => setTopic(event.target.value)}
        placeholder="Topic"
        required
        value={topic}
      />
      <fieldset className="my-2 border-0 p-0">
        <legend className="sr-only">Members</legend>
        {agents.length === 0 ? (
          <p className="section-label m-0 text-text-tertiary">
            Create an Agent first
          </p>
        ) : (
          <div className="flex flex-wrap gap-x-3 gap-y-1">
            {agents.map((agent) => {
              const checkboxId = `discussion-member-${agent.id}`;
              return (
                <label
                  className="caption-text flex min-h-7 items-center gap-2 text-text-secondary"
                  htmlFor={checkboxId}
                  key={agent.id}
                >
                  <Checkbox
                    checked={selectedMemberIds.includes(agent.id)}
                    disabled={disabled}
                    id={checkboxId}
                    onChange={() => onToggleMember(agent.id)}
                  />
                  {agent.name}
                </label>
              );
            })}
          </div>
        )}
      </fieldset>
      <Button
        className="w-full"
        disabled={
          disabled || agents.length === 0 || selectedMemberIds.length === 0
        }
        type="submit"
        variant="primary"
      >
        Create
      </Button>
    </form>
  );
}

type DiscussionViewProps = {
  discussion: Discussion;
  disabled: boolean;
  members: OrganizationSnapshot["members"];
  messageBody: string;
  messageInputRef: React.RefObject<HTMLTextAreaElement | null>;
  messageMentionIds: number[];
  onMessageChange: (body: string) => void;
  onMentionToggle: (memberId: number) => void;
  onSend: (event: FormEvent<HTMLFormElement>) => void;
};

function DiscussionView({
  discussion,
  disabled,
  members,
  messageBody,
  messageInputRef,
  messageMentionIds,
  onMessageChange,
  onMentionToggle,
  onSend,
}: DiscussionViewProps) {
  const messageLogRef = useRef<HTMLDivElement>(null);
  const shouldFollowMessagesRef = useRef(true);
  const membersById = new Map(members.map((member) => [member.id, member]));
  const discussionMembers = discussion.member_ids
    .map((id) => membersById.get(id)?.name)
    .filter(Boolean)
    .join(", ");
  const discussionAgents = discussion.member_ids
    .map((id) => membersById.get(id))
    .filter((member) => member?.type === "agent");

  useEffect(() => {
    const log = messageLogRef.current;
    if (
      discussion.messages.length > 0 &&
      log &&
      shouldFollowMessagesRef.current
    ) {
      log.scrollTop = log.scrollHeight;
    }
  }, [discussion.messages.length]);

  function handleMessageScroll() {
    const log = messageLogRef.current;
    if (!log) {
      return;
    }
    shouldFollowMessagesRef.current =
      log.scrollHeight - log.scrollTop - log.clientHeight <= 24;
  }

  function handleMessageKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (
      !shouldSubmitMessage({
        isComposing: event.nativeEvent.isComposing,
        key: event.key,
        shiftKey: event.shiftKey,
      })
    ) {
      return;
    }
    event.preventDefault();
    shouldFollowMessagesRef.current = true;
    event.currentTarget.form?.requestSubmit();
  }

  function handleSend(event: FormEvent<HTMLFormElement>) {
    shouldFollowMessagesRef.current = true;
    onSend(event);
  }

  return (
    <>
      <header className="border-border border-b px-6 py-4">
        <div className="flex items-baseline justify-between gap-6">
          <h2 className="discussion-title m-0 font-semibold">
            {discussion.topic}
          </h2>
          <span className="meta-text font-mono text-text-tertiary">
            DISCUSSION {discussion.id}
          </span>
        </div>
        <p className="caption-text mt-1 mb-0 text-text-secondary">
          {discussionMembers}
        </p>
      </header>
      <div
        className="message-log min-h-0 overflow-y-auto px-6 py-2"
        aria-label="Messages"
        onScroll={handleMessageScroll}
        ref={messageLogRef}
        role="log"
      >
        {discussion.messages.length === 0 ? (
          <div className="grid h-full place-items-center">
            <p className="body-compact m-0 text-text-tertiary">
              No messages yet
            </p>
          </div>
        ) : (
          <ol className="m-0 list-none p-0">
            {discussion.messages.map((message) => {
              const sender = membersById.get(message.sender_id);
              const isHuman = sender?.type === "human";
              return (
                <li
                  className={`message-row ${isHuman ? "message-row--human" : "message-row--agent"}`}
                  key={message.id}
                >
                  <span className="message-avatar" aria-hidden="true">
                    {(sender?.name ?? "Unknown").slice(0, 1).toUpperCase()}
                  </span>
                  <article className="message-bubble">
                    <header className="message-meta">
                      <strong>{sender?.name ?? "Unknown"}</strong>
                      <span className="font-mono">MESSAGE {message.id}</span>
                    </header>
                    <p className="message-body m-0 whitespace-pre-wrap">
                      {message.body}
                    </p>
                    {message.mentions.length > 0 ? (
                      <ul className="mention-statuses" aria-label="Mentions">
                        {message.mentions.map((mention) => (
                          <li className="font-mono" key={mention.member_id}>
                            @
                            {membersById.get(mention.member_id)?.name ??
                              mention.member_id}{" "}
                            · {mention.status.toUpperCase()}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </article>
                </li>
              );
            })}
          </ol>
        )}
      </div>
      <form
        className="border-border border-t bg-surface-subtle p-4"
        aria-label="Send Message"
        onSubmit={handleSend}
      >
        <fieldset className="mention-picker">
          <legend className="section-label text-text-secondary">Mention</legend>
          {discussionAgents.map((agent) => {
            const mentionId = `message-mention-${agent.id}`;
            return (
              <label
                className="caption-text mention-option text-text-secondary"
                htmlFor={mentionId}
                key={agent.id}
              >
                <Checkbox
                  checked={messageMentionIds.includes(agent.id)}
                  disabled={disabled}
                  id={mentionId}
                  onChange={() => onMentionToggle(agent.id)}
                />
                @{agent.name}
              </label>
            );
          })}
        </fieldset>
        <div className="flex items-end gap-3">
          <Textarea
            aria-label="Message"
            autoFocus
            disabled={disabled}
            onChange={(event) => onMessageChange(event.target.value)}
            onKeyDown={handleMessageKeyDown}
            placeholder="Write a message"
            ref={messageInputRef}
            required
            rows={3}
            value={messageBody}
          />
          <Button disabled={disabled} type="submit" variant="primary">
            Send
          </Button>
        </div>
      </form>
    </>
  );
}

export default App;
