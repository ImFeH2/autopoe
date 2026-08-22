import { describe, expect, it } from "vitest";
import { unreadHumanMentionCount } from "./human-mention-notifications";

describe("HumanMentionNotifications", () => {
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
