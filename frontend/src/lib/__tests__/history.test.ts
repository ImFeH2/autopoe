import { describe, expect, it } from "vitest";
import { historyTimestampToMs, mergeHistoryWithDeltas } from "@/lib/history";
import type { HistoryEntry, StreamingDelta } from "@/types";

describe("history utilities", () => {
  it("normalizes second-based timestamps to milliseconds", () => {
    expect(historyTimestampToMs(1_700_000_000)).toBe(1_700_000_000_000);
    expect(historyTimestampToMs(1_700_000_000_123)).toBe(1_700_000_000_123);
  });

  it("merges content, thinking, and tool result deltas into a live history view", () => {
    const history: HistoryEntry[] = [
      {
        type: "ReceivedMessage",
        from_id: "human",
        content: "Review the workshop notes.",
        timestamp: 10,
      },
      {
        type: "ToolCall",
        tool_name: "list_dir",
        tool_call_id: "call-1",
        arguments: { path: "." },
        streaming: true,
        timestamp: 11,
      },
    ];
    const incremental: HistoryEntry[] = [
      {
        type: "ReceivedMessage",
        from_id: "human",
        content: "Then draft a brief summary.",
        timestamp: 12,
      },
    ];
    const deltas: StreamingDelta[] = [
      { type: "ThinkingDelta", text: "First, extract the key takeaways." },
      {
        type: "ContentDelta",
        text: "The notes cover schedule, speakers, and logistics.",
      },
      {
        type: "ToolResultDelta",
        tool_call_id: "call-1",
        text: "schedule\nspeakers\nlogistics",
      },
    ];

    const result = mergeHistoryWithDeltas({
      history,
      incremental,
      deltas,
      fetchedAt: 15_000,
    });

    expect(result).toEqual([
      history[0],
      {
        ...history[1],
        result: "schedule\nspeakers\nlogistics",
      },
      incremental[0],
      {
        type: "AssistantThinking",
        content: "First, extract the key takeaways.",
        timestamp: 15,
        streaming: true,
      },
      {
        type: "AssistantText",
        content: "The notes cover schedule, speakers, and logistics.",
        timestamp: 15,
        streaming: true,
      },
    ]);
  });

  it("dedupes overlapping fetched and incremental history entries", () => {
    const sharedReceived: HistoryEntry = {
      type: "ReceivedMessage",
      from_id: "human",
      content: "Summarize the current workspace.",
      timestamp: 20,
    };
    const sharedAssistant: HistoryEntry = {
      type: "AssistantText",
      content: "I will inspect the workspace and report back.",
      timestamp: 21,
    };
    const sharedIdle: HistoryEntry = {
      type: "ToolCall",
      tool_name: "idle",
      tool_call_id: "idle-1",
      arguments: {},
      timestamp: 22,
    };
    const uniqueIncremental: HistoryEntry = {
      type: "ReceivedMessage",
      from_id: "human",
      content: "Also include any recent file changes.",
      timestamp: 23,
    };

    const result = mergeHistoryWithDeltas({
      history: [sharedReceived, sharedAssistant, sharedIdle],
      incremental: [
        sharedReceived,
        sharedAssistant,
        sharedIdle,
        uniqueIncremental,
      ],
      fetchedAt: 24_000,
    });

    expect(result).toEqual([
      sharedReceived,
      sharedAssistant,
      sharedIdle,
      uniqueIncremental,
    ]);
  });

  it("prefers the richer tool call entry when duplicate tool call ids overlap", () => {
    const result = mergeHistoryWithDeltas({
      history: [
        {
          type: "ToolCall",
          tool_name: "idle",
          tool_call_id: "idle-2",
          arguments: {},
          timestamp: 30,
          streaming: true,
        },
      ],
      incremental: [
        {
          type: "ToolCall",
          tool_name: "idle",
          tool_call_id: "idle-2",
          arguments: {},
          result: "Waiting for the next message.",
          timestamp: 30,
          streaming: false,
        },
      ],
      fetchedAt: 31_000,
    });

    expect(result).toEqual([
      {
        type: "ToolCall",
        tool_name: "idle",
        tool_call_id: "idle-2",
        arguments: {},
        result: "Waiting for the next message.",
        timestamp: 30,
        streaming: false,
      },
    ]);
  });

  it("dedupes sent messages using targets and content", () => {
    const sent: HistoryEntry = {
      type: "SentMessage",
      to_id: "worker-1",
      content: "Continue the task.",
      timestamp: 40,
    };

    const result = mergeHistoryWithDeltas({
      history: [sent],
      incremental: [sent],
      fetchedAt: 41_000,
    });

    expect(result).toEqual([sent]);
  });

  it("merges sent and received message deltas into streaming history entries", () => {
    const deltas: StreamingDelta[] = [
      {
        type: "SentMessageDelta",
        message_id: "msg-1",
        to_id: "worker-1",
        text: "Continue ",
      },
      {
        type: "SentMessageDelta",
        message_id: "msg-1",
        to_id: "worker-1",
        text: "the task.",
      },
      {
        type: "ReceivedMessageDelta",
        message_id: "msg-2",
        from_id: "worker-1",
        text: "Working ",
      },
      {
        type: "ReceivedMessageDelta",
        message_id: "msg-2",
        from_id: "worker-1",
        text: "on it.",
      },
    ];

    const result = mergeHistoryWithDeltas({
      history: [],
      deltas,
      fetchedAt: 50_000,
    });

    expect(result).toEqual([
      {
        type: "SentMessage",
        message_id: "msg-1",
        to_id: "worker-1",
        content: "Continue the task.",
        parts: [{ type: "text", text: "Continue the task." }],
        timestamp: 50,
        streaming: true,
      },
      {
        type: "ReceivedMessage",
        message_id: "msg-2",
        from_id: "worker-1",
        content: "Working on it.",
        parts: [{ type: "text", text: "Working on it." }],
        timestamp: 50,
        streaming: true,
      },
    ]);
  });
});
