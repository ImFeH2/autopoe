import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLeaderChat } from "@/hooks/useLeaderChat";
import { clearChatInputHistoryForTests } from "@/lib/chatInputHistory";
import type { HistoryEntry, Node, NodeDetail, TaskTab } from "@/types";

const clearNodeChatRequestMock = vi.fn();
const dispatchNodeMessageRequestMock = vi.fn();
const fetchNodeDetailMock = vi.fn();
const getImageAssetUrlMock = vi.fn();
const interruptNodeMock = vi.fn();
const retryNodeMessageRequestMock = vi.fn();
const toastErrorMock = vi.fn();
const uploadImageAssetRequestMock = vi.fn();
const useAgentActivityRuntimeMock = vi.fn();
const useAgentConnectionRuntimeMock = vi.fn();
const useAgentHistoryRuntimeMock = vi.fn();
const useAgentNodesRuntimeMock = vi.fn();
const useAgentTabsRuntimeMock = vi.fn();
const useAgentUIMock = vi.fn();

vi.mock("@/context/AgentContext", () => ({
  useAgentActivityRuntime: () => useAgentActivityRuntimeMock(),
  useAgentConnectionRuntime: () => useAgentConnectionRuntimeMock(),
  useAgentHistoryRuntime: () => useAgentHistoryRuntimeMock(),
  useAgentNodesRuntime: () => useAgentNodesRuntimeMock(),
  useAgentTabsRuntime: () => useAgentTabsRuntimeMock(),
  useAgentUI: () => useAgentUIMock(),
}));

vi.mock("sonner", () => ({
  toast: {
    error: (...args: unknown[]) => toastErrorMock(...args),
  },
}));

vi.mock("@/lib/api", () => ({
  clearNodeChatRequest: (...args: unknown[]) =>
    clearNodeChatRequestMock(...args),
  dispatchNodeMessageRequest: (...args: unknown[]) =>
    dispatchNodeMessageRequestMock(...args),
  fetchNodeDetail: (...args: unknown[]) => fetchNodeDetailMock(...args),
  getImageAssetUrl: (...args: unknown[]) => getImageAssetUrlMock(...args),
  interruptNode: (...args: unknown[]) => interruptNodeMock(...args),
  retryNodeMessageRequest: (...args: unknown[]) =>
    retryNodeMessageRequestMock(...args),
  uploadImageAssetRequest: (...args: unknown[]) =>
    uploadImageAssetRequestMock(...args),
}));

class ResizeObserverMock {
  callback: ResizeObserverCallback;
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
  }
}

function buildLeaderNode(state: Node["state"] = "idle"): Node {
  return {
    id: "leader",
    node_type: "agent",
    tab_id: "tab-1",
    is_leader: true,
    state,
    connections: [],
    name: "Leader",
    todos: [],
    role_name: "Conductor",
    capabilities: {
      input_image: true,
      output_image: false,
    },
  };
}

function buildActiveTab(): TaskTab {
  return {
    id: "tab-1",
    title: "Execution",
    leader_id: "leader",
    created_at: 1,
    updated_at: 1,
    definition: { version: 1, nodes: [], edges: [] },
    node_count: 1,
    edge_count: 0,
  };
}

function buildDetail(
  history: HistoryEntry[],
  state: NodeDetail["state"] = "idle",
): NodeDetail {
  return {
    id: "leader",
    node_type: "agent",
    tab_id: "tab-1",
    is_leader: true,
    state,
    name: "Leader",
    contacts: [],
    connections: [],
    role_name: "Conductor",
    todos: [],
    capabilities: {
      input_image: true,
      output_image: false,
    },
    tools: [],
    write_dirs: [],
    allow_network: false,
    history,
  };
}

describe("useLeaderChat", () => {
  beforeEach(() => {
    clearNodeChatRequestMock.mockReset();
    dispatchNodeMessageRequestMock.mockReset();
    fetchNodeDetailMock.mockReset();
    getImageAssetUrlMock.mockReset();
    interruptNodeMock.mockReset();
    retryNodeMessageRequestMock.mockReset();
    toastErrorMock.mockReset();
    uploadImageAssetRequestMock.mockReset();
    useAgentActivityRuntimeMock.mockReset();
    useAgentConnectionRuntimeMock.mockReset();
    useAgentHistoryRuntimeMock.mockReset();
    useAgentNodesRuntimeMock.mockReset();
    useAgentTabsRuntimeMock.mockReset();
    useAgentUIMock.mockReset();

    useAgentActivityRuntimeMock.mockReturnValue({
      activeToolCalls: new Map(),
    });
    useAgentConnectionRuntimeMock.mockReturnValue({
      connected: true,
    });
    useAgentHistoryRuntimeMock.mockReturnValue({
      agentHistories: new Map(),
      clearAgentHistory: vi.fn(),
      clearHistorySnapshot: vi.fn(),
      historyInvalidatedAt: new Map(),
      historyClearedAt: new Map(),
      historySnapshots: new Map(),
      streamingDeltas: new Map(),
    });
    useAgentNodesRuntimeMock.mockReturnValue({
      agents: new Map([["leader", buildLeaderNode()]]),
    });
    useAgentTabsRuntimeMock.mockReturnValue({
      tabs: new Map([["tab-1", buildActiveTab()]]),
    });
    useAgentUIMock.mockReturnValue({
      activeTabId: "tab-1",
    });
    getImageAssetUrlMock.mockImplementation(
      (assetId: string) => `/api/image-assets/${assetId}`,
    );
    clearChatInputHistoryForTests();
    vi.stubGlobal("ResizeObserver", ResizeObserverMock);
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
  });

  afterEach(() => {
    cleanup();
    clearChatInputHistoryForTests();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("retries the selected leader human message and refreshes history", async () => {
    const clearAgentHistoryMock = vi.fn();

    useAgentHistoryRuntimeMock.mockReturnValue({
      agentHistories: new Map(),
      clearAgentHistory: clearAgentHistoryMock,
      clearHistorySnapshot: vi.fn(),
      historyInvalidatedAt: new Map(),
      historyClearedAt: new Map(),
      historySnapshots: new Map(),
      streamingDeltas: new Map(),
    });
    fetchNodeDetailMock
      .mockResolvedValueOnce(
        buildDetail([
          {
            type: "ReceivedMessage",
            from_id: "human",
            content: "Retry this request",
            message_id: "msg-old",
            timestamp: 1,
          },
        ]),
      )
      .mockResolvedValueOnce(
        buildDetail([
          {
            type: "ReceivedMessage",
            from_id: "human",
            content: "Retry this request",
            message_id: "msg-new",
            timestamp: 2,
          },
        ]),
      );
    retryNodeMessageRequestMock.mockResolvedValue({
      message_id: "msg-new",
    });

    const { result } = renderHook(() => useLeaderChat());

    await waitFor(() => {
      expect(result.current.timelineItems).toHaveLength(1);
    });

    await act(async () => {
      await result.current.retryMessage("msg-old");
    });

    expect(retryNodeMessageRequestMock).toHaveBeenCalledWith(
      "leader",
      "msg-old",
    );
    expect(clearAgentHistoryMock).toHaveBeenCalledWith("leader");
    expect(result.current.timelineItems).toHaveLength(1);
    expect(result.current.timelineItems[0]).toMatchObject({
      type: "ReceivedMessage",
      message_id: "msg-new",
    });
  });

  it("interrupts a running leader before retrying the selected message", async () => {
    const clearAgentHistoryMock = vi.fn();

    useAgentNodesRuntimeMock.mockReturnValue({
      agents: new Map([["leader", buildLeaderNode("running")]]),
    });
    useAgentHistoryRuntimeMock.mockReturnValue({
      agentHistories: new Map(),
      clearAgentHistory: clearAgentHistoryMock,
      clearHistorySnapshot: vi.fn(),
      historyInvalidatedAt: new Map(),
      historyClearedAt: new Map(),
      historySnapshots: new Map(),
      streamingDeltas: new Map(),
    });
    fetchNodeDetailMock
      .mockResolvedValueOnce(
        buildDetail(
          [
            {
              type: "ReceivedMessage",
              from_id: "human",
              content: "Retry this request",
              message_id: "msg-old",
              timestamp: 1,
            },
          ],
          "running",
        ),
      )
      .mockResolvedValueOnce(buildDetail([], "running"))
      .mockResolvedValueOnce(buildDetail([], "idle"))
      .mockResolvedValueOnce(
        buildDetail([
          {
            type: "ReceivedMessage",
            from_id: "human",
            content: "Retry this request",
            message_id: "msg-new",
            timestamp: 2,
          },
        ]),
      );
    interruptNodeMock.mockResolvedValue(undefined);
    retryNodeMessageRequestMock.mockResolvedValue({
      message_id: "msg-new",
    });

    const { result } = renderHook(() => useLeaderChat());

    await waitFor(() => {
      expect(result.current.timelineItems).toHaveLength(1);
    });

    vi.useFakeTimers();

    await act(async () => {
      const retryPromise = result.current.retryMessage("msg-old");
      await vi.advanceTimersByTimeAsync(120);
      await retryPromise;
    });

    expect(interruptNodeMock).toHaveBeenCalledWith("leader");
    expect(retryNodeMessageRequestMock).toHaveBeenCalledWith(
      "leader",
      "msg-old",
    );
    expect(clearAgentHistoryMock).toHaveBeenCalledWith("leader");
  });

  it("switches to the history_replaced snapshot before the refetch resolves", async () => {
    const initialHistoryRuntime = {
      agentHistories: new Map(),
      clearAgentHistory: vi.fn(),
      clearHistorySnapshot: vi.fn(),
      historyInvalidatedAt: new Map(),
      historyClearedAt: new Map(),
      historySnapshots: new Map(),
      streamingDeltas: new Map(),
    };
    const invalidatedHistoryRuntime = {
      ...initialHistoryRuntime,
      historyInvalidatedAt: new Map([["leader", 1]]),
      historySnapshots: new Map([
        [
          "leader",
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

    const { result, rerender } = renderHook(() => useLeaderChat());

    await waitFor(() => {
      expect(result.current.timelineItems[0]).toMatchObject({
        message_id: "msg-old",
      });
    });

    useAgentHistoryRuntimeMock.mockReturnValue(invalidatedHistoryRuntime);
    fetchNodeDetailMock.mockImplementationOnce(
      () => new Promise<NodeDetail | null>(() => {}),
    );
    rerender();

    await waitFor(() => {
      expect(result.current.timelineItems[0]).toMatchObject({
        message_id: "msg-snapshot",
      });
    });
  });

  it("does not report retry failure when the retry request succeeds but the follow-up reload fails", async () => {
    useAgentHistoryRuntimeMock.mockReturnValue({
      agentHistories: new Map(),
      clearAgentHistory: vi.fn(),
      clearHistorySnapshot: vi.fn(),
      historyInvalidatedAt: new Map(),
      historyClearedAt: new Map(),
      historySnapshots: new Map(),
      streamingDeltas: new Map(),
    });
    fetchNodeDetailMock
      .mockResolvedValueOnce(
        buildDetail([
          {
            type: "ReceivedMessage",
            from_id: "human",
            content: "Retry this request",
            message_id: "msg-old",
            timestamp: 1,
          },
        ]),
      )
      .mockRejectedValueOnce(new Error("reload failed"));
    retryNodeMessageRequestMock.mockResolvedValue({
      message_id: "msg-new",
    });

    const { result } = renderHook(() => useLeaderChat());

    await waitFor(() => {
      expect(result.current.timelineItems).toHaveLength(1);
    });

    await act(async () => {
      await result.current.retryMessage("msg-old");
    });

    expect(retryNodeMessageRequestMock).toHaveBeenCalledWith(
      "leader",
      "msg-old",
    );
    expect(toastErrorMock).not.toHaveBeenCalled();
  });

  it("removes the pending row when a workflow command is executed", async () => {
    fetchNodeDetailMock.mockResolvedValue(buildDetail([], "idle"));
    dispatchNodeMessageRequestMock.mockResolvedValue({
      status: "command_executed",
      command_name: "/help",
    });

    const { result } = renderHook(() => useLeaderChat());

    await waitFor(() => {
      expect(fetchNodeDetailMock).toHaveBeenCalled();
    });

    act(() => {
      result.current.setInput("/help");
    });

    await act(async () => {
      await result.current.sendMessage();
    });

    expect(dispatchNodeMessageRequestMock).toHaveBeenCalledWith("leader", {
      content: "/help",
      parts: [{ type: "text", text: "/help" }],
    });
    expect(result.current.timelineItems).toEqual([]);
  });

  it("clears the current workflow chat and reloads leader history", async () => {
    const clearAgentHistoryMock = vi.fn();
    const clearHistorySnapshotMock = vi.fn();

    useAgentHistoryRuntimeMock.mockReturnValue({
      agentHistories: new Map(),
      clearAgentHistory: clearAgentHistoryMock,
      clearHistorySnapshot: clearHistorySnapshotMock,
      historyInvalidatedAt: new Map(),
      historyClearedAt: new Map(),
      historySnapshots: new Map(),
      streamingDeltas: new Map(),
    });
    fetchNodeDetailMock
      .mockResolvedValueOnce(
        buildDetail([
          {
            type: "ReceivedMessage",
            from_id: "human",
            content: "Old workflow chat",
            message_id: "msg-old",
            timestamp: 1,
          },
        ]),
      )
      .mockResolvedValueOnce(buildDetail([], "idle"));
    clearNodeChatRequestMock.mockResolvedValue(undefined);

    const { result } = renderHook(() => useLeaderChat());

    await waitFor(() => {
      expect(result.current.timelineItems).toHaveLength(1);
    });

    await act(async () => {
      await result.current.clearChat();
    });

    expect(clearNodeChatRequestMock).toHaveBeenCalledWith("leader");
    expect(clearAgentHistoryMock).toHaveBeenCalledWith("leader");
    expect(clearHistorySnapshotMock).toHaveBeenCalledWith("leader");
    expect(result.current.timelineItems).toEqual([]);
  });
});
