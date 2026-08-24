import type { DiscussionMessagePage, Message } from "@/lib/backend";
export type DiscussionMessageCache = {
  messagesById: Record<number, Message>;
  orderedIds: number[];
  loaded: boolean;
  loading: boolean;
  error: string | null;
  hasEarlier: boolean;
  hasLater: boolean;
  oldestMessageId: number | null;
  newestMessageId: number | null;
  latestMessageId: number | null;
  generation: number;
  scrollTop: number;
  followsLatest: boolean;
};
export function createDiscussionMessageCache(): DiscussionMessageCache {
  return {
    messagesById: {},
    orderedIds: [],
    loaded: false,
    loading: false,
    error: null,
    hasEarlier: false,
    hasLater: false,
    oldestMessageId: null,
    newestMessageId: null,
    latestMessageId: null,
    generation: 0,
    scrollTop: 0,
    followsLatest: true,
  };
}
export function mergeDiscussionMessagePage(
  current: DiscussionMessageCache,
  page: DiscussionMessagePage,
): DiscussionMessageCache {
  const messagesById =
    page.mode === "anchor" ? {} : { ...current.messagesById };
  for (const message of page.messages) messagesById[message.id] = message;
  const orderedIds = Object.keys(messagesById)
    .map(Number)
    .sort((left, right) => left - right);
  return {
    ...current,
    messagesById,
    orderedIds,
    loaded: true,
    loading: false,
    error: null,
    hasEarlier: page.mode === "after" ? current.hasEarlier : page.has_earlier,
    hasLater: page.mode === "before" ? current.hasLater : page.has_later,
    oldestMessageId: orderedIds[0] ?? null,
    newestMessageId: orderedIds[orderedIds.length - 1] ?? null,
    latestMessageId: page.latest_message_id,
    followsLatest: page.mode === "anchor" ? false : current.followsLatest,
  };
}

export function cachedDiscussionMessages(
  cache: DiscussionMessageCache,
): Message[] {
  return cache.orderedIds.flatMap((id) =>
    cache.messagesById[id] ? [cache.messagesById[id]] : [],
  );
}
