import { describe, expect, it } from "vitest";
import {
  applyAgentHistoryEvent,
  type DiscussionMessagePage,
  type OrganizationSnapshot,
  parseAgentHistory,
  parseAgentHistoryEvent,
  parseAgentMemoryFile,
  parseAgentMemoryList,
  parseAgentTodoDetail,
  parseAgentTodoPage,
  parseDiscussionMessagePage,
  parseExecutionSettings,
  parseModelSettings,
  parseObservabilitySettings,
  parseOrganizationAudit,
  parseOrganizationPermissions,
  parseOrganizationSnapshot,
} from "@/lib/backend";

const validSnapshot: OrganizationSnapshot = {
  organization: { id: 1, current_human_member_id: 1 },
  working_directory: "/workspace/repository",
  mention_syntax: { enabled: true, issues: [] },
  member_name_policy: {
    normalization: "NFKC",
    max_code_points: 32,
    max_utf8_bytes: 128,
  },
  members: [
    { id: 1, type: "human", name: "You" },
    { id: 2, type: "agent", name: "Ada", status: "idle" },
  ],
  discussions: [
    {
      id: 1,
      topic: "Ship",
      member_ids: [1, 2],
      message_count: 1,
      first_message_id: 1,
      latest_message_id: 1,
      human_activity: [
        {
          member_id: 1,
          joined_after_message_id: 0,
          read_through_message_id: null,
          seen_message_ids: [],
          unread_count: 0,
          first_unread_message_id: null,
          unread_human_mention_count: 0,
          next_human_mention_message_id: null,
        },
      ],
    },
  ],
};

const validMessagePage: DiscussionMessagePage = {
  discussion_id: 1,
  mode: "latest",
  messages: [
    {
      id: 1,
      sender_id: 1,
      body: "Begin.",
      created_at: null,
      delivery: { recipients_known: false, recipients: [] },
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
  oldest_message_id: 1,
  newest_message_id: 1,
  latest_message_id: 1,
  has_earlier: false,
  has_later: false,
  next_before_message_id: null,
  next_after_message_id: null,
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
      content: "Hud",
    });
    const second = parseAgentHistoryEvent({
      agent_id: 2,
      run_id: "run-1",
      sequence: 3,
      timestamp: "2026-08-15T00:00:02+00:00",
      type: "text_delta",
      part_id: "0-0",
      content: "dol",
    });

    let history = applyAgentHistoryEvent({ agent_id: 2, runs: [] }, started);
    history = applyAgentHistoryEvent(history, first);
    history = applyAgentHistoryEvent(history, second);
    const duplicate = applyAgentHistoryEvent(history, second);

    expect(history.runs[0].entries[1].content).toBe("Huddol");
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

describe("parseExecutionSettings", () => {
  it("accepts a Windows WSL selection that needs restart", () => {
    expect(
      parseExecutionSettings({
        platform: "windows",
        selected_backend: "wsl",
        active_backend: "native",
        wsl_available: true,
        wsl_distribution: "Debian",
        write_directories: ["F:\\Project", "C:\\Users\\Ada\\Code"],
        restart_required: true,
      }),
    ).toEqual({
      platform: "windows",
      selected_backend: "wsl",
      active_backend: "native",
      wsl_available: true,
      wsl_distribution: "Debian",
      write_directories: ["F:\\Project", "C:\\Users\\Ada\\Code"],
      restart_required: true,
    });
  });

  it("accepts a directory-only change that needs restart", () => {
    expect(
      parseExecutionSettings({
        platform: "linux",
        selected_backend: "native",
        active_backend: "native",
        wsl_available: false,
        wsl_distribution: null,
        write_directories: ["/project"],
        restart_required: true,
      }).restart_required,
    ).toBe(true);
  });

  it("rejects an unavailable WSL selection", () => {
    expect(() =>
      parseExecutionSettings({
        platform: "windows",
        selected_backend: "wsl",
        active_backend: "native",
        wsl_available: false,
        wsl_distribution: null,
        write_directories: [],
        restart_required: false,
      }),
    ).toThrow("state is inconsistent");
  });

  it("rejects duplicate or invalid writable directories", () => {
    const base = {
      platform: "linux",
      selected_backend: "native",
      active_backend: "native",
      wsl_available: false,
      wsl_distribution: null,
      restart_required: false,
    };

    expect(() =>
      parseExecutionSettings({
        ...base,
        write_directories: ["/project", "/project"],
      }),
    ).toThrow("fields are invalid");
    expect(() =>
      parseExecutionSettings({ ...base, write_directories: [""] }),
    ).toThrow("fields are invalid");
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

  it("rejects API keys returned by Huddol", () => {
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

  it("rejects secret keys returned by Huddol", () => {
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

describe("organization permission payloads", () => {
  it("parses the Super Admin role and explicit Agent Admin assignments", () => {
    expect(
      parseOrganizationPermissions({
        management_revision: 4,
        member_id: 1,
        role: "super_admin",
        capabilities: ["organization.role.manage", "organization.audit.read"],
        admin_agent_ids: [2],
      }),
    ).toEqual({
      management_revision: 4,
      member_id: 1,
      role: "super_admin",
      capabilities: ["organization.role.manage", "organization.audit.read"],
      admin_agent_ids: [2],
    });
  });

  it("rejects unknown capabilities and Admin-visible assignment lists", () => {
    expect(() =>
      parseOrganizationPermissions({
        management_revision: 0,
        member_id: 2,
        role: "member",
        capabilities: ["organization.secret.read"],
        admin_agent_ids: [],
      }),
    ).toThrow("capability");
    expect(() =>
      parseOrganizationPermissions({
        management_revision: 1,
        member_id: 2,
        role: "admin",
        capabilities: ["organization.permissions.read"],
        admin_agent_ids: [2],
      }),
    ).toThrow("membership");
  });

  it("parses non-sensitive audit metadata and rejects failure leakage", () => {
    const event = {
      id: 1,
      occurred_at: "2026-08-27T12:00:00.000+00:00",
      actor_id: 1,
      actor_type: "human",
      actor_name: "You",
      action: "organization.role.grant",
      target_type: "member",
      target_id: 2,
      result: "success",
      reason_code: null,
      metadata: {
        before_admin_agent_ids: [],
        after_admin_agent_ids: [2],
      },
    };

    expect(parseOrganizationAudit({ events: [event] }).events[0]).toEqual(
      event,
    );
    expect(() =>
      parseOrganizationAudit({
        events: [
          {
            ...event,
            result: "failure",
            reason_code: "invalid_request",
            metadata: { discussion_topic: "Private" },
          },
        ],
      }),
    ).toThrow("audit event");
  });
});

describe("parseOrganizationSnapshot", () => {
  it("returns a lightweight validated summary without messages", () => {
    const parsed = parseOrganizationSnapshot(structuredClone(validSnapshot));
    expect(parsed).toEqual(validSnapshot);
    expect(parsed.discussions[0]).not.toHaveProperty("messages");
  });

  it("requires a positive Member name policy", () => {
    const value = structuredClone(validSnapshot);
    value.member_name_policy.max_code_points = 0;
    expect(() => parseOrganizationSnapshot(value)).toThrow(
      "member_name_policy.max_code_points must be a positive integer",
    );
  });

  it("uses the explicit current Human identity instead of assuming Member 1", () => {
    const value = structuredClone(validSnapshot);
    value.organization.current_human_member_id = 7;
    value.members[0].id = 7;
    const discussion = value.discussions[0];
    const activity = discussion?.human_activity?.[0];
    if (!discussion || !activity) {
      throw new Error("Expected Discussion activity fixture");
    }
    discussion.member_ids[0] = 7;
    activity.member_id = 7;

    expect(
      parseOrganizationSnapshot(value).organization.current_human_member_id,
    ).toBe(7);

    value.organization.current_human_member_id = 2;
    expect(() => parseOrganizationSnapshot(value)).toThrow(
      "must target an active Human",
    );
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

  it("accepts missing legacy page timestamps and rejects malformed timestamps", () => {
    const legacy = structuredClone(validMessagePage) as unknown as {
      messages: Array<Record<string, unknown>>;
    };
    const legacyMessage = legacy.messages[0];
    if (!legacyMessage) throw new Error("Expected Message fixture");
    delete legacyMessage.created_at;
    expect(
      parseDiscussionMessagePage(legacy, validSnapshot.members).messages[0]
        .created_at,
    ).toBeNull();

    for (const createdAt of [
      "2026-08-22T12:34:56Z",
      "2026-08-22T12:34:56.789+00:00",
      "2026-02-30T12:34:56.789Z",
      "not-a-time",
    ]) {
      const malformed = structuredClone(validMessagePage);
      const malformedMessage = malformed.messages[0];
      if (!malformedMessage) throw new Error("Expected Message fixture");
      malformedMessage.created_at = createdAt;
      expect(() =>
        parseDiscussionMessagePage(malformed, validSnapshot.members),
      ).toThrow("created_at");
    }
  });

  it("preserves frontier-derived Human activity in the lightweight summary", () => {
    const value = structuredClone(validSnapshot);
    const discussion = value.discussions[0];
    const activity = discussion?.human_activity?.[0];
    if (!discussion || !activity) {
      throw new Error("Expected Human activity fixture");
    }
    discussion.human_activity = [
      {
        ...activity,
        read_through_message_id: 1,
        unread_count: 0,
        first_unread_message_id: null,
      },
    ];
    expect(
      parseOrganizationSnapshot(value).discussions[0]?.human_activity?.[0]
        ?.read_through_message_id,
    ).toBe(1);
  });

  it("rejects Discussion references to unknown Members", () => {
    const value = structuredClone(validSnapshot);
    value.discussions[0].member_ids = [1, 99];
    expect(() => parseOrganizationSnapshot(value)).toThrow("unknown Member");
  });

  it("rejects old full-message snapshots", () => {
    const value = structuredClone(validSnapshot) as unknown as Record<
      string,
      unknown
    >;
    const discussion = (value.discussions as Array<Record<string, unknown>>)[0];
    discussion.messages = validMessagePage.messages;
    expect(() => parseOrganizationSnapshot(value)).toThrow();
  });

  it("validates summary bounds, member identity, and duplicate IDs", () => {
    const invalidBounds = structuredClone(validSnapshot);
    invalidBounds.discussions[0].message_count = 0;
    expect(() => parseOrganizationSnapshot(invalidBounds)).toThrow(
      "message bounds",
    );
    const unknownMember = structuredClone(validSnapshot);
    unknownMember.discussions[0].member_ids = [1, 99];
    expect(() => parseOrganizationSnapshot(unknownMember)).toThrow(
      "unknown Member",
    );
    const duplicate = structuredClone(validSnapshot);
    duplicate.discussions.push(structuredClone(duplicate.discussions[0]));
    expect(() => parseOrganizationSnapshot(duplicate)).toThrow(
      "Discussion IDs must be unique",
    );
  });

  it("accepts empty Discussion summaries and validates Human eligibility", () => {
    const missingHuman = structuredClone(validSnapshot);
    missingHuman.discussions[0].member_ids = [2];
    missingHuman.discussions[0].human_activity = [];
    expect(() => parseOrganizationSnapshot(missingHuman)).toThrow(
      "must contain every active Human and their cutoff activity",
    );

    const empty = structuredClone(validSnapshot);
    empty.discussions[0] = {
      ...empty.discussions[0],
      member_ids: [],
      message_count: 0,
      first_message_id: null,
      latest_message_id: null,
      human_activity: [],
    };
    expect(parseOrganizationSnapshot(empty).discussions[0].message_count).toBe(
      0,
    );

    const invalidFrontier = structuredClone(validSnapshot);
    const discussion = invalidFrontier.discussions[0];
    const activity = discussion?.human_activity?.[0];
    if (!activity) throw new Error("Expected Human activity fixture");
    activity.joined_after_message_id = 1;
    activity.unread_count = 1;
    activity.first_unread_message_id = 1;
    expect(() => parseOrganizationSnapshot(invalidFrontier)).toThrow(
      "first_unread_message_id is inconsistent",
    );
  });

  it("parses stable-ID message pages independently", () => {
    expect(
      parseDiscussionMessagePage(validMessagePage, validSnapshot.members)
        .messages[0].body,
    ).toBe("Begin.");
  });

  it("accepts ID gaps and rejects unordered duplicate pages", () => {
    const page = structuredClone(validMessagePage);
    page.messages.push({ ...structuredClone(page.messages[0]), id: 3 });
    page.newest_message_id = 3;
    expect(
      parseDiscussionMessagePage(page, validSnapshot.members).messages.map(
        (message) => message.id,
      ),
    ).toEqual([1, 3]);
    page.messages.reverse();
    expect(() =>
      parseDiscussionMessagePage(page, validSnapshot.members),
    ).toThrow("unique and increasing");
  });

  it("validates exact anchor coordinates", () => {
    const page = {
      ...structuredClone(validMessagePage),
      mode: "anchor",
      anchor_message_id: 1,
      anchor_index: 0,
    };
    expect(
      parseDiscussionMessagePage(page, validSnapshot.members).anchor_index,
    ).toBe(0);
    page.anchor_index = 1;
    expect(() =>
      parseDiscussionMessagePage(page, validSnapshot.members),
    ).toThrow("anchor is inconsistent");
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

describe("message delivery snapshots", () => {
  it("accepts frozen known recipients on message pages", () => {
    const page = structuredClone(validMessagePage);
    const message = page.messages[0];
    if (!message) throw new Error("Expected Message fixture");
    message.delivery = {
      recipients_known: true,
      recipients: [
        {
          member_id: 2,
          member_type_at_send: "agent",
          member_name_at_send: "Ada",
          available: true,
          mentioned: true,
          read: true,
          ack: "acked",
        },
      ],
    };
    expect(
      parseDiscussionMessagePage(page, validSnapshot.members).messages[0]
        .delivery,
    ).toEqual(message.delivery);
  });

  it("rejects sender recipients, duplicate recipients, and fabricated legacy unread", () => {
    const sender = structuredClone(validMessagePage);
    const senderMessage = sender.messages[0];
    if (!senderMessage) throw new Error("Expected Message fixture");
    senderMessage.delivery = {
      recipients_known: true,
      recipients: [
        {
          member_id: 1,
          member_type_at_send: "human",
          member_name_at_send: "You",
          available: true,
          mentioned: false,
          read: false,
          ack: "not_applicable",
        },
      ],
    };
    expect(() =>
      parseDiscussionMessagePage(sender, validSnapshot.members),
    ).toThrow("cannot target the sender");

    const recipient = {
      member_id: 2,
      member_type_at_send: "agent" as const,
      member_name_at_send: "Ada",
      available: true,
      mentioned: false,
      read: false,
      ack: "not_applicable" as const,
    };
    const duplicate = structuredClone(validMessagePage);
    const duplicateMessage = duplicate.messages[0];
    if (!duplicateMessage) throw new Error("Expected Message fixture");
    duplicateMessage.delivery = {
      recipients_known: true,
      recipients: [recipient, recipient],
    };
    expect(() =>
      parseDiscussionMessagePage(duplicate, validSnapshot.members),
    ).toThrow("unique Members");

    const legacy = structuredClone(validMessagePage);
    const legacyMessage = legacy.messages[0];
    if (!legacyMessage) throw new Error("Expected Message fixture");
    legacyMessage.delivery = {
      recipients_known: false,
      recipients: [{ ...recipient, read: false }],
    };
    expect(() =>
      parseDiscussionMessagePage(legacy, validSnapshot.members),
    ).toThrow("cannot infer legacy unread");
  });
});
