import { describe, expect, it } from "vitest";
import {
  filterMentionAgents,
  findMentionQuery,
  getDraftMentionIds,
  getMentionKeyAction,
  insertDraftMention,
  reconcileDraftMentions,
  shouldSubmitMessage,
} from "./message-composer";

describe("MessageComposer", () => {
  it("submits Enter but preserves Shift+Enter and IME composition", () => {
    expect(
      shouldSubmitMessage({
        key: "Enter",
        shiftKey: false,
        isComposing: false,
      }),
    ).toBe(true);
    expect(
      shouldSubmitMessage({ key: "Enter", shiftKey: true, isComposing: false }),
    ).toBe(false);
    expect(
      shouldSubmitMessage({ key: "Enter", shiftKey: false, isComposing: true }),
    ).toBe(false);
  });

  it("finds inline mention queries without treating emails as mentions", () => {
    expect(findMentionQuery("Ask @ad", 7, [])).toEqual({
      start: 4,
      end: 7,
      query: "ad",
    });
    expect(findMentionQuery("mail@example.com", 16, [])).toBeNull();
    expect(
      findMentionQuery("@Ada ", 5, [
        { start: 0, end: 4, label: "@Ada", memberId: 2 },
      ]),
    ).toBeNull();
  });

  it("filters mention candidates and inserts the selected Agent at the caret", () => {
    const agents = [
      { id: 2, type: "agent" as const, name: "Ada", status: "idle" as const },
      {
        id: 3,
        type: "agent" as const,
        name: "Grace Hopper",
        status: "idle" as const,
      },
    ];

    expect(filterMentionAgents(agents, "hop")).toEqual([agents[1]]);
    expect(
      insertDraftMention({
        agent: agents[1],
        body: "Ask @gr about it",
        mentions: [],
        query: { start: 4, end: 7, query: "gr" },
      }),
    ).toEqual({
      body: "Ask @Grace Hopper about it",
      caret: 17,
      mentions: [
        {
          start: 4,
          end: 17,
          label: "@Grace Hopper",
          memberId: 3,
        },
      ],
    });
  });

  it("removes edited mentions, shifts later mentions, and deduplicates IDs", () => {
    const mentions = [
      { start: 0, end: 4, label: "@Ada", memberId: 2 },
      { start: 9, end: 15, label: "@Linus", memberId: 3 },
      { start: 16, end: 20, label: "@Ada", memberId: 2 },
    ];

    expect(
      reconcileDraftMentions(
        "@Ada and @Linus @Ada",
        "@Axa and @Linus @Ada",
        mentions,
      ),
    ).toEqual([
      { start: 9, end: 15, label: "@Linus", memberId: 3 },
      { start: 16, end: 20, label: "@Ada", memberId: 2 },
    ]);
    expect(
      reconcileDraftMentions(
        "@Ada and @Linus @Ada",
        "Please @Ada and @Linus @Ada",
        mentions,
      ),
    ).toEqual([
      { start: 7, end: 11, label: "@Ada", memberId: 2 },
      { start: 16, end: 22, label: "@Linus", memberId: 3 },
      { start: 23, end: 27, label: "@Ada", memberId: 2 },
    ]);
    expect(getDraftMentionIds(mentions)).toEqual([2, 3]);
  });

  it("reserves mention navigation keys without breaking IME or Shift+Enter", () => {
    const base = {
      open: true,
      hasSuggestions: true,
      isComposing: false,
      shiftKey: false,
    };

    expect(getMentionKeyAction({ ...base, key: "ArrowDown" })).toBe("next");
    expect(getMentionKeyAction({ ...base, key: "ArrowUp" })).toBe("previous");
    expect(getMentionKeyAction({ ...base, key: "Enter" })).toBe("select");
    expect(getMentionKeyAction({ ...base, key: "Tab" })).toBe("select");
    expect(getMentionKeyAction({ ...base, key: "Escape" })).toBe("close");
    expect(
      getMentionKeyAction({ ...base, key: "Enter", shiftKey: true }),
    ).toBeNull();
    expect(
      getMentionKeyAction({ ...base, key: "Enter", isComposing: true }),
    ).toBeNull();
  });
});
