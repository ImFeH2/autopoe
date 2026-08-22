import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  FirstUnreadDivider,
  FirstUnreadJumpButton,
  NewMessageJumpButton,
  NextHumanMentionButton,
  UnreadBadge,
} from "./unread-discussion-controls";

describe("unread discussion controls", () => {
  it("renders a bounded badge with an explicit accessible count", () => {
    const markup = renderToStaticMarkup(<UnreadBadge count={120} />);

    expect(markup).toContain('role="status"');
    expect(markup).toContain('aria-label="120 unread messages"');
    expect(markup).toContain("99+");
    expect(renderToStaticMarkup(<UnreadBadge count={0} />)).toBe("");
  });

  it("provides a focus target and accessible name for the first unread divider", () => {
    const markup = renderToStaticMarkup(<FirstUnreadDivider />);

    expect(markup).toContain('<hr aria-label="New messages"');
    expect(markup).toContain('tabindex="-1"');
    expect(markup).toContain('aria-hidden="true">New messages</span>');
  });

  it("uses a native keyboard-operable button for the first unread jump", () => {
    const onActivate = vi.fn();
    const element = FirstUnreadJumpButton({ onActivate, unreadCount: 3 });
    if (element === null) {
      throw new Error("expected jump control");
    }

    element.props.onClick();
    const markup = renderToStaticMarkup(element);

    expect(onActivate).toHaveBeenCalledOnce();
    expect(markup).toContain(
      '<button aria-label="Jump to first unread message (3 unread)"',
    );
    expect(markup).toContain('type="button"');
  });

  it("renders a distinct incremental new-message jump", () => {
    const markup = renderToStaticMarkup(
      <NewMessageJumpButton newMessageCount={3} onActivate={() => undefined} />,
    );

    expect(markup).toContain('aria-label="Jump to 3 new messages"');
    expect(markup).toContain(">3 new messages</span>");
    expect(markup).not.toContain("First unread");
  });

  it("keeps the @next control props-driven and labels disabled state", () => {
    const onActivate = vi.fn();
    const element = NextHumanMentionButton({
      disabled: true,
      onActivate,
      unreadMentionCount: 2,
    });
    if (element === null) {
      throw new Error("expected mention control");
    }

    const markup = renderToStaticMarkup(element);
    expect(markup).toContain("disabled");
    expect(markup).toContain(
      'aria-label="Jump to next unread mention (2 unread)"',
    );
    expect(markup).toContain("@2");
    expect(onActivate).not.toHaveBeenCalled();
  });

  it("omits jump controls when their caller-provided count is empty", () => {
    expect(
      renderToStaticMarkup(
        <FirstUnreadJumpButton onActivate={() => undefined} unreadCount={0} />,
      ),
    ).toBe("");
    expect(
      renderToStaticMarkup(
        <NewMessageJumpButton
          newMessageCount={0}
          onActivate={() => undefined}
        />,
      ),
    ).toBe("");
    expect(
      renderToStaticMarkup(
        <NextHumanMentionButton
          onActivate={() => undefined}
          unreadMentionCount={0}
        />,
      ),
    ).toBe("");
  });
});
