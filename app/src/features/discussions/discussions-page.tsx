import {
  type FormEvent,
  Fragment,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
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
  Tooltip,
  Trash2,
} from "@/components/ui";
import {
  getMemberAvatarDescription,
  getMemberStatusPresentation,
  MemberStatusAvatar,
} from "@/components/ui/member-status-avatar";
import { TechnicalDetails } from "@/components/ui/technical-details";
import type {
  AgentMember,
  Discussion,
  Member,
  MentionSyntax,
} from "@/lib/backend";
import {
  discussionLabel,
  shortMessageSummary,
} from "@/lib/humanized-identifiers";
import { DiscussionMarkdown } from "./discussion-markdown";
import {
  calculateHumanUnread,
  clearNewMessageIndicator,
  createNewMessageIndicatorState,
  type HumanUnreadResult,
  nextMessageId,
  updateNewMessageIndicator,
} from "./human-unread";
import { type DraftMention, MessageComposer } from "./message-composer";
import {
  FirstUnreadDivider,
  FirstUnreadJumpButton,
  NewMessageJumpButton,
  NextHumanMentionButton,
  UnreadBadge,
} from "./unread-discussion-controls";
import {
  createSeenMessageBatch,
  type SeenMessageBatch,
  useMessageViewportTracker,
} from "./use-message-viewport-tracker";

export function formatMessageCount(count: number): string {
  return `${count} ${count === 1 ? "message" : "messages"}`;
}

export function formatMessageTimestamp(
  createdAt: string,
  now = new Date(),
  locales?: Intl.LocalesArgument,
): { compact: string; full: string } {
  const sentAt = new Date(createdAt);
  const isToday =
    sentAt.getFullYear() === now.getFullYear() &&
    sentAt.getMonth() === now.getMonth() &&
    sentAt.getDate() === now.getDate();
  const time = new Intl.DateTimeFormat(locales, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(sentAt);
  const compact = isToday
    ? time
    : `${new Intl.DateTimeFormat(locales, { dateStyle: "short" }).format(sentAt)} ${time}`;
  const full = new Intl.DateTimeFormat(locales, {
    dateStyle: "medium",
    timeStyle: "long",
  }).format(sentAt);
  return { compact, full };
}

export function discussionEntryAccessibleLabel(
  topic: string,
  unreadCount: number,
  unreadHumanMentionCount: number,
): string {
  if (unreadCount <= 0) {
    return `Open ${topic}`;
  }
  const unreadLabel = `${unreadCount} unread ${
    unreadCount === 1 ? "message" : "messages"
  }`;
  if (unreadHumanMentionCount <= 0) {
    return `Open ${topic}. ${unreadLabel}.`;
  }
  const mentionLabel = `${unreadHumanMentionCount} unread ${
    unreadHumanMentionCount === 1 ? "mention" : "mentions"
  } for you`;
  return `Open ${topic}. ${unreadLabel}, including ${mentionLabel}.`;
}

export function positionInitialDiscussionMessages(
  log: HTMLElement,
  firstUnreadMessageId: number | undefined,
): "bottom" | "first-unread" {
  if (firstUnreadMessageId === undefined) {
    log.scrollTop = log.scrollHeight;
    return "bottom";
  }
  const target = log.querySelector<HTMLElement>(
    `[data-message-id="${firstUnreadMessageId}"]`,
  );
  target?.scrollIntoView({ block: "center" });
  target?.focus();
  return "first-unread";
}

export function humanUnreadForDiscussion(
  discussion: Discussion,
  humanMemberId = 1,
): HumanUnreadResult<number> {
  const state = discussion.human_read_states?.find(
    (candidate) => candidate.member_id === humanMemberId,
  );
  const readThrough = state?.read_through_message_id ?? null;
  const readMessageIds = new Set(
    readThrough === null
      ? []
      : discussion.messages
          .filter((message) => message.id <= readThrough)
          .map((message) => message.id),
  );
  const humanMentionMessageIds = new Set(
    discussion.messages.flatMap((message) =>
      message.human_mentions?.some(
        (mention) =>
          mention.member_id === humanMemberId && mention.status === "unread",
      )
        ? [message.id]
        : [],
    ),
  );
  return calculateHumanUnread({
    currentHumanMemberId: humanMemberId,
    messages: discussion.messages.map((message) => ({
      id: message.id,
      authorMemberId: message.sender_id,
    })),
    readMessageIds,
    seenMessageIds: new Set(state?.seen_message_ids ?? []),
    humanMentionMessageIds,
  });
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

type DiscussionsPageProps = {
  agents: AgentMember[];
  disabled: boolean;
  discussions: Discussion[];
  error: string | null;
  isCreating: boolean;
  members: Member[];
  messageBody: string;
  messageInputRef: RefObject<HTMLTextAreaElement | null>;
  messageMentions: DraftMention[];
  mentionSyntax: MentionSyntax;
  onCreateDiscussion: (event: FormEvent<HTMLFormElement>) => void;
  onDialogCloseAutoFocus: () => boolean;
  onDialogOpenChange: (open: boolean) => void;
  onCreateAgent: () => void;
  onDeleteDiscussion: (discussionId: number) => void;
  onMessageChange: (body: string, mentions: DraftMention[]) => void;
  onMessagesSeen?: (discussionId: number, messageIds: number[]) => void;
  onOpenMember: (
    memberId: number,
    discussionId: number,
    triggerKey: string,
  ) => void;
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
  messageMentions,
  mentionSyntax,
  onCreateAgent,
  onCreateDiscussion,
  onDialogCloseAutoFocus,
  onDialogOpenChange,
  onDeleteDiscussion,
  onMessageChange,
  onMessagesSeen = () => undefined,
  onOpenMember,
  onSelectDiscussion,
  onSend,
  onToggleMember,
  selectedDiscussion,
  selectedMemberIds,
  setTopic,
  topic,
}: DiscussionsPageProps) {
  const [query, setQuery] = useState("");
  const [deletingDiscussionId, setDeletingDiscussionId] = useState<
    number | null
  >(null);
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
              const unread = humanUnreadForDiscussion(discussion);
              return (
                <ListButton
                  active={selected}
                  aria-label={discussionEntryAccessibleLabel(
                    discussion.topic,
                    unread.unreadCount,
                    unread.unreadHumanMentionCount,
                  )}
                  key={discussion.id}
                  action={
                    <Dialog
                      description={`Delete ${discussion.topic} and all of its messages.`}
                      onOpenChange={(open) =>
                        setDeletingDiscussionId(open ? discussion.id : null)
                      }
                      open={deletingDiscussionId === discussion.id}
                      title="Delete discussion"
                      trigger={
                        <Button
                          aria-label={`Delete ${discussion.topic}`}
                          disabled={disabled}
                          size="icon"
                          variant="quiet"
                        >
                          <Trash2 aria-hidden="true" size={14} />
                        </Button>
                      }
                      triggerTooltip="Delete"
                    >
                      <div className="discussion-delete-confirmation">
                        <p>Delete this discussion and all of its messages?</p>
                        <div className="discussion-form-actions">
                          <Button
                            onClick={() => setDeletingDiscussionId(null)}
                            variant="quiet"
                          >
                            Cancel
                          </Button>
                          <Button
                            disabled={disabled}
                            onClick={() => {
                              onDeleteDiscussion(discussion.id);
                              setDeletingDiscussionId(null);
                            }}
                            variant="danger"
                          >
                            Delete
                          </Button>
                        </div>
                      </div>
                    </Dialog>
                  }
                  meta={
                    <>
                      {formatMessageCount(discussion.messages.length)}
                      {unread.unreadCount > 0 ? (
                        <UnreadBadge count={unread.unreadCount} />
                      ) : null}
                      {unread.unreadHumanMentionCount > 0 ? (
                        <UnreadBadge
                          count={unread.unreadHumanMentionCount}
                          label="unread mentions for you"
                          variant="mention"
                        />
                      ) : null}
                    </>
                  }
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
              messageMentions={messageMentions}
              mentionSyntax={mentionSyntax}
              onMessageChange={onMessageChange}
              onMessagesSeen={onMessagesSeen}
              onOpenMember={onOpenMember}
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

export function discussionAgentStatus(
  status: AgentMember["status"],
): "error" | "idle" | "paused" | "running" {
  return getMemberStatusPresentation(status)?.status ?? "idle";
}

function MessageTimestamp({ createdAt }: { createdAt: string }) {
  const { compact, full } = formatMessageTimestamp(createdAt);
  return (
    <span className="message-timestamp font-mono" data-full-time={full}>
      <time aria-hidden="true" dateTime={createdAt}>
        {compact}
      </time>
      <span className="sr-only">Sent {full}</span>
    </span>
  );
}

function DiscussionMemberAvatar({
  member,
  onOpenMember,
  triggerKey,
}: {
  member: Member;
  onOpenMember: (memberId: number, triggerKey: string) => void;
  triggerKey: string;
}) {
  const status = member.type === "agent" ? member.status : undefined;
  const description = getMemberAvatarDescription(
    member.name,
    member.type,
    status,
  );

  return (
    <Tooltip content={description.replace(", ", " · ")} side="bottom">
      <MemberStatusAvatar
        identity={member.type}
        name={member.name}
        navigationKey={triggerKey}
        onActivate={() => onOpenMember(member.id, triggerKey)}
        status={status}
        variant="member"
      />
    </Tooltip>
  );
}

type DiscussionViewProps = {
  discussion: Discussion;
  disabled: boolean;
  members: Member[];
  messageBody: string;
  messageInputRef: RefObject<HTMLTextAreaElement | null>;
  messageMentions: DraftMention[];
  mentionSyntax: MentionSyntax;
  onMessageChange: (body: string, mentions: DraftMention[]) => void;
  onMessagesSeen: (discussionId: number, messageIds: number[]) => void;
  onOpenMember: (
    memberId: number,
    discussionId: number,
    triggerKey: string,
  ) => void;
  onSend: (event: FormEvent<HTMLFormElement>) => void;
};

function DiscussionView({
  discussion,
  disabled,
  members,
  messageBody,
  messageInputRef,
  messageMentions,
  mentionSyntax,
  onMessageChange,
  onMessagesSeen,
  onOpenMember,
  onSend,
}: DiscussionViewProps) {
  const messageLogRef = useRef<HTMLDivElement>(null);
  const unread = useMemo(
    () => humanUnreadForDiscussion(discussion),
    [discussion],
  );
  const initialFirstUnreadMessageIdRef = useRef(unread.firstUnreadMessageId);
  const shouldFollowMessagesRef = useRef(
    initialFirstUnreadMessageIdRef.current === undefined,
  );
  const lastMentionTargetRef = useRef<number | undefined>(undefined);
  const onMessagesSeenRef = useRef(onMessagesSeen);
  onMessagesSeenRef.current = onMessagesSeen;
  const seenBatchRef = useRef<SeenMessageBatch<number> | null>(null);
  if (seenBatchRef.current === null) {
    seenBatchRef.current = createSeenMessageBatch((messageIds) =>
      onMessagesSeenRef.current(discussion.id, messageIds),
    );
  }
  const [newMessageIndicator, setNewMessageIndicator] = useState(() =>
    createNewMessageIndicatorState(
      discussion.messages.map((message) => message.id),
    ),
  );
  const unreadMessageIds = useMemo(
    () => new Set(unread.unreadMessageIds),
    [unread.unreadMessageIds],
  );
  const reportMessageSeen = useCallback((messageId: number) => {
    seenBatchRef.current?.add(messageId);
  }, []);
  const trackMessage = useMessageViewportTracker({
    minVisibleRatio: 0,
    onMessageSeen: reportMessageSeen,
  });
  const membersById = new Map(members.map((member) => [member.id, member]));
  const discussionMembers = discussion.member_ids
    .map((id) => membersById.get(id))
    .filter((member): member is Member => Boolean(member));
  const handleOpenMember = useCallback(
    (memberId: number, triggerKey: string) =>
      onOpenMember(memberId, discussion.id, triggerKey),
    [discussion.id, onOpenMember],
  );

  useEffect(
    () => () => {
      seenBatchRef.current?.dispose();
      seenBatchRef.current = null;
    },
    [],
  );

  useLayoutEffect(() => {
    const log = messageLogRef.current;
    if (!log) {
      return;
    }
    shouldFollowMessagesRef.current =
      positionInitialDiscussionMessages(
        log,
        initialFirstUnreadMessageIdRef.current,
      ) === "bottom";
  }, []);

  useEffect(() => {
    const messageIds = discussion.messages.map((message) => message.id);
    setNewMessageIndicator((current) =>
      updateNewMessageIndicator(
        current,
        messageIds,
        shouldFollowMessagesRef.current,
      ),
    );
    const log = messageLogRef.current;
    if (messageIds.length > 0 && log && shouldFollowMessagesRef.current) {
      log.scrollTop = log.scrollHeight;
    }
  }, [discussion.messages]);

  function handleMessageScroll() {
    const log = messageLogRef.current;
    if (!log) {
      return;
    }
    const followingBottom =
      log.scrollHeight - log.scrollTop - log.clientHeight <= 24;
    shouldFollowMessagesRef.current = followingBottom;
    if (followingBottom) {
      setNewMessageIndicator(clearNewMessageIndicator);
    }
  }

  function handleSend(event: FormEvent<HTMLFormElement>) {
    shouldFollowMessagesRef.current = true;
    onSend(event);
  }

  function focusMessage(messageId: number | undefined) {
    if (messageId === undefined) {
      return;
    }
    const target = messageLogRef.current?.querySelector<HTMLElement>(
      `[data-message-id="${messageId}"]`,
    );
    target?.scrollIntoView({ block: "center" });
    target?.focus();
  }

  function focusNewMessages() {
    focusMessage(newMessageIndicator.pendingMessageIds[0]);
    setNewMessageIndicator(clearNewMessageIndicator);
  }

  function focusNextMention() {
    const target =
      nextMessageId(
        unread.unreadHumanMentionMessageIds,
        lastMentionTargetRef.current,
      ) ?? unread.unreadHumanMentionMessageIds[0];
    lastMentionTargetRef.current = target;
    focusMessage(target);
  }

  return (
    <>
      <header className="border-border border-b px-6 py-4">
        <div className="flex items-baseline justify-between gap-6">
          <h2
            className="discussion-title m-0 font-semibold"
            data-discussion-focus-id={discussion.id}
            tabIndex={-1}
          >
            {discussionLabel(discussion)}
          </h2>
          <TechnicalDetails
            identifiers={[{ label: "Discussion", value: discussion.id }]}
          />
        </div>
        <div className="discussion-member-avatars">
          <span className="sr-only">Discussion members:</span>
          {discussionMembers.map((member) => (
            <DiscussionMemberAvatar
              key={member.id}
              member={member}
              onOpenMember={handleOpenMember}
              triggerKey={`discussion:${discussion.id}:member:${member.id}`}
            />
          ))}
        </div>
      </header>
      <div
        className="message-log min-h-0 overflow-y-auto px-6 py-2"
        aria-label="Messages"
        onScroll={handleMessageScroll}
        ref={messageLogRef}
        role="log"
      >
        {unread.unreadCount > 0 ||
        newMessageIndicator.pendingMessageIds.length > 0 ? (
          <nav
            aria-label="Unread message navigation"
            className="human-unread-controls"
          >
            <FirstUnreadJumpButton
              onActivate={() => focusMessage(unread.firstUnreadMessageId)}
              unreadCount={unread.unreadCount}
            />
            <NewMessageJumpButton
              newMessageCount={newMessageIndicator.pendingMessageIds.length}
              onActivate={focusNewMessages}
            />
            <NextHumanMentionButton
              onActivate={focusNextMention}
              unreadMentionCount={unread.unreadHumanMentionCount}
            />
          </nav>
        ) : null}
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
              const senderName =
                message.sender_name ?? sender?.name ?? "Unknown";
              const senderIdentity =
                sender?.type ?? (message.sender_name ? "deleted" : "unknown");
              const senderStatus =
                sender?.type === "agent"
                  ? getMemberStatusPresentation(sender.status)
                  : null;
              const isHuman = sender?.type === "human";
              const senderTriggerKey = `discussion:${discussion.id}:message:${message.id}:member:${message.sender_id}`;
              return (
                <Fragment key={message.id}>
                  {message.id === unread.firstUnreadMessageId ? (
                    <li className="human-unread-divider-row">
                      <FirstUnreadDivider />
                    </li>
                  ) : null}
                  <li
                    className={`message-row ${isHuman ? "message-row--human" : "message-row--agent"}`}
                    data-message-id={message.id}
                    ref={(element) =>
                      trackMessage(
                        message.id,
                        unreadMessageIds.has(message.id) ? element : null,
                      )
                    }
                    tabIndex={-1}
                  >
                    <Tooltip
                      content={getMemberAvatarDescription(
                        senderName,
                        senderIdentity,
                        sender?.type === "agent" ? sender.status : undefined,
                      ).replace(", ", " · ")}
                      side="top"
                    >
                      <MemberStatusAvatar
                        className="message-avatar"
                        identity={senderIdentity}
                        name={senderName}
                        navigationKey={sender ? senderTriggerKey : undefined}
                        onActivate={
                          sender
                            ? () =>
                                handleOpenMember(sender.id, senderTriggerKey)
                            : undefined
                        }
                        status={
                          sender?.type === "agent" ? sender.status : undefined
                        }
                        variant="message"
                      />
                    </Tooltip>
                    <article className="message-bubble">
                      <header className="message-meta">
                        <strong>
                          {senderStatus ? (
                            <>
                              <span className="sr-only">
                                {senderName}, Agent status: {senderStatus.label}
                              </span>
                              <span aria-hidden="true">{senderName}</span>
                            </>
                          ) : (
                            senderName
                          )}
                        </strong>
                        <span>
                          {shortMessageSummary(
                            message.body,
                            96,
                            message.references,
                            members,
                          )}
                        </span>
                        {message.created_at ? (
                          <MessageTimestamp createdAt={message.created_at} />
                        ) : null}
                      </header>
                      <DiscussionMarkdown
                        body={message.body}
                        members={members}
                        messageId={message.id}
                        onOpenMember={handleOpenMember}
                        references={message.references}
                      />
                      <TechnicalDetails
                        identifiers={[
                          { label: "Discussion", value: discussion.id },
                          { label: "Message", value: message.id },
                          { label: "Sender", value: message.sender_id },
                        ]}
                      />
                      {message.mentions.length > 0 ? (
                        <ul className="mention-statuses" aria-label="Mentions">
                          {message.mentions.map((mention) => {
                            const identity = message.references.find(
                              (reference) =>
                                reference.member_id === mention.member_id &&
                                reference.notified,
                            );
                            const activeMember = membersById.get(
                              mention.member_id,
                            );
                            const name =
                              (identity?.deleted
                                ? undefined
                                : activeMember?.name) ??
                              identity?.name ??
                              "Unavailable member";
                            return (
                              <li
                                className={`mention-status mention-status--${mention.status}`}
                                key={mention.member_id}
                                title={`@${name} · ${mention.status}${
                                  identity?.deleted ? " · Deleted Agent" : ""
                                }`}
                              >
                                @{name} · {mention.status.toUpperCase()}
                              </li>
                            );
                          })}
                        </ul>
                      ) : null}
                    </article>
                  </li>
                </Fragment>
              );
            })}
          </ol>
        )}
      </div>
      <MessageComposer
        agents={members}
        body={messageBody}
        disabled={disabled}
        discussionId={discussion.id}
        discussionMemberIds={discussion.member_ids}
        inputRef={messageInputRef}
        mentions={messageMentions}
        mentionSyntax={mentionSyntax}
        onChange={onMessageChange}
        onSend={handleSend}
      />
    </>
  );
}
