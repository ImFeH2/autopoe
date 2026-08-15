import {
  type FormEvent,
  type KeyboardEvent,
  startTransition,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  AppSidebar,
  PageHeader,
  type WorkspaceView,
} from "@/components/layout";
import {
  Badge,
  Button,
  Checkbox,
  Dialog,
  Input,
  ListButton,
  Plus,
  Search,
  StatusIndicator,
  Textarea,
} from "@/components/ui";
import {
  type AgentMember,
  backend,
  type Discussion,
  type Member,
  type Mention,
  type ModelProvider,
  type ModelSettings,
  type ObservabilitySettings,
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

function agentStatusTone(status: AgentMember["status"]) {
  if (status === "error") {
    return "danger" as const;
  }
  if (status === "running") {
    return "accent" as const;
  }
  return "success" as const;
}

function mentionStatusTone(status: Mention["status"]) {
  if (status === "acked") {
    return "success" as const;
  }
  if (status === "read") {
    return "accent" as const;
  }
  return "neutral" as const;
}

export function filterDiscussions(
  discussions: Discussion[],
  query: string,
): Discussion[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) {
    return discussions;
  }
  return discussions.filter((discussion) =>
    discussion.topic.toLocaleLowerCase().includes(normalizedQuery),
  );
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

function MembersPage({ members }: { members: Member[] }) {
  return (
    <section className="page-pane">
      <PageHeader count={members.length} title="Members" />
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
            <StatusIndicator
              tone={
                member.type === "agent"
                  ? agentStatusTone(member.status)
                  : "success"
              }
            >
              {member.type === "agent" ? member.status.toUpperCase() : "ACTIVE"}
            </StatusIndicator>
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
      <PageHeader count={agents.length} title="Agents" />
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
              <StatusIndicator tone={agentStatusTone(agent.status)}>
                {agent.status.toUpperCase()}
              </StatusIndicator>
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
  const [modelSettings, setModelSettings] = useState<ModelSettings | null>(
    null,
  );
  const [provider, setProvider] = useState<ModelProvider>("openai");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [modelStatus, setModelStatus] = useState<
    "loading" | "ready" | "saving" | "saved"
  >("loading");
  const [modelError, setModelError] = useState<string | null>(null);
  const [tracingSettings, setTracingSettings] =
    useState<ObservabilitySettings | null>(null);
  const [tracingEnabled, setTracingEnabled] = useState(false);
  const [tracingBaseUrl, setTracingBaseUrl] = useState("");
  const [tracingPublicKey, setTracingPublicKey] = useState("");
  const [tracingSecretKey, setTracingSecretKey] = useState("");
  const [tracingEnvironment, setTracingEnvironment] = useState("development");
  const [captureContent, setCaptureContent] = useState(false);
  const [tracingStatus, setTracingStatus] = useState<
    "loading" | "ready" | "saving" | "saved"
  >("loading");
  const [tracingError, setTracingError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void backend
      .getModelSettings()
      .then((current) => {
        if (!active) {
          return;
        }
        setModelSettings(current);
        setProvider(current.provider);
        setBaseUrl(current.base_url);
        setModel(current.model);
        setModelStatus("ready");
      })
      .catch((reason) => {
        if (active) {
          setModelError(errorMessage(reason));
          setModelStatus("ready");
        }
      });
    void backend
      .getObservabilitySettings()
      .then((current) => {
        if (!active) {
          return;
        }
        setTracingSettings(current);
        setTracingEnabled(current.enabled);
        setTracingBaseUrl(current.base_url);
        setTracingPublicKey(current.public_key);
        setTracingEnvironment(current.environment);
        setCaptureContent(current.capture_content);
        setTracingStatus("ready");
      })
      .catch((reason) => {
        if (active) {
          setTracingError(errorMessage(reason));
          setTracingStatus("ready");
        }
      });
    return () => {
      active = false;
    };
  }, []);

  async function handleSaveModel(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setModelStatus("saving");
    setModelError(null);
    try {
      const current = await backend.updateModelSettings({
        provider,
        base_url: baseUrl,
        api_key: apiKey,
        model,
      });
      setModelSettings(current);
      setProvider(current.provider);
      setBaseUrl(current.base_url);
      setApiKey("");
      setModel(current.model);
      setModelStatus("saved");
    } catch (reason) {
      setModelError(errorMessage(reason));
      setModelStatus("ready");
    }
  }

  async function handleSaveTracing(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setTracingStatus("saving");
    setTracingError(null);
    try {
      const current = await backend.updateObservabilitySettings({
        enabled: tracingEnabled,
        base_url: tracingBaseUrl,
        public_key: tracingPublicKey,
        secret_key: tracingSecretKey,
        environment: tracingEnvironment,
        capture_content: captureContent,
      });
      setTracingSettings(current);
      setTracingEnabled(current.enabled);
      setTracingBaseUrl(current.base_url);
      setTracingPublicKey(current.public_key);
      setTracingSecretKey("");
      setTracingEnvironment(current.environment);
      setCaptureContent(current.capture_content);
      setTracingStatus("saved");
    } catch (reason) {
      setTracingError(errorMessage(reason));
      setTracingStatus("ready");
    }
  }

  const modelDisabled = modelStatus === "loading" || modelStatus === "saving";
  const tracingDisabled =
    tracingStatus === "loading" || tracingStatus === "saving";
  const hasApiKey = modelSettings?.has_api_key ?? false;
  const hasTracingSecretKey = tracingSettings?.has_secret_key ?? false;

  return (
    <section className="page-pane page-pane--settings">
      <PageHeader title="Settings" />
      <div className="settings-scroll">
        <section className="settings-section">
          <h3 className="settings-section-title">Model</h3>
          <form
            className="settings-form"
            aria-label="Model settings"
            onSubmit={handleSaveModel}
          >
            <fieldset className="settings-provider">
              <legend>Provider</legend>
              <div>
                {providerOptions.map((option) => (
                  <Button
                    aria-pressed={provider === option.value}
                    disabled={modelDisabled}
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
                disabled={modelDisabled}
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
                disabled={modelDisabled}
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
                disabled={modelDisabled}
                onChange={(event) => setModel(event.target.value)}
                placeholder="Model"
                required
                value={model}
              />
            </label>
            <div className="settings-actions">
              <Button disabled={modelDisabled} type="submit" variant="primary">
                {modelStatus === "saving" ? "Saving" : "Save model"}
              </Button>
              {modelStatus === "saved" ? (
                <span role="status">Saved</span>
              ) : null}
            </div>
            {modelError ? (
              <p className="caption-text m-0 text-danger" role="alert">
                {modelError}
              </p>
            ) : null}
          </form>
        </section>

        <section className="settings-section">
          <h3 className="settings-section-title">Tracing</h3>
          <form
            className="settings-form"
            aria-label="Tracing settings"
            onSubmit={handleSaveTracing}
          >
            <label className="settings-toggle" htmlFor="tracing-enabled">
              <Checkbox
                checked={tracingEnabled}
                disabled={tracingDisabled}
                id="tracing-enabled"
                onChange={(event) => setTracingEnabled(event.target.checked)}
              />
              Enable Langfuse
            </label>
            <label className="settings-field" htmlFor="tracing-base-url">
              <span>Host</span>
              <Input
                aria-label="Langfuse host"
                id="tracing-base-url"
                autoComplete="url"
                disabled={tracingDisabled}
                onChange={(event) => setTracingBaseUrl(event.target.value)}
                placeholder="https://cloud.langfuse.com"
                required={tracingEnabled}
                type="url"
                value={tracingBaseUrl}
              />
            </label>
            <label className="settings-field" htmlFor="tracing-public-key">
              <span>Public key</span>
              <Input
                aria-label="Langfuse public key"
                id="tracing-public-key"
                autoComplete="off"
                disabled={tracingDisabled}
                onChange={(event) => setTracingPublicKey(event.target.value)}
                placeholder="pk-lf-..."
                required={tracingEnabled}
                value={tracingPublicKey}
              />
            </label>
            <label className="settings-field" htmlFor="tracing-secret-key">
              <span>Secret key</span>
              <Input
                aria-label="Langfuse secret key"
                id="tracing-secret-key"
                autoComplete="new-password"
                disabled={tracingDisabled}
                onChange={(event) => setTracingSecretKey(event.target.value)}
                placeholder={hasTracingSecretKey ? "Saved" : "sk-lf-..."}
                required={tracingEnabled && !hasTracingSecretKey}
                type="password"
                value={tracingSecretKey}
              />
            </label>
            <label className="settings-field" htmlFor="tracing-environment">
              <span>Environment</span>
              <Input
                aria-label="Tracing environment"
                id="tracing-environment"
                autoComplete="off"
                disabled={tracingDisabled}
                onChange={(event) => setTracingEnvironment(event.target.value)}
                placeholder="development"
                required={tracingEnabled}
                value={tracingEnvironment}
              />
            </label>
            <label className="settings-toggle" htmlFor="capture-content">
              <Checkbox
                checked={captureContent}
                disabled={tracingDisabled}
                id="capture-content"
                onChange={(event) => setCaptureContent(event.target.checked)}
              />
              Capture content
            </label>
            <div className="settings-actions">
              <Button
                disabled={tracingDisabled}
                type="submit"
                variant="primary"
              >
                {tracingStatus === "saving" ? "Saving" : "Save tracing"}
              </Button>
              {tracingStatus === "saved" ? (
                <span role="status">Saved</span>
              ) : null}
            </div>
            {tracingError ? (
              <p className="caption-text m-0 text-danger" role="alert">
                {tracingError}
              </p>
            ) : null}
          </form>
        </section>
      </div>
    </section>
  );
}

type DiscussionsPageProps = {
  agents: AgentMember[];
  disabled: boolean;
  discussions: Discussion[];
  error: string | null;
  isCreating: boolean;
  members: Member[];
  messageBody: string;
  messageInputRef: React.RefObject<HTMLTextAreaElement | null>;
  messageMentionIds: number[];
  onCreateDiscussion: (event: FormEvent<HTMLFormElement>) => void;
  onDialogCloseAutoFocus: () => boolean;
  onDialogOpenChange: (open: boolean) => void;
  onMessageChange: (body: string) => void;
  onMentionToggle: (memberId: number) => void;
  onSelectDiscussion: (discussionId: number) => void;
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
  error,
  isCreating,
  members,
  messageBody,
  messageInputRef,
  messageMentionIds,
  onCreateDiscussion,
  onDialogCloseAutoFocus,
  onDialogOpenChange,
  onMessageChange,
  onMentionToggle,
  onSelectDiscussion,
  onSend,
  onToggleMember,
  selectedDiscussion,
  selectedMemberIds,
  setTopic,
  topic,
}: DiscussionsPageProps) {
  const [query, setQuery] = useState("");
  const filteredDiscussions = filterDiscussions(discussions, query);

  return (
    <section className="discussions-workspace">
      <aside className="discussion-list-pane" aria-label="Discussion list">
        <div className="discussion-list-toolbar">
          <label className="discussion-search" htmlFor="discussion-search">
            <span className="sr-only">Search discussions</span>
            <Search aria-hidden="true" size={14} />
            <Input
              aria-label="Search discussions"
              autoComplete="off"
              id="discussion-search"
              inset="leading-icon"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search"
              type="search"
              value={query}
            />
          </label>
          <Dialog
            description="Enter a topic and choose the Agents who should join."
            onCloseAutoFocus={onDialogCloseAutoFocus}
            onOpenChange={onDialogOpenChange}
            open={isCreating}
            title="New discussion"
            trigger={
              <Button
                aria-label="New discussion"
                disabled={agents.length === 0 || disabled}
                size="icon"
                variant="primary"
              >
                <Plus aria-hidden="true" size={15} />
              </Button>
            }
          >
            <DiscussionForm
              agents={agents}
              disabled={disabled}
              error={error}
              onCancel={() => onDialogOpenChange(false)}
              onSubmit={onCreateDiscussion}
              onToggleMember={onToggleMember}
              selectedMemberIds={selectedMemberIds}
              setTopic={setTopic}
              topic={topic}
            />
          </Dialog>
        </div>
        {discussions.length === 0 ? (
          <p className="discussion-list-empty">No discussions</p>
        ) : filteredDiscussions.length === 0 ? (
          <p className="discussion-list-empty">No matches</p>
        ) : (
          <div className="discussion-list-items">
            {filteredDiscussions.map((discussion) => {
              const selected = selectedDiscussion?.id === discussion.id;
              return (
                <ListButton
                  active={selected}
                  aria-label={`Open ${discussion.topic}`}
                  key={discussion.id}
                  meta={`${discussion.messages.length} messages`}
                  onClick={() => onSelectDiscussion(discussion.id)}
                  title={discussion.topic}
                />
              );
            })}
          </div>
        )}
      </aside>
      <div className="discussion-detail-pane">
        {selectedDiscussion ? (
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
        ) : (
          <div className="discussion-empty">
            <p>Select a discussion</p>
          </div>
        )}
      </div>
    </section>
  );
}

type DiscussionFormProps = {
  agents: Array<{ id: number; name: string }>;
  disabled: boolean;
  error: string | null;
  onCancel: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onToggleMember: (memberId: number) => void;
  selectedMemberIds: number[];
  setTopic: (topic: string) => void;
  topic: string;
};

function DiscussionForm({
  agents,
  disabled,
  error,
  onCancel,
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
      <label className="discussion-form-field" htmlFor="discussion-topic">
        <span>Topic</span>
        <Input
          autoFocus
          disabled={disabled}
          id="discussion-topic"
          onChange={(event) => setTopic(event.target.value)}
          placeholder="Topic"
          required
          value={topic}
        />
      </label>
      <fieldset className="discussion-members">
        <legend>Members</legend>
        <div className="discussion-member-options">
          {agents.map((agent) => {
            const checkboxId = `discussion-member-${agent.id}`;
            return (
              <label htmlFor={checkboxId} key={agent.id}>
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
      </fieldset>
      {error ? (
        <p className="caption-text m-0 text-danger" role="alert">
          {error}
        </p>
      ) : null}
      <div className="discussion-form-actions">
        <Button disabled={disabled} onClick={onCancel} variant="secondary">
          Cancel
        </Button>
        <Button
          disabled={disabled || selectedMemberIds.length === 0}
          type="submit"
          variant="primary"
        >
          Create
        </Button>
      </div>
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
                          <li key={mention.member_id}>
                            <Badge
                              size="small"
                              tone={mentionStatusTone(mention.status)}
                            >
                              @
                              {membersById.get(mention.member_id)?.name ??
                                mention.member_id}{" "}
                              · {mention.status.toUpperCase()}
                            </Badge>
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
