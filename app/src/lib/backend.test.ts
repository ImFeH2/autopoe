import { describe, expect, it } from "vitest";
import {
  applyAgentHistoryEvent,
  type OrganizationSnapshot,
  parseAgentHistory,
  parseAgentHistoryEvent,
  parseAgentMemoryFile,
  parseAgentMemoryList,
  parseAgentTodoDetail,
  parseAgentTodoPage,
  parseModelSettings,
  parseObservabilitySettings,
  parseOrganizationSnapshot,
} from "@/lib/backend";

const validSnapshot: OrganizationSnapshot = {
  organization: { id: 1 },
  working_directory: "/project/flowent",
  mention_syntax: { enabled: true, issues: [] },
  members: [
    { id: 1, type: "human", name: "You" },
    { id: 2, type: "agent", name: "Ada", status: "idle" },
  ],
  discussions: [
    {
      id: 1,
      topic: "Ship",
      member_ids: [1, 2],
      human_read_states: [
        {
          member_id: 1,
          joined_after_message_id: 0,
          read_through_message_id: null,
          seen_message_ids: [],
        },
      ],
      messages: [
        {
          id: 1,
          sender_id: 1,
          body: "Begin.",
          created_at: "2026-08-22T12:34:56.789Z",
          references: [
            {
              member_id: 2,
              name: "Ada",
              start: null,
              end: null,
              in_discussion: true,
              notified: true,
              deleted: false,
            },
          ],
          mentions: [{ member_id: 2, status: "pending" }],
        },
      ],
    },
  ],
};

describe("Agent history", () => {
  it("parses complete persistent history without exposing thinking content", () => {
    const history = parseAgentHistory({
      agent_id: 2,
      runs: [
        {
          run_id: "run-1",
          status: "completed",
          started_at: "2026-08-15T00:00:00+00:00",
          completed_at: "2026-08-15T00:01:00+00:00",
          usage: { input_tokens: 10, output_tokens: 4 },
          event_sequence: 0,
          entries: [
            {
              id: "reminder",
              type: "reminder",
              timestamp: "2026-08-15T00:00:00+00:00",
              state: "complete",
              reminder: {
                mentions: [
                  {
                    discussion_id: 1,
                    message_id: 3,
                    sender_id: 1,
                    body: "Request",
                    previously_reminded: false,
                  },
                ],
              },
            },
            {
              id: "thinking",
              type: "thinking",
              timestamp: "2026-08-15T00:00:01+00:00",
              state: "complete",
            },
            {
              id: "reply",
              type: "assistant",
              timestamp: "2026-08-15T00:00:02+00:00",
              state: "complete",
              content: "Done",
            },
          ],
        },
      ],
    });

    expect(history.runs[0].entries[1]).toEqual({
      id: "thinking",
      type: "thinking",
      timestamp: "2026-08-15T00:00:01+00:00",
      state: "complete",
    });
    expect(history.runs[0].entries[2].content).toBe("Done");
  });

  it("coalesces ordered text deltas and ignores duplicate events", () => {
    const started = parseAgentHistoryEvent({
      agent_id: 2,
      run_id: "run-1",
      sequence: 1,
      timestamp: "2026-08-15T00:00:00+00:00",
      type: "run_started",
      reminder: {
        mentions: [
          {
            discussion_id: 1,
            message_id: 3,
            sender_id: 1,
            body: "Request",
            previously_reminded: false,
          },
        ],
      },
    });
    const first = parseAgentHistoryEvent({
      agent_id: 2,
      run_id: "run-1",
      sequence: 2,
      timestamp: "2026-08-15T00:00:01+00:00",
      type: "text_delta",
      part_id: "0-0",
      content: "Flow",
    });
    const second = parseAgentHistoryEvent({
      agent_id: 2,
      run_id: "run-1",
      sequence: 3,
      timestamp: "2026-08-15T00:00:02+00:00",
      type: "text_delta",
      part_id: "0-0",
      content: "ent",
    });

    let history = applyAgentHistoryEvent({ agent_id: 2, runs: [] }, started);
    history = applyAgentHistoryEvent(history, first);
    history = applyAgentHistoryEvent(history, second);
    const duplicate = applyAgentHistoryEvent(history, second);

    expect(history.runs[0].entries[1].content).toBe("Flowent");
    expect(duplicate).toBe(history);
  });

  it("formats streamed tool arguments for inspection", () => {
    const event = parseAgentHistoryEvent({
      agent_id: 2,
      run_id: "run-1",
      sequence: 2,
      timestamp: "2026-08-15T00:00:01+00:00",
      type: "tool_call",
      tool_name: "run",
      content: { argv: ["pwd"] },
    });

    expect(event.content).toContain('"argv"');
    expect(event.tool_name).toBe("run");
  });
});

describe("parseModelSettings", () => {
  it("accepts safe shared model settings", () => {
    expect(
      parseModelSettings({
        api_type: "anthropic",
        base_url: "https://example.invalid",
        model: "claude-test",
        context_window: 200000,
        has_api_key: true,
      }),
    ).toEqual({
      api_type: "anthropic",
      base_url: "https://example.invalid",
      model: "claude-test",
      context_window: 200000,
      has_api_key: true,
    });
  });

  it("rejects invalid context windows", () => {
    expect(() =>
      parseModelSettings({
        api_type: "openai-responses",
        base_url: "https://example.invalid",
        model: "test-model",
        context_window: 1,
        has_api_key: true,
      }),
    ).toThrow("fields are invalid");
  });

  it("rejects API keys returned by Flowent", () => {
    expect(() =>
      parseModelSettings({
        api_type: "openai-responses",
        base_url: "https://example.invalid",
        model: "test-model",
        context_window: null,
        has_api_key: true,
        api_key: "secret",
      }),
    ).toThrow("API key must not be returned");
  });
});

describe("parseObservabilitySettings", () => {
  it("accepts safe Langfuse settings", () => {
    expect(
      parseObservabilitySettings({
        enabled: true,
        base_url: "https://cloud.langfuse.com",
        public_key: "pk-lf-test",
        environment: "development",
        capture_content: true,
        has_secret_key: true,
      }),
    ).toEqual({
      enabled: true,
      base_url: "https://cloud.langfuse.com",
      public_key: "pk-lf-test",
      environment: "development",
      capture_content: true,
      has_secret_key: true,
    });
  });

  it("rejects secret keys returned by Flowent", () => {
    expect(() =>
      parseObservabilitySettings({
        enabled: true,
        base_url: "https://cloud.langfuse.com",
        public_key: "pk-lf-test",
        environment: "development",
        capture_content: true,
        has_secret_key: true,
        secret_key: "secret",
      }),
    ).toThrow("secret key must not be returned");
  });
});

describe("parseOrganizationSnapshot", () => {
  it("returns a complete validated snapshot", () => {
    expect(parseOrganizationSnapshot(validSnapshot)).toEqual(validSnapshot);
  });

  it.each([null, {}, { ...validSnapshot, members: [] }])(
    "rejects an invalid root or empty Organization: %j",
    (value) => {
      expect(() => parseOrganizationSnapshot(value)).toThrow(
        "Invalid Organization snapshot",
      );
    },
  );

  it.each(["pausing", "paused"] as const)(
    "accepts the %s Agent status",
    (status) => {
      const value = structuredClone(validSnapshot);
      if (value.members[1].type !== "agent") {
        throw new Error("Expected Agent fixture");
      }
      value.members[1].status = status;

      expect(parseOrganizationSnapshot(value).members[1]).toEqual({
        id: 2,
        type: "agent",
        name: "Ada",
        status,
      });
    },
  );

  it("accepts missing legacy timestamps and rejects malformed timestamps", () => {
    const legacy = structuredClone(validSnapshot) as unknown as {
      discussions: Array<{ messages: Array<Record<string, unknown>> }>;
    };
    delete legacy.discussions[0].messages[0].created_at;
    expect(
      parseOrganizationSnapshot(legacy).discussions[0].messages[0].created_at,
    ).toBeNull();

    for (const createdAt of [
      "2026-08-22T12:34:56Z",
      "2026-08-22T12:34:56.789+00:00",
      "2026-02-30T12:34:56.789Z",
      "not-a-time",
    ]) {
      const malformed = structuredClone(validSnapshot);
      malformed.discussions[0].messages[0].created_at = createdAt;
      expect(() => parseOrganizationSnapshot(malformed)).toThrow("created_at");
    }
  });

  it("rejects Discussion references to unknown Members", () => {
    const value = structuredClone(validSnapshot);
    value.discussions[0].member_ids = [1, 99];

    expect(() => parseOrganizationSnapshot(value)).toThrow("unknown Member");
  });

  it("accepts historical sender and Mention IDs no longer in the Discussion", () => {
    const value = structuredClone(validSnapshot);
    value.members.push({
      id: 3,
      type: "agent",
      name: "Lin",
      status: "idle",
    });
    value.discussions[0].member_ids = [1];
    value.discussions[0].messages[0].sender_id = 3;

    expect(parseOrganizationSnapshot(value).discussions[0]).toEqual(
      value.discussions[0],
    );
  });

  it("accepts a preserved Discussion after all of its Members are deleted", () => {
    const value = structuredClone(validSnapshot);
    value.discussions[0].member_ids = [];

    expect(parseOrganizationSnapshot(value).discussions[0]).toEqual(
      value.discussions[0],
    );
  });

  it("rejects out-of-order Message IDs", () => {
    const value = structuredClone(validSnapshot);
    value.discussions[0].messages[0].id = 2;

    expect(() => parseOrganizationSnapshot(value)).toThrow(
      "must follow Discussion order",
    );
  });

  it("validates code-point ranges, notification identity, and deleted history", () => {
    const value = structuredClone(validSnapshot);
    value.discussions[0].messages[0].body = "😀 @Ada";
    value.discussions[0].messages[0].references[0] = {
      member_id: 99,
      name: "Ada",
      start: 2,
      end: 6,
      in_discussion: true,
      notified: true,
      deleted: true,
    };
    value.discussions[0].messages[0].mentions[0].member_id = 99;

    expect(parseOrganizationSnapshot(value).discussions[0].messages[0]).toEqual(
      value.discussions[0].messages[0],
    );

    const partial = structuredClone(value);
    partial.discussions[0].messages[0].references[0].end = null;
    expect(() => parseOrganizationSnapshot(partial)).toThrow(
      "start and end must both be null or set",
    );

    const missingIdentity = structuredClone(value);
    missingIdentity.discussions[0].messages[0].references[0].notified = false;
    expect(() => parseOrganizationSnapshot(missingIdentity)).toThrow(
      "requires a notified identity reference",
    );
  });

  it("parses Human read state and the public Human mention subset contract", () => {
    const value = structuredClone(validSnapshot);
    value.discussions[0].human_read_states = [
      {
        member_id: 1,
        joined_after_message_id: 0,
        read_through_message_id: null,
        seen_message_ids: [],
      },
    ];
    value.discussions[0].messages[0].sender_id = 2;
    value.discussions[0].messages[0].references = [
      {
        member_id: 1,
        name: "You",
        start: null,
        end: null,
        in_discussion: true,
        notified: true,
        deleted: false,
      },
    ];
    value.discussions[0].messages[0].mentions = [];
    value.discussions[0].messages[0].human_mentions = [
      { member_id: 1, status: "unread" },
    ];

    expect(parseOrganizationSnapshot(value).discussions[0]).toEqual(
      value.discussions[0],
    );

    const invalidSparse = structuredClone(value);
    const invalidState = invalidSparse.discussions[0].human_read_states?.[0];
    if (!invalidState) {
      throw new Error("Expected Human read state fixture");
    }
    invalidState.seen_message_ids = [2];
    expect(() => parseOrganizationSnapshot(invalidSparse)).toThrow(
      "unique sparse later IDs",
    );
  });

  it("rejects missing global Human membership and invalid membership cutoffs", () => {
    const missingHuman = structuredClone(validSnapshot);
    missingHuman.discussions[0].member_ids = [2];
    missingHuman.discussions[0].human_read_states = [];
    expect(() => parseOrganizationSnapshot(missingHuman)).toThrow(
      "must contain every active Human and their cutoff state",
    );

    const missingCutoff = structuredClone(validSnapshot) as unknown as {
      discussions: Array<{
        human_read_states: Array<Record<string, unknown>>;
      }>;
    };
    delete missingCutoff.discussions[0].human_read_states[0]
      .joined_after_message_id;
    expect(() => parseOrganizationSnapshot(missingCutoff)).toThrow(
      "joined_after_message_id must be a non-negative integer",
    );

    const futureCutoff = structuredClone(validSnapshot);
    const state = futureCutoff.discussions[0].human_read_states?.[0];
    if (!state) {
      throw new Error("Expected Human cutoff fixture");
    }
    state.joined_after_message_id = 2;
    expect(() => parseOrganizationSnapshot(futureCutoff)).toThrow(
      "joined_after_message_id is outside the Discussion",
    );
  });

  it("accepts a historical sender name snapshot after rename", () => {
    const value = structuredClone(validSnapshot);
    value.members[0].name = "Owner";
    value.discussions[0].messages[0].sender_name = "You";

    expect(
      parseOrganizationSnapshot(value).discussions[0].messages[0].sender_name,
    ).toBe("You");
  });

  it("accepts renamed current Human and separate Human notification state", () => {
    const value = structuredClone(validSnapshot);
    value.members[0].name = "Owner";
    const message = value.discussions[0].messages[0];
    message.sender_id = 2;
    message.body = "@Owner review";
    message.references = [
      {
        member_id: 1,
        name: "Owner",
        start: 0,
        end: 6,
        in_discussion: true,
        notified: true,
        deleted: false,
      },
    ];
    message.mentions = [];
    message.human_mentions = [{ member_id: 1, status: "unread" }];

    expect(parseOrganizationSnapshot(value).members[0].name).toBe("Owner");
  });

  it("keeps historical self-reference display but rejects self delivery state", () => {
    const historical = structuredClone(validSnapshot);
    const message = historical.discussions[0].messages[0];
    message.body = "@You historical";
    message.references = [
      {
        member_id: 1,
        name: "You",
        start: 0,
        end: 4,
        in_discussion: true,
        notified: false,
        deleted: false,
      },
    ];
    message.mentions = [];

    expect(
      parseOrganizationSnapshot(historical).discussions[0].messages[0]
        .references,
    ).toEqual(message.references);

    const forgedHuman = structuredClone(historical);
    forgedHuman.discussions[0].messages[0].references[0].notified = true;
    forgedHuman.discussions[0].messages[0].human_mentions = [
      { member_id: 1, status: "unread" },
    ];
    expect(() => parseOrganizationSnapshot(forgedHuman)).toThrow(
      "cannot notify its sender",
    );

    const forgedAgent = structuredClone(validSnapshot);
    forgedAgent.discussions[0].messages[0].sender_id = 2;
    expect(() => parseOrganizationSnapshot(forgedAgent)).toThrow(
      "cannot notify its sender",
    );
  });

  it("rejects Human delivery in Agent Mention state", () => {
    const value = structuredClone(validSnapshot);
    value.discussions[0].messages[0].sender_id = 2;
    value.discussions[0].messages[0].references[0].member_id = 1;
    value.discussions[0].messages[0].mentions[0].member_id = 1;
    expect(() => parseOrganizationSnapshot(value)).toThrow(
      "must target an Agent",
    );
  });

  it("rejects a notified reference without a Mention status", () => {
    const value = structuredClone(validSnapshot);
    value.discussions[0].messages[0].mentions = [];
    expect(() => parseOrganizationSnapshot(value)).toThrow(
      "notified Agent identity requires a Mention status",
    );
  });

  it("rejects overlapping or mismatched positioned references", () => {
    const value = structuredClone(validSnapshot);
    value.discussions[0].messages[0].body = "@Ada @Ada";
    value.discussions[0].messages[0].references = [
      {
        member_id: 2,
        name: "Ada",
        start: 0,
        end: 4,
        in_discussion: true,
        notified: true,
        deleted: false,
      },
      {
        member_id: 2,
        name: "Ada",
        start: 3,
        end: 9,
        in_discussion: true,
        notified: true,
        deleted: false,
      },
    ];
    expect(() => parseOrganizationSnapshot(value)).toThrow(
      "ordered and non-overlapping",
    );
  });

  it("requires mention_syntax enabled and issues to agree", () => {
    const value = structuredClone(validSnapshot);
    value.mention_syntax = {
      enabled: true,
      issues: [
        {
          code: "duplicate_name",
          member_ids: [2, 1],
          names: ["Ada", "You"],
          normalized_name: "ada",
        },
      ],
    };
    expect(() => parseOrganizationSnapshot(value)).toThrow(
      "enabled must match",
    );
  });

  it("rejects duplicate Member and Discussion IDs", () => {
    const duplicateMember = structuredClone(validSnapshot);
    duplicateMember.members.push({
      id: 2,
      type: "agent",
      name: "Lin",
      status: "idle",
    });
    expect(() => parseOrganizationSnapshot(duplicateMember)).toThrow(
      "Member IDs must be unique",
    );

    const duplicateDiscussion = structuredClone(validSnapshot);
    duplicateDiscussion.discussions.push(
      structuredClone(duplicateDiscussion.discussions[0]),
    );
    expect(() => parseOrganizationSnapshot(duplicateDiscussion)).toThrow(
      "Discussion IDs must be unique",
    );
  });
});

describe("Agent Memory and Todo payloads", () => {
  const todo = (
    id: number,
    status: "pending" | "in_progress" | "completed",
  ) => ({
    id,
    subject: `Todo ${id}`,
    description: "Fixture",
    status,
    created_at: "2026-08-20T00:00:00+00:00",
    updated_at: "2026-08-21T00:00:00+00:00",
    completed_at: status === "completed" ? "2026-08-21T00:00:00+00:00" : null,
  });

  it("parses closed Memory pagination and bounded UTF-8 line ranges", () => {
    expect(
      parseAgentMemoryList({
        paths: ["MEMORY.md", "topics/release.md"],
        count: 2,
        total: 3,
        offset: 0,
        limit: 2,
        has_more: true,
        next_offset: 2,
      }),
    ).toMatchObject({ count: 2, has_more: true, next_offset: 2 });
    expect(
      parseAgentMemoryFile({
        path: "MEMORY.md",
        content: "é",
        start_line: 1,
        end_line: 1,
        total_lines: 1,
        bytes: 2,
        max_bytes: 3,
        bytes_truncated: true,
        truncated: true,
      }).content,
    ).toBe("é");
    expect(
      parseAgentMemoryFile({
        path: "empty.md",
        content: "",
        start_line: 1,
        end_line: 0,
        total_lines: 0,
        bytes: 0,
        max_bytes: 65536,
        bytes_truncated: false,
        truncated: false,
      }).end_line,
    ).toBe(0);
    expect(
      parseAgentMemoryFile({
        path: "past-end.md",
        content: "",
        start_line: 4,
        end_line: 3,
        total_lines: 3,
        bytes: 0,
        max_bytes: 65536,
        bytes_truncated: false,
        truncated: false,
      }).start_line,
    ).toBe(4);
  });

  it.each([
    "../secret.md",
    " bad.md",
    "bad.md ",
    "bad\nname.md",
    "safe\u202eevil.md",
    "safe\u200bevil.md",
    `${"a".repeat(1022)}.md`,
  ])("rejects unsafe Memory path %j", (path) => {
    expect(() =>
      parseAgentMemoryList({
        paths: [path],
        count: 1,
        total: 1,
        offset: 0,
        limit: 1,
        has_more: false,
        next_offset: null,
      }),
    ).toThrow("safe relative Markdown path");
  });

  it.each([
    {
      paths: ["MEMORY.md", "MEMORY.md"],
      count: 2,
      total: 2,
      offset: 0,
      limit: 2,
      has_more: false,
      next_offset: null,
    },
    {
      paths: ["z.md", "a.md"],
      count: 2,
      total: 2,
      offset: 0,
      limit: 2,
      has_more: false,
      next_offset: null,
    },
    {
      paths: ["bad.md"],
      count: 1,
      total: 2,
      offset: 0,
      limit: 1,
      has_more: false,
      next_offset: null,
    },
    {
      paths: ["bad.md"],
      count: 1,
      total: 1,
      offset: 0,
      limit: 0,
      has_more: false,
      next_offset: null,
    },
    {
      paths: ["MEMORY.md"],
      count: 1,
      total: 2,
      offset: 1,
      limit: 1,
      has_more: false,
      next_offset: null,
    },
  ])("rejects inconsistent Memory list payloads", (payload) => {
    expect(() => parseAgentMemoryList(payload)).toThrow();
  });

  it.each([
    {
      content: "secret",
      start_line: 10,
      end_line: 1,
      total_lines: 1,
      bytes: 6,
      max_bytes: 65536,
      bytes_truncated: false,
      truncated: false,
    },
    {
      content: "é",
      start_line: 1,
      end_line: 1,
      total_lines: 1,
      bytes: 1,
      max_bytes: 65536,
      bytes_truncated: false,
      truncated: false,
    },
    {
      content: "line",
      start_line: 1,
      end_line: 1,
      total_lines: 2,
      bytes: 4,
      max_bytes: 65536,
      bytes_truncated: false,
      truncated: false,
    },
    {
      content: "",
      start_line: 1,
      end_line: 0,
      total_lines: 1,
      bytes: 0,
      max_bytes: 65536,
      bytes_truncated: true,
      truncated: true,
    },
  ])("rejects inconsistent Memory file payloads", (payload) => {
    expect(() =>
      parseAgentMemoryFile({ path: "MEMORY.md", ...payload }),
    ).toThrow("bounds or truncation are inconsistent");
  });

  it("parses status-specific Todo cursor pages and detail", () => {
    expect(
      parseAgentTodoPage({
        todos: [todo(11, "pending"), todo(12, "pending")],
        count: 2,
        status: "pending",
        limit: 2,
        cursor: 10,
        has_more: true,
        next_cursor: 12,
      }).next_cursor,
    ).toBe(12);
    expect(
      parseAgentTodoPage({
        todos: [todo(9, "completed"), todo(7, "completed")],
        count: 2,
        status: "completed",
        limit: 50,
        cursor: 10,
        has_more: false,
        next_cursor: null,
      }).todos.map((item) => item.id),
    ).toEqual([9, 7]);
    expect(parseAgentTodoDetail({ todo: todo(3, "completed") })).toMatchObject({
      id: 3,
    });
  });

  it.each([
    {
      todos: [todo(3, "pending"), todo(3, "pending")],
      count: 2,
      status: "pending",
      limit: 2,
      cursor: null,
      has_more: false,
      next_cursor: null,
    },
    {
      todos: [todo(12, "pending"), todo(11, "pending")],
      count: 2,
      status: "pending",
      limit: 2,
      cursor: 10,
      has_more: false,
      next_cursor: null,
    },
    {
      todos: [todo(3, "pending")],
      count: 1,
      status: "pending",
      limit: 1,
      cursor: 10,
      has_more: true,
      next_cursor: 999,
    },
    {
      todos: [todo(11, "completed")],
      count: 1,
      status: "completed",
      limit: 1,
      cursor: 10,
      has_more: false,
      next_cursor: null,
    },
    {
      todos: [todo(1, "in_progress"), todo(2, "in_progress")],
      count: 2,
      status: "in_progress",
      limit: 2,
      cursor: null,
      has_more: false,
      next_cursor: null,
    },
  ])("rejects inconsistent Todo cursor payloads", (payload) => {
    expect(() => parseAgentTodoPage(payload)).toThrow(
      "contents or cursor are inconsistent",
    );
  });
});
