import { describe, expect, it } from "vitest";
import { calculateHumanUnread, nextMessageId } from "./human-unread";

const messages = [
  { id: "m1", authorMemberId: 7 },
  { id: "m2", authorMemberId: 2 },
  { id: "m3", authorMemberId: 2 },
  { id: "m4", authorMemberId: 3 },
  { id: "m5", authorMemberId: 4 },
] as const;

describe("calculateHumanUnread", () => {
  it("excludes the Human's own messages and caller-provided read or seen messages", () => {
    const result = calculateHumanUnread({
      currentHumanMemberId: 7,
      messages,
      readMessageIds: new Set(["m2"]),
      seenMessageIds: new Set(["m4"]),
      humanMentionMessageIds: new Set(["m1", "m3", "m4", "m5"]),
    });

    expect(result).toEqual({
      unreadMessageIds: ["m3", "m5"],
      unreadHumanMentionMessageIds: ["m3", "m5"],
      unreadCount: 2,
      unreadHumanMentionCount: 2,
      firstUnreadMessageId: "m3",
    });
  });

  it("counts @ messages only when they are also ordinary unread messages", () => {
    const result = calculateHumanUnread({
      currentHumanMemberId: 7,
      messages,
      readMessageIds: new Set(["m3"]),
      seenMessageIds: new Set<string>(),
      humanMentionMessageIds: new Set(["m1", "m2", "m3", "missing"]),
    });

    expect(result.unreadMessageIds).toEqual(["m2", "m4", "m5"]);
    expect(result.unreadHumanMentionMessageIds).toEqual(["m2"]);
    expect(result.unreadHumanMentionCount).toBe(1);
  });

  it("does not mutate any caller-owned set", () => {
    const readMessageIds = new Set(["m2"]);
    const seenMessageIds = new Set(["m3"]);
    const humanMentionMessageIds = new Set(["m4"]);

    calculateHumanUnread({
      currentHumanMemberId: 7,
      messages,
      readMessageIds,
      seenMessageIds,
      humanMentionMessageIds,
    });

    expect([...readMessageIds]).toEqual(["m2"]);
    expect([...seenMessageIds]).toEqual(["m3"]);
    expect([...humanMentionMessageIds]).toEqual(["m4"]);
  });
});

describe("nextMessageId", () => {
  it("selects the first or following target without wrapping", () => {
    const ids = ["m2", "m4", "m8"];

    expect(nextMessageId(ids)).toBe("m2");
    expect(nextMessageId(ids, "m2")).toBe("m4");
    expect(nextMessageId(ids, "m8")).toBeUndefined();
  });

  it("starts at the first target when the current message is outside the subset", () => {
    expect(nextMessageId(["m2", "m4"], "m3")).toBe("m2");
    expect(nextMessageId([], "m3")).toBeUndefined();
  });
});
