import { flowent } from "@/lib/flowent";
import {
  codePointRangeToUtf16,
  normalizeMentionText,
} from "@/lib/mention-normalization";

export type HumanMember = {
  id: number;
  type: "human";
  name: string;
};

export type AgentMember = {
  id: number;
  type: "agent";
  name: string;
  status: "idle" | "running" | "error" | "pausing" | "paused";
  error?: string;
};

export type Member = HumanMember | AgentMember;

export type AgentReminderMention = {
  discussion_id: number;
  message_id: number;
  sender_id: number;
  body: string;
  previously_reminded: boolean;
};

export type AgentReminder = {
  mentions: AgentReminderMention[];
};

export type AgentHistoryEntryType =
  | "reminder"
  | "assistant"
  | "system"
  | "thinking"
  | "tool_call"
  | "tool_result"
  | "retry"
  | "error";

export type AgentHistoryEntry = {
  id: string;
  type: AgentHistoryEntryType;
  timestamp: string;
  state: "complete" | "interrupted" | "streaming";
  content?: string;
  tool_name?: string;
  reminder?: AgentReminder;
  content_length?: number;
  content_truncated?: boolean;
  paired_entry_id?: string;
};

export type AgentHistoryRun = {
  run_id: string;
  sequence?: number;
  status: "running" | "completed" | "failed" | "interrupted";
  started_at: string;
  completed_at: string | null;
  usage: Record<string, unknown> | null;
  event_sequence: number;
  entries: AgentHistoryEntry[];
};

export type AgentHistoryRunMetadata = Omit<
  AgentHistoryRun,
  "entries" | "sequence"
> & {
  sequence: number;
  entry_count: number;
  error: string | null;
};

export type AgentHistoryPage = {
  agent_id: number;
  runs: AgentHistoryRunMetadata[];
  has_earlier: boolean;
  next_before_sequence: number | null;
};

export type AgentHistoryEntryDetail = {
  agent_id: number;
  run_id: string;
  entry_id: string;
  type: AgentHistoryEntryType;
  tool_name?: string;
  paired_entry_id?: string;
  content: string;
  content_length: number;
  offset: number;
  next_offset: number | null;
  truncated: boolean;
};

export type AgentHistory = {
  agent_id: number;
  runs: AgentHistoryRun[];
};

export type AgentMemoryList = {
  paths: string[];
  count: number;
  total: number;
  offset: number;
  limit: number;
  has_more: boolean;
  next_offset: number | null;
};

export type AgentMemoryFile = {
  path: string;
  content: string;
  start_line: number;
  end_line: number;
  total_lines: number;
  bytes: number;
  max_bytes: number;
  bytes_truncated: boolean;
  truncated: boolean;
};

export type AgentTodoStatus = "pending" | "in_progress" | "completed";

export type AgentTodo = {
  id: number;
  subject: string;
  description: string;
  status: AgentTodoStatus;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
};

export type AgentTodoPage = {
  todos: AgentTodo[];
  count: number;
  status: AgentTodoStatus;
  limit: number;
  cursor: number | null;
  has_more: boolean;
  next_cursor: number | null;
};

export type AgentHistoryEvent = {
  agent_id: number;
  run_id: string;
  sequence: number;
  timestamp: string;
  type:
    | "run_started"
    | "text_delta"
    | "thinking"
    | "tool_call"
    | "tool_result"
    | "retry"
    | "run_completed"
    | "run_failed";
  reminder?: AgentReminder;
  part_id?: string;
  content?: string;
  tool_name?: string;
  status?: "completed" | "failed" | "interrupted";
  error?: string;
};

export type Mention = {
  member_id: number;
  status: "pending" | "read" | "acked";
};

export type HumanMention = {
  member_id: number;
  status: "unread" | "read";
};

export type HumanDiscussionReadState = {
  member_id: number;
  joined_after_message_id: number;
  read_through_message_id: number | null;
  seen_message_ids: number[];
};

export type MentionReference = {
  member_id: number;
  name: string;
  start: number | null;
  end: number | null;
  in_discussion: boolean;
  notified: boolean;
  deleted: boolean;
};

export type MentionSyntaxIssue = {
  code: "invalid_name" | "duplicate_name";
  member_ids: number[];
  names: string[];
  normalized_name?: string;
};

export type MentionSyntax = {
  enabled: boolean;
  issues: MentionSyntaxIssue[];
};

export type MemberNamePolicy = {
  normalization: "NFKC";
  max_code_points: number;
  max_utf8_bytes: number;
};

export type DeliveryRecipient = {
  member_id: number;
  member_type_at_send: "human" | "agent";
  member_name_at_send: string;
  available: boolean;
  mentioned: boolean;
  read: boolean | null;
  ack: "acked" | "pending" | "unknown" | "not_applicable";
};

export type MessageDelivery = {
  recipients_known: boolean;
  recipients: DeliveryRecipient[];
};

export type Message = {
  id: number;
  sender_id: number;
  sender_name?: string;
  body: string;
  created_at: string | null;
  delivery?: MessageDelivery;
  references: MentionReference[];
  mentions: Mention[];
  human_mentions?: HumanMention[];
};

export type HumanDiscussionActivity = HumanDiscussionReadState & {
  unread_count: number;
  first_unread_message_id: number | null;
  unread_human_mention_count: number;
  next_human_mention_message_id: number | null;
};

export type DiscussionSummary = {
  id: number;
  topic: string;
  member_ids: number[];
  message_count: number;
  first_message_id: number | null;
  latest_message_id: number | null;
  human_activity: HumanDiscussionActivity[];
};

export type DiscussionActivityFrontier = {
  member_id: number;
  latest_activity_message_id: number;
};

export type Discussion = {
  id: number;
  topic: string;
  member_ids: number[];
  messages?: Message[];
  human_read_states?: HumanDiscussionReadState[];
  message_count?: number;
  first_message_id?: number | null;
  latest_message_id?: number | null;
  human_activity?: HumanDiscussionActivity[];
  activity_frontiers?: DiscussionActivityFrontier[];
};

export type DiscussionMessagePageMode =
  | "latest"
  | "before"
  | "after"
  | "anchor";

export type DiscussionMessagePage = {
  discussion_id: number;
  mode: DiscussionMessagePageMode;
  messages: Message[];
  oldest_message_id: number | null;
  newest_message_id: number | null;
  latest_message_id: number | null;
  has_earlier: boolean;
  has_later: boolean;
  next_before_message_id: number | null;
  next_after_message_id: number | null;
  anchor_message_id?: number;
  anchor_index?: number;
};

export type OrganizationSnapshot = {
  organization: { id: 1; current_human_member_id: number };
  working_directory: string;
  mention_syntax: MentionSyntax;
  member_name_policy: MemberNamePolicy;
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
  context_window: number | null;
  has_api_key: boolean;
};

export type ModelSettingsUpdate = {
  api_type: ModelApiType;
  base_url: string;
  api_key: string;
  model: string;
  context_window: number | null;
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

function boolean(value: unknown, path: string): boolean {
  return typeof value === "boolean"
    ? value
    : invalidSnapshot(`${path} must be a boolean`);
}

function nullableNonNegativeInteger(
  value: unknown,
  path: string,
): number | null {
  return value === null ? null : nonNegativeInteger(value, path);
}

function parseMentionSyntax(value: unknown): MentionSyntax {
  const item = record(value, "mention_syntax");
  const enabled = boolean(item.enabled, "mention_syntax.enabled");
  const issues = array(item.issues, "mention_syntax.issues").map(
    (issue, index) => {
      const path = `mention_syntax.issues[${index}]`;
      const issueItem = record(issue, path);
      if (
        issueItem.code !== "invalid_name" &&
        issueItem.code !== "duplicate_name"
      ) {
        invalidSnapshot(`${path}.code is invalid`);
      }
      const memberIds = array(issueItem.member_ids, `${path}.member_ids`).map(
        (memberId, memberIndex) =>
          positiveInteger(memberId, `${path}.member_ids[${memberIndex}]`),
      );
      const names = array(issueItem.names, `${path}.names`).map(
        (name, nameIndex) =>
          nonEmptyString(name, `${path}.names[${nameIndex}]`),
      );
      if (
        memberIds.length === 0 ||
        memberIds.length !== names.length ||
        new Set(memberIds).size !== memberIds.length
      ) {
        invalidSnapshot(`${path} must pair unique Member IDs and names`);
      }
      const parsed: MentionSyntaxIssue = {
        code: issueItem.code,
        member_ids: memberIds,
        names,
      };
      if (issueItem.normalized_name !== undefined) {
        parsed.normalized_name = nonEmptyString(
          issueItem.normalized_name,
          `${path}.normalized_name`,
        );
      }
      if (parsed.code === "duplicate_name" && !parsed.normalized_name) {
        invalidSnapshot(`${path}.normalized_name is required`);
      }
      if (parsed.code === "invalid_name" && parsed.normalized_name) {
        invalidSnapshot(`${path}.normalized_name is not allowed`);
      }
      return parsed;
    },
  );
  if (enabled !== (issues.length === 0)) {
    invalidSnapshot(
      "mention_syntax.enabled must match whether issues are empty",
    );
  }
  return { enabled, issues };
}

function parseMemberNamePolicy(value: unknown): MemberNamePolicy {
  const item = record(value, "member_name_policy");
  if (item.normalization !== "NFKC") {
    invalidSnapshot("member_name_policy.normalization must be NFKC");
  }
  return {
    normalization: "NFKC",
    max_code_points: positiveInteger(
      item.max_code_points,
      "member_name_policy.max_code_points",
    ),
    max_utf8_bytes: positiveInteger(
      item.max_utf8_bytes,
      "member_name_policy.max_utf8_bytes",
    ),
  };
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
      item.status === "error" ||
      item.status === "pausing" ||
      item.status === "paused")
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

function optionalMessageCreatedAt(value: unknown, path: string): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "string") {
    return invalidSnapshot(`${path} must be a UTC RFC 3339 timestamp or null`);
  }
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\.(\d{3,})Z$/.exec(value);
  if (!match) {
    return invalidSnapshot(`${path} must be a UTC RFC 3339 timestamp or null`);
  }
  const [, year, month, day, hour, minute, second] = match;
  const parsed = new Date(value);
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.getUTCFullYear() !== Number(year) ||
    parsed.getUTCMonth() + 1 !== Number(month) ||
    parsed.getUTCDate() !== Number(day) ||
    parsed.getUTCHours() !== Number(hour) ||
    parsed.getUTCMinutes() !== Number(minute) ||
    parsed.getUTCSeconds() !== Number(second)
  ) {
    return invalidSnapshot(`${path} must be a valid UTC RFC 3339 timestamp`);
  }
  return value;
}

function parseMessageDelivery(
  value: unknown,
  path: string,
  senderId: number,
): MessageDelivery {
  const item = record(value, path);
  const recipientsKnown = boolean(
    item.recipients_known,
    `${path}.recipients_known`,
  );
  const memberIds = new Set<number>();
  const recipients = array(item.recipients, `${path}.recipients`).map(
    (value, index) => {
      const recipientPath = `${path}.recipients[${index}]`;
      const recipient = record(value, recipientPath);
      const memberId = positiveInteger(
        recipient.member_id,
        `${recipientPath}.member_id`,
      );
      if (memberId === senderId)
        invalidSnapshot(`${recipientPath} cannot target the sender`);
      if (memberIds.has(memberId))
        invalidSnapshot(`${path}.recipients must contain unique Members`);
      memberIds.add(memberId);
      const memberType = recipient.member_type_at_send;
      if (memberType !== "human" && memberType !== "agent")
        invalidSnapshot(`${recipientPath}.member_type_at_send is invalid`);
      const mentioned = boolean(
        recipient.mentioned,
        `${recipientPath}.mentioned`,
      );
      const read =
        recipient.read === null
          ? null
          : boolean(recipient.read, `${recipientPath}.read`);
      if (recipientsKnown && read === null)
        invalidSnapshot(`${recipientPath}.read cannot be unknown`);
      if (!recipientsKnown && read === false)
        invalidSnapshot(`${recipientPath}.read cannot infer legacy unread`);
      const ack = recipient.ack;
      if (
        ack !== "acked" &&
        ack !== "pending" &&
        ack !== "unknown" &&
        ack !== "not_applicable"
      )
        invalidSnapshot(`${recipientPath}.ack is invalid`);
      if (!mentioned && ack !== "not_applicable")
        invalidSnapshot(`${recipientPath}.ack requires mentioned`);
      if (mentioned && ack === "not_applicable")
        invalidSnapshot(`${recipientPath}.mentioned requires an ack state`);
      if (ack === "acked" && read === false)
        invalidSnapshot(`${recipientPath}.acked cannot be unread`);
      if (recipientsKnown && mentioned && ack === "unknown")
        invalidSnapshot(
          `${recipientPath}.known mention cannot have unknown ack`,
        );
      return {
        member_id: memberId,
        member_type_at_send: memberType,
        member_name_at_send: nonEmptyString(
          recipient.member_name_at_send,
          `${recipientPath}.member_name_at_send`,
        ),
        available: boolean(recipient.available, `${recipientPath}.available`),
        mentioned,
        read,
        ack,
      } satisfies DeliveryRecipient;
    },
  );
  return { recipients_known: recipientsKnown, recipients };
}

function parseMessage(
  value: unknown,
  discussionIndex: number,
  messageIndex: number,
  membersById: Map<number, Member>,
  enforceOrder = true,
  pathOverride?: string,
): Message {
  const path =
    pathOverride ?? `discussions[${discussionIndex}].messages[${messageIndex}]`;
  const item = record(value, path);
  const id = positiveInteger(item.id, `${path}.id`);
  if (enforceOrder && id !== messageIndex + 1) {
    invalidSnapshot(`${path}.id must follow Discussion order`);
  }
  const senderId = positiveInteger(item.sender_id, `${path}.sender_id`);
  const senderName =
    item.sender_name === undefined
      ? undefined
      : nonEmptyString(item.sender_name, `${path}.sender_name`);
  const body = nonEmptyString(item.body, `${path}.body`);
  const createdAt = optionalMessageCreatedAt(
    item.created_at,
    `${path}.created_at`,
  );
  const delivery = parseMessageDelivery(
    item.delivery,
    `${path}.delivery`,
    senderId,
  );
  const bodyCodePoints = [...body];
  let previousPositionedEnd = 0;
  const references = array(item.references, `${path}.references`).map(
    (reference, referenceIndex) => {
      const referencePath = `${path}.references[${referenceIndex}]`;
      const referenceItem = record(reference, referencePath);
      const memberId = positiveInteger(
        referenceItem.member_id,
        `${referencePath}.member_id`,
      );
      const name = nonEmptyString(referenceItem.name, `${referencePath}.name`);
      const start = nullableNonNegativeInteger(
        referenceItem.start,
        `${referencePath}.start`,
      );
      const end = nullableNonNegativeInteger(
        referenceItem.end,
        `${referencePath}.end`,
      );
      const inDiscussion = boolean(
        referenceItem.in_discussion,
        `${referencePath}.in_discussion`,
      );
      const notified = boolean(
        referenceItem.notified,
        `${referencePath}.notified`,
      );
      const deleted = boolean(
        referenceItem.deleted,
        `${referencePath}.deleted`,
      );
      if ((start === null) !== (end === null)) {
        invalidSnapshot(
          `${referencePath}.start and end must both be null or set`,
        );
      }
      if (notified && !inDiscussion) {
        invalidSnapshot(`${referencePath}.notified requires in_discussion`);
      }
      if (memberId === senderId && notified) {
        invalidSnapshot(`${referencePath} cannot notify its sender`);
      }
      if (!deleted && !membersById.has(memberId)) {
        invalidSnapshot(`${referencePath} targets an unknown active Member`);
      }
      if (start !== null && end !== null) {
        if (end <= start || end > bodyCodePoints.length) {
          invalidSnapshot(`${referencePath} range is outside the Message body`);
        }
        if (start < previousPositionedEnd) {
          invalidSnapshot(
            `${path}.references ranges must be ordered and non-overlapping`,
          );
        }
        const source = bodyCodePoints.slice(start, end).join("");
        if (
          !source.startsWith("@") ||
          normalizeMentionText(source.slice(1)) !== normalizeMentionText(name)
        ) {
          invalidSnapshot(
            `${referencePath} range does not match its stable name`,
          );
        }
        if (codePointRangeToUtf16(body, start, end) === null) {
          invalidSnapshot(`${referencePath} range cannot be converted safely`);
        }
        previousPositionedEnd = end;
      }
      return {
        member_id: memberId,
        name,
        start,
        end,
        in_discussion: inDiscussion,
        notified,
        deleted,
      };
    },
  );
  const mentionedMemberIds = new Set<number>();
  const mentions = array(item.mentions, `${path}.mentions`).map(
    (mention, mentionIndex) => {
      const mentionPath = `${path}.mentions[${mentionIndex}]`;
      const mentionItem = record(mention, mentionPath);
      const memberId = positiveInteger(
        mentionItem.member_id,
        `${mentionPath}.member_id`,
      );
      if (mentionedMemberIds.has(memberId)) {
        invalidSnapshot(`${path}.mentions must target unique Members`);
      }
      if (memberId === senderId) {
        invalidSnapshot(`${mentionPath} cannot target its sender`);
      }
      const member = membersById.get(memberId);
      if (member && member.type !== "agent") {
        invalidSnapshot(`${mentionPath} must target an Agent`);
      }
      if (
        !references.some(
          (reference) => reference.member_id === memberId && reference.notified,
        )
      ) {
        invalidSnapshot(
          `${mentionPath} requires a notified identity reference`,
        );
      }
      mentionedMemberIds.add(memberId);
      return {
        member_id: memberId,
        status: mentionStatus(mentionItem.status, `${mentionPath}.status`),
      };
    },
  );
  const humanMentionIds = new Set<number>();
  const humanMentions = array(
    item.human_mentions ?? [],
    `${path}.human_mentions`,
  ).map((notification, notificationIndex) => {
    const notificationPath = `${path}.human_mentions[${notificationIndex}]`;
    const notificationItem = record(notification, notificationPath);
    const memberId = positiveInteger(
      notificationItem.member_id,
      `${notificationPath}.member_id`,
    );
    if (humanMentionIds.has(memberId)) {
      invalidSnapshot(`${path}.human_mentions must target unique Humans`);
    }
    if (memberId === senderId) {
      invalidSnapshot(`${notificationPath} cannot target its sender`);
    }
    const member = membersById.get(memberId);
    if (member?.type !== "human") {
      invalidSnapshot(`${notificationPath} must target an active Human`);
    }
    if (
      notificationItem.status !== "unread" &&
      notificationItem.status !== "read"
    ) {
      invalidSnapshot(`${notificationPath}.status is invalid`);
    }
    if (
      !references.some(
        (reference) => reference.member_id === memberId && reference.notified,
      )
    ) {
      invalidSnapshot(
        `${notificationPath} requires a notified identity reference`,
      );
    }
    const status: HumanMention["status"] = notificationItem.status;
    humanMentionIds.add(memberId);
    return { member_id: memberId, status };
  });
  for (const reference of references) {
    if (!reference.notified) {
      continue;
    }
    const member = membersById.get(reference.member_id);
    if (member?.type === "human" && !humanMentionIds.has(reference.member_id)) {
      invalidSnapshot(
        `${path}.references notified Human identity requires a Human notification`,
      );
    }
    if (
      member?.type === "agent" &&
      !mentionedMemberIds.has(reference.member_id)
    ) {
      invalidSnapshot(
        `${path}.references notified Agent identity requires a Mention status`,
      );
    }
    if (!member && !mentionedMemberIds.has(reference.member_id)) {
      invalidSnapshot(
        `${path}.references deleted notified identity requires a Mention status`,
      );
    }
  }
  const notifiedReferenceIds = new Set(
    references
      .filter((reference) => reference.notified)
      .map((reference) => reference.member_id),
  );
  for (const recipient of delivery.recipients) {
    if (recipient.mentioned && !notifiedReferenceIds.has(recipient.member_id)) {
      invalidSnapshot(
        `${path}.delivery mentioned recipient requires notified reference`,
      );
    }
    if (
      mentionedMemberIds.has(recipient.member_id) &&
      recipient.member_type_at_send !== "agent"
    ) {
      invalidSnapshot(
        `${path}.delivery Agent Mention recipient type is invalid`,
      );
    }
    if (
      humanMentionIds.has(recipient.member_id) &&
      recipient.member_type_at_send !== "human"
    ) {
      invalidSnapshot(
        `${path}.delivery Human Mention recipient type is invalid`,
      );
    }
  }
  if (delivery.recipients_known) {
    for (const memberId of notifiedReferenceIds) {
      const recipient = delivery.recipients.find(
        (candidate) => candidate.member_id === memberId,
      );
      if (!recipient?.mentioned) {
        invalidSnapshot(
          `${path}.delivery must include every notified recipient`,
        );
      }
    }
  }
  return {
    id,
    sender_id: senderId,
    ...(senderName === undefined ? {} : { sender_name: senderName }),
    body,
    created_at: createdAt,
    delivery,
    references,
    mentions,
    ...(item.human_mentions === undefined
      ? {}
      : { human_mentions: humanMentions }),
  };
}

function nullablePositiveInteger(value: unknown, path: string): number | null {
  return value === null ? null : positiveInteger(value, path);
}

function parseDiscussion(
  value: unknown,
  index: number,
  membersById: Map<number, Member>,
): DiscussionSummary {
  const path = `discussions[${index}]`;
  const item = record(value, path);
  if (item.messages !== undefined || item.human_read_states !== undefined) {
    invalidSnapshot(`${path} must be a lightweight summary`);
  }
  const id = positiveInteger(item.id, `${path}.id`);
  const memberIds = array(item.member_ids, `${path}.member_ids`).map(
    (memberId, memberIndex) =>
      positiveInteger(memberId, `${path}.member_ids[${memberIndex}]`),
  );
  if (new Set(memberIds).size !== memberIds.length) {
    invalidSnapshot(`${path}.member_ids must contain unique Members`);
  }
  for (const memberId of memberIds) {
    if (!membersById.has(memberId)) {
      invalidSnapshot(`${path}.member_ids contains an unknown Member`);
    }
  }
  const messageCount = nonNegativeInteger(
    item.message_count,
    `${path}.message_count`,
  );
  const firstMessageId = nullablePositiveInteger(
    item.first_message_id,
    `${path}.first_message_id`,
  );
  const latestMessageId = nullablePositiveInteger(
    item.latest_message_id,
    `${path}.latest_message_id`,
  );
  if (
    (messageCount === 0) !==
    (firstMessageId === null && latestMessageId === null)
  ) {
    invalidSnapshot(`${path} message bounds are inconsistent`);
  }
  if (
    firstMessageId !== null &&
    latestMessageId !== null &&
    firstMessageId > latestMessageId
  ) {
    invalidSnapshot(`${path} message bounds are invalid`);
  }
  const latestBound = latestMessageId ?? 0;
  const activityMemberIds = new Set<number>();
  const humanActivity = array(
    item.human_activity,
    `${path}.human_activity`,
  ).map((value, activityIndex) => {
    const activityPath = `${path}.human_activity[${activityIndex}]`;
    const activity = record(value, activityPath);
    const memberId = positiveInteger(
      activity.member_id,
      `${activityPath}.member_id`,
    );
    if (
      membersById.get(memberId)?.type !== "human" ||
      !memberIds.includes(memberId)
    ) {
      invalidSnapshot(`${activityPath} must target a Human Discussion Member`);
    }
    if (activityMemberIds.has(memberId)) {
      invalidSnapshot(`${path}.human_activity must target unique Humans`);
    }
    activityMemberIds.add(memberId);
    const joinedAfterMessageId = nonNegativeInteger(
      activity.joined_after_message_id,
      `${activityPath}.joined_after_message_id`,
    );
    if (joinedAfterMessageId > latestBound) {
      invalidSnapshot(
        `${activityPath}.joined_after_message_id is outside the Discussion`,
      );
    }
    const readThroughMessageId = nullablePositiveInteger(
      activity.read_through_message_id,
      `${activityPath}.read_through_message_id`,
    );
    if (readThroughMessageId !== null && readThroughMessageId > latestBound) {
      invalidSnapshot(
        `${activityPath}.read_through_message_id is outside the Discussion`,
      );
    }
    const seenMessageIds = array(
      activity.seen_message_ids,
      `${activityPath}.seen_message_ids`,
    ).map((messageId, messageIndex) =>
      positiveInteger(
        messageId,
        `${activityPath}.seen_message_ids[${messageIndex}]`,
      ),
    );
    if (
      new Set(seenMessageIds).size !== seenMessageIds.length ||
      seenMessageIds.some(
        (messageId) =>
          messageId <= joinedAfterMessageId ||
          messageId > latestBound ||
          (readThroughMessageId !== null && messageId <= readThroughMessageId),
      )
    ) {
      invalidSnapshot(
        `${activityPath}.seen_message_ids are outside the eligible sparse range`,
      );
    }
    const unreadCount = nonNegativeInteger(
      activity.unread_count,
      `${activityPath}.unread_count`,
    );
    const firstUnreadMessageId = nullablePositiveInteger(
      activity.first_unread_message_id,
      `${activityPath}.first_unread_message_id`,
    );
    const unreadHumanMentionCount = nonNegativeInteger(
      activity.unread_human_mention_count,
      `${activityPath}.unread_human_mention_count`,
    );
    const nextHumanMentionMessageId = nullablePositiveInteger(
      activity.next_human_mention_message_id,
      `${activityPath}.next_human_mention_message_id`,
    );
    if (
      (unreadCount === 0) !== (firstUnreadMessageId === null) ||
      (firstUnreadMessageId !== null &&
        (firstUnreadMessageId <= joinedAfterMessageId ||
          firstUnreadMessageId > latestBound))
    ) {
      invalidSnapshot(
        `${activityPath}.first_unread_message_id is inconsistent`,
      );
    }
    if (
      (unreadHumanMentionCount === 0) !==
        (nextHumanMentionMessageId === null) ||
      (nextHumanMentionMessageId !== null &&
        (nextHumanMentionMessageId <= joinedAfterMessageId ||
          nextHumanMentionMessageId > latestBound))
    ) {
      invalidSnapshot(
        `${activityPath}.next_human_mention_message_id is inconsistent`,
      );
    }
    return {
      member_id: memberId,
      joined_after_message_id: joinedAfterMessageId,
      read_through_message_id: readThroughMessageId,
      seen_message_ids: seenMessageIds,
      unread_count: unreadCount,
      first_unread_message_id: firstUnreadMessageId,
      unread_human_mention_count: unreadHumanMentionCount,
      next_human_mention_message_id: nextHumanMentionMessageId,
    };
  });
  return {
    id,
    topic: nonEmptyString(item.topic, `${path}.topic`),
    member_ids: memberIds,
    message_count: messageCount,
    first_message_id: firstMessageId,
    latest_message_id: latestMessageId,
    human_activity: humanActivity,
  };
}

export function parseDiscussionMessagePage(
  value: unknown,
  members: Member[],
): DiscussionMessagePage {
  const page = record(value, "discussion message page");
  const mode = page.mode;
  if (
    mode !== "latest" &&
    mode !== "before" &&
    mode !== "after" &&
    mode !== "anchor"
  ) {
    invalidSnapshot("discussion message page.mode is invalid");
  }
  const membersById = new Map(members.map((member) => [member.id, member]));
  const messages = array(page.messages, "discussion message page.messages").map(
    (message, index) =>
      parseMessage(
        message,
        0,
        index,
        membersById,
        false,
        `discussion message page.messages[${index}]`,
      ),
  );
  if (
    new Set(messages.map((message) => message.id)).size !== messages.length ||
    messages.some(
      (message, index) => index > 0 && messages[index - 1].id >= message.id,
    )
  ) {
    invalidSnapshot(
      "discussion message page.messages must be unique and increasing",
    );
  }
  const result: DiscussionMessagePage = {
    discussion_id: positiveInteger(
      page.discussion_id,
      "discussion message page.discussion_id",
    ),
    mode,
    messages,
    oldest_message_id: nullablePositiveInteger(
      page.oldest_message_id,
      "discussion message page.oldest_message_id",
    ),
    newest_message_id: nullablePositiveInteger(
      page.newest_message_id,
      "discussion message page.newest_message_id",
    ),
    latest_message_id: nullablePositiveInteger(
      page.latest_message_id,
      "discussion message page.latest_message_id",
    ),
    has_earlier: boolean(
      page.has_earlier,
      "discussion message page.has_earlier",
    ),
    has_later: boolean(page.has_later, "discussion message page.has_later"),
    next_before_message_id: nullablePositiveInteger(
      page.next_before_message_id,
      "discussion message page.next_before_message_id",
    ),
    next_after_message_id: nullablePositiveInteger(
      page.next_after_message_id,
      "discussion message page.next_after_message_id",
    ),
  };
  if (mode === "anchor") {
    result.anchor_message_id = positiveInteger(
      page.anchor_message_id,
      "discussion message page.anchor_message_id",
    );
    result.anchor_index = nonNegativeInteger(
      page.anchor_index,
      "discussion message page.anchor_index",
    );
    if (
      result.anchor_index >= messages.length ||
      messages[result.anchor_index]?.id !== result.anchor_message_id
    )
      invalidSnapshot("discussion message page anchor is inconsistent");
  }
  return result;
}

export function parseOrganizationSnapshot(
  value: unknown,
): OrganizationSnapshot {
  const snapshot = record(value, "snapshot");
  const organization = record(snapshot.organization, "organization");
  if (organization.id !== 1) {
    invalidSnapshot("organization.id must be 1");
  }

  const mentionSyntax = parseMentionSyntax(snapshot.mention_syntax);
  const memberNamePolicy = parseMemberNamePolicy(snapshot.member_name_policy);
  const members = array(snapshot.members, "members").map(parseMember);
  if (members.length === 0) {
    invalidSnapshot("members cannot be empty");
  }
  const memberIds = new Set(members.map((member) => member.id));
  if (memberIds.size !== members.length) {
    invalidSnapshot("Member IDs must be unique");
  }
  const currentHumanMemberId = positiveInteger(
    organization.current_human_member_id,
    "organization.current_human_member_id",
  );
  const currentHuman = members.find(
    (member) => member.id === currentHumanMemberId,
  );
  if (currentHuman?.type !== "human") {
    invalidSnapshot(
      "organization.current_human_member_id must target an active Human",
    );
  }

  const membersById = new Map(members.map((member) => [member.id, member]));
  const discussions = array(snapshot.discussions, "discussions").map(
    (discussion, index) => parseDiscussion(discussion, index, membersById),
  );
  const discussionIds = new Set(discussions.map((discussion) => discussion.id));
  if (discussionIds.size !== discussions.length) {
    invalidSnapshot("Discussion IDs must be unique");
  }
  const humanIds = members
    .filter((member) => member.type === "human")
    .map((member) => member.id);
  for (const [index, discussion] of discussions.entries()) {
    if (discussion.member_ids.length === 0) {
      continue;
    }
    const discussionMemberIds = new Set(discussion.member_ids);
    const activityMemberIds = new Set(
      discussion.human_activity.map((activity) => activity.member_id),
    );
    if (
      humanIds.some(
        (humanId) =>
          !discussionMemberIds.has(humanId) || !activityMemberIds.has(humanId),
      )
    ) {
      invalidSnapshot(
        `discussions[${index}] must contain every active Human and their cutoff activity`,
      );
    }
  }

  return {
    organization: { id: 1, current_human_member_id: currentHumanMemberId },
    working_directory: nonEmptyString(
      snapshot.working_directory,
      "working_directory",
    ),
    mention_syntax: mentionSyntax,
    member_name_policy: memberNamePolicy,
    members,
    discussions,
  };
}

function nonNegativeInteger(value: unknown, path: string): number {
  if (!Number.isInteger(value) || typeof value !== "number" || value < 0) {
    invalidSnapshot(`${path} must be a non-negative integer`);
  }
  return value;
}

function parseReminder(value: unknown, path: string): AgentReminder {
  const reminder = record(value, path);
  return {
    mentions: array(reminder.mentions, `${path}.mentions`).map(
      (value, index) => {
        const itemPath = `${path}.mentions[${index}]`;
        const item = record(value, itemPath);
        if (typeof item.previously_reminded !== "boolean") {
          invalidSnapshot(`${itemPath}.previously_reminded must be a boolean`);
        }
        return {
          discussion_id: positiveInteger(
            item.discussion_id,
            `${itemPath}.discussion_id`,
          ),
          message_id: positiveInteger(
            item.message_id,
            `${itemPath}.message_id`,
          ),
          sender_id: nonNegativeInteger(
            item.sender_id,
            `${itemPath}.sender_id`,
          ),
          body:
            typeof item.body === "string"
              ? item.body
              : invalidSnapshot(`${itemPath}.body must be a string`),
          previously_reminded: item.previously_reminded,
        };
      },
    ),
  };
}

function historyEntryType(value: unknown, path: string): AgentHistoryEntryType {
  if (
    value === "reminder" ||
    value === "assistant" ||
    value === "system" ||
    value === "thinking" ||
    value === "tool_call" ||
    value === "tool_result" ||
    value === "retry" ||
    value === "error"
  ) {
    return value;
  }
  return invalidSnapshot(`${path} is invalid`);
}

function historyEntryState(
  value: unknown,
  path: string,
): AgentHistoryEntry["state"] {
  if (
    value === "complete" ||
    value === "interrupted" ||
    value === "streaming"
  ) {
    return value;
  }
  return invalidSnapshot(`${path} is invalid`);
}

function parseHistoryEntry(
  value: unknown,
  runIndex: number,
  entryIndex: number,
): AgentHistoryEntry {
  const path = `runs[${runIndex}].entries[${entryIndex}]`;
  const item = record(value, path);
  const type = historyEntryType(item.type, `${path}.type`);
  const entry: AgentHistoryEntry = {
    id: nonEmptyString(item.id, `${path}.id`),
    type,
    timestamp: nonEmptyString(item.timestamp, `${path}.timestamp`),
    state: historyEntryState(item.state, `${path}.state`),
  };
  if (type === "reminder") {
    entry.reminder = parseReminder(item.reminder, `${path}.reminder`);
    return entry;
  }
  if (type !== "thinking") {
    entry.content = typeof item.content === "string" ? item.content : "";
  }
  if (item.tool_name !== undefined && item.tool_name !== null) {
    entry.tool_name = nonEmptyString(item.tool_name, `${path}.tool_name`);
  }
  if (item.content_length !== undefined)
    entry.content_length = nonNegativeInteger(
      item.content_length,
      `${path}.content_length`,
    );
  if (item.content_truncated !== undefined)
    entry.content_truncated = boolean(
      item.content_truncated,
      `${path}.content_truncated`,
    );
  if (item.paired_entry_id !== undefined && item.paired_entry_id !== null)
    entry.paired_entry_id = nonEmptyString(
      item.paired_entry_id,
      `${path}.paired_entry_id`,
    );
  return entry;
}

function parseHistoryRun(value: unknown, index: number): AgentHistoryRun {
  const path = `runs[${index}]`;
  const item = record(value, path);
  if (
    item.status !== "running" &&
    item.status !== "completed" &&
    item.status !== "failed" &&
    item.status !== "interrupted"
  ) {
    invalidSnapshot(`${path}.status is invalid`);
  }
  const completedAt = item.completed_at;
  if (completedAt !== null && typeof completedAt !== "string") {
    invalidSnapshot(`${path}.completed_at must be a string or null`);
  }
  const usage = item.usage;
  if (usage !== null && (typeof usage !== "object" || Array.isArray(usage))) {
    invalidSnapshot(`${path}.usage must be an object or null`);
  }
  return {
    run_id: nonEmptyString(item.run_id, `${path}.run_id`),
    sequence:
      item.sequence === undefined
        ? index + 1
        : positiveInteger(item.sequence, `${path}.sequence`),
    status: item.status,
    started_at: nonEmptyString(item.started_at, `${path}.started_at`),
    completed_at: completedAt,
    usage: usage as Record<string, unknown> | null,
    event_sequence: nonNegativeInteger(
      item.event_sequence,
      `${path}.event_sequence`,
    ),
    entries: array(item.entries, `${path}.entries`).map((entry, entryIndex) =>
      parseHistoryEntry(entry, index, entryIndex),
    ),
  };
}

export function parseAgentHistoryPage(value: unknown): AgentHistoryPage {
  const page = record(value, "agent history page");
  const runs = array(page.runs, "agent history page.runs").map(
    (value, index) => {
      const path = `agent history page.runs[${index}]`;
      const item = record(value, path);
      if (
        item.status !== "running" &&
        item.status !== "completed" &&
        item.status !== "failed" &&
        item.status !== "interrupted"
      )
        invalidSnapshot(`${path}.status is invalid`);
      return {
        run_id: nonEmptyString(item.run_id, `${path}.run_id`),
        sequence: positiveInteger(item.sequence, `${path}.sequence`),
        status: item.status,
        started_at: nonEmptyString(item.started_at, `${path}.started_at`),
        completed_at:
          item.completed_at === null
            ? null
            : nonEmptyString(item.completed_at, `${path}.completed_at`),
        usage: item.usage === null ? null : record(item.usage, `${path}.usage`),
        event_sequence: nonNegativeInteger(
          item.event_sequence,
          `${path}.event_sequence`,
        ),
        entry_count: nonNegativeInteger(
          item.entry_count,
          `${path}.entry_count`,
        ),
        error:
          item.error === null
            ? null
            : nonEmptyString(item.error, `${path}.error`),
      } as AgentHistoryRunMetadata;
    },
  );
  if (
    runs.some(
      (run, index) => index > 0 && runs[index - 1].sequence >= run.sequence,
    )
  )
    invalidSnapshot("agent history page runs must be increasing");
  return {
    agent_id: positiveInteger(page.agent_id, "agent history page.agent_id"),
    runs,
    has_earlier: boolean(page.has_earlier, "agent history page.has_earlier"),
    next_before_sequence: nullablePositiveInteger(
      page.next_before_sequence,
      "agent history page.next_before_sequence",
    ),
  };
}

export function parseAgentHistoryRun(value: unknown): AgentHistoryRun {
  return parseHistoryRun(value, 0);
}

export function parseAgentHistoryEntryDetail(
  value: unknown,
): AgentHistoryEntryDetail {
  const item = record(value, "agent history entry");
  const detail: AgentHistoryEntryDetail = {
    agent_id: positiveInteger(item.agent_id, "agent history entry.agent_id"),
    run_id: nonEmptyString(item.run_id, "agent history entry.run_id"),
    entry_id: nonEmptyString(item.entry_id, "agent history entry.entry_id"),
    type: historyEntryType(item.type, "agent history entry.type"),
    content: typeof item.content === "string" ? item.content : "",
    content_length: nonNegativeInteger(
      item.content_length,
      "agent history entry.content_length",
    ),
    offset: nonNegativeInteger(item.offset, "agent history entry.offset"),
    next_offset:
      item.next_offset === null
        ? null
        : nonNegativeInteger(
            item.next_offset,
            "agent history entry.next_offset",
          ),
    truncated: boolean(item.truncated, "agent history entry.truncated"),
  };
  if (item.tool_name !== null && item.tool_name !== undefined)
    detail.tool_name = nonEmptyString(
      item.tool_name,
      "agent history entry.tool_name",
    );
  if (item.paired_entry_id !== null && item.paired_entry_id !== undefined)
    detail.paired_entry_id = nonEmptyString(
      item.paired_entry_id,
      "agent history entry.paired_entry_id",
    );
  return detail;
}

export function parseAgentHistory(value: unknown): AgentHistory {
  const history = record(value, "agent history");
  const agentId = positiveInteger(history.agent_id, "agent_id");
  const runs = array(history.runs, "runs").map(parseHistoryRun);
  const runIds = new Set(runs.map((run) => run.run_id));
  if (runIds.size !== runs.length) {
    invalidSnapshot("Agent history Run IDs must be unique");
  }
  return { agent_id: agentId, runs };
}

function formatEventContent(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  return JSON.stringify(value, null, 2) ?? "";
}

export function parseAgentHistoryEvent(value: unknown): AgentHistoryEvent {
  const event = record(value, "agent history event");
  const base = {
    agent_id: positiveInteger(event.agent_id, "agent_id"),
    run_id: nonEmptyString(event.run_id, "run_id"),
    sequence: positiveInteger(event.sequence, "sequence"),
    timestamp: nonEmptyString(event.timestamp, "timestamp"),
  };
  if (event.type === "run_started") {
    return {
      ...base,
      type: event.type,
      reminder: parseReminder(event.reminder, "reminder"),
    };
  }
  if (event.type === "text_delta") {
    return {
      ...base,
      type: event.type,
      part_id: nonEmptyString(event.part_id, "part_id"),
      content: typeof event.content === "string" ? event.content : "",
    };
  }
  if (event.type === "thinking") {
    return {
      ...base,
      type: event.type,
      part_id: nonEmptyString(event.part_id, "part_id"),
    };
  }
  if (
    event.type === "tool_call" ||
    event.type === "tool_result" ||
    event.type === "retry"
  ) {
    return {
      ...base,
      type: event.type,
      content: formatEventContent(event.content),
      tool_name:
        typeof event.tool_name === "string" && event.tool_name
          ? event.tool_name
          : undefined,
    };
  }
  if (event.type === "run_completed" || event.type === "run_failed") {
    if (
      event.status !== "completed" &&
      event.status !== "failed" &&
      event.status !== "interrupted"
    ) {
      invalidSnapshot("status is invalid");
    }
    return {
      ...base,
      type: event.type,
      status: event.status,
      error: typeof event.error === "string" ? event.error : undefined,
    };
  }
  return invalidSnapshot("Agent history event type is invalid");
}

export function applyAgentHistoryEvent(
  history: AgentHistory,
  event: AgentHistoryEvent,
): AgentHistory {
  if (history.agent_id !== event.agent_id) {
    return history;
  }
  const runIndex = history.runs.findIndex((run) => run.run_id === event.run_id);
  if (event.type === "run_started") {
    if (runIndex >= 0) {
      const current = history.runs[runIndex];
      if (event.sequence <= current.event_sequence) {
        return history;
      }
      const runs = [...history.runs];
      runs[runIndex] = { ...current, event_sequence: event.sequence };
      return { ...history, runs };
    }
    return {
      ...history,
      runs: [
        ...history.runs,
        {
          run_id: event.run_id,
          status: "running",
          started_at: event.timestamp,
          completed_at: null,
          usage: null,
          event_sequence: event.sequence,
          entries: [
            {
              id: `${event.run_id}-reminder`,
              type: "reminder",
              timestamp: event.timestamp,
              state: "complete",
              reminder: event.reminder,
            },
          ],
        },
      ],
    };
  }
  if (runIndex < 0 || event.sequence <= history.runs[runIndex].event_sequence) {
    return history;
  }
  const runs = [...history.runs];
  const current = history.runs[runIndex];
  const entries = [...current.entries];
  const run: AgentHistoryRun = {
    ...current,
    event_sequence: event.sequence,
    entries,
  };
  runs[runIndex] = run;

  if (event.type === "text_delta") {
    const id = `live-text-${event.part_id}`;
    const entryIndex = entries.findIndex((entry) => entry.id === id);
    if (entryIndex >= 0) {
      entries[entryIndex] = {
        ...entries[entryIndex],
        content: `${entries[entryIndex].content ?? ""}${event.content ?? ""}`,
      };
    } else {
      entries.push({
        id,
        type: "assistant",
        timestamp: event.timestamp,
        state: "streaming",
        content: event.content ?? "",
      });
    }
  } else if (event.type === "thinking") {
    const id = `live-thinking-${event.part_id}`;
    if (!entries.some((entry) => entry.id === id)) {
      entries.push({
        id,
        type: "thinking",
        timestamp: event.timestamp,
        state: "streaming",
      });
    }
  } else if (
    event.type === "tool_call" ||
    event.type === "tool_result" ||
    event.type === "retry"
  ) {
    entries.push({
      id: `live-${event.type}-${event.sequence}`,
      type: event.type,
      timestamp: event.timestamp,
      state: "complete",
      content: event.content ?? "",
      tool_name: event.tool_name,
    });
  } else {
    run.status =
      event.status ?? (event.type === "run_completed" ? "completed" : "failed");
    run.completed_at = event.timestamp;
    if (event.error) {
      entries.push({
        id: `${event.run_id}-error-live`,
        type: "error",
        timestamp: event.timestamp,
        state: "complete",
        content: event.error,
      });
    }
  }
  return { ...history, runs };
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

const MEMORY_PATH_MAX_LENGTH = 1024;
const MEMORY_LIST_MAX_LIMIT = 500;
const MEMORY_READ_MAX_BYTES = 64 * 1024;
const TODO_PAGE_MAX_LIMIT = 100;
const MEMORY_INDEX_PATH = "MEMORY.md";
const MEMORY_CONTROL_CHARACTER = /[\p{Cc}\p{Cf}]/u;

function memoryPath(value: unknown, path: string): string {
  const parsed = nonEmptyString(value, path);
  if (
    parsed !== parsed.trim() ||
    [...parsed].length > MEMORY_PATH_MAX_LENGTH ||
    MEMORY_CONTROL_CHARACTER.test(parsed) ||
    parsed.startsWith("/") ||
    parsed.includes("\\") ||
    parsed.split("/").some((part) => !part || part === "." || part === "..") ||
    !parsed.endsWith(".md")
  ) {
    invalidSnapshot(`${path} must be a safe relative Markdown path`);
  }
  return parsed;
}

function compareCodePoints(left: string, right: string): number {
  const leftPoints = [...left].map(
    (character) => character.codePointAt(0) ?? 0,
  );
  const rightPoints = [...right].map(
    (character) => character.codePointAt(0) ?? 0,
  );
  const length = Math.min(leftPoints.length, rightPoints.length);
  for (let index = 0; index < length; index += 1) {
    if (leftPoints[index] !== rightPoints[index]) {
      return leftPoints[index] - rightPoints[index];
    }
  }
  return leftPoints.length - rightPoints.length;
}

function compareMemoryPaths(left: string, right: string): number {
  if (left === MEMORY_INDEX_PATH) {
    return right === MEMORY_INDEX_PATH ? 0 : -1;
  }
  if (right === MEMORY_INDEX_PATH) {
    return 1;
  }
  return compareCodePoints(left, right);
}

function isMemoryLineBreak(codePoint: number): boolean {
  return (
    (codePoint >= 10 && codePoint <= 13) ||
    (codePoint >= 28 && codePoint <= 30) ||
    codePoint === 133 ||
    codePoint === 8232 ||
    codePoint === 8233
  );
}

function memoryContentLineCount(content: string): number {
  if (!content) {
    return 0;
  }
  let breaks = 0;
  let endsWithBreak = false;
  const points = [...content].map((character) => character.codePointAt(0) ?? 0);
  for (let index = 0; index < points.length; index += 1) {
    if (!isMemoryLineBreak(points[index])) {
      endsWithBreak = false;
      continue;
    }
    breaks += 1;
    endsWithBreak = true;
    if (points[index] === 13 && points[index + 1] === 10) {
      index += 1;
    }
  }
  return breaks + (endsWithBreak ? 0 : 1);
}

function todoStatus(value: unknown, path: string): AgentTodoStatus {
  if (value === "pending" || value === "in_progress" || value === "completed") {
    return value;
  }
  return invalidSnapshot(`${path} is invalid`);
}

function parseAgentTodo(value: unknown, path: string): AgentTodo {
  const item = record(value, path);
  const status = todoStatus(item.status, `${path}.status`);
  const completedAt =
    item.completed_at === null
      ? null
      : nonEmptyString(item.completed_at, `${path}.completed_at`);
  if ((status === "completed") !== (completedAt !== null)) {
    invalidSnapshot(`${path}.completed_at must match completed status`);
  }
  return {
    id: positiveInteger(item.id, `${path}.id`),
    subject: nonEmptyString(item.subject, `${path}.subject`),
    description:
      typeof item.description === "string"
        ? item.description
        : invalidSnapshot(`${path}.description must be a string`),
    status,
    created_at: nonEmptyString(item.created_at, `${path}.created_at`),
    updated_at: nonEmptyString(item.updated_at, `${path}.updated_at`),
    completed_at: completedAt,
  };
}

export function parseAgentMemoryList(value: unknown): AgentMemoryList {
  const item = record(value, "agent memory list");
  const paths = array(item.paths, "agent memory list.paths").map(
    (path, index) => memoryPath(path, `agent memory list.paths[${index}]`),
  );
  const count = nonNegativeInteger(item.count, "agent memory list.count");
  const total = nonNegativeInteger(item.total, "agent memory list.total");
  const offset = nonNegativeInteger(item.offset, "agent memory list.offset");
  const limit = positiveInteger(item.limit, "agent memory list.limit");
  const hasMore = boolean(item.has_more, "agent memory list.has_more");
  const nextOffset =
    item.next_offset === null
      ? null
      : nonNegativeInteger(item.next_offset, "agent memory list.next_offset");
  const returnedEnd = offset + count;
  const expectedHasMore = returnedEnd < total;
  if (
    count !== paths.length ||
    count > limit ||
    limit > MEMORY_LIST_MAX_LIMIT ||
    (hasMore && count !== limit) ||
    returnedEnd > total ||
    new Set(paths).size !== paths.length ||
    paths.some(
      (path, index) =>
        index > 0 && compareMemoryPaths(paths[index - 1], path) >= 0,
    ) ||
    (paths.includes(MEMORY_INDEX_PATH) &&
      (offset !== 0 || paths[0] !== MEMORY_INDEX_PATH))
  ) {
    invalidSnapshot(
      "agent memory list contents or pagination are inconsistent",
    );
  }
  if (
    hasMore !== expectedHasMore ||
    nextOffset !== (expectedHasMore ? returnedEnd : null)
  ) {
    invalidSnapshot("agent memory list next_offset is inconsistent");
  }
  return {
    paths,
    count,
    total,
    offset,
    limit,
    has_more: hasMore,
    next_offset: nextOffset,
  };
}

export function parseAgentMemoryFile(value: unknown): AgentMemoryFile {
  const item = record(value, "agent memory file");
  const content =
    typeof item.content === "string"
      ? item.content
      : invalidSnapshot("agent memory file.content must be a string");
  const startLine = positiveInteger(
    item.start_line,
    "agent memory file.start_line",
  );
  const endLine = nonNegativeInteger(
    item.end_line,
    "agent memory file.end_line",
  );
  const totalLines = nonNegativeInteger(
    item.total_lines,
    "agent memory file.total_lines",
  );
  const bytes = nonNegativeInteger(item.bytes, "agent memory file.bytes");
  const maxBytes = positiveInteger(
    item.max_bytes,
    "agent memory file.max_bytes",
  );
  const bytesTruncated = boolean(
    item.bytes_truncated,
    "agent memory file.bytes_truncated",
  );
  const truncated = boolean(item.truncated, "agent memory file.truncated");
  const actualBytes = new TextEncoder().encode(content).byteLength;
  const contentLines = memoryContentLineCount(content);
  const expectedEndLine = startLine + contentLines - 1;
  if (
    actualBytes !== bytes ||
    bytes > maxBytes ||
    maxBytes > MEMORY_READ_MAX_BYTES ||
    startLine > totalLines + 1 ||
    endLine > totalLines ||
    endLine !== expectedEndLine ||
    (contentLines === 0 &&
      (startLine !== totalLines + 1 || endLine !== totalLines)) ||
    truncated !== (bytesTruncated || endLine < totalLines) ||
    (bytesTruncated && (contentLines === 0 || maxBytes - bytes > 3))
  ) {
    invalidSnapshot("agent memory file bounds or truncation are inconsistent");
  }
  return {
    path: memoryPath(item.path, "agent memory file.path"),
    content,
    start_line: startLine,
    end_line: endLine,
    total_lines: totalLines,
    bytes,
    max_bytes: maxBytes,
    bytes_truncated: bytesTruncated,
    truncated,
  };
}

export function parseAgentTodoPage(value: unknown): AgentTodoPage {
  const item = record(value, "agent todo page");
  const status = todoStatus(item.status, "agent todo page.status");
  const todos = array(item.todos, "agent todo page.todos").map((todo, index) =>
    parseAgentTodo(todo, `agent todo page.todos[${index}]`),
  );
  const count = nonNegativeInteger(item.count, "agent todo page.count");
  const limit = positiveInteger(item.limit, "agent todo page.limit");
  const cursor = nullablePositiveInteger(item.cursor, "agent todo page.cursor");
  const hasMore = boolean(item.has_more, "agent todo page.has_more");
  const nextCursor = nullablePositiveInteger(
    item.next_cursor,
    "agent todo page.next_cursor",
  );
  const ids = todos.map((todo) => todo.id);
  const ascending = status !== "completed";
  const ordered = ids.every(
    (id, index) =>
      index === 0 || (ascending ? ids[index - 1] < id : ids[index - 1] > id),
  );
  const afterCursor =
    cursor === null ||
    ids.every((id) => (ascending ? id > cursor : id < cursor));
  const expectedNextCursor =
    hasMore && ids.length > 0 ? ids[ids.length - 1] : null;
  if (
    count !== todos.length ||
    count > limit ||
    limit > TODO_PAGE_MAX_LIMIT ||
    (hasMore && (count !== limit || ids.length === 0)) ||
    todos.some((todo) => todo.status !== status) ||
    new Set(ids).size !== ids.length ||
    !ordered ||
    !afterCursor ||
    (status === "in_progress" && count > 1) ||
    nextCursor !== expectedNextCursor
  ) {
    invalidSnapshot("agent todo page contents or cursor are inconsistent");
  }
  return {
    todos,
    count,
    status,
    limit,
    cursor,
    has_more: hasMore,
    next_cursor: nextCursor,
  };
}

export function parseAgentTodoDetail(value: unknown): AgentTodo {
  const item = record(value, "agent todo detail");
  return parseAgentTodo(item.todo, "agent todo detail.todo");
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
    (settings.context_window !== null &&
      (!Number.isSafeInteger(settings.context_window) ||
        Number(settings.context_window) < 2)) ||
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
    context_window: settings.context_window as number | null,
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
  getDiscussionMessagesPage: async (
    currentHumanMemberId: number,
    discussionId: number,
    members: Member[],
    cursor: {
      before_message_id?: number;
      after_message_id?: number;
      anchor_message_id?: number;
    } = {},
    limit = 50,
  ) =>
    parseDiscussionMessagePage(
      await request("human.discussion.messages.page", {
        human_id: currentHumanMemberId,
        discussion_id: discussionId,
        limit,
        ...cursor,
      }),
      members,
    ),
  getAgentHistory: async (agentId: number) =>
    parseAgentHistory(
      await request("agent.history.get", { agent_id: agentId }),
    ),
  getAgentHistoryPage: async (
    agentId: number,
    beforeSequence: number | null = null,
    limit = 30,
  ) =>
    parseAgentHistoryPage(
      await request("agent.history.runs.page", {
        agent_id: agentId,
        before_sequence: beforeSequence,
        limit,
      }),
    ),
  getAgentHistoryRun: async (agentId: number, runId: string) =>
    parseAgentHistoryRun(
      await request("agent.history.run.get", {
        agent_id: agentId,
        run_id: runId,
      }),
    ),
  getAgentHistoryEntry: async (
    agentId: number,
    runId: string,
    entryId: string,
    offset = 0,
    maxChars = 8_000,
  ) =>
    parseAgentHistoryEntryDetail(
      await request("agent.history.entry.get", {
        agent_id: agentId,
        run_id: runId,
        entry_id: entryId,
        offset,
        max_chars: maxChars,
      }),
    ),
  listAgentMemory: async (agentId: number, offset = 0, limit = 100) =>
    parseAgentMemoryList(
      await request("agent.memory.list", {
        agent_id: agentId,
        offset,
        limit,
      }),
    ),
  readAgentMemory: async (
    agentId: number,
    path: string,
    offset = 1,
    limit = 200,
  ) =>
    parseAgentMemoryFile(
      await request("agent.memory.read", {
        agent_id: agentId,
        path,
        offset,
        limit,
      }),
    ),
  listAgentTodos: async (
    agentId: number,
    status: AgentTodoStatus,
    limit = 50,
    cursor: number | null = null,
  ) =>
    parseAgentTodoPage(
      await request("agent.todo.list", {
        agent_id: agentId,
        status,
        limit,
        cursor,
      }),
    ),
  readAgentTodo: async (agentId: number, todoId: number) =>
    parseAgentTodoDetail(
      await request("agent.todo.read", { agent_id: agentId, todo_id: todoId }),
    ),
  onAgentHistoryEvent: (listener: (event: AgentHistoryEvent) => void) =>
    flowent.onEvent((event, data) => {
      if (event === "agent.history.updated") {
        listener(parseAgentHistoryEvent(data));
      }
    }),
  createAgent: (name: string) =>
    organizationRequest("organization.create_agent", { name }),
  renameMember: (memberId: number, name: string) =>
    organizationRequest("organization.rename_member", {
      member_id: memberId,
      name,
    }),
  deleteAgent: (agentId: number) =>
    organizationRequest("organization.delete_agent", { agent_id: agentId }),
  pauseAgent: (agentId: number) =>
    organizationRequest("organization.pause_agent", { agent_id: agentId }),
  resumeAgent: (agentId: number) =>
    organizationRequest("organization.resume_agent", { agent_id: agentId }),
  createDiscussion: (
    currentHumanMemberId: number,
    topic: string,
    memberIds: number[],
  ) =>
    organizationRequest("discussion.create", {
      topic,
      creator_id: currentHumanMemberId,
      member_ids: memberIds,
    }),
  deleteDiscussion: (discussionId: number) =>
    organizationRequest("discussion.delete", { discussion_id: discussionId }),
  sendMessage: (
    currentHumanMemberId: number,
    discussionId: number,
    body: string,
  ) =>
    organizationRequest("discussion.send", {
      discussion_id: discussionId,
      sender_id: currentHumanMemberId,
      body,
    }),
  seeHumanMessages: (
    humanId: number,
    discussionId: number,
    messageIds: number[],
  ) =>
    organizationRequest("human.discussion.see_messages", {
      human_id: humanId,
      discussion_id: discussionId,
      message_ids: messageIds,
    }),
  readHumanMention: (
    memberId: number,
    discussionId: number,
    messageId: number,
  ) =>
    organizationRequest("human.mention.read", {
      member_id: memberId,
      discussion_id: discussionId,
      message_id: messageId,
    }),
  markAllHumanMessagesRead: (
    humanId: number,
    discussionId: number,
    throughMessageId: number,
  ) =>
    organizationRequest("human.discussion.mark_all_read", {
      human_id: humanId,
      discussion_id: discussionId,
      through_message_id: throughMessageId,
    }),
  ackHumanMention: (humanId: number, discussionId: number, messageId: number) =>
    organizationRequest("human.mention.ack", {
      human_id: humanId,
      discussion_id: discussionId,
      message_id: messageId,
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
