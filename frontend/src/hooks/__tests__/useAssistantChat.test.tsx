import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import type { KeyboardEvent } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAssistantChat } from "@/hooks/useAssistantChat";
import {
  clearAssistantInputHistoryForTests,
  resetAssistantInputHistorySessionForTests,
} from "@/lib/assistantInputHistory";
import type { HistoryEntry, Node, NodeDetail } from "@/types";

const clearAssistantChatRequestMock = vi.fn();
const getImageAssetUrlMock = vi.fn();
const interruptNodeMock = vi.fn();
const retryAssistantMessageRequestMock = vi.fn();
const sendAssistantMessageRequestMock = vi.fn();
const toastErrorMock = vi.fn();
const useAgentActivityRuntimeMock = vi.fn();
const useAgentConnectionRuntimeMock = vi.fn();
const useAgentHistoryRuntimeMock = vi.fn();
const useAgentNodesRuntimeMock = vi.fn();
const useAgentUIMock = vi.fn();
const fetchNodeDetailMock = vi.fn();
const uploadImageAssetRequestMock = vi.fn();
const resizeObservers: ResizeObserverMock[] = [];

vi.mock("@/context/AgentContext", () => ({
  useAgentActivityRuntime: () => useAgentActivityRuntimeMock(),
  useAgentConnectionRuntime: () => useAgentConnectionRuntimeMock(),
  useAgentHistoryRuntime: () => useAgentHistoryRuntimeMock(),
  useAgentNodesRuntime: () => useAgentNodesRuntimeMock(),
  useAgentUI: () => useAgentUIMock(),
}));

vi.mock("sonner", () => ({
  toast: {
    error: (...args: unknown[]) => toastErrorMock(...args),
  },
}));

vi.mock("@/lib/api", () => ({
  clearAssistantChatRequest: (...args: unknown[]) =>
    clearAssistantChatRequestMock(...args),
  fetchNodeDetail: (...args: unknown[]) => fetchNodeDetailMock(...args),
  getImageAssetUrl: (...args: unknown[]) => getImageAssetUrlMock(...args),
  interruptNode: (...args: unknown[]) => interruptNodeMock(...args),
  retryAssistantMessageRequest: (...args: unknown[]) =>
    retryAssistantMessageRequestMock(...args),
  sendAssistantMessageRequest: (...args: unknown[]) =>
    sendAssistantMessageRequestMock(...args),
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
    resizeObservers.push(this);
  }
}

function buildAssistantNode(state: Node["state"] = "running"): Node {
  return {
    id: "assistant",
    node_type: "assistant",
    is_leader: false,
    state,
    connections: [],
    name: null,
    todos: [],
    role_name: "Steward",
  };
}

function buildDetail(
  history: HistoryEntry[],
  state: NodeDetail["state"] = "running",
): NodeDetail {
  return {
    id: "assistant",
    node_type: "assistant",
    is_leader: false,
    state,
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

function AssistantChatScrollHarness({
  bottomInset = 0,
}: {
  bottomInset?: number;
}) {
  const { assistantActivity, onMessagesScroll, scrollRef, timelineItems } =
    useAssistantChat({ bottomInset });

  return (
    <>
      <div
        data-testid="assistant-scroll"
        onScroll={onMessagesScroll}
        ref={scrollRef}
      />
      <div data-testid="assistant-hint">
        {assistantActivity.runningHint?.label ?? "none"}
      </div>
      <div data-testid="assistant-count">{timelineItems.length}</div>
    </>
  );
}

function mockScrollableElement(
  element: HTMLDivElement,
  initial: {
    scrollHeight: number;
    clientHeight: number;
    scrollTop?: number;
  },
) {
  let scrollHeight = initial.scrollHeight;
  let clientHeight = initial.clientHeight;
  let scrollTop =
    initial.scrollTop ??
    Math.max(0, initial.scrollHeight - initial.clientHeight);

  Object.defineProperties(element, {
    scrollHeight: {
      configurable: true,
      get: () => scrollHeight,
    },
    clientHeight: {
      configurable: true,
      get: () => clientHeight,
    },
    scrollTop: {
      configurable: true,
      get: () => scrollTop,
      set: (value: number) => {
        const maxScrollTop = Math.max(0, scrollHeight - clientHeight);
        scrollTop = Math.max(0, Math.min(value, maxScrollTop));
      },
    },
  });

  return {
    get scrollTop() {
      return scrollTop;
    },
    setMetrics(next: Partial<{ scrollHeight: number; clientHeight: number }>) {
      if (typeof next.scrollHeight === "number") {
        scrollHeight = next.scrollHeight;
      }
      if (typeof next.clientHeight === "number") {
        clientHeight = next.clientHeight;
      }
    },
  };
}

describe("useAssistantChat", () => {
  beforeEach(() => {
    clearAssistantChatRequestMock.mockReset();
    getImageAssetUrlMock.mockReset();
    interruptNodeMock.mockReset();
    retryAssistantMessageRequestMock.mockReset();
    sendAssistantMessageRequestMock.mockReset();
    toastErrorMock.mockReset();
    useAgentActivityRuntimeMock.mockReset();
    useAgentConnectionRuntimeMock.mockReset();
    useAgentHistoryRuntimeMock.mockReset();
    useAgentNodesRuntimeMock.mockReset();
    useAgentUIMock.mockReset();
    fetchNodeDetailMock.mockReset();
    uploadImageAssetRequestMock.mockReset();

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
    getImageAssetUrlMock.mockImplementation(
      (assetId: string) => `/api/image-assets/${assetId}`,
    );
    clearAssistantInputHistoryForTests();
    resizeObservers.splice(0, resizeObservers.length);
    vi.stubGlobal("ResizeObserver", ResizeObserverMock);
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("falls back to thinking after a completed tool call finishes", async () => {
    useAgentNodesRuntimeMock.mockReturnValue({
      agents: new Map([["assistant", buildAssistantNode("running")]]),
    });
    useAgentActivityRuntimeMock.mockReturnValue({
      activeMessages: [],
      activeToolCalls: new Map(),
    });
    fetchNodeDetailMock.mockResolvedValue(
      buildDetail([
        {
          type: "ReceivedMessage",
          from_id: "human",
          content: "Inspect the workspace",
          timestamp: 1,
        },
        {
          type: "ToolCall",
          tool_name: "manage_roles",
          tool_call_id: "tool-1",
          arguments: {},
          result: '{"ok":true}',
          streaming: false,
          timestamp: 2,
        },
      ]),
    );

    const { result } = renderHook(() => useAssistantChat());

    await waitFor(() => {
      expect(result.current.assistantActivity.runningHint).toEqual({
        label: "Thinking...",
        toolName: null,
      });
    });
  });

  it("keeps the running tools hint while a tool call is still streaming", async () => {
    useAgentNodesRuntimeMock.mockReturnValue({
      agents: new Map([["assistant", buildAssistantNode("running")]]),
    });
    useAgentActivityRuntimeMock.mockReturnValue({
      activeMessages: [],
      activeToolCalls: new Map(),
    });
    fetchNodeDetailMock.mockResolvedValue(
      buildDetail([
        {
          type: "ReceivedMessage",
          from_id: "human",
          content: "Inspect the workspace",
          timestamp: 1,
        },
        {
          type: "ToolCall",
          tool_name: "manage_roles",
          tool_call_id: "tool-2",
          arguments: {},
          streaming: true,
          timestamp: 2,
        },
      ]),
    );

    const { result } = renderHook(() => useAssistantChat());

    await waitFor(() => {
      expect(result.current.assistantActivity.runningHint).toEqual({
        label: "Running tools...",
        toolName: "manage_roles",
      });
    });
  });

  it("treats sleeping assistant state as interruptible active work", async () => {
    useAgentNodesRuntimeMock.mockReturnValue({
      agents: new Map([["assistant", buildAssistantNode("sleeping")]]),
    });
    useAgentActivityRuntimeMock.mockReturnValue({
      activeMessages: [],
      activeToolCalls: new Map(),
    });
    fetchNodeDetailMock.mockResolvedValue(
      buildDetail([
        {
          type: "ReceivedMessage",
          from_id: "human",
          content: "Wait for the reply",
          timestamp: 1,
        },
      ]),
    );

    const { result } = renderHook(() => useAssistantChat());

    await waitFor(() => {
      expect(result.current.assistantActivity.running).toBe(true);
    });
  });

  it("clears assistant chat and reloads the empty conversation detail", async () => {
    const clearAgentHistoryMock = vi.fn();

    useAgentNodesRuntimeMock.mockReturnValue({
      agents: new Map([["assistant", buildAssistantNode("idle")]]),
    });
    useAgentActivityRuntimeMock.mockReturnValue({
      activeMessages: [],
      activeToolCalls: new Map(),
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
        buildDetail([
          {
            type: "ReceivedMessage",
            from_id: "human",
            content: "Old conversation",
            timestamp: 1,
          },
        ]),
      )
      .mockResolvedValueOnce(buildDetail([]));
    clearAssistantChatRequestMock.mockResolvedValue(undefined);

    const { result } = renderHook(() => useAssistantChat());

    await waitFor(() => {
      expect(result.current.timelineItems).toHaveLength(1);
    });

    await act(async () => {
      await result.current.clearChat();
    });

    expect(clearAssistantChatRequestMock).toHaveBeenCalledWith("assistant");
    expect(clearAgentHistoryMock).toHaveBeenCalledWith("assistant");
    expect(result.current.timelineItems).toHaveLength(0);
  });

  it("retries a committed human message and reloads the rewritten history", async () => {
    const clearAgentHistoryMock = vi.fn();

    useAgentNodesRuntimeMock.mockReturnValue({
      agents: new Map([["assistant", buildAssistantNode("idle")]]),
    });
    useAgentActivityRuntimeMock.mockReturnValue({
      activeMessages: [],
      activeToolCalls: new Map(),
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
        buildDetail([
          {
            type: "ReceivedMessage",
            from_id: "human",
            content: "Retry this request",
            message_id: "msg-old",
            timestamp: 1,
          },
          {
            type: "AssistantText",
            content: "Old reply",
            timestamp: 2,
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
            timestamp: 3,
          },
        ]),
      );
    retryAssistantMessageRequestMock.mockResolvedValue({
      status: "retried",
      message_id: "msg-new",
    });

    const { result } = renderHook(() => useAssistantChat());

    await waitFor(() => {
      expect(result.current.timelineItems).toHaveLength(2);
    });

    await act(async () => {
      await result.current.retryMessage("msg-old");
    });

    expect(retryAssistantMessageRequestMock).toHaveBeenCalledWith("msg-old");
    expect(clearAgentHistoryMock).toHaveBeenCalledWith("assistant");
    expect(result.current.timelineItems).toHaveLength(1);
    expect(result.current.timelineItems[0]).toMatchObject({
      type: "ReceivedMessage",
      message_id: "msg-new",
    });
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
      agents: new Map([["assistant", buildAssistantNode("idle")]]),
    });
    useAgentActivityRuntimeMock.mockReturnValue({
      activeMessages: [],
      activeToolCalls: new Map(),
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

    const { result, rerender } = renderHook(() => useAssistantChat());

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

  it("interrupts a running assistant before retrying the selected message", async () => {
    const clearAgentHistoryMock = vi.fn();

    useAgentNodesRuntimeMock.mockReturnValue({
      agents: new Map([["assistant", buildAssistantNode("running")]]),
    });
    useAgentActivityRuntimeMock.mockReturnValue({
      activeMessages: [],
      activeToolCalls: new Map(),
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
      .mockResolvedValueOnce(buildDetail([], "running"))
      .mockResolvedValueOnce(buildDetail([], "idle"))
      .mockResolvedValueOnce(
        buildDetail([
          {
            type: "ReceivedMessage",
            from_id: "human",
            content: "Retry this request",
            message_id: "msg-new",
            timestamp: 3,
          },
        ]),
      );
    interruptNodeMock.mockResolvedValue(undefined);
    retryAssistantMessageRequestMock.mockResolvedValue({
      status: "retried",
      message_id: "msg-new",
    });

    const { result } = renderHook(() => useAssistantChat());

    await waitFor(() => {
      expect(result.current.timelineItems).toHaveLength(1);
    });

    vi.useFakeTimers();

    await act(async () => {
      const retryPromise = result.current.retryMessage("msg-old");
      await vi.advanceTimersByTimeAsync(120);
      await retryPromise;
    });

    expect(interruptNodeMock).toHaveBeenCalledWith("assistant");
    expect(retryAssistantMessageRequestMock).toHaveBeenCalledWith("msg-old");
    expect(clearAgentHistoryMock).toHaveBeenCalledWith("assistant");
  });

  it("does not report retry failure when the retry request succeeds but the follow-up reload fails", async () => {
    useAgentNodesRuntimeMock.mockReturnValue({
      agents: new Map([["assistant", buildAssistantNode("idle")]]),
    });
    useAgentActivityRuntimeMock.mockReturnValue({
      activeMessages: [],
      activeToolCalls: new Map(),
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
    retryAssistantMessageRequestMock.mockResolvedValue({
      status: "retried",
      message_id: "msg-new",
    });

    const { result } = renderHook(() => useAssistantChat());

    await waitFor(() => {
      expect(result.current.timelineItems).toHaveLength(1);
    });

    await act(async () => {
      await result.current.retryMessage("msg-old");
    });

    expect(retryAssistantMessageRequestMock).toHaveBeenCalledWith("msg-old");
    expect(toastErrorMock).not.toHaveBeenCalled();
  });

  it("records submitted inputs and browses them with ArrowUp and ArrowDown", async () => {
    useAgentNodesRuntimeMock.mockReturnValue({
      agents: new Map([["assistant", buildAssistantNode("idle")]]),
    });
    useAgentActivityRuntimeMock.mockReturnValue({
      activeMessages: [],
      activeToolCalls: new Map(),
    });
    sendAssistantMessageRequestMock.mockResolvedValue({ status: "sent" });
    fetchNodeDetailMock.mockResolvedValue(buildDetail([], "idle"));

    const { result } = renderHook(() => useAssistantChat());

    await waitFor(() => {
      expect(fetchNodeDetailMock).toHaveBeenCalled();
    });

    act(() => {
      result.current.setInput("first request");
    });

    await act(async () => {
      await result.current.sendMessage();
    });

    act(() => {
      result.current.setInput("/help ");
    });

    await act(async () => {
      await result.current.sendMessage();
    });

    expect(sendAssistantMessageRequestMock).toHaveBeenNthCalledWith(1, {
      content: "first request",
      parts: [{ type: "text", text: "first request" }],
    });
    expect(sendAssistantMessageRequestMock).toHaveBeenNthCalledWith(2, {
      content: "/help",
      parts: [{ type: "text", text: "/help" }],
    });

    act(() => {
      expect(
        result.current.navigateInputHistory(-1, { start: 0, end: 0 }),
      ).toBe(true);
    });

    expect(result.current.input).toBe("/help ");

    act(() => {
      expect(
        result.current.navigateInputHistory(-1, { start: 0, end: 0 }),
      ).toBe(true);
    });

    expect(result.current.input).toBe("first request");

    act(() => {
      expect(result.current.navigateInputHistory(1, { start: 0, end: 0 })).toBe(
        true,
      );
    });

    expect(result.current.input).toBe("/help ");

    act(() => {
      expect(result.current.navigateInputHistory(1, { start: 6, end: 6 })).toBe(
        true,
      );
    });

    expect(result.current.input).toBe("");
    expect(result.current.draftImages).toEqual([]);
  });

  it("restores recalled images in the same session and reloads only text history after a new session", async () => {
    const originalCreateObjectURL = URL.createObjectURL;
    const originalRevokeObjectURL = URL.revokeObjectURL;
    const originalImage = globalThis.Image;
    let objectUrlCounter = 0;

    class ImageMock {
      naturalWidth = 1280;
      naturalHeight = 720;
      onload: null | (() => void) = null;
      onerror: null | (() => void) = null;

      set src(_value: string) {
        queueMicrotask(() => {
          this.onload?.();
        });
      }
    }

    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn(() => `blob:image-${objectUrlCounter++}`),
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: vi.fn(),
    });
    Object.defineProperty(globalThis, "Image", {
      configurable: true,
      value: ImageMock,
    });

    useAgentNodesRuntimeMock.mockReturnValue({
      agents: new Map([
        [
          "assistant",
          {
            ...buildAssistantNode("idle"),
            capabilities: {
              input_image: true,
              output_image: false,
            },
          },
        ],
      ]),
    });
    useAgentActivityRuntimeMock.mockReturnValue({
      activeMessages: [],
      activeToolCalls: new Map(),
    });
    sendAssistantMessageRequestMock.mockResolvedValue({ status: "sent" });
    fetchNodeDetailMock.mockResolvedValue(buildDetail([], "idle"));
    uploadImageAssetRequestMock.mockResolvedValue({
      id: "asset-1",
      mime_type: "image/png",
      width: 1280,
      height: 720,
    });

    try {
      const { result, unmount } = renderHook(() => useAssistantChat());

      await waitFor(() => {
        expect(fetchNodeDetailMock).toHaveBeenCalled();
      });

      act(() => {
        result.current.setInput("review this image");
      });

      await act(async () => {
        await result.current.addImages([
          new File(["image"], "diagram.png", { type: "image/png" }),
        ]);
      });

      await act(async () => {
        await result.current.sendMessage();
      });

      act(() => {
        expect(
          result.current.navigateInputHistory(-1, { start: 0, end: 0 }),
        ).toBe(true);
      });

      expect(result.current.input).toBe("review this image");
      expect(result.current.draftImages).toHaveLength(1);
      expect(result.current.draftImages[0]).toMatchObject({
        assetId: "asset-1",
        name: "diagram.png",
        previewUrl: "/api/image-assets/asset-1",
        status: "ready",
      });

      unmount();
      resetAssistantInputHistorySessionForTests();

      const { result: refreshed } = renderHook(() => useAssistantChat());

      await waitFor(() => {
        expect(fetchNodeDetailMock).toHaveBeenCalledTimes(2);
      });

      act(() => {
        expect(
          refreshed.current.navigateInputHistory(-1, { start: 0, end: 0 }),
        ).toBe(true);
      });

      expect(refreshed.current.input).toBe("review this image");
      expect(refreshed.current.draftImages).toEqual([]);
    } finally {
      Object.defineProperty(URL, "createObjectURL", {
        configurable: true,
        value: originalCreateObjectURL,
      });
      Object.defineProperty(URL, "revokeObjectURL", {
        configurable: true,
        value: originalRevokeObjectURL,
      });
      Object.defineProperty(globalThis, "Image", {
        configurable: true,
        value: originalImage,
      });
    }
  });

  it("does not persist a blank history slot for image-only messages across sessions", async () => {
    const originalCreateObjectURL = URL.createObjectURL;
    const originalRevokeObjectURL = URL.revokeObjectURL;
    const originalImage = globalThis.Image;
    let objectUrlCounter = 0;

    class ImageMock {
      naturalWidth = 1280;
      naturalHeight = 720;
      onload: null | (() => void) = null;
      onerror: null | (() => void) = null;

      set src(_value: string) {
        queueMicrotask(() => {
          this.onload?.();
        });
      }
    }

    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn(() => `blob:image-only-${objectUrlCounter++}`),
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: vi.fn(),
    });
    Object.defineProperty(globalThis, "Image", {
      configurable: true,
      value: ImageMock,
    });

    useAgentNodesRuntimeMock.mockReturnValue({
      agents: new Map([
        [
          "assistant",
          {
            ...buildAssistantNode("idle"),
            capabilities: {
              input_image: true,
              output_image: false,
            },
          },
        ],
      ]),
    });
    useAgentActivityRuntimeMock.mockReturnValue({
      activeMessages: [],
      activeToolCalls: new Map(),
    });
    sendAssistantMessageRequestMock.mockResolvedValue({ status: "sent" });
    fetchNodeDetailMock.mockResolvedValue(buildDetail([], "idle"));
    uploadImageAssetRequestMock.mockResolvedValue({
      id: "asset-image-only",
      mime_type: "image/png",
      width: 1280,
      height: 720,
    });

    try {
      const { result, unmount } = renderHook(() => useAssistantChat());

      await waitFor(() => {
        expect(fetchNodeDetailMock).toHaveBeenCalled();
      });

      await act(async () => {
        await result.current.addImages([
          new File(["image"], "diagram-only.png", { type: "image/png" }),
        ]);
      });

      await act(async () => {
        await result.current.sendMessage();
      });

      act(() => {
        expect(
          result.current.navigateInputHistory(-1, { start: 0, end: 0 }),
        ).toBe(true);
      });

      expect(result.current.input).toBe("");
      expect(result.current.draftImages).toHaveLength(1);

      unmount();
      resetAssistantInputHistorySessionForTests();

      const { result: refreshed } = renderHook(() => useAssistantChat());

      await waitFor(() => {
        expect(fetchNodeDetailMock).toHaveBeenCalledTimes(2);
      });

      act(() => {
        expect(
          refreshed.current.navigateInputHistory(-1, { start: 0, end: 0 }),
        ).toBe(false);
      });

      expect(refreshed.current.input).toBe("");
      expect(refreshed.current.draftImages).toEqual([]);
    } finally {
      Object.defineProperty(URL, "createObjectURL", {
        configurable: true,
        value: originalCreateObjectURL,
      });
      Object.defineProperty(URL, "revokeObjectURL", {
        configurable: true,
        value: originalRevokeObjectURL,
      });
      Object.defineProperty(globalThis, "Image", {
        configurable: true,
        value: originalImage,
      });
    }
  });

  it("only continues history browsing at text boundaries for recalled entries", async () => {
    useAgentNodesRuntimeMock.mockReturnValue({
      agents: new Map([["assistant", buildAssistantNode("idle")]]),
    });
    useAgentActivityRuntimeMock.mockReturnValue({
      activeMessages: [],
      activeToolCalls: new Map(),
    });
    sendAssistantMessageRequestMock.mockResolvedValue({ status: "sent" });
    fetchNodeDetailMock.mockResolvedValue(buildDetail([], "idle"));

    const { result } = renderHook(() => useAssistantChat());

    await waitFor(() => {
      expect(fetchNodeDetailMock).toHaveBeenCalled();
    });

    act(() => {
      result.current.setInput("follow up");
    });

    await act(async () => {
      await result.current.sendMessage();
    });

    act(() => {
      expect(
        result.current.navigateInputHistory(-1, { start: 0, end: 0 }),
      ).toBe(true);
    });

    act(() => {
      expect(result.current.navigateInputHistory(1, { start: 3, end: 3 })).toBe(
        false,
      );
    });

    expect(result.current.input).toBe("follow up");

    act(() => {
      result.current.setInput("follow up edited");
    });

    act(() => {
      expect(
        result.current.navigateInputHistory(-1, { start: 0, end: 0 }),
      ).toBe(false);
    });
  });

  it("keeps pending messages across unrelated history resets and clears them for the assistant only", async () => {
    const historyRuntime = {
      agentHistories: new Map(),
      clearAgentHistory: vi.fn(),
      clearHistorySnapshot: vi.fn(),
      historyInvalidatedAt: new Map(),
      historyClearedAt: new Map(),
      historySnapshots: new Map(),
      streamingDeltas: new Map(),
    };

    useAgentNodesRuntimeMock.mockReturnValue({
      agents: new Map([["assistant", buildAssistantNode("idle")]]),
    });
    useAgentActivityRuntimeMock.mockReturnValue({
      activeMessages: [],
      activeToolCalls: new Map(),
    });
    useAgentHistoryRuntimeMock.mockImplementation(() => historyRuntime);
    sendAssistantMessageRequestMock.mockResolvedValue({
      status: "sent",
      message_id: "msg-pending",
    });
    fetchNodeDetailMock.mockResolvedValue(buildDetail([], "idle"));

    const { result, rerender } = renderHook(() => useAssistantChat());

    await waitFor(() => {
      expect(fetchNodeDetailMock).toHaveBeenCalled();
    });

    act(() => {
      result.current.setInput("keep pending");
    });

    await act(async () => {
      await result.current.sendMessage();
    });

    expect(result.current.timelineItems).toHaveLength(1);
    expect(result.current.timelineItems[0]).toMatchObject({
      type: "PendingHumanMessage",
      content: "keep pending",
      message_id: "msg-pending",
    });

    historyRuntime.historyClearedAt = new Map([["worker", 1]]);
    rerender();

    expect(result.current.timelineItems).toHaveLength(1);
    expect(result.current.timelineItems[0]).toMatchObject({
      type: "PendingHumanMessage",
      content: "keep pending",
      message_id: "msg-pending",
    });

    historyRuntime.historyClearedAt = new Map([["assistant", 2]]);
    rerender();

    await waitFor(() => {
      expect(result.current.timelineItems).toEqual([]);
    });
  });

  it("stores a Tab submitted draft as pending send while the assistant is running", async () => {
    useAgentNodesRuntimeMock.mockReturnValue({
      agents: new Map([["assistant", buildAssistantNode("running")]]),
    });
    useAgentActivityRuntimeMock.mockReturnValue({
      activeMessages: [],
      activeToolCalls: new Map(),
    });
    fetchNodeDetailMock.mockResolvedValue(buildDetail([], "running"));

    const { result } = renderHook(() => useAssistantChat());

    await waitFor(() => {
      expect(fetchNodeDetailMock).toHaveBeenCalled();
    });

    act(() => {
      result.current.setInput("send after the current reply");
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
    expect(sendAssistantMessageRequestMock).not.toHaveBeenCalled();
    expect(result.current.input).toBe("");
    expect(result.current.timelineItems).toHaveLength(1);
    expect(result.current.timelineItems[0]).toMatchObject({
      type: "PendingSendMessage",
      content: "send after the current reply",
      target_id: "assistant",
      target_state: "running",
    });
  });

  it("replaces an assistant pending send instead of queuing multiple drafts", async () => {
    useAgentNodesRuntimeMock.mockReturnValue({
      agents: new Map([["assistant", buildAssistantNode("sleeping")]]),
    });
    useAgentActivityRuntimeMock.mockReturnValue({
      activeMessages: [],
      activeToolCalls: new Map(),
    });
    fetchNodeDetailMock.mockResolvedValue(buildDetail([], "sleeping"));

    const { result } = renderHook(() => useAssistantChat());

    await waitFor(() => {
      expect(fetchNodeDetailMock).toHaveBeenCalled();
    });

    act(() => {
      result.current.setInput("first pending draft");
    });
    act(() => {
      result.current.handleKeyDown({
        key: "Tab",
        shiftKey: false,
        preventDefault: vi.fn(),
      } as unknown as KeyboardEvent<HTMLTextAreaElement>);
    });

    act(() => {
      result.current.setInput("replacement pending draft");
    });
    act(() => {
      result.current.handleKeyDown({
        key: "Tab",
        shiftKey: false,
        preventDefault: vi.fn(),
      } as unknown as KeyboardEvent<HTMLTextAreaElement>);
    });

    expect(sendAssistantMessageRequestMock).not.toHaveBeenCalled();
    expect(result.current.timelineItems).toHaveLength(1);
    expect(result.current.timelineItems[0]).toMatchObject({
      type: "PendingSendMessage",
      content: "replacement pending draft",
      target_state: "sleeping",
    });
  });

  it("automatically sends an assistant pending send after the assistant returns to idle", async () => {
    useAgentNodesRuntimeMock.mockReturnValue({
      agents: new Map([["assistant", buildAssistantNode("running")]]),
    });
    useAgentActivityRuntimeMock.mockReturnValue({
      activeMessages: [],
      activeToolCalls: new Map(),
    });
    fetchNodeDetailMock.mockResolvedValue(buildDetail([], "running"));

    const { result, rerender } = renderHook(() => useAssistantChat());

    await waitFor(() => {
      expect(fetchNodeDetailMock).toHaveBeenCalled();
    });

    act(() => {
      result.current.setInput("send when idle");
    });
    act(() => {
      result.current.handleKeyDown({
        key: "Tab",
        shiftKey: false,
        preventDefault: vi.fn(),
      } as unknown as KeyboardEvent<HTMLTextAreaElement>);
    });

    expect(sendAssistantMessageRequestMock).not.toHaveBeenCalled();

    sendAssistantMessageRequestMock.mockResolvedValue({
      status: "sent",
      message_id: "msg-auto",
    });
    useAgentNodesRuntimeMock.mockReturnValue({
      agents: new Map([["assistant", buildAssistantNode("idle")]]),
    });

    await act(async () => {
      rerender();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(sendAssistantMessageRequestMock).toHaveBeenCalledWith({
        content: "send when idle",
        parts: [{ type: "text", text: "send when idle" }],
      });
    });
    expect(result.current.timelineItems[0]).toMatchObject({
      type: "PendingHumanMessage",
      content: "send when idle",
      message_id: "msg-auto",
    });

    act(() => {
      expect(
        result.current.navigateInputHistory(-1, { start: 0, end: 0 }),
      ).toBe(true);
    });
    expect(result.current.input).toBe("send when idle");
  });

  it("does not turn Enter into an assistant pending send while the assistant is running", async () => {
    useAgentNodesRuntimeMock.mockReturnValue({
      agents: new Map([["assistant", buildAssistantNode("running")]]),
    });
    useAgentActivityRuntimeMock.mockReturnValue({
      activeMessages: [],
      activeToolCalls: new Map(),
    });
    sendAssistantMessageRequestMock.mockResolvedValue({
      status: "sent",
      message_id: "msg-enter",
    });
    fetchNodeDetailMock.mockResolvedValue(buildDetail([], "running"));

    const { result } = renderHook(() => useAssistantChat());

    await waitFor(() => {
      expect(fetchNodeDetailMock).toHaveBeenCalled();
    });

    act(() => {
      result.current.setInput("enter should send");
    });
    await act(async () => {
      result.current.handleKeyDown({
        key: "Enter",
        shiftKey: false,
        preventDefault: vi.fn(),
      } as unknown as KeyboardEvent<HTMLTextAreaElement>);
      await Promise.resolve();
    });

    expect(sendAssistantMessageRequestMock).toHaveBeenCalledWith({
      content: "enter should send",
      parts: [{ type: "text", text: "enter should send" }],
    });
    expect(result.current.timelineItems[0]).toMatchObject({
      type: "PendingHumanMessage",
      content: "enter should send",
    });
  });

  it("keeps a failed assistant auto-send visible without retrying automatically", async () => {
    useAgentNodesRuntimeMock.mockReturnValue({
      agents: new Map([["assistant", buildAssistantNode("running")]]),
    });
    useAgentActivityRuntimeMock.mockReturnValue({
      activeMessages: [],
      activeToolCalls: new Map(),
    });
    fetchNodeDetailMock.mockResolvedValue(buildDetail([], "running"));

    const { result, rerender } = renderHook(() => useAssistantChat());

    await waitFor(() => {
      expect(fetchNodeDetailMock).toHaveBeenCalled();
    });

    act(() => {
      result.current.setInput("failed auto send");
    });
    act(() => {
      result.current.handleKeyDown({
        key: "Tab",
        shiftKey: false,
        preventDefault: vi.fn(),
      } as unknown as KeyboardEvent<HTMLTextAreaElement>);
    });

    sendAssistantMessageRequestMock.mockRejectedValueOnce(
      new Error("send failed"),
    );
    useAgentNodesRuntimeMock.mockReturnValue({
      agents: new Map([["assistant", buildAssistantNode("idle")]]),
    });

    await act(async () => {
      rerender();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(sendAssistantMessageRequestMock).toHaveBeenCalledTimes(1);
    });
    expect(result.current.timelineItems[0]).toMatchObject({
      type: "PendingSendMessage",
      content: "failed auto send",
      send_failed: true,
      target_state: "error",
    });

    await act(async () => {
      rerender();
      await Promise.resolve();
    });

    expect(sendAssistantMessageRequestMock).toHaveBeenCalledTimes(1);
  });

  it("keeps assistant pending send visible when the assistant enters error", async () => {
    useAgentNodesRuntimeMock.mockReturnValue({
      agents: new Map([["assistant", buildAssistantNode("running")]]),
    });
    useAgentActivityRuntimeMock.mockReturnValue({
      activeMessages: [],
      activeToolCalls: new Map(),
    });
    fetchNodeDetailMock.mockResolvedValue(buildDetail([], "running"));

    const { result, rerender } = renderHook(() => useAssistantChat());

    await waitFor(() => {
      expect(fetchNodeDetailMock).toHaveBeenCalled();
    });

    act(() => {
      result.current.setInput("keep this visible");
    });
    act(() => {
      result.current.handleKeyDown({
        key: "Tab",
        shiftKey: false,
        preventDefault: vi.fn(),
      } as unknown as KeyboardEvent<HTMLTextAreaElement>);
    });

    useAgentNodesRuntimeMock.mockReturnValue({
      agents: new Map([["assistant", buildAssistantNode("error")]]),
    });
    rerender();

    expect(sendAssistantMessageRequestMock).not.toHaveBeenCalled();
    expect(result.current.timelineItems[0]).toMatchObject({
      type: "PendingSendMessage",
      content: "keep this visible",
      target_state: "error",
    });
  });

  it("cancels assistant pending send without adding it to input history", async () => {
    useAgentNodesRuntimeMock.mockReturnValue({
      agents: new Map([["assistant", buildAssistantNode("running")]]),
    });
    useAgentActivityRuntimeMock.mockReturnValue({
      activeMessages: [],
      activeToolCalls: new Map(),
    });
    fetchNodeDetailMock.mockResolvedValue(buildDetail([], "running"));

    const { result } = renderHook(() => useAssistantChat());

    await waitFor(() => {
      expect(fetchNodeDetailMock).toHaveBeenCalled();
    });

    act(() => {
      result.current.setInput("cancel this pending draft");
    });
    act(() => {
      result.current.handleKeyDown({
        key: "Tab",
        shiftKey: false,
        preventDefault: vi.fn(),
      } as unknown as KeyboardEvent<HTMLTextAreaElement>);
    });

    const pending = result.current.timelineItems[0];
    expect(pending).toMatchObject({ type: "PendingSendMessage" });
    if (pending?.type !== "PendingSendMessage") {
      throw new Error("Expected pending send message");
    }

    act(() => {
      result.current.cancelPendingSend(pending.id);
    });

    expect(result.current.timelineItems).toEqual([]);
    act(() => {
      expect(
        result.current.navigateInputHistory(-1, { start: 0, end: 0 }),
      ).toBe(false);
    });
  });

  it("replaces assistant pending send while the assistant needs attention", async () => {
    useAgentNodesRuntimeMock.mockReturnValue({
      agents: new Map([["assistant", buildAssistantNode("running")]]),
    });
    useAgentActivityRuntimeMock.mockReturnValue({
      activeMessages: [],
      activeToolCalls: new Map(),
    });
    fetchNodeDetailMock.mockResolvedValue(buildDetail([], "running"));

    const { result, rerender } = renderHook(() => useAssistantChat());

    await waitFor(() => {
      expect(fetchNodeDetailMock).toHaveBeenCalled();
    });

    act(() => {
      result.current.setInput("first blocked draft");
    });
    act(() => {
      result.current.handleKeyDown({
        key: "Tab",
        shiftKey: false,
        preventDefault: vi.fn(),
      } as unknown as KeyboardEvent<HTMLTextAreaElement>);
    });

    useAgentNodesRuntimeMock.mockReturnValue({
      agents: new Map([["assistant", buildAssistantNode("error")]]),
    });
    rerender();

    act(() => {
      result.current.setInput("replacement blocked draft");
    });
    act(() => {
      result.current.handleKeyDown({
        key: "Tab",
        shiftKey: false,
        preventDefault: vi.fn(),
      } as unknown as KeyboardEvent<HTMLTextAreaElement>);
    });

    expect(sendAssistantMessageRequestMock).not.toHaveBeenCalled();
    expect(result.current.timelineItems).toHaveLength(1);
    expect(result.current.timelineItems[0]).toMatchObject({
      type: "PendingSendMessage",
      content: "replacement blocked draft",
      target_state: "error",
    });
  });

  it("keeps following the bottom when the running hint appears without a new timeline item", async () => {
    useAgentNodesRuntimeMock.mockReturnValue({
      agents: new Map([["assistant", buildAssistantNode("idle")]]),
    });
    useAgentActivityRuntimeMock.mockReturnValue({
      activeMessages: [],
      activeToolCalls: new Map(),
    });
    fetchNodeDetailMock.mockResolvedValue(
      buildDetail([
        {
          type: "ReceivedMessage",
          from_id: "human",
          content: "Summarize the repo status",
          timestamp: 1,
        },
      ]),
    );

    const view = render(<AssistantChatScrollHarness bottomInset={0} />);
    const scrollElement = screen.getByTestId(
      "assistant-scroll",
    ) as HTMLDivElement;
    const scrollState = mockScrollableElement(scrollElement, {
      scrollHeight: 300,
      clientHeight: 100,
    });

    await waitFor(() => {
      expect(screen.getByTestId("assistant-count").textContent).toBe("1");
    });
    expect(screen.getByTestId("assistant-hint").textContent).toBe("none");
    expect(scrollState.scrollTop).toBe(200);

    useAgentNodesRuntimeMock.mockReturnValue({
      agents: new Map([["assistant", buildAssistantNode("running")]]),
    });
    scrollState.setMetrics({ scrollHeight: 336 });
    view.rerender(<AssistantChatScrollHarness bottomInset={0} />);

    await waitFor(() => {
      expect(screen.getByTestId("assistant-hint").textContent).toBe(
        "Thinking...",
      );
    });
    expect(scrollState.scrollTop).toBe(236);
  });

  it("stops auto-follow after an upward scroll and restores it after returning to bottom", async () => {
    useAgentNodesRuntimeMock.mockReturnValue({
      agents: new Map([["assistant", buildAssistantNode("running")]]),
    });
    useAgentActivityRuntimeMock.mockReturnValue({
      activeMessages: [],
      activeToolCalls: new Map(),
    });
    fetchNodeDetailMock.mockResolvedValue(
      buildDetail([
        {
          type: "ReceivedMessage",
          from_id: "human",
          content: "Keep following the latest output",
          timestamp: 1,
        },
      ]),
    );

    const view = render(<AssistantChatScrollHarness bottomInset={0} />);
    const scrollElement = screen.getByTestId(
      "assistant-scroll",
    ) as HTMLDivElement;
    const scrollState = mockScrollableElement(scrollElement, {
      scrollHeight: 300,
      clientHeight: 100,
    });

    await waitFor(() => {
      expect(screen.getByTestId("assistant-count").textContent).toBe("1");
    });

    scrollElement.scrollTop = 120;
    fireEvent.scroll(scrollElement);

    scrollState.setMetrics({ scrollHeight: 340 });
    view.rerender(<AssistantChatScrollHarness bottomInset={40} />);

    await waitFor(() => {
      expect(scrollState.scrollTop).toBe(120);
    });

    scrollElement.scrollTop = 240;
    fireEvent.scroll(scrollElement);

    scrollState.setMetrics({ scrollHeight: 420 });
    view.rerender(<AssistantChatScrollHarness bottomInset={80} />);

    await waitFor(() => {
      expect(scrollState.scrollTop).toBe(320);
    });
  });

  it("keeps following the bottom when the panel height changes", async () => {
    useAgentNodesRuntimeMock.mockReturnValue({
      agents: new Map([["assistant", buildAssistantNode("running")]]),
    });
    useAgentActivityRuntimeMock.mockReturnValue({
      activeMessages: [],
      activeToolCalls: new Map(),
    });
    fetchNodeDetailMock.mockResolvedValue(
      buildDetail([
        {
          type: "ReceivedMessage",
          from_id: "human",
          content: "Stream a long answer",
          timestamp: 1,
        },
      ]),
    );

    render(<AssistantChatScrollHarness bottomInset={0} />);
    const scrollElement = screen.getByTestId(
      "assistant-scroll",
    ) as HTMLDivElement;
    const scrollState = mockScrollableElement(scrollElement, {
      scrollHeight: 300,
      clientHeight: 100,
    });

    await waitFor(() => {
      expect(screen.getByTestId("assistant-count").textContent).toBe("1");
      expect(resizeObservers).toHaveLength(1);
    });

    scrollState.setMetrics({ clientHeight: 80 });

    await act(async () => {
      resizeObservers[0]?.callback(
        [],
        resizeObservers[0] as unknown as ResizeObserver,
      );
    });

    await waitFor(() => {
      expect(scrollState.scrollTop).toBe(220);
    });
  });
});
