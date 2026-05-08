/* eslint-disable react-refresh/only-export-components */
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useAgents } from "@/hooks/useAgents";
import { useTabs } from "@/hooks/useTabs";
import { useWebSocket } from "@/hooks/useWebSocket";
import {
  AgentFeedContext,
  MAX_ACTIVITY_FEED_ITEMS,
  normalizeEventTimestampMs,
  type ActivityFeedEntry,
} from "@/context/AgentFeedContext";
import {
  deleteMapEntries,
  deleteMapEntry,
  filterStreamingDeltas,
} from "@/context/agentRuntimeState";
import { getDeletedTabNodeIds, getTabEventId } from "@/lib/tabEvents";
import type {
  AgentEvent,
  HistoryEntry,
  Node,
  TaskTab,
  StreamingDelta,
} from "@/types";

export interface ActiveMessage {
  id: string;
  fromId: string;
  toId: string;
  timestamp: number;
}

export type PageId =
  | "assistant"
  | "workspace"
  | "providers"
  | "mcp"
  | "roles"
  | "prompts"
  | "tools"
  | "channels"
  | "stats"
  | "settings";

interface AgentRuntimeContextValue {
  agents: Map<string, Node>;
  tabs: Map<string, TaskTab>;
  connected: boolean;
  agentHistories: Map<string, HistoryEntry[]>;
  clearAgentHistory: (agentId: string) => void;
  clearHistorySnapshot: (agentId: string) => void;
  historyInvalidatedAt: Map<string, number>;
  historyClearedAt: Map<string, number>;
  historySnapshots: Map<string, HistoryEntry[]>;
  streamingDeltas: Map<string, StreamingDelta[]>;
  activeMessages: ActiveMessage[];
  activeToolCalls: Map<string, string>;
}

interface AgentNodesContextValue {
  agents: Map<string, Node>;
}

interface AgentTabsContextValue {
  tabs: Map<string, TaskTab>;
}

interface AgentConnectionContextValue {
  connected: boolean;
}

interface AgentHistoryContextValue {
  agentHistories: Map<string, HistoryEntry[]>;
  clearAgentHistory: (agentId: string) => void;
  clearHistorySnapshot: (agentId: string) => void;
  historyInvalidatedAt: Map<string, number>;
  historyClearedAt: Map<string, number>;
  historySnapshots: Map<string, HistoryEntry[]>;
  streamingDeltas: Map<string, StreamingDelta[]>;
}

interface AgentActivityContextValue {
  activeMessages: ActiveMessage[];
  activeToolCalls: Map<string, string>;
}

interface AgentUIContextValue {
  selectedAgentId: string | null;
  selectAgent: (id: string | null) => void;
  hoveredAgentId: string | null;
  setHoveredAgentId: (id: string | null) => void;
  activeTabId: string | null;
  setActiveTabId: (id: string | null) => void;
  currentPage: PageId;
  setCurrentPage: (page: PageId) => void;
}

const AgentNodesContext = createContext<AgentNodesContextValue | null>(null);
const AgentTabsContext = createContext<AgentTabsContextValue | null>(null);
const AgentConnectionContext =
  createContext<AgentConnectionContextValue | null>(null);
const AgentHistoryContext = createContext<AgentHistoryContextValue | null>(
  null,
);
const AgentActivityContext = createContext<AgentActivityContextValue | null>(
  null,
);
const AgentUIContext = createContext<AgentUIContextValue | null>(null);

const MESSAGE_ANIMATION_MS = 2000;
const TOOL_CALL_ANIMATION_MS = 2000;
const MAX_TRACKED_TOOL_CALL_IDS = 256;

function shouldTrackFeedEntry(entry: HistoryEntry): boolean {
  return (
    entry.type === "ReceivedMessage" ||
    entry.type === "AssistantText" ||
    entry.type === "SentMessage" ||
    entry.type === "AssistantThinking" ||
    entry.type === "ToolCall" ||
    entry.type === "ErrorEntry"
  );
}

export function AgentProvider({ children }: { children: ReactNode }) {
  const { agents, handleUpdateEvent } = useAgents();
  const { tabs, handleUpdateEvent: handleTabEvent } = useTabs();
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [hoveredAgentId, setHoveredAgentId] = useState<string | null>(null);
  const [selectedTabId, setSelectedTabId] = useState<string | null>(null);
  const [agentHistories, setAgentHistories] = useState<
    Map<string, HistoryEntry[]>
  >(() => new Map());
  const [streamingDeltas, setStreamingDeltas] = useState<
    Map<string, StreamingDelta[]>
  >(() => new Map());
  const [historyClearedAt, setHistoryClearedAt] = useState<Map<string, number>>(
    () => new Map(),
  );
  const [historyInvalidatedAt, setHistoryInvalidatedAt] = useState<
    Map<string, number>
  >(() => new Map());
  const [historySnapshots, setHistorySnapshots] = useState<
    Map<string, HistoryEntry[]>
  >(() => new Map());
  const [activeMessages, setActiveMessages] = useState<ActiveMessage[]>([]);
  const [activeToolCalls, setActiveToolCalls] = useState<Map<string, string>>(
    () => new Map(),
  );
  const [recentActivities, setRecentActivities] = useState<ActivityFeedEntry[]>(
    [],
  );
  const [currentPage, setCurrentPage] = useState<PageId>("assistant");
  const msgTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(
    new Map(),
  );
  const toolTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(
    new Map(),
  );
  const activityEntryCounterRef = useRef(0);
  const seenToolCallIdsRef = useRef<Set<string>>(new Set());
  const activeTabId = useMemo(() => {
    if (selectedTabId && tabs.has(selectedTabId)) {
      return selectedTabId;
    }
    const firstTabId = tabs.keys().next().value;
    return typeof firstTabId === "string" ? firstTabId : null;
  }, [selectedTabId, tabs]);

  const clearAgentHistory = useCallback((agentId: string) => {
    setAgentHistories((prev) => deleteMapEntry(prev, agentId));
  }, []);

  const clearHistorySnapshot = useCallback((agentId: string) => {
    setHistorySnapshots((prev) => deleteMapEntry(prev, agentId));
  }, []);

  const onDisplayEvent = useCallback(() => {}, []);

  const onUpdateEvent = useCallback(
    (event: AgentEvent) => {
      handleUpdateEvent(event);
      handleTabEvent(event);

      if (event.type === "tab_deleted") {
        const removedNodeIdSet = getDeletedTabNodeIds(event.data, agents);
        const deletedTabId = getTabEventId(event.data);

        if (deletedTabId) {
          setSelectedTabId((current) =>
            current === deletedTabId ? null : current,
          );
        }

        if (removedNodeIdSet.size > 0) {
          setSelectedAgentId((current) =>
            current && removedNodeIdSet.has(current) ? null : current,
          );
          setHoveredAgentId((current) =>
            current && removedNodeIdSet.has(current) ? null : current,
          );
        }

        if (removedNodeIdSet.size > 0) {
          setAgentHistories((prev) => deleteMapEntries(prev, removedNodeIdSet));
          setStreamingDeltas((prev) =>
            deleteMapEntries(prev, removedNodeIdSet),
          );
          setActiveMessages((prev) =>
            prev.filter(
              (message) =>
                !removedNodeIdSet.has(message.fromId) &&
                !removedNodeIdSet.has(message.toId),
            ),
          );
          setActiveToolCalls((prev) =>
            deleteMapEntries(prev, removedNodeIdSet),
          );
          setRecentActivities((prev) =>
            prev.filter((activity) => !removedNodeIdSet.has(activity.agentId)),
          );
        }
      }

      if (event.type === "node_deleted") {
        const deletedNodeId = event.agent_id;
        setSelectedAgentId((current) =>
          current === deletedNodeId ? null : current,
        );
        setHoveredAgentId((current) =>
          current === deletedNodeId ? null : current,
        );
        setAgentHistories((prev) => deleteMapEntry(prev, deletedNodeId));
        setStreamingDeltas((prev) => deleteMapEntry(prev, deletedNodeId));
        setActiveMessages((prev) =>
          prev.filter(
            (message) =>
              message.fromId !== deletedNodeId &&
              message.toId !== deletedNodeId,
          ),
        );
        setActiveToolCalls((prev) => deleteMapEntry(prev, deletedNodeId));
        setRecentActivities((prev) =>
          prev.filter((activity) => activity.agentId !== deletedNodeId),
        );
      }

      if (event.type === "node_message") {
        const fromId = event.agent_id;
        const toId = event.data.to_id as string | undefined;
        if (fromId && toId) {
          const msgId = `msg-${Date.now()}-${Math.random()}`;
          const message: ActiveMessage = {
            id: msgId,
            fromId,
            toId,
            timestamp: Date.now(),
          };
          setActiveMessages((prev) => [...prev, message]);
          const timer = setTimeout(() => {
            setActiveMessages((prev) => prev.filter((m) => m.id !== msgId));
            msgTimers.current.delete(msgId);
          }, MESSAGE_ANIMATION_MS);
          msgTimers.current.set(msgId, timer);
        }
      }

      if (event.type === "tool_called") {
        const toolName = event.data.tool as string;
        const agentId = event.agent_id;
        const prev = toolTimers.current.get(agentId);
        if (prev) clearTimeout(prev);
        setActiveToolCalls((current) => {
          const next = new Map(current);
          next.set(agentId, toolName);
          return next;
        });
        const timer = setTimeout(() => {
          setActiveToolCalls((current) => deleteMapEntry(current, agentId));
          toolTimers.current.delete(agentId);
        }, TOOL_CALL_ANIMATION_MS);
        toolTimers.current.set(agentId, timer);
      }

      if (event.type === "history_entry_delta") {
        const delta = event.data as unknown as StreamingDelta;
        setStreamingDeltas((prev) => {
          const next = new Map(prev);
          const list = next.get(event.agent_id) ?? [];
          next.set(event.agent_id, [...list, delta]);
          return next;
        });
      }

      if (event.type === "history_cleared") {
        const agentId = event.agent_id;
        const clearedAt = normalizeEventTimestampMs(event.timestamp);
        setHistoryInvalidatedAt((prev) => {
          const next = new Map(prev);
          next.set(agentId, clearedAt);
          return next;
        });
        setHistoryClearedAt((prev) => {
          const next = new Map(prev);
          next.set(agentId, clearedAt);
          return next;
        });
        setHistorySnapshots((prev) => deleteMapEntry(prev, agentId));
        setAgentHistories((prev) => deleteMapEntry(prev, agentId));
        setStreamingDeltas((prev) => deleteMapEntry(prev, agentId));
        setActiveToolCalls((prev) => deleteMapEntry(prev, agentId));
        setRecentActivities((prev) =>
          prev.filter((activity) => activity.agentId !== agentId),
        );
      }

      if (event.type === "history_replaced") {
        const agentId = event.agent_id;
        const invalidatedAt = normalizeEventTimestampMs(event.timestamp);
        setHistoryInvalidatedAt((prev) => {
          const next = new Map(prev);
          next.set(agentId, invalidatedAt);
          return next;
        });
        setHistorySnapshots((prev) => {
          const next = new Map(prev);
          const history = Array.isArray(event.data.history)
            ? (event.data.history as HistoryEntry[])
            : null;
          if (history) {
            next.set(agentId, history);
          } else {
            next.delete(agentId);
          }
          return next;
        });
        setAgentHistories((prev) => deleteMapEntry(prev, agentId));
        setStreamingDeltas((prev) => deleteMapEntry(prev, agentId));
        setActiveToolCalls((prev) => deleteMapEntry(prev, agentId));
        setRecentActivities((prev) =>
          prev.filter((activity) => activity.agentId !== agentId),
        );
      }

      if (event.type === "history_entry_added") {
        const entry = event.data as unknown as HistoryEntry;
        if (shouldTrackFeedEntry(entry)) {
          let shouldAppendActivity = true;
          let toolCallIdToReplace: string | null = null;

          if (entry.type === "ToolCall" && entry.tool_call_id) {
            if (seenToolCallIdsRef.current.has(entry.tool_call_id)) {
              shouldAppendActivity = false;
              toolCallIdToReplace = entry.tool_call_id;
            } else {
              seenToolCallIdsRef.current.add(entry.tool_call_id);
              if (seenToolCallIdsRef.current.size > MAX_TRACKED_TOOL_CALL_IDS) {
                const oldestId = seenToolCallIdsRef.current
                  .values()
                  .next().value;
                if (oldestId) {
                  seenToolCallIdsRef.current.delete(oldestId);
                }
              }
            }
          }

          if (shouldAppendActivity) {
            const timestampMs = normalizeEventTimestampMs(event.timestamp);
            const activityEntry: ActivityFeedEntry = {
              id: `activity-${timestampMs}-${activityEntryCounterRef.current++}`,
              agentId: event.agent_id,
              entry,
              timestampMs,
            };
            setRecentActivities((prev) => {
              const next = [...prev, activityEntry];
              return next.slice(-MAX_ACTIVITY_FEED_ITEMS);
            });
          } else if (toolCallIdToReplace) {
            const timestampMs = normalizeEventTimestampMs(event.timestamp);
            setRecentActivities((prev) => {
              const next = [...prev];
              for (let i = next.length - 1; i >= 0; i -= 1) {
                const activityEntry = next[i];
                if (
                  activityEntry.entry.type === "ToolCall" &&
                  activityEntry.entry.tool_call_id === toolCallIdToReplace
                ) {
                  next[i] = {
                    ...activityEntry,
                    entry,
                    timestampMs,
                  };
                  break;
                }
              }
              return next;
            });
          }
        }

        if (
          entry.type === "AssistantText" ||
          entry.type === "AssistantThinking"
        ) {
          setStreamingDeltas((prev) =>
            filterStreamingDeltas(
              prev,
              event.agent_id,
              (delta) =>
                delta.type !== "ContentDelta" && delta.type !== "ThinkingDelta",
            ),
          );
        } else if (
          entry.type === "ToolCall" &&
          entry.tool_call_id &&
          !entry.streaming
        ) {
          setStreamingDeltas((prev) =>
            filterStreamingDeltas(
              prev,
              event.agent_id,
              (delta) =>
                !(
                  delta.type === "ToolResultDelta" &&
                  delta.tool_call_id === entry.tool_call_id
                ),
            ),
          );
        } else if (
          (entry.type === "SentMessage" || entry.type === "ReceivedMessage") &&
          entry.message_id
        ) {
          setStreamingDeltas((prev) =>
            filterStreamingDeltas(prev, event.agent_id, (delta) => {
              if (delta.type === "SentMessageDelta") {
                return delta.message_id !== entry.message_id;
              }
              if (delta.type === "ReceivedMessageDelta") {
                return delta.message_id !== entry.message_id;
              }
              return true;
            }),
          );
        }

        setAgentHistories((prev) => {
          const next = new Map(prev);
          const existing = next.get(event.agent_id) ?? [];

          if (
            entry.type === "ToolCall" &&
            entry.tool_call_id &&
            !entry.streaming
          ) {
            const idx = existing.findIndex(
              (historyEntry) =>
                historyEntry.type === "ToolCall" &&
                historyEntry.tool_call_id === entry.tool_call_id &&
                historyEntry.streaming === true,
            );
            if (idx >= 0) {
              const updated = [...existing];
              updated[idx] = entry;
              next.set(event.agent_id, updated);
              return next;
            }
          }

          next.set(event.agent_id, [...existing, entry]);
          return next;
        });
      }
    },
    [agents, handleTabEvent, handleUpdateEvent],
  );

  const { connected } = useWebSocket({ onDisplayEvent, onUpdateEvent });

  const selectAgent = useCallback(
    (id: string | null) => {
      if (id) {
        const agent = agents.get(id);
        if (agent?.tab_id) {
          setSelectedTabId(agent.tab_id);
        }
      }
      setSelectedAgentId(id);
    },
    [agents],
  );

  const nodesValue = useMemo(
    () => ({
      agents,
    }),
    [agents],
  );

  const tabsValue = useMemo(
    () => ({
      tabs,
    }),
    [tabs],
  );

  const connectionValue = useMemo(
    () => ({
      connected,
    }),
    [connected],
  );

  const historyValue = useMemo(
    () => ({
      agentHistories,
      clearAgentHistory,
      clearHistorySnapshot,
      historyInvalidatedAt,
      historyClearedAt,
      historySnapshots,
      streamingDeltas,
    }),
    [
      agentHistories,
      clearAgentHistory,
      clearHistorySnapshot,
      historyInvalidatedAt,
      historyClearedAt,
      historySnapshots,
      streamingDeltas,
    ],
  );

  const activityValue = useMemo(
    () => ({
      activeMessages,
      activeToolCalls,
    }),
    [activeMessages, activeToolCalls],
  );

  const feedValue = useMemo(
    () => ({
      recentActivities,
    }),
    [recentActivities],
  );

  const uiValue = useMemo(
    () => ({
      selectedAgentId,
      selectAgent,
      hoveredAgentId,
      setHoveredAgentId,
      activeTabId,
      setActiveTabId: setSelectedTabId,
      currentPage,
      setCurrentPage,
    }),
    [selectedAgentId, selectAgent, hoveredAgentId, activeTabId, currentPage],
  );

  return (
    <AgentNodesContext.Provider value={nodesValue}>
      <AgentTabsContext.Provider value={tabsValue}>
        <AgentConnectionContext.Provider value={connectionValue}>
          <AgentHistoryContext.Provider value={historyValue}>
            <AgentActivityContext.Provider value={activityValue}>
              <AgentFeedContext.Provider value={feedValue}>
                <AgentUIContext.Provider value={uiValue}>
                  {children}
                </AgentUIContext.Provider>
              </AgentFeedContext.Provider>
            </AgentActivityContext.Provider>
          </AgentHistoryContext.Provider>
        </AgentConnectionContext.Provider>
      </AgentTabsContext.Provider>
    </AgentNodesContext.Provider>
  );
}

export function useAgentNodesRuntime() {
  const ctx = useContext(AgentNodesContext);
  if (!ctx) {
    throw new Error("useAgentNodesRuntime must be used within AgentProvider");
  }
  return ctx;
}

export function useAgentConnectionRuntime() {
  const ctx = useContext(AgentConnectionContext);
  if (!ctx) {
    throw new Error(
      "useAgentConnectionRuntime must be used within AgentProvider",
    );
  }
  return ctx;
}

export function useAgentTabsRuntime() {
  const ctx = useContext(AgentTabsContext);
  if (!ctx) {
    throw new Error("useAgentTabsRuntime must be used within AgentProvider");
  }
  return ctx;
}

export function useAgentHistoryRuntime() {
  const ctx = useContext(AgentHistoryContext);
  if (!ctx) {
    throw new Error("useAgentHistoryRuntime must be used within AgentProvider");
  }
  return ctx;
}

export function useAgentActivityRuntime() {
  const ctx = useContext(AgentActivityContext);
  if (!ctx) {
    throw new Error(
      "useAgentActivityRuntime must be used within AgentProvider",
    );
  }
  return ctx;
}

export function useAgentRuntime(): AgentRuntimeContextValue {
  const { agents } = useAgentNodesRuntime();
  const { tabs } = useAgentTabsRuntime();
  const { connected } = useAgentConnectionRuntime();
  const {
    agentHistories,
    clearAgentHistory,
    clearHistorySnapshot,
    historyInvalidatedAt,
    historyClearedAt,
    historySnapshots,
    streamingDeltas,
  } = useAgentHistoryRuntime();
  const { activeMessages, activeToolCalls } = useAgentActivityRuntime();

  return useMemo(
    () => ({
      agents,
      tabs,
      connected,
      agentHistories,
      clearAgentHistory,
      clearHistorySnapshot,
      historyInvalidatedAt,
      historyClearedAt,
      historySnapshots,
      streamingDeltas,
      activeMessages,
      activeToolCalls,
    }),
    [
      agents,
      tabs,
      connected,
      agentHistories,
      clearAgentHistory,
      clearHistorySnapshot,
      historyInvalidatedAt,
      historyClearedAt,
      historySnapshots,
      streamingDeltas,
      activeMessages,
      activeToolCalls,
    ],
  );
}

export function useAgentUI() {
  const ctx = useContext(AgentUIContext);
  if (!ctx) {
    throw new Error("useAgentUI must be used within AgentProvider");
  }
  return ctx;
}

export function useOptionalAgentUI() {
  return useContext(AgentUIContext);
}

export function useAgent() {
  const runtime = useAgentRuntime();
  const ui = useAgentUI();
  return useMemo(() => ({ ...runtime, ...ui }), [runtime, ui]);
}
