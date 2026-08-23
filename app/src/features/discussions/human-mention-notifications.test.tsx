import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  HumanMentionNotifications,
  humanMentionNotificationAccessibleLabel,
  unreadHumanMentionCount,
} from "./human-mention-notifications";

describe("HumanMentionNotifications", () => {
  it("exposes read state and the shared keyboard or pointer activation contract", () => {
    const notifications = [
      {
        discussionId: 1,
        discussionTopic: "One",
        messageId: 1,
        senderName: "Ada",
        unread: true,
      },
      {
        discussionId: 2,
        discussionTopic: "Two",
        messageId: 4,
        senderName: "Lin",
        unread: false,
      },
    ];
    expect(humanMentionNotificationAccessibleLabel(notifications[0])).toBe(
      "Unread mention from Ada in One",
    );
    expect(humanMentionNotificationAccessibleLabel(notifications[1])).toBe(
      "Read mention from Lin in Two",
    );

    const markup = renderToStaticMarkup(
      <HumanMentionNotifications
        notifications={notifications}
        onOpen={vi.fn()}
      />,
    );
    expect(markup).toContain('aria-label="Unread mention from Ada in One"');
    expect(markup).toContain('aria-label="Read mention from Lin in Two"');
    expect(markup.match(/<button/g)).toHaveLength(2);
  });

  it("counts only unread Human notification state", () => {
    expect(
      unreadHumanMentionCount([
        {
          discussionId: 1,
          discussionTopic: "One",
          messageId: 1,
          senderName: "Ada",
          unread: true,
        },
        {
          discussionId: 2,
          discussionTopic: "Two",
          messageId: 4,
          senderName: "Lin",
          unread: false,
        },
      ]),
    ).toBe(1);
  });
});
