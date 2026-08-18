import type { AgentHistoryEntry, AgentHistoryRun } from "@/lib/backend";
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

function ReminderContent({ entry }: { entry: AgentHistoryEntry }) {
  return (
    <div className="agent-history-reminder-list">
      {(entry.reminder?.mentions ?? []).map((mention) => (
        <section
          className="agent-history-reminder-item"
          key={`${mention.discussion_id}-${mention.message_id}`}
        >
          <header>
            <strong>
              {mention.previously_reminded ? "Previously reminded" : "New"}
            </strong>
            <span>
              Discussion {mention.discussion_id} · Message {mention.message_id}{" "}
              · Member {mention.sender_id}
            </span>
          </header>
          <HistoryContent content={mention.body} />
        </section>
      ))}
    </div>
  );
}

export function HistoryBlock({
  entry,
  run,
}: {
  entry: AgentHistoryEntry;
  run: AgentHistoryRun;
}) {
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
        <time dateTime={entry.timestamp}>
          {formatHistoryTime(entry.timestamp)}
        </time>
      </summary>
      <div className="agent-history-block-content">
        {entry.type === "reminder" ? (
          <ReminderContent entry={entry} />
        ) : entry.type === "thinking" ? (
          <p className="agent-history-thinking">Model reasoning hidden</p>
        ) : (
          <HistoryContent content={entry.content ?? ""} />
        )}
      </div>
    </details>
  );
}
