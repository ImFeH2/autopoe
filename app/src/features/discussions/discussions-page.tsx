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
  Users,
} from "@/components/ui";
import {
  getMemberAvatarDescription,
  getMemberStatusPresentation,
  MemberStatusAvatar,
} from "@/components/ui/member-status-avatar";
import {
  captureStableScrollAnchor,
  restoreStableScrollAnchor,
  type StableScrollAnchor,
} from "@/features/incremental/stable-scroll-anchor";
import type {
  AgentMember,
  Discussion,
  Member,
  MentionSyntax,
} from "@/lib/backend";
import { discussionLabel } from "@/lib/humanized-identifiers";
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
  DeliveryCircle,
  DeliveryPanel,
  type DeliverySelection,
} from "./message-delivery";
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

export function preserveActivityBarScrollAnchor(
  log: Pick<HTMLElement, "scrollHeight" | "scrollTop">,
  previousHeight: number | null,
  nextHeight: number,
  followingBottom: boolean,
): void {
  if (previousHeight === null) {
    return;
  }
  if (followingBottom) {
    log.scrollTop = log.scrollHeight;
    return;
  }
  log.scrollTop += nextHeight - previousHeight;
}

type ActivityBarResizeObserver = Pick<ResizeObserver, "disconnect" | "observe">;
type ActivityBarResizeObserverFactory = (
  callback: ResizeObserverCallback,
) => ActivityBarResizeObserver;

export function observeActivityBarHeight(
  bar: HTMLElement,
  onHeightChange: (height: number) => void,
  observerFactory: ActivityBarResizeObserverFactory = (callback) =>
    new ResizeObserver(callback),
): () => void {
  const observer = observerFactory(() => onHeightChange(bar.offsetHeight));
  observer.observe(bar);
  return () => observer.disconnect();
}

export function humanUnreadForDiscussion(
  discussion: Discussion,
  humanMemberId: number,
): HumanUnreadResult<number> {
  const activity = discussion.human_activity?.find(
    (candidate) => candidate.member_id === humanMemberId,
  );
  if (activity) {
    const readThrough = activity.read_through_message_id;
    const seen = new Set(activity.seen_message_ids);
    const loadedUnread = (discussion.messages ?? []).filter(
      (message) =>
        message.id > activity.joined_after_message_id &&
        message.sender_id !== humanMemberId &&
        !(readThrough !== null && message.id <= readThrough) &&
        !seen.has(message.id),
    );
    return {
      unreadCount: activity.unread_count,
      unreadMessageIds: loadedUnread.map((message) => message.id),
      firstUnreadMessageId: activity.first_unread_message_id ?? undefined,
      unreadHumanMentionCount: activity.unread_human_mention_count,
      unreadHumanMentionMessageIds: loadedUnread.flatMap((message) =>
        message.human_mentions?.some(
          (mention) =>
            mention.member_id === humanMemberId && mention.status === "unread",
        )
          ? [message.id]
          : [],
      ),
    };
  }
  const state = discussion.human_read_states?.find(
    (candidate) => candidate.member_id === humanMemberId,
  );
  const joinedAfterMessageId = state?.joined_after_message_id ?? 0;
  const frontier =
    discussion.activity_frontiers?.find(
      (candidate) => candidate.member_id === humanMemberId,
    )?.latest_activity_message_id ??
    Math.max(
      state?.read_through_message_id ?? 0,
      ...(state?.seen_message_ids ?? [0]),
    );
  const eligibleMessages = (discussion.messages ?? []).filter((message) => {
    if (
      message.id <= Math.max(joinedAfterMessageId, frontier) ||
      message.sender_id === humanMemberId
    ) {
      return false;
    }
    const delivery = message.delivery;
    return (
      delivery === undefined ||
      !delivery.recipients_known ||
      delivery.recipients.some(
        (recipient) => recipient.member_id === humanMemberId,
      )
    );
  });
  const humanMentionMessageIds = new Set(
    eligibleMessages.flatMap((message) =>
      message.delivery?.recipients.some(
        (recipient) =>
          recipient.member_id === humanMemberId && recipient.mentioned,
      ) ||
      message.human_mentions?.some(
        (mention) => mention.member_id === humanMemberId,
      )
        ? [message.id]
        : [],
    ),
  );
  return calculateHumanUnread({
    currentHumanMemberId: humanMemberId,
    messages: eligibleMessages.map((message) => ({
      id: message.id,
      authorMemberId: message.sender_id,
    })),
    readMessageIds: new Set(),
    seenMessageIds: new Set(),
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
  currentHumanMemberId: number;
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
  onDeleteDiscussion: (
    discussionId: number,
    confirmTopic: string,
  ) => Promise<boolean> | undefined;
  onUpdateDiscussionMembers?: (
    discussionId: number,
    memberIds: number[],
  ) => Promise<boolean>;
  onMessageChange: (body: string, mentions: DraftMention[]) => void;
  onMessagesSeen?: (discussionId: number, messageIds: number[]) => void;
  onLoadEarlier?: () => Promise<void>;
  onRequestMessage?: (messageId: number) => Promise<void>;
  onLoadNewMessages?: () => Promise<void>;
  unloadedNewMessageCount?: number;
  messagePageLoading?: boolean;
  messagePageError?: string | null;
  initialScrollTop?: number;
  onMessageScrollState?: (scrollTop: number, followsLatest: boolean) => void;
  onMarkAllRead?: (
    discussionId: number,
    throughMessageId: number,
  ) => Promise<boolean>;
  onAcknowledgeHumanMention?: (discussionId: number, messageId: number) => void;
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
  currentHumanMemberId,
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
  onUpdateDiscussionMembers,
  onMessageChange,
  onMessagesSeen = () => undefined,
  onLoadEarlier,
  onRequestMessage,
  onLoadNewMessages,
  unloadedNewMessageCount = 0,
  messagePageLoading = false,
  messagePageError = null,
  initialScrollTop,
  onMessageScrollState,
  onMarkAllRead,
  onAcknowledgeHumanMention,
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
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [managingDiscussionId, setManagingDiscussionId] = useState<
    number | null
  >(null);
  const [managedMemberIds, setManagedMemberIds] = useState<number[]>([]);
  const filteredDiscussions = filterDiscussions(discussions, query);

  async function saveManagedMembers(
    event: FormEvent<HTMLFormElement>,
    discussionId: number,
  ) {
    event.preventDefault();
    if (
      onUpdateDiscussionMembers &&
      (await onUpdateDiscussionMembers(discussionId, managedMemberIds))
    ) {
      setManagingDiscussionId(null);
    }
  }

  async function deleteDiscussion(discussionId: number) {
    const deleted = await onDeleteDiscussion(discussionId, deleteConfirmation);
    if (deleted !== false) {
      setDeletingDiscussionId(null);
      setDeleteConfirmation("");
    }
  }

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
              humans={members.filter((member) => member.type === "human")}
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
              const unread = humanUnreadForDiscussion(
                discussion,
                currentHumanMemberId,
              );
              return (
                <ListButton
                  actionSize={onUpdateDiscussionMembers ? "double" : "single"}
                  active={selected}
                  aria-label={discussionEntryAccessibleLabel(
                    discussion.topic,
                    unread.unreadCount,
                    unread.unreadHumanMentionCount,
                  )}
                  key={discussion.id}
                  action={
                    <div className="discussion-list-actions">
                      {onUpdateDiscussionMembers ? (
                        <Dialog
                          description={`Choose the Agents who belong to ${discussion.topic}.`}
                          onOpenChange={(open) => {
                            setManagingDiscussionId(
                              open ? discussion.id : null,
                            );
                            setManagedMemberIds(
                              open
                                ? discussion.member_ids.filter((memberId) =>
                                    agents.some(
                                      (agent) => agent.id === memberId,
                                    ),
                                  )
                                : [],
                            );
                          }}
                          open={managingDiscussionId === discussion.id}
                          title="Manage members"
                          trigger={
                            <Button
                              aria-label={`Manage ${discussion.topic} members`}
                              disabled={disabled}
                              size="icon"
                              variant="quiet"
                            >
                              <Users aria-hidden="true" size={14} />
                            </Button>
                          }
                          triggerTooltip="Manage members"
                        >
                          <form
                            aria-label={`Manage ${discussion.topic} members`}
                            className="discussion-form"
                            onSubmit={(event) =>
                              void saveManagedMembers(event, discussion.id)
                            }
                          >
                            <DiscussionMembersFieldset
                              agents={agents}
                              disabled={disabled}
                              humans={members.filter(
                                (member) => member.type === "human",
                              )}
                              idPrefix={`discussion-${discussion.id}-member`}
                              onToggleMember={(memberId) =>
                                setManagedMemberIds((current) =>
                                  current.includes(memberId)
                                    ? current.filter((id) => id !== memberId)
                                    : [...current, memberId],
                                )
                              }
                              selectedMemberIds={managedMemberIds}
                            />
                            {error ? (
                              <p
                                className="caption-text m-0 text-danger"
                                role="alert"
                              >
                                {error}
                              </p>
                            ) : null}
                            <div className="discussion-form-actions">
                              <Button
                                disabled={disabled}
                                onClick={() => setManagingDiscussionId(null)}
                                variant="secondary"
                              >
                                Cancel
                              </Button>
                              <Button
                                disabled={
                                  disabled || managedMemberIds.length === 0
                                }
                                type="submit"
                                variant="primary"
                              >
                                Save
                              </Button>
                            </div>
                          </form>
                        </Dialog>
                      ) : null}
                      <Dialog
                        description={`Permanently delete ${discussion.topic}. Copied content may remain in other records.`}
                        onOpenChange={(open) => {
                          setDeletingDiscussionId(open ? discussion.id : null);
                          setDeleteConfirmation("");
                        }}
                        open={deletingDiscussionId === discussion.id}
                        title="Delete discussion"
                        trigger={
                          <Button
                            aria-label={`Delete ${discussion.topic}`}
                            disabled={disabled}
                            size="icon"
                            variant="danger"
                          >
                            <Trash2 aria-hidden="true" size={14} />
                          </Button>
                        }
                        triggerTooltip="Delete"
                      >
                        <div className="discussion-delete-confirmation">
                          <p>
                            This discussion and its messages will be permanently
                            deleted and cannot be recovered. Content previously
                            copied to Agent History, Memory, or other records
                            may remain.
                          </p>
                          <label
                            className="discussion-form-field"
                            htmlFor={`delete-discussion-${discussion.id}`}
                          >
                            <span>Type {discussion.topic} to confirm</span>
                            <Input
                              autoComplete="off"
                              autoFocus
                              disabled={disabled}
                              id={`delete-discussion-${discussion.id}`}
                              onChange={(event) =>
                                setDeleteConfirmation(event.target.value)
                              }
                              value={deleteConfirmation}
                            />
                          </label>
                          <div className="discussion-form-actions">
                            <Button
                              disabled={disabled}
                              onClick={() => setDeletingDiscussionId(null)}
                              variant="secondary"
                            >
                              Cancel
                            </Button>
                            <Button
                              disabled={
                                disabled ||
                                deleteConfirmation !== discussion.topic
                              }
                              onClick={() =>
                                void deleteDiscussion(discussion.id)
                              }
                              variant="danger"
                            >
                              Delete
                            </Button>
                          </div>
                        </div>
                      </Dialog>
                    </div>
                  }
                  meta={
                    <>
                      {formatMessageCount(
                        discussion.message_count ??
                          discussion.messages?.length ??
                          0,
                      )}
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
              currentHumanMemberId={currentHumanMemberId}
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
              onLoadEarlier={onLoadEarlier}
              onRequestMessage={onRequestMessage}
              onLoadNewMessages={onLoadNewMessages}
              unloadedNewMessageCount={unloadedNewMessageCount}
              messagePageLoading={messagePageLoading}
              messagePageError={messagePageError}
              initialScrollTop={initialScrollTop}
              onMessageScrollState={onMessageScrollState}
              onMarkAllRead={onMarkAllRead}
              onAcknowledgeHumanMention={onAcknowledgeHumanMention}
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

type DiscussionMembersFieldsetProps = {
  agents: Array<{ id: number; name: string }>;
  disabled: boolean;
  humans: Array<{ id: number; name: string }>;
  idPrefix: string;
  onToggleMember: (memberId: number) => void;
  selectedMemberIds: number[];
};

function DiscussionMembersFieldset({
  agents,
  disabled,
  humans,
  idPrefix,
  onToggleMember,
  selectedMemberIds,
}: DiscussionMembersFieldsetProps) {
  return (
    <fieldset className="discussion-members">
      <legend>Members</legend>
      <section
        aria-label="Inherent Human participants"
        className="discussion-inherent-members"
      >
        <span>Always included</span>
        {humans.map((human) => (
          <span key={human.id}>{human.name} · Human</span>
        ))}
      </section>
      <div className="discussion-member-options">
        {agents.map((agent) => {
          const checkboxId = `${idPrefix}-${agent.id}`;
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
  );
}

type DiscussionFormProps = {
  agents: Array<{ id: number; name: string }>;
  humans: Array<{ id: number; name: string }>;
  disabled: boolean;
  error: string | null;
  onCancel: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onToggleMember: (memberId: number) => void;
  selectedMemberIds: number[];
  setTopic: (topic: string) => void;
  topic: string;
};

export function DiscussionForm({
  agents,
  humans,
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
      <DiscussionMembersFieldset
        agents={agents}
        disabled={disabled}
        humans={humans}
        idPrefix="discussion-member"
        onToggleMember={onToggleMember}
        selectedMemberIds={selectedMemberIds}
      />
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
        memberId={member.id}
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
  currentHumanMemberId: number;
  discussion: Discussion;
  disabled: boolean;
  members: Member[];
  messageBody: string;
  messageInputRef: RefObject<HTMLTextAreaElement | null>;
  messageMentions: DraftMention[];
  mentionSyntax: MentionSyntax;
  onMessageChange: (body: string, mentions: DraftMention[]) => void;
  onMessagesSeen: (discussionId: number, messageIds: number[]) => void;
  onLoadEarlier?: () => Promise<void>;
  onRequestMessage?: (messageId: number) => Promise<void>;
  onLoadNewMessages?: () => Promise<void>;
  unloadedNewMessageCount: number;
  messagePageLoading: boolean;
  messagePageError: string | null;
  initialScrollTop?: number;
  onMessageScrollState?: (scrollTop: number, followsLatest: boolean) => void;
  onMarkAllRead?: (
    discussionId: number,
    throughMessageId: number,
  ) => Promise<boolean>;
  onAcknowledgeHumanMention?: (discussionId: number, messageId: number) => void;
  onOpenMember: (
    memberId: number,
    discussionId: number,
    triggerKey: string,
  ) => void;
  onSend: (event: FormEvent<HTMLFormElement>) => void;
};

function DiscussionView({
  currentHumanMemberId,
  discussion,
  disabled,
  members,
  messageBody,
  messageInputRef,
  messageMentions,
  mentionSyntax,
  onMessageChange,
  onMessagesSeen,
  onLoadEarlier,
  onRequestMessage,
  onLoadNewMessages,
  unloadedNewMessageCount,
  messagePageLoading,
  messagePageError,
  initialScrollTop,
  onMessageScrollState,
  onMarkAllRead,
  onAcknowledgeHumanMention,
  onOpenMember,
  onSend,
}: DiscussionViewProps) {
  const messageLogRef = useRef<HTMLDivElement>(null);
  const prependAnchorRef = useRef<StableScrollAnchor | null>(null);
  const prependMessageCountRef = useRef(0);
  const loadEarlierButtonRef = useRef<HTMLButtonElement>(null);
  const unread = useMemo(
    () => humanUnreadForDiscussion(discussion, currentHumanMemberId),
    [currentHumanMemberId, discussion],
  );
  const initialFirstUnreadMessageIdRef = useRef(unread.firstUnreadMessageId);
  const initialScrollTopRef = useRef(initialScrollTop);
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
      (discussion.messages ?? []).map((message) => message.id),
    ),
  );
  const discussionTitleRef = useRef<HTMLHeadingElement>(null);
  const activityBarRef = useRef<HTMLElement>(null);
  const previousActivityBarHeightRef = useRef<number | null>(null);
  const [deliverySelection, setDeliverySelection] =
    useState<DeliverySelection | null>(null);
  const [activityFeedback, setActivityFeedback] = useState("");
  const [markAllStatus, setMarkAllStatus] = useState<
    "idle" | "pending" | "error"
  >("idle");
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
    if (initialScrollTopRef.current !== undefined) {
      log.scrollTop = initialScrollTopRef.current;
      shouldFollowMessagesRef.current =
        log.scrollHeight - log.scrollTop - log.clientHeight <= 24;
    } else {
      shouldFollowMessagesRef.current =
        positionInitialDiscussionMessages(
          log,
          initialFirstUnreadMessageIdRef.current,
        ) === "bottom";
    }
  }, []);

  useLayoutEffect(() => {
    const log = messageLogRef.current;
    const anchor = prependAnchorRef.current;
    if (
      log &&
      anchor &&
      (discussion.messages?.length ?? 0) > prependMessageCountRef.current &&
      restoreStableScrollAnchor(log, anchor)
    ) {
      prependAnchorRef.current = null;
      loadEarlierButtonRef.current?.focus();
    }
  });

  useEffect(() => {
    const messageIds = (discussion.messages ?? []).map((message) => message.id);
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

  const updateActivityBarHeight = useCallback((nextHeight: number) => {
    const previousHeight = previousActivityBarHeightRef.current;
    previousActivityBarHeightRef.current = nextHeight;
    const log = messageLogRef.current;
    if (!log) {
      return;
    }
    preserveActivityBarScrollAnchor(
      log,
      previousHeight,
      nextHeight,
      shouldFollowMessagesRef.current,
    );
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: unread counts mount/unmount the bar; ResizeObserver handles every in-place pending/error/retry or responsive height change.
  useLayoutEffect(() => {
    const bar = activityBarRef.current;
    updateActivityBarHeight(bar?.offsetHeight ?? 0);
    if (!bar || typeof ResizeObserver === "undefined") {
      return undefined;
    }
    return observeActivityBarHeight(bar, updateActivityBarHeight);
  }, [
    newMessageIndicator.pendingMessageIds.length,
    unloadedNewMessageCount,
    unread.unreadCount,
    unread.unreadHumanMentionCount,
    updateActivityBarHeight,
  ]);

  function handleMessageScroll() {
    const log = messageLogRef.current;
    if (!log) {
      return;
    }
    const followingBottom =
      log.scrollHeight - log.scrollTop - log.clientHeight <= 24;
    shouldFollowMessagesRef.current = followingBottom;
    onMessageScrollState?.(log.scrollTop, followingBottom);
    if (followingBottom) {
      setNewMessageIndicator(clearNewMessageIndicator);
    }
  }

  async function handleLoadEarlier() {
    const log = messageLogRef.current;
    if (!log || !onLoadEarlier || messagePageLoading) return;
    prependAnchorRef.current = captureStableScrollAnchor(log);
    prependMessageCountRef.current = discussion.messages?.length ?? 0;
    await onLoadEarlier();
  }

  function handleSend(event: FormEvent<HTMLFormElement>) {
    shouldFollowMessagesRef.current = true;
    onSend(event);
  }

  async function focusMessage(messageId: number | undefined) {
    if (messageId === undefined) return;
    let target = messageLogRef.current?.querySelector<HTMLElement>(
      `[data-message-id="${messageId}"]`,
    );
    if (!target && onRequestMessage) {
      await onRequestMessage(messageId);
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => resolve()),
      );
      target = messageLogRef.current?.querySelector<HTMLElement>(
        `[data-message-id="${messageId}"]`,
      );
    }
    target?.scrollIntoView({ block: "center" });
    target?.focus();
  }

  async function focusNewMessages() {
    if (
      newMessageIndicator.pendingMessageIds.length === 0 &&
      onLoadNewMessages
    ) {
      await onLoadNewMessages();
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => resolve()),
      );
      const loadedIds = discussion.messages?.map((message) => message.id) ?? [];
      await focusMessage(loadedIds[loadedIds.length - 1]);
    } else {
      await focusMessage(newMessageIndicator.pendingMessageIds[0]);
    }
    setNewMessageIndicator(clearNewMessageIndicator);
  }

  function focusNextMention() {
    const target =
      nextMessageId(
        unread.unreadHumanMentionMessageIds,
        lastMentionTargetRef.current,
      ) ?? unread.unreadHumanMentionMessageIds[0];
    lastMentionTargetRef.current = target;
    void focusMessage(target);
  }

  function closeDeliveryPanel() {
    const triggerKey = deliverySelection?.triggerKey;
    setDeliverySelection(null);
    if (triggerKey) {
      requestAnimationFrame(() =>
        requestAnimationFrame(() =>
          document
            .querySelector<HTMLElement>(
              `[data-delivery-trigger-key="${CSS.escape(triggerKey)}"]`,
            )
            ?.focus(),
        ),
      );
    }
  }

  const selectedDeliveryMessage = deliverySelection
    ? (discussion.messages ?? []).find(
        (message) => message.id === deliverySelection.messageId,
      )
    : undefined;

  return (
    <>
      <header className="border-border border-b px-6 py-4">
        <div className="flex items-baseline justify-between gap-6">
          <h2
            className="discussion-title m-0 font-semibold"
            data-discussion-focus-id={discussion.id}
            ref={discussionTitleRef}
            tabIndex={-1}
          >
            {discussionLabel(discussion)}
          </h2>
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
      {unread.unreadCount > 0 ||
      unread.unreadHumanMentionCount > 0 ||
      newMessageIndicator.pendingMessageIds.length > 0 ||
      unloadedNewMessageCount > 0 ? (
        <section
          aria-label="New Discussion activity"
          className="human-unread-controls"
          ref={activityBarRef}
        >
          <div className="human-activity-counts">
            {unread.unreadCount > 0 ? (
              <span className="human-activity-count">
                {unread.unreadCount} new messages
              </span>
            ) : null}
            {unread.unreadHumanMentionCount > 0 ? (
              <span className="human-activity-count">
                {unread.unreadHumanMentionCount} new mentions
              </span>
            ) : null}
            {markAllStatus === "error" ? (
              <span className="human-activity-error" role="alert">
                Could not mark messages as read. Try again.
              </span>
            ) : null}
          </div>
          <div className="human-activity-actions">
            <FirstUnreadJumpButton
              onActivate={() => focusMessage(unread.firstUnreadMessageId)}
              unreadCount={unread.unreadCount}
            />
            <NewMessageJumpButton
              newMessageCount={
                newMessageIndicator.pendingMessageIds.length +
                unloadedNewMessageCount
              }
              onActivate={() => void focusNewMessages()}
            />
            <NextHumanMentionButton
              onActivate={focusNextMention}
              unreadMentionCount={unread.unreadHumanMentionCount}
            />
            {unread.unreadCount > 0 ? (
              <button
                aria-describedby={`mark-all-note-${discussion.id}`}
                className="human-unread-control"
                disabled={
                  disabled || markAllStatus === "pending" || !onMarkAllRead
                }
                onClick={async () => {
                  const latest =
                    discussion.messages?.[discussion.messages.length - 1]?.id ??
                    0;
                  setMarkAllStatus("pending");
                  setActivityFeedback("Marking all current messages as read");
                  const succeeded = await onMarkAllRead?.(
                    discussion.id,
                    latest,
                  );
                  if (succeeded) {
                    setMarkAllStatus("idle");
                    setActivityFeedback(
                      "All current messages marked as read; mentions were not acknowledged",
                    );
                    requestAnimationFrame(() =>
                      discussionTitleRef.current?.focus(),
                    );
                  } else {
                    setMarkAllStatus("error");
                    setActivityFeedback(
                      "Could not mark messages as read. Try again",
                    );
                  }
                }}
                type="button"
              >
                {markAllStatus === "pending"
                  ? "Marking as read…"
                  : markAllStatus === "error"
                    ? "Retry mark all as read"
                    : "Mark all as read"}
              </button>
            ) : null}
          </div>
          <p className="sr-only" id={`mark-all-note-${discussion.id}`}>
            Marking all as read does not acknowledge mentions.
          </p>
        </section>
      ) : null}
      <span aria-live="polite" className="sr-only">
        {activityFeedback}
      </span>
      <div
        className="message-log min-h-0 overflow-y-auto px-6 py-2"
        aria-label="Messages"
        onScroll={handleMessageScroll}
        ref={messageLogRef}
        role="log"
      >
        {onLoadEarlier ? (
          <div className="flex min-h-10 items-center justify-center py-2">
            <Button
              ref={loadEarlierButtonRef}
              aria-disabled={messagePageLoading}
              onClick={() => void handleLoadEarlier()}
              variant="quiet"
            >
              {messagePageLoading
                ? "Loading earlier messages"
                : messagePageError
                  ? "Retry loading earlier messages"
                  : "Load earlier messages"}
            </Button>
            {messagePageError ? (
              <span className="sr-only" role="alert">
                {messagePageError}
              </span>
            ) : null}
          </div>
        ) : null}
        {messagePageLoading && (discussion.messages?.length ?? 0) === 0 ? (
          <p
            className="body-compact m-0 py-4 text-center text-text-tertiary"
            aria-live="polite"
          >
            Loading messages
          </p>
        ) : messagePageError && (discussion.messages?.length ?? 0) === 0 ? (
          <p
            className="body-compact m-0 py-4 text-center text-danger"
            role="alert"
          >
            {messagePageError}
          </p>
        ) : null}
        {(discussion.messages?.length ?? 0) === 0 ? (
          <div className="grid h-full place-items-center">
            <p className="body-compact m-0 text-text-tertiary">
              No messages yet
            </p>
          </div>
        ) : (
          <ol className="m-0 list-none p-0">
            {(discussion.messages ?? []).map((message) => {
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
                        memberId={message.sender_id}
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
                          ) : senderIdentity === "deleted" ? (
                            <>
                              <span className="sr-only">
                                {senderName}, Deleted member
                              </span>
                              <span aria-hidden="true">{senderName}</span>
                            </>
                          ) : (
                            senderName
                          )}
                        </strong>
                        {message.created_at ? (
                          <MessageTimestamp createdAt={message.created_at} />
                        ) : null}
                      </header>
                      <DiscussionMarkdown
                        body={message.body}
                        delivery={message.delivery}
                        members={members}
                        messageId={message.id}
                        onOpenMember={handleOpenMember}
                        onOpenMentionDetails={(memberId, triggerKey) =>
                          setDeliverySelection({
                            messageId: message.id,
                            memberId,
                            triggerKey,
                          })
                        }
                        references={message.references}
                      />
                      <DeliveryCircle
                        isOwnMessage={
                          message.sender_id === currentHumanMemberId
                        }
                        message={message}
                        onOpen={setDeliverySelection}
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
      {deliverySelection && selectedDeliveryMessage ? (
        <>
          <button
            aria-label="Dismiss delivery details"
            className="delivery-panel-backdrop"
            onClick={closeDeliveryPanel}
            type="button"
          />
          <DeliveryPanel
            currentHumanMemberId={currentHumanMemberId}
            disabled={disabled}
            members={members}
            message={selectedDeliveryMessage}
            onAcknowledge={(messageId) =>
              onAcknowledgeHumanMention?.(discussion.id, messageId)
            }
            onClose={closeDeliveryPanel}
            onOpenMember={(memberId, triggerKey) =>
              onOpenMember(memberId, discussion.id, triggerKey)
            }
            returnTriggerKey={deliverySelection.triggerKey}
            selectedMemberId={deliverySelection.memberId}
          />
        </>
      ) : null}
      <MessageComposer
        agents={members}
        body={messageBody}
        currentHumanMemberId={currentHumanMemberId}
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
