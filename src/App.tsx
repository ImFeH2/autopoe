import {
  type FormEvent,
  startTransition,
  useEffect,
  useRef,
  useState,
} from "react";
import { Button, Checkbox, Input, Textarea } from "@/components/ui";
import {
  backend,
  type Discussion,
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
  const [agentName, setAgentName] = useState("");
  const [topic, setTopic] = useState("");
  const [selectedMemberIds, setSelectedMemberIds] = useState<number[]>([]);
  const [messageBody, setMessageBody] = useState("");
  const [messageMentionIds, setMessageMentionIds] = useState<number[]>([]);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const messageInputRef = useRef<HTMLTextAreaElement>(null);
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
    if (!isSaving && restoreMessageFocusRef.current) {
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
    setMessageBody("");
    setMessageMentionIds([]);
  }

  return (
    <main className="app-shell bg-canvas text-text-primary">
      <aside className="app-sidebar border-border border-r bg-surface-subtle">
        <header className="border-border border-b px-4 py-3">
          <div className="flex items-baseline justify-between gap-3">
            <h1 className="app-brand m-0 font-semibold">Flowent</h1>
            <span className="meta-text font-mono text-text-tertiary">
              ORG 1
            </span>
          </div>
          <p className="meta-text mt-1 mb-0 truncate font-mono text-text-tertiary">
            {snapshot.working_directory}
          </p>
        </header>

        <section
          className="border-border border-b p-3"
          aria-labelledby="members-title"
        >
          <div className="mb-2 flex items-center justify-between">
            <h2
              className="section-label m-0 font-semibold text-text-secondary uppercase"
              id="members-title"
            >
              Members
            </h2>
            <span className="meta-text font-mono text-text-tertiary">
              {snapshot.members.length}
            </span>
          </div>
          <ul className="m-0 mb-3 grid list-none gap-1 p-0">
            {snapshot.members.map((member) => (
              <li className="member-row body-compact min-h-7" key={member.id}>
                <span className="truncate">{member.name}</span>
                <span className="meta-text font-mono text-text-tertiary">
                  {member.type === "agent"
                    ? `${member.status.toUpperCase()} · ${member.id}`
                    : `HUMAN · ${member.id}`}
                </span>
                {member.type === "agent" && member.error ? (
                  <span
                    className="member-error caption-text text-danger"
                    role="status"
                  >
                    {member.error}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
          <form
            className="flex gap-2"
            aria-label="Create Agent"
            onSubmit={handleCreateAgent}
          >
            <Input
              aria-label="Agent name"
              disabled={isSaving}
              onChange={(event) => setAgentName(event.target.value)}
              placeholder="Agent name"
              required
              value={agentName}
            />
            <Button disabled={isSaving} type="submit">
              New
            </Button>
          </form>
        </section>

        <section
          className="flex min-h-0 flex-col"
          aria-labelledby="discussions-title"
        >
          <div className="flex items-center justify-between px-3 pt-3 pb-2">
            <h2
              className="section-label m-0 font-semibold text-text-secondary uppercase"
              id="discussions-title"
            >
              Discussions
            </h2>
            <span className="meta-text font-mono text-text-tertiary">
              {snapshot.discussions.length}
            </span>
          </div>
          <nav
            className="min-h-0 flex-1 overflow-y-auto px-2"
            aria-label="Discussions"
          >
            {snapshot.discussions.length === 0 ? (
              <p className="caption-text m-0 px-1 py-2 text-text-tertiary">
                No discussions
              </p>
            ) : (
              <ul className="m-0 grid list-none gap-1 p-0">
                {snapshot.discussions.map((discussion) => (
                  <li key={discussion.id}>
                    <Button
                      aria-current={
                        selectedDiscussion?.id === discussion.id
                          ? "page"
                          : undefined
                      }
                      className="w-full justify-start"
                      onClick={() => selectDiscussion(discussion.id)}
                      variant={
                        selectedDiscussion?.id === discussion.id
                          ? "secondary"
                          : "quiet"
                      }
                    >
                      <span className="meta-text mr-2 font-mono text-text-tertiary">
                        {discussion.id}
                      </span>
                      <span className="truncate">{discussion.topic}</span>
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </nav>
          <DiscussionForm
            agents={snapshot.members.filter(
              (member) => member.type === "agent",
            )}
            disabled={isSaving}
            onSubmit={handleCreateDiscussion}
            onToggleMember={toggleMember}
            selectedMemberIds={selectedMemberIds}
            setTopic={setTopic}
            topic={topic}
          />
        </section>
      </aside>

      <section className="discussion-pane bg-surface">
        {selectedDiscussion ? (
          <DiscussionView
            discussion={selectedDiscussion}
            disabled={isSaving}
            members={snapshot.members}
            messageBody={messageBody}
            messageInputRef={messageInputRef}
            messageMentionIds={messageMentionIds}
            onMessageChange={setMessageBody}
            onMentionToggle={toggleMessageMention}
            onSend={handleSendMessage}
          />
        ) : (
          <EmptyDiscussion />
        )}
        {mutationError ? (
          <p
            className="caption-text absolute right-4 bottom-4 m-0 border border-danger bg-surface px-3 py-2 text-danger"
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
      className="border-border border-t p-3"
      aria-label="Create Discussion"
      onSubmit={onSubmit}
    >
      <label
        className="section-label mb-2 block font-medium text-text-secondary"
        htmlFor="topic"
      >
        New discussion
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
  const membersById = new Map(members.map((member) => [member.id, member]));
  const discussionMembers = discussion.member_ids
    .map((id) => membersById.get(id)?.name)
    .filter(Boolean)
    .join(", ");
  const discussionAgents = discussion.member_ids
    .map((id) => membersById.get(id))
    .filter((member) => member?.type === "agent");

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
        className="min-h-0 overflow-y-auto px-6 py-2"
        aria-label="Messages"
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
              return (
                <li
                  className="message-row border-border border-b py-4"
                  key={message.id}
                >
                  <div>
                    <p className="caption-text m-0 font-medium">
                      {sender?.name ?? "Unknown"}
                    </p>
                    <p className="meta-text mt-1 mb-0 font-mono text-text-tertiary">
                      MESSAGE {message.id}
                    </p>
                  </div>
                  <div className="message-content">
                    <p className="message-body m-0 whitespace-pre-wrap leading-6">
                      {message.body}
                    </p>
                    {message.mentions.length > 0 ? (
                      <ul className="mention-statuses" aria-label="Mentions">
                        {message.mentions.map((mention) => (
                          <li
                            className="meta-text font-mono text-text-secondary"
                            key={mention.member_id}
                          >
                            @
                            {membersById.get(mention.member_id)?.name ??
                              mention.member_id}{" "}
                            · {mention.status.toUpperCase()}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </div>
      <form
        className="border-border border-t bg-surface-subtle p-4"
        aria-label="Send Message"
        onSubmit={onSend}
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
            disabled={disabled}
            onChange={(event) => onMessageChange(event.target.value)}
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

function EmptyDiscussion() {
  return (
    <div className="col-span-full row-span-full grid place-items-center">
      <div className="text-center">
        <p className="empty-title m-0 font-medium">Create a Discussion</p>
        <p className="caption-text mt-1 mb-0 text-text-tertiary">
          Add an Agent, then choose Members and a topic.
        </p>
      </div>
    </div>
  );
}

export default App;
