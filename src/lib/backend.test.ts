import { describe, expect, it } from "vitest";
import {
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

describe("parseModelSettings", () => {
  it("accepts safe shared model settings", () => {
    expect(
      parseModelSettings({
        provider: "anthropic",
        base_url: "https://example.invalid",
        model: "claude-test",
        has_api_key: true,
      }),
    ).toEqual({
      provider: "anthropic",
      base_url: "https://example.invalid",
      model: "claude-test",
      has_api_key: true,
    });
  });

  it("rejects API keys returned by the Sidecar", () => {
    expect(() =>
      parseModelSettings({
        provider: "openai",
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

  it("rejects secret keys returned by the Sidecar", () => {
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

  it("rejects Discussion references to unknown Members", () => {
    const value = structuredClone(validSnapshot);
    value.discussions[0].member_ids = [1, 99];

    expect(() => parseOrganizationSnapshot(value)).toThrow("unknown Member");
  });

  it("rejects a Message sender outside the Discussion", () => {
    const value = structuredClone(validSnapshot);
    value.members.push({
      id: 3,
      type: "agent",
      name: "Lin",
      status: "idle",
    });
    value.discussions[0].messages[0].sender_id = 3;

    expect(() => parseOrganizationSnapshot(value)).toThrow(
      "must belong to the Discussion",
    );
  });

  it("rejects Mentions targeting a Human or unknown Member", () => {
    const humanMention = structuredClone(validSnapshot);
    humanMention.discussions[0].messages[0].mentions[0].member_id = 1;
    expect(() => parseOrganizationSnapshot(humanMention)).toThrow(
      "must identify an Agent",
    );

    const unknownMention = structuredClone(validSnapshot);
    unknownMention.discussions[0].messages[0].mentions[0].member_id = 99;
    expect(() => parseOrganizationSnapshot(unknownMention)).toThrow(
      "must belong to the Discussion",
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
