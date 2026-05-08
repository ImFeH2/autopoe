import type { HistoryEntry, StreamingDelta } from "@/types";
import { contentPartsToText } from "@/lib/contentParts";

export function clearConversationHistory(
  history: HistoryEntry[],
): HistoryEntry[] {
  return history.filter((entry) => entry.type === "SystemEntry");
}

export function historyTimestampToMs(timestamp: number): number {
  return timestamp > 1_000_000_000_000
    ? timestamp
    : Math.round(timestamp * 1000);
}

export function reduceDeltas(deltas: StreamingDelta[]) {
  let content = "";
  let thinking = "";
  const toolResults = new Map<string, string>();
  const sentMessages = new Map<string, { toId: string; text: string }>();
  const receivedMessages = new Map<string, { fromId: string; text: string }>();
  const messageOrder: Array<{ kind: "sent" | "received"; messageId: string }> =
    [];

  for (const delta of deltas) {
    switch (delta.type) {
      case "ContentDelta":
        content += delta.text;
        break;
      case "ThinkingDelta":
        thinking += delta.text;
        break;
      case "ToolResultDelta":
        toolResults.set(
          delta.tool_call_id,
          (toolResults.get(delta.tool_call_id) ?? "") + delta.text,
        );
        break;
      case "SentMessageDelta":
        if (!sentMessages.has(delta.message_id)) {
          messageOrder.push({ kind: "sent", messageId: delta.message_id });
        }
        sentMessages.set(delta.message_id, {
          toId: delta.to_id,
          text: (sentMessages.get(delta.message_id)?.text ?? "") + delta.text,
        });
        break;
      case "ReceivedMessageDelta":
        if (!receivedMessages.has(delta.message_id)) {
          messageOrder.push({ kind: "received", messageId: delta.message_id });
        }
        receivedMessages.set(delta.message_id, {
          fromId: delta.from_id,
          text:
            (receivedMessages.get(delta.message_id)?.text ?? "") + delta.text,
        });
        break;
    }
  }

  return {
    content,
    thinking,
    toolResults,
    sentMessages,
    receivedMessages,
    messageOrder,
  };
}

function serializeHistoryValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }

  if (typeof value === "string") {
    return value;
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function getHistoryEntryDedupKey(entry: HistoryEntry): string {
  const timestamp = historyTimestampToMs(entry.timestamp);

  switch (entry.type) {
    case "ReceivedMessage":
      if (entry.message_id) {
        return `${entry.type}:${entry.message_id}`;
      }
      return [
        entry.type,
        timestamp,
        entry.from_id ?? "",
        contentPartsToText(entry.parts, entry.content),
      ].join(":");
    case "SentMessage":
      if (entry.message_id) {
        return `${entry.type}:${entry.message_id}`;
      }
      return [
        entry.type,
        timestamp,
        entry.to_id ?? entry.to_ids?.[0] ?? "",
        contentPartsToText(entry.parts, entry.content),
      ].join(":");
    case "ToolCall":
      if (entry.tool_call_id) {
        return `${entry.type}:${entry.tool_call_id}`;
      }
      return [
        entry.type,
        timestamp,
        entry.tool_name ?? "",
        serializeHistoryValue(entry.arguments),
        entry.result ?? "",
        entry.streaming ? "streaming" : "final",
      ].join(":");
    default:
      return [entry.type, timestamp, entry.content ?? ""].join(":");
  }
}

function shouldReplaceDuplicateHistoryEntry(
  existing: HistoryEntry,
  candidate: HistoryEntry,
): boolean {
  if (existing.type !== "ToolCall" || candidate.type !== "ToolCall") {
    return false;
  }

  if (existing.streaming && !candidate.streaming) {
    return true;
  }

  return !existing.result && Boolean(candidate.result);
}

function dedupeHistoryEntries(entries: HistoryEntry[]): HistoryEntry[] {
  const deduped: HistoryEntry[] = [];
  const seenIndexes = new Map<string, number>();

  for (const entry of entries) {
    const key = getHistoryEntryDedupKey(entry);
    const existingIndex = seenIndexes.get(key);

    if (existingIndex === undefined) {
      seenIndexes.set(key, deduped.length);
      deduped.push(entry);
      continue;
    }

    const existing = deduped[existingIndex];
    if (shouldReplaceDuplicateHistoryEntry(existing, entry)) {
      deduped[existingIndex] = entry;
    }
  }

  return deduped;
}

export function mergeHistoryWithDeltas({
  history,
  incremental,
  deltas,
  fetchedAt,
}: {
  history: HistoryEntry[];
  incremental?: HistoryEntry[];
  deltas?: StreamingDelta[];
  fetchedAt: number;
}): HistoryEntry[] {
  const base = dedupeHistoryEntries(
    incremental && incremental.length > 0
      ? [...history, ...incremental]
      : [...history],
  );

  if (!deltas || deltas.length === 0) {
    return base;
  }

  const {
    content,
    thinking,
    toolResults,
    sentMessages,
    receivedMessages,
    messageOrder,
  } = reduceDeltas(deltas);
  const now = fetchedAt / 1000;

  if (thinking) {
    base.push({
      type: "AssistantThinking",
      content: thinking,
      timestamp: now,
      streaming: true,
    } satisfies HistoryEntry);
  }

  if (content) {
    base.push({
      type: "AssistantText",
      content,
      timestamp: now,
      streaming: true,
    } satisfies HistoryEntry);
  }

  if (toolResults.size > 0) {
    for (const [toolCallId, resultText] of toolResults) {
      for (let i = base.length - 1; i >= 0; i -= 1) {
        const entry = base[i];
        if (
          entry.type === "ToolCall" &&
          entry.tool_call_id === toolCallId &&
          entry.streaming
        ) {
          base[i] = { ...entry, result: resultText };
          break;
        }
      }
    }
  }

  for (const item of messageOrder) {
    if (item.kind === "sent") {
      const sent = sentMessages.get(item.messageId);
      if (!sent) {
        continue;
      }
      if (
        base.some(
          (entry) =>
            entry.type === "SentMessage" && entry.message_id === item.messageId,
        )
      ) {
        continue;
      }
      base.push({
        type: "SentMessage",
        message_id: item.messageId,
        to_id: sent.toId,
        content: sent.text,
        parts: [{ type: "text", text: sent.text }],
        timestamp: now,
        streaming: true,
      } satisfies HistoryEntry);
      continue;
    }

    const received = receivedMessages.get(item.messageId);
    if (!received) {
      continue;
    }
    if (
      base.some(
        (entry) =>
          entry.type === "ReceivedMessage" &&
          entry.message_id === item.messageId,
      )
    ) {
      continue;
    }
    base.push({
      type: "ReceivedMessage",
      message_id: item.messageId,
      from_id: received.fromId,
      content: received.text,
      parts: [{ type: "text", text: received.text }],
      timestamp: now,
      streaming: true,
    } satisfies HistoryEntry);
  }

  return base;
}
