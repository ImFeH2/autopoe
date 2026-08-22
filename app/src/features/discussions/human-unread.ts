export type HumanUnreadMessageId = string | number;

export interface HumanUnreadMessage<
  MessageId extends HumanUnreadMessageId = HumanUnreadMessageId,
> {
  id: MessageId;
  authorMemberId: number;
}

export interface HumanUnreadInput<
  MessageId extends HumanUnreadMessageId = HumanUnreadMessageId,
> {
  currentHumanMemberId: number;
  messages: readonly HumanUnreadMessage<MessageId>[];
  readMessageIds: ReadonlySet<MessageId>;
  seenMessageIds: ReadonlySet<MessageId>;
  humanMentionMessageIds: ReadonlySet<MessageId>;
}

export interface HumanUnreadResult<
  MessageId extends HumanUnreadMessageId = HumanUnreadMessageId,
> {
  unreadMessageIds: readonly MessageId[];
  unreadHumanMentionMessageIds: readonly MessageId[];
  unreadCount: number;
  unreadHumanMentionCount: number;
  firstUnreadMessageId: MessageId | undefined;
}

/**
 * Computes Human unread presentation state from caller-owned facts.
 *
 * Mention membership is deliberately accepted as an input. This module never
 * parses identities, derives mention notification truth, or changes read state.
 */
export function calculateHumanUnread<MessageId extends HumanUnreadMessageId>(
  input: HumanUnreadInput<MessageId>,
): HumanUnreadResult<MessageId> {
  const unreadMessageIds: MessageId[] = [];
  const unreadHumanMentionMessageIds: MessageId[] = [];

  for (const message of input.messages) {
    const isOwnMessage = message.authorMemberId === input.currentHumanMemberId;
    const isRead = input.readMessageIds.has(message.id);
    const isSeen = input.seenMessageIds.has(message.id);

    if (isOwnMessage || isRead || isSeen) {
      continue;
    }

    unreadMessageIds.push(message.id);
    if (input.humanMentionMessageIds.has(message.id)) {
      unreadHumanMentionMessageIds.push(message.id);
    }
  }

  return {
    unreadMessageIds,
    unreadHumanMentionMessageIds,
    unreadCount: unreadMessageIds.length,
    unreadHumanMentionCount: unreadHumanMentionMessageIds.length,
    firstUnreadMessageId: unreadMessageIds[0],
  };
}

/** Returns the next target in caller-provided discussion order without wrapping. */
export function nextMessageId<MessageId extends HumanUnreadMessageId>(
  orderedMessageIds: readonly MessageId[],
  afterMessageId?: MessageId,
): MessageId | undefined {
  if (orderedMessageIds.length === 0) {
    return undefined;
  }
  if (afterMessageId === undefined) {
    return orderedMessageIds[0];
  }

  const currentIndex = orderedMessageIds.indexOf(afterMessageId);
  return currentIndex < 0
    ? orderedMessageIds[0]
    : orderedMessageIds[currentIndex + 1];
}

export interface NewMessageIndicatorState {
  latestMessageId: number;
  pendingMessageIds: readonly number[];
}

export function createNewMessageIndicatorState(
  orderedMessageIds: readonly number[],
): NewMessageIndicatorState {
  return {
    latestMessageId: orderedMessageIds[orderedMessageIds.length - 1] ?? 0,
    pendingMessageIds: [],
  };
}

/** Tracks only messages appended while the Human is not following the bottom. */
export function updateNewMessageIndicator(
  state: NewMessageIndicatorState,
  orderedMessageIds: readonly number[],
  followingBottom: boolean,
): NewMessageIndicatorState {
  const latestMessageId =
    orderedMessageIds[orderedMessageIds.length - 1] ?? state.latestMessageId;
  if (followingBottom) {
    return { latestMessageId, pendingMessageIds: [] };
  }

  const appendedMessageIds = orderedMessageIds.filter(
    (messageId) => messageId > state.latestMessageId,
  );
  return {
    latestMessageId,
    pendingMessageIds: [
      ...new Set([...state.pendingMessageIds, ...appendedMessageIds]),
    ],
  };
}

export function clearNewMessageIndicator(
  state: NewMessageIndicatorState,
): NewMessageIndicatorState {
  return state.pendingMessageIds.length === 0
    ? state
    : { ...state, pendingMessageIds: [] };
}
