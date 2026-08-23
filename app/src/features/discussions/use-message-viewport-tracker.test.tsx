import { describe, expect, it, vi } from "vitest";
import {
  createMessageViewportTracker,
  createSeenMessageBatch,
} from "./use-message-viewport-tracker";

function setup(minVisibleRatio = 0.5) {
  let notify: IntersectionObserverCallback = () => undefined;
  const observe = vi.fn();
  const unobserve = vi.fn();
  const disconnect = vi.fn();
  const onMessageSeen = vi.fn();
  const factory = vi.fn(
    (
      callback: IntersectionObserverCallback,
      _options: IntersectionObserverInit,
    ) => {
      notify = callback;
      return { disconnect, observe, unobserve };
    },
  );
  const tracker = createMessageViewportTracker(
    { minVisibleRatio, onMessageSeen },
    factory,
  );

  const intersect = (
    target: Element,
    intersectionRatio: number,
    isIntersecting = true,
  ) => {
    notify(
      [
        {
          target,
          intersectionRatio,
          isIntersecting,
        } as IntersectionObserverEntry,
      ],
      {} as IntersectionObserver,
    );
  };

  return {
    disconnect,
    factory,
    intersect,
    observe,
    onMessageSeen,
    tracker,
    unobserve,
  };
}

describe("createMessageViewportTracker", () => {
  it("does not emit for mount, selection-like reattachment, or non-intersection", () => {
    const { intersect, onMessageSeen, tracker } = setup();
    const element = {} as Element;

    tracker.track("m1", element);
    tracker.track("m1", element);
    expect(onMessageSeen).not.toHaveBeenCalled();

    intersect(element, 1, false);
    intersect(element, 0.49);
    expect(onMessageSeen).not.toHaveBeenCalled();
  });

  it("emits once only after a real qualifying intersection", () => {
    const { intersect, observe, onMessageSeen, tracker, unobserve } = setup();
    const element = {} as Element;

    tracker.track("m1", element);
    intersect(element, 0.5);
    intersect(element, 1);

    expect(observe).toHaveBeenCalledOnce();
    expect(onMessageSeen).toHaveBeenCalledOnce();
    expect(onMessageSeen).toHaveBeenCalledWith("m1");
    expect(unobserve).toHaveBeenCalledWith(element);
  });

  it("unobserves replaced or removed elements and disconnects cleanly", () => {
    const { disconnect, tracker, unobserve } = setup();
    const first = {} as Element;
    const second = {} as Element;

    tracker.track("m1", first);
    tracker.track("m1", second);
    tracker.track("m1", null);
    tracker.disconnect();

    expect(unobserve).toHaveBeenNthCalledWith(1, first);
    expect(unobserve).toHaveBeenNthCalledWith(2, second);
    expect(disconnect).toHaveBeenCalledOnce();
  });

  it("passes the requested root, margin, and real threshold to the observer", () => {
    const root = {} as Element;
    const factory = vi.fn(
      (
        _callback: IntersectionObserverCallback,
        _options: IntersectionObserverInit,
      ) => ({
        disconnect: vi.fn(),
        observe: vi.fn(),
        unobserve: vi.fn(),
      }),
    );

    createMessageViewportTracker(
      {
        minVisibleRatio: 0.75,
        onMessageSeen: vi.fn(),
        root,
        rootMargin: "0px 0px -10%",
      },
      factory,
    );

    expect(factory.mock.calls[0]?.[1]).toEqual({
      root,
      rootMargin: "0px 0px -10%",
      threshold: 0.75,
    });
  });

  it("rejects an impossible visibility ratio", () => {
    expect(() => setup(1.1)).toThrow(RangeError);
  });
});

describe("createSeenMessageBatch", () => {
  it("flushes a real intersected message when navigation disposes before RAF", () => {
    let scheduled: (() => void) | undefined;
    let notify: IntersectionObserverCallback = () => undefined;
    const cancel = vi.fn();
    const onFlush = vi.fn();
    const batch = createSeenMessageBatch(
      onFlush,
      (callback) => {
        scheduled = callback;
        return 17;
      },
      cancel,
    );
    const tracker = createMessageViewportTracker(
      { minVisibleRatio: 0, onMessageSeen: batch.add },
      (callback) => {
        notify = callback;
        return {
          disconnect: vi.fn(),
          observe: vi.fn(),
          unobserve: vi.fn(),
        };
      },
    );
    const element = {} as Element;

    tracker.track("m1", element);
    notify(
      [
        {
          target: element,
          isIntersecting: true,
          intersectionRatio: 1,
        } as IntersectionObserverEntry,
      ],
      {} as IntersectionObserver,
    );
    expect(scheduled).toBeDefined();
    expect(onFlush).not.toHaveBeenCalled();

    batch.dispose();

    expect(cancel).toHaveBeenCalledWith(17);
    expect(onFlush).toHaveBeenCalledOnce();
    expect(onFlush).toHaveBeenCalledWith(["m1"]);
    scheduled?.();
    expect(onFlush).toHaveBeenCalledOnce();
  });
});
