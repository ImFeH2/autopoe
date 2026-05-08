import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAgentDetail } from "@/hooks/useAgentDetail";
import type { HistoryEntry, Node, NodeDetail } from "@/types";

const useAgentNodesRuntimeMock = vi.fn();
const useAgentHistoryRuntimeMock = vi.fn();
const fetchNodeDetailMock = vi.fn();

vi.mock("@/context/AgentContext", () => ({
  useAgentNodesRuntime: () => useAgentNodesRuntimeMock(),
  useAgentHistoryRuntime: () => useAgentHistoryRuntimeMock(),
}));

vi.mock("@/lib/api", () => ({
  fetchNodeDetail: (...args: unknown[]) => fetchNodeDetailMock(...args),
}));

function buildDetail(history: HistoryEntry[] = []): NodeDetail {
  return {
    id: "assistant",
    node_type: "assistant",
    is_leader: false,
    state: "idle",
    name: null,
    contacts: [],
    connections: [],
    role_name: "Steward",
    todos: [],
    tools: [],
    write_dirs: [],
    allow_network: false,
    history,
  };
}

function buildNode(): Node {
  return {
    id: "assistant",
    node_type: "assistant",
    is_leader: false,
    state: "idle",
    connections: [],
    name: null,
    todos: [],
    role_name: "Steward",
  };
}

describe("useAgentDetail", () => {
  beforeEach(() => {
    fetchNodeDetailMock.mockReset();
    useAgentNodesRuntimeMock.mockReset();
    useAgentHistoryRuntimeMock.mockReset();
  });

  it("preserves assistant incremental history when requested", async () => {
    const incrementalEntry: HistoryEntry = {
      type: "AssistantText",
      content: "recent message",
      timestamp: 2,
    };
    const agentHistories = new Map<string, HistoryEntry[]>([
      ["assistant", [incrementalEntry]],
    ]);
    const clearAgentHistory = vi.fn((agentId: string) => {
      agentHistories.delete(agentId);
    });

    useAgentNodesRuntimeMock.mockReturnValue({
      agents: new Map<string, Node>([["assistant", buildNode()]]),
    });
    useAgentHistoryRuntimeMock.mockReturnValue({
      agentHistories,
      clearAgentHistory,
      clearHistorySnapshot: vi.fn(),
      historyInvalidatedAt: new Map(),
      historyClearedAt: new Map(),
      historySnapshots: new Map(),
      streamingDeltas: new Map(),
    });
    fetchNodeDetailMock.mockResolvedValue(buildDetail());

    const { result } = renderHook(() => useAgentDetail("assistant", true));

    await waitFor(() => {
      expect(result.current.detail?.history).toEqual([incrementalEntry]);
    });
    expect(clearAgentHistory).not.toHaveBeenCalled();
  });

  it("clears incremental history for regular detail views by default", async () => {
    const incrementalEntry: HistoryEntry = {
      type: "AssistantText",
      content: "recent message",
      timestamp: 2,
    };
    const agentHistories = new Map<string, HistoryEntry[]>([
      ["agent-1", [incrementalEntry]],
    ]);
    const clearAgentHistory = vi.fn((agentId: string) => {
      agentHistories.delete(agentId);
    });

    useAgentNodesRuntimeMock.mockReturnValue({
      agents: new Map<string, Node>([["assistant", buildNode()]]),
    });
    useAgentHistoryRuntimeMock.mockReturnValue({
      agentHistories,
      clearAgentHistory,
      clearHistorySnapshot: vi.fn(),
      historyInvalidatedAt: new Map(),
      historyClearedAt: new Map(),
      historySnapshots: new Map(),
      streamingDeltas: new Map(),
    });
    fetchNodeDetailMock.mockResolvedValue({
      ...buildDetail(),
      id: "agent-1",
      node_type: "agent",
      role_name: "Worker",
    } satisfies NodeDetail);

    const { result } = renderHook(() => useAgentDetail("agent-1"));

    await waitFor(() => {
      expect(result.current.detail?.history).toEqual([]);
    });
    expect(clearAgentHistory).toHaveBeenCalledWith("agent-1");
  });

  it("dedupes overlapping fetched and incremental history entries", async () => {
    const sharedEntry: HistoryEntry = {
      type: "AssistantText",
      content: "summarized result",
      timestamp: 3,
    };
    const agentHistories = new Map<string, HistoryEntry[]>([
      ["assistant", [sharedEntry]],
    ]);

    useAgentNodesRuntimeMock.mockReturnValue({
      agents: new Map<string, Node>([["assistant", buildNode()]]),
    });
    useAgentHistoryRuntimeMock.mockReturnValue({
      agentHistories,
      clearAgentHistory: vi.fn(),
      clearHistorySnapshot: vi.fn(),
      historyInvalidatedAt: new Map(),
      historyClearedAt: new Map(),
      historySnapshots: new Map(),
      streamingDeltas: new Map(),
    });
    fetchNodeDetailMock.mockResolvedValue(buildDetail([sharedEntry]));

    const { result } = renderHook(() => useAgentDetail("assistant", true));

    await waitFor(() => {
      expect(result.current.detail?.history).toEqual([sharedEntry]);
    });
  });

  it("updates current state from live nodes without adding state history", async () => {
    const agentHistories = new Map<string, HistoryEntry[]>([["assistant", []]]);

    useAgentNodesRuntimeMock.mockReturnValue({
      agents: new Map<string, Node>([
        [
          "assistant",
          {
            ...buildNode(),
            state: "running",
          },
        ],
      ]),
    });
    useAgentHistoryRuntimeMock.mockReturnValue({
      agentHistories,
      clearAgentHistory: vi.fn(),
      clearHistorySnapshot: vi.fn(),
      historyInvalidatedAt: new Map(),
      historyClearedAt: new Map(),
      historySnapshots: new Map(),
      streamingDeltas: new Map(),
    });
    fetchNodeDetailMock.mockResolvedValue(
      buildDetail([
        {
          type: "AssistantText",
          content: "Ready.",
          timestamp: 1,
        },
      ]),
    );

    const { result } = renderHook(() => useAgentDetail("assistant", true));

    await waitFor(() => {
      expect(result.current.detail?.state).toBe("running");
      expect(result.current.detail?.history).toEqual([
        {
          type: "AssistantText",
          content: "Ready.",
          timestamp: 1,
        },
      ]);
    });
  });

  it("switches to the history_replaced snapshot before the refetch resolves", async () => {
    const initialHistoryRuntime = {
      agentHistories: new Map<string, HistoryEntry[]>(),
      clearAgentHistory: vi.fn(),
      clearHistorySnapshot: vi.fn(),
      historyInvalidatedAt: new Map<string, number>(),
      historyClearedAt: new Map<string, number>(),
      historySnapshots: new Map<string, HistoryEntry[]>(),
      streamingDeltas: new Map(),
    };
    const invalidatedHistoryRuntime = {
      ...initialHistoryRuntime,
      historyInvalidatedAt: new Map([["assistant", 1]]),
      historySnapshots: new Map([
        [
          "assistant",
          [
            {
              type: "ReceivedMessage",
              from_id: "human",
              content: "Snapshot retry result",
              message_id: "msg-snapshot",
              timestamp: 5,
            },
          ],
        ],
      ]),
    };

    useAgentNodesRuntimeMock.mockReturnValue({
      agents: new Map<string, Node>([["assistant", buildNode()]]),
    });
    useAgentHistoryRuntimeMock.mockReturnValue(initialHistoryRuntime);
    fetchNodeDetailMock.mockResolvedValueOnce(
      buildDetail([
        {
          type: "ReceivedMessage",
          from_id: "human",
          content: "Old history",
          message_id: "msg-old",
          timestamp: 1,
        },
      ]),
    );

    const { result, rerender } = renderHook(() => useAgentDetail("assistant"));

    await waitFor(() => {
      expect(result.current.detail?.history[0]).toMatchObject({
        message_id: "msg-old",
      });
    });

    useAgentHistoryRuntimeMock.mockReturnValue(invalidatedHistoryRuntime);
    fetchNodeDetailMock.mockImplementationOnce(
      () => new Promise<NodeDetail | null>(() => {}),
    );
    rerender();

    await waitFor(() => {
      expect(result.current.detail?.history[0]).toMatchObject({
        message_id: "msg-snapshot",
      });
    });
  });
});
