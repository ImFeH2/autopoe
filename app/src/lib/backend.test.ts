import { describe, expect, it } from "vitest";
import {
  applyAgentHistoryEvent,
  parseAgentHistory,
  parseAgentHistoryEvent,
  parseModelSettings,
  parseObservabilitySettings,
  parseOrganizationSnapshot,
} from "@/lib/backend";

const validSnapshot = {
  organization: { id: 1 },
  working_directory: "/project/flowent",
  members: [
    { id: 1, type: "human", name: "You" },
    { id: 2, type: "agent", name: "Ada", status: "idle" },
  ],
  discussions: [
    {
      id: 1,
      topic: "Ship",
      member_ids: [1, 2],
      messages: [
        {
          id: 1,
          sender_id: 1,
          body: "Begin.",
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
        has_api_key: true,
      }),
    ).toEqual({
      api_type: "anthropic",
      base_url: "https://example.invalid",
      model: "claude-test",
      has_api_key: true,
    });
  });

  it("rejects API keys returned by Flowent", () => {
    expect(() =>
      parseModelSettings({
        api_type: "openai-responses",
        base_url: "https://example.invalid",
        model: "test-model",
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
      value.members[1].status = status;

      expect(parseOrganizationSnapshot(value).members[1]).toEqual({
        id: 2,
        type: "agent",
        name: "Ada",
        status,
      });
    },
  );

  it("rejects Discussion references to unknown Members", () => {
    const value = structuredClone(validSnapshot);
    value.discussions[0].member_ids = [1, 99];

    expect(() => parseOrganizationSnapshot(value)).toThrow("unknown Member");
  });

  it("accepts historical sender and Mention IDs no longer in the Discussion", () => {
    const value = structuredClone(validSnapshot);
    value.discussions[0].member_ids = [1];
    value.discussions[0].messages[0].sender_id = 2;
    value.discussions[0].messages[0].mentions[0].member_id = 2;

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
