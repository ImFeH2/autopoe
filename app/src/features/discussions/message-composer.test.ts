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

  it("finds mention queries after any preceding character", () => {
    expect(findMentionQuery("Ask @ad", 7, [])).toEqual({
      start: 4,
      end: 7,
      query: "ad",
    });
    expect(findMentionQuery("mail@example", 12, [])).toEqual({
      start: 4,
      end: 12,
      query: "example",
    });
    expect(findMentionQuery("请@ad", 4, [])).toEqual({
      start: 1,
      end: 4,
      query: "ad",
    });
    expect(
      findMentionQuery("@Ada ", 5, [
        { start: 0, end: 4, label: "@Ada", memberId: 2 },
      ]),
    ).toBeNull();
  });

  it("ranks exact, prefix, word, substring, initials, and fuzzy matches", () => {
    const agents = [
      { id: 2, type: "agent" as const, name: "ABCD", status: "idle" as const },
      { id: 3, type: "agent" as const, name: "ABC", status: "idle" as const },
      {
        id: 4,
        type: "agent" as const,
        name: "Team ABC",
        status: "idle" as const,
      },
      { id: 5, type: "agent" as const, name: "XABC", status: "idle" as const },
      {
        id: 6,
        type: "agent" as const,
        name: "Grace Hopper",
        status: "idle" as const,
      },
      {
        id: 7,
        type: "agent" as const,
        name: "AxByCz",
        status: "idle" as const,
      },
    ];

    expect(filterMentionAgents(agents, "abc")).toEqual([
      agents[1],
      agents[0],
      agents[2],
      agents[3],
      agents[5],
    ]);
    expect(filterMentionAgents(agents, "GH")).toEqual([agents[4]]);
    expect(filterMentionAgents(agents, "ABCDEF")).toEqual([]);
  });

  it("inserts the selected Agent at the caret", () => {
    const agent = {
      id: 3,
      type: "agent" as const,
      name: "Grace Hopper",
      status: "idle" as const,
    };

    expect(
      insertDraftMention({
        agent,
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
    expect(
      reconcileDraftMentions("@ABC ", "@ABCDEF", [
        { start: 0, end: 4, label: "@ABC", memberId: 4 },
      ]),
    ).toEqual([]);
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
