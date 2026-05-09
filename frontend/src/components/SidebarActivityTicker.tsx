import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useAgentNodesRuntime } from "@/context/AgentContext";
import { useAgentFeedRuntime } from "@/context/AgentFeedContext";
import { getNodeLabel } from "@/lib/nodeLabel";
import { cn } from "@/lib/utils";
import type { HistoryEntry, Node } from "@/types";

const RECENT_ACTIVITY_WINDOW_MS = 8000;
const MAX_VISIBLE_ACTIVITY_ITEMS = 24;
const LABEL_FONT_SIZE =
  "clamp(9.5px, calc(9.5px + (var(--sidebar-activity-width) - 180px) * 0.003636), 10.3px)";
const TICKER_FONT_SIZE =
  "clamp(10px, calc(10px + (var(--sidebar-activity-width) - 180px) * 0.002273), 10.6px)";
const ROW_HEIGHT =
  "clamp(20px, calc(20px + (var(--sidebar-activity-width) - 180px) * 0.016364), 24px)";
const ITEM_GAP =
  "clamp(7px, calc(7px + (var(--sidebar-activity-width) - 180px) * 0.013636), 10px)";
const EVENT_DOT_SIZE =
  "clamp(4px, calc(4px + (var(--sidebar-activity-width) - 180px) * 0.004545), 5px)";

type ActivityTone = "active" | "quiet" | "alert" | "thinking";

interface ActivityTickerItem {
  id: string;
  text: string;
  tone: ActivityTone;
}

interface SidebarActivityTickerProps {
  width: number;
}

function buildTickerItem(
  agentId: string,
  entry: HistoryEntry,
  agents: Map<string, Node>,
  labelMaxLength: number,
  toolMaxLength: number,
): ActivityTickerItem | null {
  const agentLabel = getNodeLabel(agentId, agents, labelMaxLength);

  switch (entry.type) {
    case "ReceivedMessage": {
      const fromLabel =
        entry.from_id === "human"
          ? "Human"
          : getNodeLabel(entry.from_id ?? "unknown", agents, labelMaxLength);
      return {
        id: `${agentId}-${entry.timestamp}-received-${entry.from_id ?? "unknown"}`,
        text: `${agentLabel} <- ${fromLabel}`,
        tone: "active",
      };
    }
    case "AssistantText":
      return {
        id: `${agentId}-${entry.timestamp}-text`,
        text: `${agentLabel} replied`,
        tone: "active",
      };
    case "SentMessage": {
      const targetIds =
        entry.to_id != null
          ? [entry.to_id]
          : (entry.to_ids ?? []).filter((toId): toId is string =>
              Boolean(toId),
            );
      const targetLabels = targetIds.map((toId) =>
        getNodeLabel(toId, agents, labelMaxLength),
      );
      return {
        id: `${agentId}-${entry.timestamp}-sent-${targetIds.join(",")}`,
        text: `${agentLabel} -> ${targetLabels.join(", ") || "unknown"}`,
        tone: "active",
      };
    }
    case "AssistantThinking":
      return {
        id: `${agentId}-${entry.timestamp}-thinking`,
        text: `${agentLabel} thinking`,
        tone: "thinking",
      };
    case "ToolCall": {
      const toolName = entry.tool_name ?? "tool";
      const toolLabel =
        toolName.length > toolMaxLength
          ? `${toolName.slice(0, Math.max(0, toolMaxLength - 3))}...`
          : toolName;
      if (toolName === "idle") {
        const resultLabel =
          typeof entry.result === "string" && entry.result.trim()
            ? entry.result.trim()
            : "idle";
        return {
          id: `${agentId}-${entry.timestamp}-idle`,
          text: `${agentLabel} ${resultLabel}`,
          tone: "quiet",
        };
      }
      if (toolName === "sleep") {
        const resultLabel =
          typeof entry.result === "string" && entry.result.trim()
            ? entry.result.trim()
            : "sleep";
        return {
          id: `${agentId}-${entry.timestamp}-sleep`,
          text: `${agentLabel} ${resultLabel}`,
          tone: "quiet",
        };
      }
      if (toolName === "todo") {
        const todos = Array.isArray(entry.arguments?.todos)
          ? (entry.arguments?.todos as unknown[])
          : [];
        const count = todos.length;
        return {
          id: `${agentId}-${entry.timestamp}-todo-${count}`,
          text:
            count > 0
              ? `${agentLabel} todo x${count}`
              : `${agentLabel} todo clear`,
          tone: count > 0 ? "active" : "quiet",
        };
      }
      return {
        id: `${agentId}-${entry.timestamp}-tool-${toolName}`,
        text: `${agentLabel} · ${toolLabel}`,
        tone: "active",
      };
    }
    case "ErrorEntry":
      return {
        id: `${agentId}-${entry.timestamp}-error`,
        text: `${agentLabel} error`,
        tone: "alert",
      };
    default:
      return null;
  }
}

export function SidebarActivityTicker({ width }: SidebarActivityTickerProps) {
  const { agents } = useAgentNodesRuntime();
  const { recentActivities } = useAgentFeedRuntime();
  const [now, setNow] = useState(() => Date.now());
  const labelMaxLength = width < 220 ? 12 : width < 280 ? 16 : 22;
  const toolMaxLength = width < 220 ? 10 : width < 280 ? 14 : 18;
  const responsiveStyles = {
    "--sidebar-activity-width": `${width}px`,
  } as CSSProperties;

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => {
      window.clearInterval(timer);
    };
  }, []);

  const items = useMemo(
    () =>
      recentActivities
        .slice(-MAX_VISIBLE_ACTIVITY_ITEMS)
        .map((activity) =>
          buildTickerItem(
            activity.agentId,
            activity.entry,
            agents,
            labelMaxLength,
            toolMaxLength,
          ),
        )
        .filter((item): item is ActivityTickerItem => item !== null),
    [agents, labelMaxLength, recentActivities, toolMaxLength],
  );

  const recentBurstCount = useMemo(
    () =>
      recentActivities.filter(
        (entry) => now - entry.timestampMs <= RECENT_ACTIVITY_WINDOW_MS,
      ).length,
    [now, recentActivities],
  );

  const currentItem = items[items.length - 1] ?? null;

  return (
    <div
      className="flex items-center gap-2.5 overflow-hidden"
      style={responsiveStyles}
    >
      <div className="flex shrink-0 items-center gap-2 text-[10px] font-semibold text-muted-foreground/76">
        <span
          className={cn(
            "size-1.5 rounded-full transition-all duration-300",
            recentBurstCount > 0
              ? "bg-graph-status-idle shadow-[0_0_10px_var(--graph-status-idle)]"
              : "bg-graph-status-idle/20",
          )}
        />
        <span style={{ fontSize: LABEL_FONT_SIZE }}>Live</span>
      </div>

      <div className="min-w-0 flex-1 overflow-hidden">
        {!currentItem ? (
          <div
            className="flex min-w-0 items-center text-muted-foreground/82"
            style={{
              height: ROW_HEIGHT,
              fontSize: TICKER_FONT_SIZE,
            }}
          >
            <span className="block truncate">Waiting for agent activity</span>
          </div>
        ) : (
          <div
            className="relative min-w-0 overflow-hidden"
            style={{
              height: ROW_HEIGHT,
            }}
          >
            <AnimatePresence initial={false}>
              <motion.div
                key={currentItem.id}
                initial={{ y: 16, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: -16, opacity: 0 }}
                transition={{
                  duration: 0.24,
                  ease: [0.22, 1, 0.36, 1],
                }}
                className="absolute inset-0 flex min-w-0 items-center text-muted-foreground/92"
                style={{
                  fontSize: TICKER_FONT_SIZE,
                  gap: ITEM_GAP,
                }}
              >
                <span
                  className={cn(
                    "shrink-0 rounded-full",
                    currentItem.tone === "alert"
                      ? "bg-graph-status-error/94"
                      : currentItem.tone === "thinking"
                        ? "bg-graph-status-initializing/62"
                        : currentItem.tone === "active"
                          ? "bg-graph-status-running/80"
                          : "bg-muted-foreground/30",
                  )}
                  style={{
                    width: EVENT_DOT_SIZE,
                    height: EVENT_DOT_SIZE,
                  }}
                />
                <span className="block min-w-0 truncate">
                  {currentItem.text}
                </span>
              </motion.div>
            </AnimatePresence>
          </div>
        )}
      </div>
    </div>
  );
}
