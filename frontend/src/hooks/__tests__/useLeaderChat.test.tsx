import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { KeyboardEvent } from "react";
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
    allow_network: false,
    write_dirs: [],
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

  it("stores a Tab submitted workflow draft as pending send while the leader is running", async () => {
    useAgentNodesRuntimeMock.mockReturnValue({
      agents: new Map([["leader", buildLeaderNode("running")]]),
    });
    fetchNodeDetailMock.mockResolvedValue(buildDetail([], "running"));

    const { result } = renderHook(() => useLeaderChat());

    await waitFor(() => {
      expect(fetchNodeDetailMock).toHaveBeenCalled();
    });

    act(() => {
      result.current.setInput("next workflow step");
    });

    const preventDefault = vi.fn();
    act(() => {
      result.current.handleKeyDown({
        key: "Tab",
        shiftKey: false,
        preventDefault,
      } as unknown as KeyboardEvent<HTMLTextAreaElement>);
    });

    expect(preventDefault).toHaveBeenCalled();
    expect(dispatchNodeMessageRequestMock).not.toHaveBeenCalled();
    expect(result.current.input).toBe("");
    expect(result.current.timelineItems).toHaveLength(1);
    expect(result.current.timelineItems[0]).toMatchObject({
      type: "PendingSendMessage",
      content: "next workflow step",
      target_id: "leader",
      target_state: "running",
    });
  });

  it("keeps workflow pending sends bound to their original workflow", async () => {
    useAgentNodesRuntimeMock.mockReturnValue({
      agents: new Map([
        ["leader", buildLeaderNode("running")],
        [
          "leader-2",
          {
            ...buildLeaderNode("idle"),
            id: "leader-2",
            tab_id: "tab-2",
          },
        ],
      ]),
    });
    useAgentTabsRuntimeMock.mockReturnValue({
      tabs: new Map([
        ["tab-1", buildActiveTab()],
        [
          "tab-2",
          {
            ...buildActiveTab(),
            id: "tab-2",
            title: "Second workflow",
            leader_id: "leader-2",
          },
        ],
      ]),
    });
    fetchNodeDetailMock.mockResolvedValue(buildDetail([], "running"));

    const { result, rerender } = renderHook(() => useLeaderChat());

    await waitFor(() => {
      expect(fetchNodeDetailMock).toHaveBeenCalled();
    });

    act(() => {
      result.current.setInput("stay with first workflow");
    });
    act(() => {
      result.current.handleKeyDown({
        key: "Tab",
        shiftKey: false,
        preventDefault: vi.fn(),
      } as unknown as KeyboardEvent<HTMLTextAreaElement>);
    });

    expect(result.current.timelineItems[0]).toMatchObject({
      type: "PendingSendMessage",
      target_id: "leader",
    });

    useAgentUIMock.mockReturnValue({
      activeTabId: "tab-2",
    });
    rerender();

    expect(result.current.timelineItems).toEqual([]);
    expect(dispatchNodeMessageRequestMock).not.toHaveBeenCalled();

    useAgentUIMock.mockReturnValue({
      activeTabId: "tab-1",
    });
    rerender();

    expect(result.current.timelineItems[0]).toMatchObject({
      type: "PendingSendMessage",
      content: "stay with first workflow",
      target_id: "leader",
    });
  });

  it("sends a workflow pending send to its original leader while another workflow is selected", async () => {
    useAgentNodesRuntimeMock.mockReturnValue({
      agents: new Map([
        ["leader", buildLeaderNode("running")],
        [
          "leader-2",
          {
            ...buildLeaderNode("idle"),
            id: "leader-2",
            tab_id: "tab-2",
          },
        ],
      ]),
    });
    useAgentTabsRuntimeMock.mockReturnValue({
      tabs: new Map([
        ["tab-1", buildActiveTab()],
        [
          "tab-2",
          {
            ...buildActiveTab(),
            id: "tab-2",
            title: "Second workflow",
            leader_id: "leader-2",
          },
        ],
      ]),
    });
    fetchNodeDetailMock.mockResolvedValue(buildDetail([], "running"));

    const { result, rerender } = renderHook(() => useLeaderChat());

    await waitFor(() => {
      expect(fetchNodeDetailMock).toHaveBeenCalled();
    });

    act(() => {
      result.current.setInput("send to first leader");
    });
    act(() => {
      result.current.handleKeyDown({
        key: "Tab",
        shiftKey: false,
        preventDefault: vi.fn(),
      } as unknown as KeyboardEvent<HTMLTextAreaElement>);
    });

    dispatchNodeMessageRequestMock.mockResolvedValue({
      status: "sent",
      message_id: "msg-background",
    });
    useAgentNodesRuntimeMock.mockReturnValue({
      agents: new Map([
        ["leader", buildLeaderNode("idle")],
        [
          "leader-2",
          {
            ...buildLeaderNode("idle"),
            id: "leader-2",
            tab_id: "tab-2",
          },
        ],
      ]),
    });
    useAgentUIMock.mockReturnValue({
      activeTabId: "tab-2",
    });

    await act(async () => {
      rerender();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(dispatchNodeMessageRequestMock).toHaveBeenCalledWith("leader", {
        content: "send to first leader",
        parts: [{ type: "text", text: "send to first leader" }],
      });
    });
    expect(result.current.timelineItems).toEqual([]);
  });

  it("automatically sends a workflow pending send when its leader returns to idle", async () => {
    useAgentNodesRuntimeMock.mockReturnValue({
      agents: new Map([["leader", buildLeaderNode("sleeping")]]),
    });
    fetchNodeDetailMock.mockResolvedValue(buildDetail([], "sleeping"));

    const { result, rerender } = renderHook(() => useLeaderChat());

    await waitFor(() => {
      expect(fetchNodeDetailMock).toHaveBeenCalled();
    });

    act(() => {
      result.current.setInput("wake up follow-up");
    });
    act(() => {
      result.current.handleKeyDown({
        key: "Tab",
        shiftKey: false,
        preventDefault: vi.fn(),
      } as unknown as KeyboardEvent<HTMLTextAreaElement>);
    });

    expect(dispatchNodeMessageRequestMock).not.toHaveBeenCalled();

    dispatchNodeMessageRequestMock.mockResolvedValue({
      status: "sent",
      message_id: "msg-workflow-auto",
    });
    useAgentNodesRuntimeMock.mockReturnValue({
      agents: new Map([["leader", buildLeaderNode("idle")]]),
    });

    await act(async () => {
      rerender();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(dispatchNodeMessageRequestMock).toHaveBeenCalledWith("leader", {
        content: "wake up follow-up",
        parts: [{ type: "text", text: "wake up follow-up" }],
      });
    });
    expect(result.current.timelineItems[0]).toMatchObject({
      type: "PendingHumanMessage",
      content: "wake up follow-up",
      message_id: "msg-workflow-auto",
    });
  });

  it("does not turn Enter into a workflow pending send while the leader is running", async () => {
    useAgentNodesRuntimeMock.mockReturnValue({
      agents: new Map([["leader", buildLeaderNode("running")]]),
    });
    fetchNodeDetailMock.mockResolvedValue(buildDetail([], "running"));
    dispatchNodeMessageRequestMock.mockResolvedValue({
      status: "sent",
      message_id: "msg-enter-workflow",
    });

    const { result } = renderHook(() => useLeaderChat());

    await waitFor(() => {
      expect(fetchNodeDetailMock).toHaveBeenCalled();
    });

    act(() => {
      result.current.setInput("workflow enter should send");
    });
    await act(async () => {
      result.current.handleKeyDown({
        key: "Enter",
        shiftKey: false,
        preventDefault: vi.fn(),
      } as unknown as KeyboardEvent<HTMLTextAreaElement>);
      await Promise.resolve();
    });

    expect(dispatchNodeMessageRequestMock).toHaveBeenCalledWith("leader", {
      content: "workflow enter should send",
      parts: [{ type: "text", text: "workflow enter should send" }],
    });
    expect(result.current.timelineItems[0]).toMatchObject({
      type: "PendingHumanMessage",
      content: "workflow enter should send",
    });
  });

  it("keeps a failed workflow auto-send visible without retrying automatically", async () => {
    useAgentNodesRuntimeMock.mockReturnValue({
      agents: new Map([["leader", buildLeaderNode("running")]]),
    });
    fetchNodeDetailMock.mockResolvedValue(buildDetail([], "running"));

    const { result, rerender } = renderHook(() => useLeaderChat());

    await waitFor(() => {
      expect(fetchNodeDetailMock).toHaveBeenCalled();
    });

    act(() => {
      result.current.setInput("failed workflow auto send");
    });
    act(() => {
      result.current.handleKeyDown({
        key: "Tab",
        shiftKey: false,
        preventDefault: vi.fn(),
      } as unknown as KeyboardEvent<HTMLTextAreaElement>);
    });

    dispatchNodeMessageRequestMock.mockRejectedValueOnce(
      new Error("send failed"),
    );
    useAgentNodesRuntimeMock.mockReturnValue({
      agents: new Map([["leader", buildLeaderNode("idle")]]),
    });

    await act(async () => {
      rerender();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(dispatchNodeMessageRequestMock).toHaveBeenCalledTimes(1);
    });
    expect(result.current.timelineItems[0]).toMatchObject({
      type: "PendingSendMessage",
      content: "failed workflow auto send",
      send_failed: true,
      target_state: "error",
    });

    await act(async () => {
      rerender();
      await Promise.resolve();
    });

    expect(dispatchNodeMessageRequestMock).toHaveBeenCalledTimes(1);
  });

  it("keeps workflow pending send visible when the leader enters error", async () => {
    useAgentNodesRuntimeMock.mockReturnValue({
      agents: new Map([["leader", buildLeaderNode("running")]]),
    });
    fetchNodeDetailMock.mockResolvedValue(buildDetail([], "running"));

    const { result, rerender } = renderHook(() => useLeaderChat());

    await waitFor(() => {
      expect(fetchNodeDetailMock).toHaveBeenCalled();
    });

    act(() => {
      result.current.setInput("keep workflow draft visible");
    });
    act(() => {
      result.current.handleKeyDown({
        key: "Tab",
        shiftKey: false,
        preventDefault: vi.fn(),
      } as unknown as KeyboardEvent<HTMLTextAreaElement>);
    });

    useAgentNodesRuntimeMock.mockReturnValue({
      agents: new Map([["leader", buildLeaderNode("error")]]),
    });
    rerender();

    expect(dispatchNodeMessageRequestMock).not.toHaveBeenCalled();
    expect(result.current.timelineItems[0]).toMatchObject({
      type: "PendingSendMessage",
      content: "keep workflow draft visible",
      target_state: "error",
    });
  });

  it("sends a new workflow message after a leader error", async () => {
    useAgentNodesRuntimeMock.mockReturnValue({
      agents: new Map([["leader", buildLeaderNode("error")]]),
    });
    fetchNodeDetailMock.mockResolvedValue(buildDetail([], "error"));
    dispatchNodeMessageRequestMock.mockResolvedValue({
      status: "sent",
      message_id: "msg-workflow-after-error",
    });

    const { result } = renderHook(() => useLeaderChat());

    await waitFor(() => {
      expect(fetchNodeDetailMock).toHaveBeenCalled();
    });

    act(() => {
      result.current.setInput("continue workflow chat");
    });

    await act(async () => {
      await result.current.sendMessage();
    });

    expect(dispatchNodeMessageRequestMock).toHaveBeenCalledWith("leader", {
      content: "continue workflow chat",
      parts: [{ type: "text", text: "continue workflow chat" }],
    });
    expect(toastErrorMock).not.toHaveBeenCalledWith(
      "Resolve the current chat before sending",
    );
    expect(result.current.timelineItems[0]).toMatchObject({
      type: "PendingHumanMessage",
      content: "continue workflow chat",
      message_id: "msg-workflow-after-error",
    });
  });

  it("explicitly sends a workflow pending send after a leader error", async () => {
    useAgentNodesRuntimeMock.mockReturnValue({
      agents: new Map([["leader", buildLeaderNode("running")]]),
    });
    fetchNodeDetailMock.mockResolvedValue(buildDetail([], "running"));

    const { result, rerender } = renderHook(() => useLeaderChat());

    await waitFor(() => {
      expect(fetchNodeDetailMock).toHaveBeenCalled();
    });

    act(() => {
      result.current.setInput("send workflow draft after error");
    });
    act(() => {
      result.current.handleKeyDown({
        key: "Tab",
        shiftKey: false,
        preventDefault: vi.fn(),
      } as unknown as KeyboardEvent<HTMLTextAreaElement>);
    });

    useAgentNodesRuntimeMock.mockReturnValue({
      agents: new Map([["leader", buildLeaderNode("error")]]),
    });
    rerender();
    const pending = result.current.timelineItems[0];
    if (pending?.type !== "PendingSendMessage") {
      throw new Error("Expected pending send message");
    }

    dispatchNodeMessageRequestMock.mockResolvedValue({
      status: "sent",
      message_id: "msg-workflow-pending-after-error",
    });

    await act(async () => {
      await result.current.sendPendingSend(pending.id);
    });

    expect(dispatchNodeMessageRequestMock).toHaveBeenCalledWith("leader", {
      content: "send workflow draft after error",
      parts: [{ type: "text", text: "send workflow draft after error" }],
    });
    expect(result.current.timelineItems[0]).toMatchObject({
      type: "PendingHumanMessage",
      content: "send workflow draft after error",
      message_id: "msg-workflow-pending-after-error",
    });
  });

  it("keeps a workflow pending send visible when explicit send fails", async () => {
    useAgentNodesRuntimeMock.mockReturnValue({
      agents: new Map([["leader", buildLeaderNode("running")]]),
    });
    fetchNodeDetailMock.mockResolvedValue(buildDetail([], "running"));

    const { result, rerender } = renderHook(() => useLeaderChat());

    await waitFor(() => {
      expect(fetchNodeDetailMock).toHaveBeenCalled();
    });

    act(() => {
      result.current.setInput("workflow draft still pending");
    });
    act(() => {
      result.current.handleKeyDown({
        key: "Tab",
        shiftKey: false,
        preventDefault: vi.fn(),
      } as unknown as KeyboardEvent<HTMLTextAreaElement>);
    });

    useAgentNodesRuntimeMock.mockReturnValue({
      agents: new Map([["leader", buildLeaderNode("error")]]),
    });
    rerender();
    const pending = result.current.timelineItems[0];
    if (pending?.type !== "PendingSendMessage") {
      throw new Error("Expected pending send message");
    }

    dispatchNodeMessageRequestMock.mockRejectedValueOnce(
      new Error("send failed"),
    );

    await act(async () => {
      await result.current.sendPendingSend(pending.id);
    });

    expect(result.current.timelineItems[0]).toMatchObject({
      type: "PendingSendMessage",
      content: "workflow draft still pending",
      send_failed: true,
      target_state: "error",
    });
  });

  it("replaces workflow pending send while the leader needs attention", async () => {
    useAgentNodesRuntimeMock.mockReturnValue({
      agents: new Map([["leader", buildLeaderNode("running")]]),
    });
    fetchNodeDetailMock.mockResolvedValue(buildDetail([], "running"));

    const { result, rerender } = renderHook(() => useLeaderChat());

    await waitFor(() => {
      expect(fetchNodeDetailMock).toHaveBeenCalled();
    });

    act(() => {
      result.current.setInput("first workflow draft");
    });
    act(() => {
      result.current.handleKeyDown({
        key: "Tab",
        shiftKey: false,
        preventDefault: vi.fn(),
      } as unknown as KeyboardEvent<HTMLTextAreaElement>);
    });

    useAgentNodesRuntimeMock.mockReturnValue({
      agents: new Map([["leader", buildLeaderNode("error")]]),
    });
    rerender();

    act(() => {
      result.current.setInput("replacement workflow draft");
    });
    act(() => {
      result.current.handleKeyDown({
        key: "Tab",
        shiftKey: false,
        preventDefault: vi.fn(),
      } as unknown as KeyboardEvent<HTMLTextAreaElement>);
    });

    expect(dispatchNodeMessageRequestMock).not.toHaveBeenCalled();
    expect(result.current.timelineItems).toHaveLength(1);
    expect(result.current.timelineItems[0]).toMatchObject({
      type: "PendingSendMessage",
      content: "replacement workflow draft",
      target_state: "error",
    });
  });
});
