import { flowent } from "@/lib/flowent";

export type HumanMember = {
  id: number;
  type: "human";
  name: string;
};

export type AgentMember = {
  id: number;
  type: "agent";
  name: string;
  status: "idle" | "running" | "error";
  error?: string;
};

export type Member = HumanMember | AgentMember;

export type Mention = {
  member_id: number;
  status: "pending" | "read" | "acked";
};

export type Message = {
  id: number;
  sender_id: number;
  body: string;
  mentions: Mention[];
};

export type Discussion = {
  id: number;
  topic: string;
  member_ids: number[];
  messages: Message[];
};

export type OrganizationSnapshot = {
  organization: { id: 1 };
  working_directory: string;
  members: Member[];
  discussions: Discussion[];
};

export type ModelApiType =
  | "openai-chat"
  | "openai-responses"
  | "anthropic"
  | "google";

export type ModelSettings = {
  api_type: ModelApiType;
  base_url: string;
  model: string;
  has_api_key: boolean;
};

export type ModelSettingsUpdate = {
  api_type: ModelApiType;
  base_url: string;
  api_key: string;
  model: string;
};

export type ObservabilitySettings = {
  enabled: boolean;
  base_url: string;
  public_key: string;
  environment: string;
  capture_content: boolean;
  has_secret_key: boolean;
};

export type ObservabilitySettingsUpdate = {
  enabled: boolean;
  base_url: string;
  public_key: string;
  secret_key: string;
  environment: string;
  capture_content: boolean;
};

function invalidSnapshot(message: string): never {
  throw new Error(`Invalid Organization snapshot: ${message}`);
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    invalidSnapshot(`${path} must be an object`);
  }
  return value as Record<string, unknown>;
}

function positiveInteger(value: unknown, path: string): number {
  if (!Number.isInteger(value) || typeof value !== "number" || value < 1) {
    invalidSnapshot(`${path} must be a positive integer`);
  }
  return value;
}

function nonEmptyString(value: unknown, path: string): string {
  if (typeof value !== "string" || !value.trim()) {
    invalidSnapshot(`${path} must be a non-empty string`);
  }
  return value;
}

function array(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) {
    invalidSnapshot(`${path} must be an array`);
  }
  return value;
}

function mentionStatus(value: unknown, path: string): Mention["status"] {
  if (value === "pending" || value === "read" || value === "acked") {
    return value;
  }
  return invalidSnapshot(`${path} is invalid`);
}

function parseMember(value: unknown, index: number): Member {
  const item = record(value, `members[${index}]`);
  const id = positiveInteger(item.id, `members[${index}].id`);
  const name = nonEmptyString(item.name, `members[${index}].name`);

  if (item.type === "human") {
    return { id, type: "human", name };
  }
  if (
    item.type === "agent" &&
    (item.status === "idle" ||
      item.status === "running" ||
      item.status === "error")
  ) {
    const member: AgentMember = {
      id,
      type: "agent",
      name,
      status: item.status,
    };
    if (item.error !== undefined) {
      member.error = nonEmptyString(item.error, `members[${index}].error`);
    }
    if (member.status === "error" && !member.error) {
      invalidSnapshot(`members[${index}].error is required for error status`);
    }
    return member;
  }
  return invalidSnapshot(`members[${index}] has an invalid type or status`);
}

function parseMessage(
  value: unknown,
  discussionIndex: number,
  messageIndex: number,
  discussionMembers: Map<number, Member>,
): Message {
  const path = `discussions[${discussionIndex}].messages[${messageIndex}]`;
  const item = record(value, path);
  const id = positiveInteger(item.id, `${path}.id`);
  if (id !== messageIndex + 1) {
    invalidSnapshot(`${path}.id must follow Discussion order`);
  }
  const senderId = positiveInteger(item.sender_id, `${path}.sender_id`);
  if (!discussionMembers.has(senderId)) {
    invalidSnapshot(`${path}.sender_id must belong to the Discussion`);
  }
  const mentionIds = new Set<number>();
  const mentions = array(item.mentions, `${path}.mentions`).map(
    (mention, mentionIndex) => {
      const mentionPath = `${path}.mentions[${mentionIndex}]`;
      const mentionItem = record(mention, mentionPath);
      const memberId = positiveInteger(
        mentionItem.member_id,
        `${mentionPath}.member_id`,
      );
      const mentionedMember = discussionMembers.get(memberId);
      if (!mentionedMember) {
        invalidSnapshot(
          `${mentionPath}.member_id must belong to the Discussion`,
        );
      }
      if (mentionedMember.type !== "agent") {
        invalidSnapshot(`${mentionPath}.member_id must identify an Agent`);
      }
      if (mentionIds.has(memberId)) {
        invalidSnapshot(`${path}.mentions must target unique Members`);
      }
      mentionIds.add(memberId);
      return {
        member_id: memberId,
        status: mentionStatus(mentionItem.status, `${mentionPath}.status`),
      };
    },
  );
  return {
    id,
    sender_id: senderId,
    body: nonEmptyString(item.body, `${path}.body`),
    mentions,
  };
}

function parseDiscussion(
  value: unknown,
  index: number,
  membersById: Map<number, Member>,
): Discussion {
  const path = `discussions[${index}]`;
  const item = record(value, path);
  const id = positiveInteger(item.id, `${path}.id`);
  const discussionMemberIds = array(item.member_ids, `${path}.member_ids`).map(
    (memberId, memberIndex) =>
      positiveInteger(memberId, `${path}.member_ids[${memberIndex}]`),
  );
  const uniqueMemberIds = new Set(discussionMemberIds);
  if (
    discussionMemberIds.length < 2 ||
    uniqueMemberIds.size !== discussionMemberIds.length
  ) {
    invalidSnapshot(
      `${path}.member_ids must contain at least two unique Members`,
    );
  }
  for (const memberId of discussionMemberIds) {
    if (!membersById.has(memberId)) {
      invalidSnapshot(`${path}.member_ids contains an unknown Member`);
    }
  }

  const discussionMembers = new Map(
    discussionMemberIds.map((memberId) => [
      memberId,
      membersById.get(memberId) as Member,
    ]),
  );
  return {
    id,
    topic: nonEmptyString(item.topic, `${path}.topic`),
    member_ids: discussionMemberIds,
    messages: array(item.messages, `${path}.messages`).map(
      (message, messageIndex) =>
        parseMessage(message, index, messageIndex, discussionMembers),
    ),
  };
}

export function parseOrganizationSnapshot(
  value: unknown,
): OrganizationSnapshot {
  const snapshot = record(value, "snapshot");
  const organization = record(snapshot.organization, "organization");
  if (organization.id !== 1) {
    invalidSnapshot("organization.id must be 1");
  }

  const members = array(snapshot.members, "members").map(parseMember);
  if (members.length === 0) {
    invalidSnapshot("members cannot be empty");
  }
  const memberIds = new Set(members.map((member) => member.id));
  if (memberIds.size !== members.length) {
    invalidSnapshot("Member IDs must be unique");
  }
  const currentHuman = members.find((member) => member.id === 1);
  if (currentHuman?.type !== "human" || currentHuman.name !== "You") {
    invalidSnapshot('Member 1 must be the current Human "You"');
  }

  const membersById = new Map(members.map((member) => [member.id, member]));
  const discussions = array(snapshot.discussions, "discussions").map(
    (discussion, index) => parseDiscussion(discussion, index, membersById),
  );
  const discussionIds = new Set(discussions.map((discussion) => discussion.id));
  if (discussionIds.size !== discussions.length) {
    invalidSnapshot("Discussion IDs must be unique");
  }

  return {
    organization: { id: 1 },
    working_directory: nonEmptyString(
      snapshot.working_directory,
      "working_directory",
    ),
    members,
    discussions,
  };
}

export function parseObservabilitySettings(
  value: unknown,
): ObservabilitySettings {
  const settings = record(value, "observability settings");
  if (
    typeof settings.enabled !== "boolean" ||
    typeof settings.base_url !== "string" ||
    typeof settings.public_key !== "string" ||
    typeof settings.environment !== "string" ||
    typeof settings.capture_content !== "boolean" ||
    typeof settings.has_secret_key !== "boolean"
  ) {
    throw new Error("Invalid observability settings: fields are invalid");
  }
  if (Object.getOwnPropertyDescriptor(settings, "secret_key") !== undefined) {
    throw new Error(
      "Invalid observability settings: secret key must not be returned",
    );
  }
  return {
    enabled: settings.enabled,
    base_url: settings.base_url,
    public_key: settings.public_key,
    environment: settings.environment,
    capture_content: settings.capture_content,
    has_secret_key: settings.has_secret_key,
  };
}

export function parseModelSettings(value: unknown): ModelSettings {
  const settings = record(value, "model settings");
  if (
    settings.api_type !== "openai-chat" &&
    settings.api_type !== "openai-responses" &&
    settings.api_type !== "anthropic" &&
    settings.api_type !== "google"
  ) {
    throw new Error("Invalid model settings: API type is invalid");
  }
  if (
    typeof settings.base_url !== "string" ||
    typeof settings.model !== "string" ||
    typeof settings.has_api_key !== "boolean"
  ) {
    throw new Error("Invalid model settings: fields are invalid");
  }
  if (Object.getOwnPropertyDescriptor(settings, "api_key") !== undefined) {
    throw new Error("Invalid model settings: API key must not be returned");
  }
  return {
    api_type: settings.api_type,
    base_url: settings.base_url,
    model: settings.model,
    has_api_key: settings.has_api_key,
  };
}

async function request(
  method: string,
  params: Record<string, unknown> = {},
): Promise<unknown> {
  return flowent.request(method, params);
}

async function organizationRequest(
  method: string,
  params: Record<string, unknown> = {},
): Promise<OrganizationSnapshot> {
  return parseOrganizationSnapshot(await request(method, params));
}

export const backend = {
  getOrganization: () => organizationRequest("organization.get"),
  createAgent: (name: string) =>
    organizationRequest("organization.create_agent", { name }),
  retryAgent: (agentId: number) =>
    organizationRequest("organization.retry_agent", { agent_id: agentId }),
  createDiscussion: (topic: string, memberIds: number[]) =>
    organizationRequest("discussion.create", {
      topic,
      creator_id: 1,
      member_ids: memberIds,
    }),
  sendMessage: (discussionId: number, body: string, mentionIds: number[]) =>
    organizationRequest("discussion.send", {
      discussion_id: discussionId,
      sender_id: 1,
      body,
      mention_ids: mentionIds,
    }),
  getModelSettings: async () =>
    parseModelSettings(await request("settings.get_model")),
  updateModelSettings: async (settings: ModelSettingsUpdate) =>
    parseModelSettings(await request("settings.update_model", settings)),
  getObservabilitySettings: async () =>
    parseObservabilitySettings(await request("settings.get_observability")),
  updateObservabilitySettings: async (settings: ObservabilitySettingsUpdate) =>
    parseObservabilitySettings(
      await request("settings.update_observability", settings),
    ),
};
