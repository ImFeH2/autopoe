import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { AgentHistoryEntry, AgentHistoryRun } from "@/lib/backend";
import { HistoryBlock } from "./history-block";
import { HistoryContent } from "./history-content";

const run: AgentHistoryRun = {
  run_id: "turn-1",
  status: "completed",
  started_at: "2026-08-16T00:00:00+00:00",
  completed_at: "2026-08-16T00:00:01+00:00",
  usage: null,
  event_sequence: 0,
  entries: [],
};

function entry(overrides: Partial<AgentHistoryEntry>): AgentHistoryEntry {
  return {
    id: "entry-1",
    type: "assistant",
    timestamp: "2026-08-16T00:00:00+00:00",
    state: "complete",
    ...overrides,
  };
}

describe("Agent history blocks", () => {
  it("renders entries as collapsed labeled details with explicit event time", () => {
    const markup = renderToStaticMarkup(
      <HistoryBlock
        entry={entry({ content: "Done", type: "assistant" })}
        run={run}
      />,
    );

    expect(markup).toContain("<details");
    expect(markup).not.toContain(' open="');
    expect(markup).toContain("<strong>Assistant</strong>");
    expect(markup).toContain("Run event time");
    expect(markup).toContain("Done");
  });

  it("humanizes Reminders without exposing technical IDs", () => {
    const markup = renderToStaticMarkup(
      <HistoryBlock
        discussions={[{ id: 12, topic: "Release plan" }]}
        entry={entry({
          reminder: {
            mentions: [
              {
                body: "**Shipped** to production",
                discussion_id: 12,
                message_id: 34,
                previously_reminded: false,
                sender_id: 7,
              },
            ],
          },
          type: "reminder",
        })}
        members={[{ id: 7, name: "Ada" }]}
        run={run}
      />,
    );

    expect(markup).toContain("Ada · Shipped to production");
    expect(markup).toContain("Release plan");
    expect(markup).toContain("Reminder event time");
    expect(markup).not.toContain("Discussion 12 · Message 34 · Member 7");
    expect(markup).not.toContain("Technical details");
    expect(markup).not.toContain('aria-label="Copy Message ID"');
  });

  it("labels web search activity clearly", () => {
    const markup = renderToStaticMarkup(
      <HistoryBlock
        entry={entry({
          content: '{"query":"Huddol"}',
          tool_name: "web_search",
          type: "tool_call",
        })}
        run={run}
      />,
    );

    expect(markup).toContain("<strong>Tool call</strong>");
    expect(markup).toContain("Web search");
  });

  it("renders GFM Markdown without raw HTML injection", () => {
    const markup = renderToStaticMarkup(
      <HistoryContent
        content={
          '**Bold**\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\n<script>alert("x")</script>'
        }
      />,
    );

    expect(markup).toContain("<strong>Bold</strong>");
    expect(markup).toContain("<table>");
    expect(markup).not.toContain("<script>");
  });

  it("adds restrained token classes to structured JSON", () => {
    const markup = renderToStaticMarkup(
      <HistoryContent content={'{"ok":true,"count":2,"name":"Ada"}'} />,
    );

    expect(markup).toContain("agent-history-json-key");
    expect(markup).toContain("agent-history-json-boolean");
    expect(markup).toContain("agent-history-json-number");
    expect(markup).toContain("agent-history-json-string");
  });
});
