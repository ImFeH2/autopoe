import { invoke } from "@tauri-apps/api/core";

export type HumanMember = {
  id: number;
  type: "human";
  name: string;
};

export type AgentMember = {
  id: number;
  type: "agent";
  name: string;
  status: "idle";
};

export type Member = HumanMember | AgentMember;

export type Message = {
  id: number;
  sender_id: number;
  body: string;
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

function parseMember(value: unknown, index: number): Member {
  const item = record(value, `members[${index}]`);
  const id = positiveInteger(item.id, `members[${index}].id`);
  const name = nonEmptyString(item.name, `members[${index}].name`);

  if (item.type === "human") {
    return { id, type: "human", name };
  }
  if (item.type === "agent" && item.status === "idle") {
    return { id, type: "agent", name, status: "idle" };
  }
  return invalidSnapshot(`members[${index}] has an invalid type or status`);
}

function parseMessage(
  value: unknown,
  discussionIndex: number,
  messageIndex: number,
  discussionMemberIds: Set<number>,
): Message {
  const path = `discussions[${discussionIndex}].messages[${messageIndex}]`;
  const item = record(value, path);
  const id = positiveInteger(item.id, `${path}.id`);
  if (id !== messageIndex + 1) {
    invalidSnapshot(`${path}.id must follow Discussion order`);
  }
  const senderId = positiveInteger(item.sender_id, `${path}.sender_id`);
  if (!discussionMemberIds.has(senderId)) {
    invalidSnapshot(`${path}.sender_id must belong to the Discussion`);
  }
  return {
    id,
    sender_id: senderId,
    body: nonEmptyString(item.body, `${path}.body`),
  };
}

function parseDiscussion(
  value: unknown,
  index: number,
  memberIds: Set<number>,
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
    if (!memberIds.has(memberId)) {
      invalidSnapshot(`${path}.member_ids contains an unknown Member`);
    }
  }

  return {
    id,
    topic: nonEmptyString(item.topic, `${path}.topic`),
    member_ids: discussionMemberIds,
    messages: array(item.messages, `${path}.messages`).map(
      (message, messageIndex) =>
        parseMessage(message, index, messageIndex, uniqueMemberIds),
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

  const discussions = array(snapshot.discussions, "discussions").map(
    (discussion, index) => parseDiscussion(discussion, index, memberIds),
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

async function request(
  method: string,
  params: Record<string, unknown> = {},
): Promise<OrganizationSnapshot> {
  const value = await invoke<unknown>("sidecar_request", { method, params });
  return parseOrganizationSnapshot(value);
}

export const backend = {
  getOrganization: () => request("organization.get"),
  createAgent: (name: string) => request("organization.create_agent", { name }),
  createDiscussion: (topic: string, memberIds: number[]) =>
    request("discussion.create", {
      topic,
      creator_id: 1,
      member_ids: memberIds,
    }),
  sendMessage: (discussionId: number, body: string) =>
    request("discussion.send", {
      discussion_id: discussionId,
      sender_id: 1,
      body,
    }),
};
