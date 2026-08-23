import { useCallback, useEffect, useRef } from "react";

export type MessageViewportMessageId = string | number;

export interface MessageViewportTrackerOptions<
  MessageId extends MessageViewportMessageId,
> {
  onMessageSeen: (messageId: MessageId) => void;
  root?: Element | Document | null;
  rootMargin?: string;
  minVisibleRatio?: number;
}

type IntersectionObserverHandle = Pick<
  IntersectionObserver,
  "disconnect" | "observe" | "unobserve"
>;

type IntersectionObserverFactory = (
  callback: IntersectionObserverCallback,
  options: IntersectionObserverInit,
) => IntersectionObserverHandle;

export interface SeenMessageBatch<MessageId extends MessageViewportMessageId> {
  add: (messageId: MessageId) => void;
  dispose: () => void;
  flush: () => void;
}

type ScheduleSeenFlush = (callback: () => void) => number;
type CancelSeenFlush = (handle: number) => void;

export function createSeenMessageBatch<
  MessageId extends MessageViewportMessageId,
>(
  onFlush: (messageIds: MessageId[]) => void,
  schedule: ScheduleSeenFlush = (callback) => requestAnimationFrame(callback),
  cancel: CancelSeenFlush = (handle) => cancelAnimationFrame(handle),
): SeenMessageBatch<MessageId> {
  const pendingMessageIds = new Set<MessageId>();
  let scheduledHandle: number | null = null;

  const flush = () => {
    if (scheduledHandle !== null) {
      cancel(scheduledHandle);
      scheduledHandle = null;
    }
    const messageIds = [...pendingMessageIds];
    pendingMessageIds.clear();
    if (messageIds.length > 0) {
      onFlush(messageIds);
    }
  };

  return {
    add: (messageId) => {
      pendingMessageIds.add(messageId);
      if (scheduledHandle === null) {
        scheduledHandle = schedule(flush);
      }
    },
    dispose: flush,
    flush,
  };
}

export interface MessageViewportTracker<
  MessageId extends MessageViewportMessageId,
> {
  disconnect: () => void;
  track: (messageId: MessageId, element: Element | null) => void;
}

function browserObserverFactory(
  callback: IntersectionObserverCallback,
  options: IntersectionObserverInit,
): IntersectionObserverHandle {
  return new IntersectionObserver(callback, options);
}

/**
 * Creates a real intersection-based tracker. Attaching an element never marks
 * it seen; only a qualifying IntersectionObserver entry can emit the callback.
 */
export function createMessageViewportTracker<
  MessageId extends MessageViewportMessageId,
>(
  options: MessageViewportTrackerOptions<MessageId>,
  observerFactory: IntersectionObserverFactory = browserObserverFactory,
): MessageViewportTracker<MessageId> {
  const minVisibleRatio = options.minVisibleRatio ?? 0.5;
  if (minVisibleRatio < 0 || minVisibleRatio > 1) {
    throw new RangeError("minVisibleRatio must be between 0 and 1");
  }

  const elementsByMessageId = new Map<MessageId, Element>();
  const messageIdsByElement = new Map<Element, MessageId>();
  const emittedMessageIds = new Set<MessageId>();

  const observer = observerFactory(
    (entries) => {
      for (const entry of entries) {
        if (
          !entry.isIntersecting ||
          entry.intersectionRatio < minVisibleRatio
        ) {
          continue;
        }

        const messageId = messageIdsByElement.get(entry.target);
        if (messageId === undefined || emittedMessageIds.has(messageId)) {
          continue;
        }

        emittedMessageIds.add(messageId);
        observer.unobserve(entry.target);
        messageIdsByElement.delete(entry.target);
        elementsByMessageId.delete(messageId);
        options.onMessageSeen(messageId);
      }
    },
    {
      root: options.root ?? null,
      rootMargin: options.rootMargin ?? "0px",
      threshold: minVisibleRatio,
    },
  );

  const track = (messageId: MessageId, element: Element | null) => {
    const previousElement = elementsByMessageId.get(messageId);
    if (previousElement === element) {
      return;
    }
    if (previousElement !== undefined) {
      observer.unobserve(previousElement);
      elementsByMessageId.delete(messageId);
      messageIdsByElement.delete(previousElement);
    }
    if (element === null || emittedMessageIds.has(messageId)) {
      return;
    }

    const previousMessageId = messageIdsByElement.get(element);
    if (previousMessageId !== undefined) {
      elementsByMessageId.delete(previousMessageId);
    }

    elementsByMessageId.set(messageId, element);
    messageIdsByElement.set(element, messageId);
    observer.observe(element);
  };

  const disconnect = () => {
    observer.disconnect();
    elementsByMessageId.clear();
    messageIdsByElement.clear();
  };

  return { disconnect, track };
}

/**
 * React adapter for createMessageViewportTracker. Consumers pass the returned
 * function to callback refs as `(element) => trackMessage(id, element)`.
 */
export function useMessageViewportTracker<
  MessageId extends MessageViewportMessageId,
>(
  options: MessageViewportTrackerOptions<MessageId>,
): (messageId: MessageId, element: Element | null) => void {
  const onMessageSeenRef = useRef(options.onMessageSeen);
  const trackerRef = useRef<MessageViewportTracker<MessageId> | null>(null);
  const elementsRef = useRef(new Map<MessageId, Element>());
  onMessageSeenRef.current = options.onMessageSeen;

  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") {
      return undefined;
    }
    const tracker = createMessageViewportTracker<MessageId>({
      minVisibleRatio: options.minVisibleRatio,
      onMessageSeen: (messageId) => onMessageSeenRef.current(messageId),
      root: options.root,
      rootMargin: options.rootMargin,
    });
    trackerRef.current = tracker;
    for (const [messageId, element] of elementsRef.current) {
      tracker.track(messageId, element);
    }
    return () => {
      tracker.disconnect();
      trackerRef.current = null;
    };
  }, [options.minVisibleRatio, options.root, options.rootMargin]);

  return useCallback((messageId: MessageId, element: Element | null) => {
    if (element === null) {
      elementsRef.current.delete(messageId);
    } else {
      elementsRef.current.set(messageId, element);
    }
    trackerRef.current?.track(messageId, element);
  }, []);
}
