import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { motion } from "motion/react";
import { useRef, type CSSProperties } from "react";
import { cn } from "@/lib/utils";
import { nodeTypeIcon, stateColor, stateRing } from "@/lib/constants";
import {
  NODE_BODY_SOURCE_HANDLE,
  NODE_BODY_TARGET_HANDLE,
} from "@/components/agent-graph/lib";
import type { AgentState, NodeType, WorkflowPort } from "@/types";

interface AgentNodeData {
  label: string;
  width: number;
  node_type: NodeType;
  is_leader: boolean;
  state: AgentState;
  shortId: string;
  name: string | null;
  role_name: string | null;
  latestTodo: string | null;
  selected: boolean;
  toolCall: string | null;
  leaving: boolean;
  canConnect: boolean;
  showConnectionEntryHint: boolean;
  connectionState?: "source" | "valid-target" | "invalid-target" | null;
  inputPorts: WorkflowPort[];
  outputPorts: WorkflowPort[];
  [key: string]: unknown;
}

const nodeStateBorderClass: Record<AgentState, string> = {
  running: "border-graph-status-running/28",
  idle: "border-graph-node-border",
  sleeping: "border-graph-status-sleeping/26",
  initializing: "border-border border-dashed",
  error: "border-graph-status-error/28 border-double",
  terminated: "border-border/70",
};

function getNodeIconClass(nodeType: NodeType, isLeader = false): string {
  if (nodeType === "assistant") {
    return "rounded-sm border-graph-node-border bg-accent/60 text-foreground";
  }

  return cn(
    "rounded-sm border-graph-node-border bg-surface-3",
    isLeader ? "text-primary" : "text-foreground/80",
  );
}

export const AgentNode = memo(function AgentNode({ data }: NodeProps) {
  const {
    label,
    node_type,
    is_leader,
    state,
    latestTodo,
    selected,
    toolCall,
    canConnect,
    showConnectionEntryHint,
    connectionState,
    inputPorts,
    outputPorts,
  } = data as unknown as AgentNodeData;
  const leaving = Boolean((data as AgentNodeData).leaving);
  const Icon = nodeTypeIcon[node_type];
  const nodeRef = useRef<HTMLDivElement>(null);

  const updateMouseEffect = (clientX: number, clientY: number) => {
    if (!nodeRef.current) return;
    const rect = nodeRef.current.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const dx = clientX - centerX;
    const dy = clientY - centerY;
    const distance = Math.sqrt(dx * dx + dy * dy);
    const intensity = Math.max(0, 1 - distance / 240);
    const angle = (Math.atan2(dy, dx) * 180) / Math.PI + 90;

    nodeRef.current.style.setProperty("--mouse-angle", `${angle}deg`);
    nodeRef.current.style.setProperty(
      "--mouse-intensity",
      intensity.toString(),
    );
  };

  const resetMouseEffect = () => {
    if (!nodeRef.current) return;
    nodeRef.current.style.setProperty("--mouse-angle", "135deg");
    nodeRef.current.style.setProperty("--mouse-intensity", "0");
  };

  const isToolActive = !!toolCall;
  const isRunning = state === "running";

  const baseBorder = isToolActive
    ? "border-graph-attention/70"
    : nodeStateBorderClass[state];

  const borderClass = selected
    ? "ring-1 ring-graph-selection/25 border-graph-selection/80"
    : cn(baseBorder, "hover:border-graph-node-border-hover");
  const connectionClass =
    connectionState === "source"
      ? "ring-2 ring-graph-selection/35 border-graph-selection/90"
      : connectionState === "valid-target"
        ? "border-graph-selection/55 ring-1 ring-graph-selection/20"
        : connectionState === "invalid-target"
          ? "opacity-45"
          : "";
  const showConnectionEntry =
    showConnectionEntryHint || connectionState === "source";
  const bodySourceActive = canConnect && connectionState === null;
  const bodyTargetActive =
    canConnect &&
    (connectionState === "valid-target" ||
      connectionState === "invalid-target");
  const connectionEntryClass =
    connectionState === "source"
      ? "border-graph-selection/75 bg-graph-selection/14"
      : connectionState === "valid-target"
        ? "border-graph-selection/45 bg-graph-selection/10"
        : connectionState === "invalid-target"
          ? "border-graph-node-border bg-graph-node-bg/50"
          : "border-graph-node-border bg-graph-node-bg/72";

  return (
    <motion.div
      ref={nodeRef}
      initial={{ opacity: 0, scale: 0.92, filter: "blur(6px) grayscale(0%)" }}
      animate={{
        opacity: leaving ? 0 : state === "terminated" ? 0.4 : 1,
        scale: leaving ? 0.9 : 1,
        y: leaving ? 8 : 0,
        filter: leaving
          ? "blur(8px) grayscale(100%)"
          : state === "terminated"
            ? "blur(0px) grayscale(100%)"
            : "blur(0px) grayscale(0%)",
      }}
      transition={{ duration: leaving ? 0.28 : 0.35, ease: [0.23, 1, 0.32, 1] }}
      onMouseEnter={(event) => updateMouseEffect(event.clientX, event.clientY)}
      onMouseMove={(event) => updateMouseEffect(event.clientX, event.clientY)}
      onMouseLeave={resetMouseEffect}
      className={cn(
        "relative isolate flex h-14 w-max min-w-[100px] max-w-[300px] items-center gap-2 overflow-visible rounded-[10px] border px-2.5 py-2.5",
        "bg-graph-node-bg",
        "transition-[border-color] duration-300",
        leaving && "pointer-events-none",
        borderClass,
        connectionClass,
      )}
      style={
        {
          "--mouse-angle": "135deg",
          "--mouse-intensity": "0",
        } as CSSProperties
      }
    >
      <div
        aria-hidden="true"
        className={cn("agent-state-ring", stateRing[state])}
      />
      <div
        aria-hidden="true"
        className={cn(
          "agent-loading-border",
          isRunning && "agent-loading-border-active",
        )}
      />

      {inputPorts.map((port, index) => (
        <Handle
          key={`input-${port.key}`}
          id={port.key}
          type="target"
          position={Position.Left}
          isConnectable={canConnect}
          isConnectableEnd={canConnect}
          className={cn(
            "!z-10 !h-[72%] !w-5 !-translate-y-1/2 !border-0 !bg-transparent !opacity-0 after:absolute after:-inset-3 after:content-['']",
          )}
          style={{
            top: `${((index + 1) * 100) / (inputPorts.length + 1)}%`,
          }}
        />
      ))}
      {outputPorts.map((port, index) => (
        <Handle
          key={`output-${port.key}`}
          id={port.key}
          type="source"
          position={Position.Right}
          isConnectable={canConnect}
          isConnectableStart={canConnect}
          className={cn(
            "!z-10 !h-[72%] !w-5 !-translate-y-1/2 !border-0 !bg-transparent !opacity-0 after:absolute after:-inset-3 after:content-['']",
          )}
          style={{
            top: `${((index + 1) * 100) / (outputPorts.length + 1)}%`,
          }}
        />
      ))}

      <Handle
        id={NODE_BODY_SOURCE_HANDLE}
        type="source"
        position={Position.Right}
        isConnectable={canConnect}
        isConnectableStart={canConnect}
        isConnectableEnd={false}
        className={cn(
          "!absolute !h-full !w-full !border-0 !bg-transparent !opacity-0",
          bodySourceActive
            ? "!z-30 !pointer-events-auto"
            : "!z-0 !pointer-events-none",
        )}
        style={{
          left: 0,
          top: 0,
          right: "auto",
          bottom: "auto",
          transform: "none",
        }}
      />
      <Handle
        id={NODE_BODY_TARGET_HANDLE}
        type="target"
        position={Position.Left}
        isConnectable={canConnect}
        isConnectableStart={false}
        isConnectableEnd={canConnect}
        className={cn(
          "!absolute !h-full !w-full !border-0 !bg-transparent !opacity-0",
          bodyTargetActive
            ? "!z-30 !pointer-events-auto"
            : "!z-0 !pointer-events-none",
        )}
        style={{
          left: 0,
          top: 0,
          right: "auto",
          bottom: "auto",
          transform: "none",
        }}
      />

      {showConnectionEntry
        ? [
            <div
              key="left-entry"
              aria-hidden="true"
              data-testid="connection-entry-left"
              className={cn(
                "pointer-events-none absolute top-1/2 z-10 h-[72%] w-2.5 -translate-y-1/2 rounded-full border transition-[opacity,transform] duration-150",
                "-left-1.5",
                connectionEntryClass,
              )}
            />,
            <div
              key="right-entry"
              aria-hidden="true"
              data-testid="connection-entry-right"
              className={cn(
                "pointer-events-none absolute top-1/2 z-10 h-[72%] w-2.5 -translate-y-1/2 rounded-full border transition-[opacity,transform] duration-150",
                "-right-1.5",
                connectionEntryClass,
              )}
            />,
          ]
        : null}

      <div
        className={cn(
          "relative z-10 flex size-8 shrink-0 items-center justify-center border",
          getNodeIconClass(node_type, is_leader),
        )}
      >
        <Icon className="size-4.5" />
      </div>

      <div className="relative z-10 flex min-w-0 flex-1 items-center justify-between gap-2">
        <span
          className="truncate text-[13px] font-semibold text-foreground -translate-y-[0.7px]"
          title={latestTodo ?? undefined}
        >
          {label}
        </span>

        <div
          className="relative flex items-center pr-0.5"
          title={isToolActive ? "Active" : state}
        >
          <span className="relative flex size-2.5">
            {(isRunning || isToolActive) && (
              <span
                className={cn(
                  "absolute inline-flex size-full animate-ping rounded-full opacity-40",
                  isToolActive ? "bg-graph-attention" : stateColor[state],
                )}
              />
            )}
            <span
              className={cn(
                "relative inline-flex size-2.5 rounded-full border border-card",
                isToolActive ? "bg-graph-attention" : stateColor[state],
              )}
            />
          </span>
        </div>
      </div>

      {isToolActive && (
        <motion.div
          initial={{ opacity: 0, y: 5 }}
          animate={{ opacity: 1, y: 0 }}
          className="absolute -bottom-6 left-1/2 z-20 -translate-x-1/2 whitespace-nowrap"
        >
          <span className="rounded-sm border border-graph-attention/24 bg-surface-2/92 px-1.5 py-0.5 text-[9px] font-mono text-graph-attention-text backdrop-blur-sm">
            {toolCall}
          </span>
        </motion.div>
      )}
    </motion.div>
  );
});
