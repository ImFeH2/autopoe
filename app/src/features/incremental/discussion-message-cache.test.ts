import { describe, expect, it } from "vitest";
import {
  cachedDiscussionMessages,
  createDiscussionMessageCache,
  mergeDiscussionMessagePage,
} from "./discussion-message-cache";

const message = (id: number) => ({
  id,
  sender_id: 1,
  body: `m${id}`,
  created_at: null,
  references: [],
  mentions: [],
});
const page = (
  ids: number[],
  mode: "latest" | "before" | "after" | "anchor" = "latest",
) => ({
  discussion_id: 1,
  mode,
  messages: ids.map(message),
  oldest_message_id: ids[0] ?? null,
  newest_message_id: ids[ids.length - 1] ?? null,
  latest_message_id: 9,
  has_earlier: (ids[0] ?? 1) > 1,
  has_later: (ids[ids.length - 1] ?? 9) < 9,
  next_before_message_id: ids[0] ?? null,
  next_after_message_id: ids[ids.length - 1] ?? null,
});
describe("discussion message cache", () => {
  it("deduplicates overlapping pages and preserves ID gaps", () => {
    const first = mergeDiscussionMessagePage(
      createDiscussionMessageCache(),
      page([5, 7, 9]),
    );
    const second = mergeDiscussionMessagePage(first, page([1, 3, 5], "before"));
    expect(cachedDiscussionMessages(second).map((item) => item.id)).toEqual([
      1, 3, 5, 7, 9,
    ]);
  });
  it("stops following latest for exact anchor windows", () => {
    expect(
      mergeDiscussionMessagePage(
        createDiscussionMessageCache(),
        page([3, 5, 7], "anchor"),
      ).followsLatest,
    ).toBe(false);
  });
});
