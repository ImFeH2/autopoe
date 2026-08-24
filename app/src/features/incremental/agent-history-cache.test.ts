import { describe, expect, it } from "vitest";
import {
  createAgentHistoryCache,
  mergeAgentHistoryPage,
} from "./agent-history-cache";

const run = (sequence: number) => ({
  run_id: `r${sequence}`,
  sequence,
  status: "completed" as const,
  started_at: "2026-08-23T00:00:00Z",
  completed_at: "2026-08-23T00:00:01Z",
  usage: null,
  event_sequence: 0,
  entry_count: 1,
  error: null,
});
describe("agent history cache", () => {
  it("merges overlapping cursor pages in sequence order", () => {
    const first = mergeAgentHistoryPage(createAgentHistoryCache(), {
      agent_id: 2,
      runs: [run(3), run(4)],
      has_earlier: true,
      next_before_sequence: 3,
    });
    const second = mergeAgentHistoryPage(first, {
      agent_id: 2,
      runs: [run(1), run(2), run(3)],
      has_earlier: false,
      next_before_sequence: null,
    });
    expect(second.orderedRunIds).toEqual(["r1", "r2", "r3", "r4"]);
  });
});
