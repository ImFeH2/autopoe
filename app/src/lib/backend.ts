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
};

export type AgentHistoryRun = {
  run_id: string;
  status: "running" | "completed" | "failed" | "interrupted";
  started_at: string;
  completed_at: string | null;
  usage: Record<string, unknown> | null;
  event_sequence: number;
  entries: AgentHistoryEntry[];
};

export type AgentHistory = {
  agent_id: number;
  runs: AgentHistoryRun[];
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

function parseMessage(
  value: unknown,
  discussionIndex: number,
  messageIndex: number,
): Message {
  const path = `discussions[${discussionIndex}].messages[${messageIndex}]`;
  const item = record(value, path);
  const id = positiveInteger(item.id, `${path}.id`);
  if (id !== messageIndex + 1) {
    invalidSnapshot(`${path}.id must follow Discussion order`);
  }
  const senderId = positiveInteger(item.sender_id, `${path}.sender_id`);
  const mentionIds = new Set<number>();
  const mentions = array(item.mentions, `${path}.mentions`).map(
    (mention, mentionIndex) => {
      const mentionPath = `${path}.mentions[${mentionIndex}]`;
      const mentionItem = record(mention, mentionPath);
      const memberId = positiveInteger(
        mentionItem.member_id,
        `${mentionPath}.member_id`,
      );
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
    discussionMemberIds.length < 1 ||
    uniqueMemberIds.size !== discussionMemberIds.length
  ) {
    invalidSnapshot(`${path}.member_ids must contain unique Members`);
  }
  for (const memberId of discussionMemberIds) {
    if (!membersById.has(memberId)) {
      invalidSnapshot(`${path}.member_ids contains an unknown Member`);
    }
  }

  return {
    id,
    topic: nonEmptyString(item.topic, `${path}.topic`),
    member_ids: discussionMemberIds,
    messages: array(item.messages, `${path}.messages`).map(
      (message, messageIndex) => parseMessage(message, index, messageIndex),
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
  getAgentHistory: async (agentId: number) =>
    parseAgentHistory(
      await request("agent.history.get", { agent_id: agentId }),
    ),
  onAgentHistoryEvent: (listener: (event: AgentHistoryEvent) => void) =>
    flowent.onEvent((event, data) => {
      if (event === "agent.history.updated") {
        listener(parseAgentHistoryEvent(data));
      }
    }),
  createAgent: (name: string) =>
    organizationRequest("organization.create_agent", { name }),
  deleteAgent: (agentId: number) =>
    organizationRequest("organization.delete_agent", { agent_id: agentId }),
  pauseAgent: (agentId: number) =>
    organizationRequest("organization.pause_agent", { agent_id: agentId }),
  resumeAgent: (agentId: number) =>
    organizationRequest("organization.resume_agent", { agent_id: agentId }),
  createDiscussion: (topic: string, memberIds: number[]) =>
    organizationRequest("discussion.create", {
      topic,
      creator_id: 1,
      member_ids: memberIds,
    }),
  deleteDiscussion: (discussionId: number) =>
    organizationRequest("discussion.delete", { discussion_id: discussionId }),
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
