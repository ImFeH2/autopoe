import {
  type ChangeEvent,
  type FormEvent,
  type KeyboardEvent,
  type RefObject,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  Button,
  Checkbox,
  Dialog,
  Input,
  ListButton,
  Plus,
  Search,
  Textarea,
} from "@/components/ui";
import type { AgentMember, Discussion, Member } from "@/lib/backend";

export function formatMessageCount(count: number): string {
  return `${count} ${count === 1 ? "message" : "messages"}`;
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

type DiscussionsPageProps = {
  agents: AgentMember[];
  disabled: boolean;
  discussions: Discussion[];
  error: string | null;
  isCreating: boolean;
  members: Member[];
  messageBody: string;
  messageInputRef: RefObject<HTMLTextAreaElement | null>;
  messageMentionIds: number[];
  onCreateDiscussion: (event: FormEvent<HTMLFormElement>) => void;
  onDialogCloseAutoFocus: () => boolean;
  onDialogOpenChange: (open: boolean) => void;
  onCreateAgent: () => void;
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

export function DiscussionsPage({
  agents,
  disabled,
  discussions,
  error,
  isCreating,
  members,
  messageBody,
  messageInputRef,
  messageMentionIds,
  onCreateAgent,
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
            triggerTooltip={
              agents.length === 0 ? "Create an Agent first" : "New discussion"
            }
            trigger={
              <Button
                aria-describedby={
                  agents.length === 0 ? "new-discussion-requirement" : undefined
                }
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
                  meta={formatMessageCount(discussion.messages.length)}
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
            {agents.length === 0 ? (
              <div className="discussion-empty-content">
                <h2>Create an Agent first</h2>
                <p id="new-discussion-requirement">
                  Discussions need at least one Agent.
                </p>
                <Button onClick={onCreateAgent} variant="secondary">
                  New Agent
                </Button>
              </div>
            ) : discussions.length === 0 ? (
              <div className="discussion-empty-content">
                <h2>Create a discussion</h2>
                <p>Start collaborating with your Agents.</p>
                <Button
                  disabled={disabled}
                  onClick={() => onDialogOpenChange(true)}
                  variant="primary"
                >
                  New discussion
                </Button>
              </div>
            ) : (
              <p>Select a discussion</p>
            )}
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
  members: Member[];
  messageBody: string;
  messageInputRef: RefObject<HTMLTextAreaElement | null>;
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

  function handleMessageChange(event: ChangeEvent<HTMLTextAreaElement>) {
    const input = event.currentTarget;
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, 120)}px`;
    onMessageChange(input.value);
  }

  useEffect(() => {
    const input = messageInputRef.current;
    if (input && messageBody.length === 0) {
      input.style.height = "";
    }
  }, [messageBody, messageInputRef]);

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
                          <li
                            className={`mention-status mention-status--${mention.status}`}
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
                  </article>
                </li>
              );
            })}
          </ol>
        )}
      </div>
      <form
        className="message-composer"
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
            onChange={handleMessageChange}
            onKeyDown={handleMessageKeyDown}
            placeholder="Write a message"
            ref={messageInputRef}
            required
            rows={1}
            value={messageBody}
            variant="composer"
          />
          <Button disabled={disabled} type="submit" variant="primary">
            Send
          </Button>
        </div>
      </form>
    </>
  );
}
