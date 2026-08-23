import { TechnicalDetails } from "@/components/ui/technical-details";
import type {
  AgentHistoryEntry,
  AgentHistoryRun,
  Discussion,
  Member,
} from "@/lib/backend";
import {
  discussionLabel,
  senderLabel,
  shortMessageSummary,
} from "@/lib/humanized-identifiers";
import { HistoryContent } from "./history-content";

const historyTimeFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "medium",
});

function formatHistoryTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.valueOf())
    ? value
    : historyTimeFormatter.format(date);
}

function entryLabel(entry: AgentHistoryEntry) {
  switch (entry.type) {
    case "assistant":
      return "Assistant";
    case "system":
      return "System";
    case "reminder":
      return "Reminder";
    case "thinking":
      return "Thinking";
    case "tool_call":
      return "Tool call";
    case "tool_result":
      return "Tool result";
    case "retry":
      return "Retry";
    case "error":
      return "Error";
  }
}

function usageLabel(run: AgentHistoryRun) {
  const input = run.usage?.input_tokens;
  const output = run.usage?.output_tokens;
  if (typeof input !== "number" && typeof output !== "number") {
    return null;
  }
  return `${typeof input === "number" ? input : 0} in · ${typeof output === "number" ? output : 0} out`;
}

function toolLabel(toolName?: string) {
  return toolName === "web_search" ? "Web search" : (toolName ?? "Tool");
}

function entrySummary(entry: AgentHistoryEntry, run: AgentHistoryRun) {
  if (entry.type === "reminder") {
    const count = entry.reminder?.mentions.length ?? 0;
    const usage = usageLabel(run);
    return `${count} pending Mention${count === 1 ? "" : "s"}${usage ? ` · ${usage}` : ""}`;
  }
  if (
    entry.type === "tool_call" ||
    entry.type === "tool_result" ||
    entry.type === "retry"
  ) {
    return toolLabel(entry.tool_name);
  }
  if (entry.state === "streaming") {
    return "Streaming";
  }
  if (entry.state === "interrupted") {
    return "Interrupted";
  }
  return run.status === "running" ? "Running" : "Complete";
}

function ReminderContent({
  discussions,
  entry,
  members,
}: {
  discussions: readonly Pick<Discussion, "id" | "topic">[];
  entry: AgentHistoryEntry;
  members: readonly Pick<Member, "id" | "name">[];
}) {
  return (
    <div className="agent-history-reminder-list">
      {(entry.reminder?.mentions ?? []).map((mention) => {
        const discussion = discussions.find(
          (candidate) => candidate.id === mention.discussion_id,
        );
        return (
          <section
            className="agent-history-reminder-item"
            key={`${mention.discussion_id}-${mention.message_id}`}
          >
            <header>
              <strong>
                {mention.previously_reminded ? "Previously reminded" : "New"}
              </strong>
              <span>
                {senderLabel(mention.sender_id, members)} ·{" "}
                {shortMessageSummary(mention.body)}
              </span>
              <span>{discussionLabel(discussion)}</span>
            </header>
            <HistoryContent content={mention.body} />
            <TechnicalDetails
              identifiers={[
                { label: "Discussion", value: mention.discussion_id },
                { label: "Message", value: mention.message_id },
                { label: "Sender", value: mention.sender_id },
              ]}
            />
          </section>
        );
      })}
    </div>
  );
}

export function HistoryBlock({
  discussions = [],
  entry,
  members = [],
  run,
}: {
  discussions?: readonly Pick<Discussion, "id" | "topic">[];
  entry: AgentHistoryEntry;
  members?: readonly Pick<Member, "id" | "name">[];
  run: AgentHistoryRun;
}) {
  const eventTimeLabel =
    entry.type === "reminder" ? "Reminder event time" : "Run event time";
  return (
    <details
      className={`agent-history-block agent-history-block--${entry.type}`}
    >
      <summary>
        <span className="agent-history-block-marker" aria-hidden="true" />
        <strong>{entryLabel(entry)}</strong>
        <span className="agent-history-block-summary">
          {entrySummary(entry, run)}
        </span>
        <span className="agent-history-block-time">
          {eventTimeLabel}:{" "}
          <time dateTime={entry.timestamp}>
            {formatHistoryTime(entry.timestamp)}
          </time>
        </span>
      </summary>
      <div className="agent-history-block-content">
        {entry.type === "reminder" ? (
          <ReminderContent
            discussions={discussions}
            entry={entry}
            members={members}
          />
        ) : entry.type === "thinking" ? (
          <p className="agent-history-thinking">Model reasoning hidden</p>
        ) : (
          <HistoryContent content={entry.content ?? ""} />
        )}
      </div>
    </details>
  );
}
