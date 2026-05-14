import type { CSSProperties, RefObject } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Badge } from "@/components/ui/badge";
import { ViewportPortal } from "@/components/ViewportPortal";
import { getNodeLabel } from "@/lib/constants";
import type { AgentState, Node } from "@/types";

const tooltipStateBadgeClass: Record<AgentState, string> = {
  running:
    "border-graph-status-running/18 bg-graph-status-running/[0.12] text-graph-status-running",
  idle: "border-graph-status-idle/12 bg-graph-status-idle/[0.06] text-graph-status-idle/78",
  sleeping:
    "border-graph-status-sleeping/18 bg-graph-status-sleeping/[0.12] text-graph-status-sleeping",
  initializing:
    "border-graph-status-initializing/16 bg-graph-status-initializing/[0.08] text-graph-status-initializing/84",
  error:
    "border-graph-status-error/20 bg-graph-status-error/[0.09] text-graph-status-error",
  terminated: "border-border bg-accent/35 text-muted-foreground",
};

interface AgentTooltipProps {
  agent: Node | null;
  agentId: string | null;
  activeToolCall: string | null;
  style?: CSSProperties;
  tooltipRef: RefObject<HTMLDivElement | null>;
}

export function AgentTooltip({
  agent,
  agentId,
  activeToolCall,
  style,
  tooltipRef,
}: AgentTooltipProps) {
  const label = agent
    ? getNodeLabel({
        name: agent.name,
        roleName: agent.role_name,
        nodeType: agent.node_type,
        isLeader: agent.is_leader,
      })
    : null;

  return (
    <ViewportPortal>
      <AnimatePresence>
        {agent && agentId && label ? (
          <motion.div
            ref={tooltipRef}
            initial={{ opacity: 0, y: 4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 2, scale: 0.98 }}
            transition={{ duration: 0.15 }}
            className="pointer-events-none fixed z-[100] max-w-[320px] rounded-md border border-border bg-popover px-2 py-1 text-popover-foreground"
            style={style}
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[11px] font-medium">{label}</span>
              <Badge
                variant="outline"
                className={`text-[10px] ${tooltipStateBadgeClass[agent.state]}`}
              >
                {agent.state.toUpperCase()}
              </Badge>
              {agent.role_name ? (
                <Badge variant="outline" className="text-[10px]">
                  {agent.role_name}
                </Badge>
              ) : null}
              {agent.is_leader ? (
                <Badge
                  variant="outline"
                  className="border-accent bg-accent/45 text-[10px] text-accent-foreground"
                >
                  Leader
                </Badge>
              ) : null}
            </div>
            <div className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 text-[10px] text-muted-foreground">
              <span>ID</span>
              <span className="font-mono text-foreground/80">
                {agentId.slice(0, 8)}
              </span>
              <span>Connections</span>
              <span className="text-foreground/80">
                {agent.connections.length}
              </span>
              <span>Workflow</span>
              <span className="font-mono text-foreground/80">
                {agent.tab_id?.slice(0, 8) ?? "—"}
              </span>
              {activeToolCall ? (
                <>
                  <span>Tool</span>
                  <span className="font-mono text-foreground/80">
                    {activeToolCall}
                  </span>
                </>
              ) : null}
            </div>
            <div className="mt-1.5 space-y-1">
              <div className="text-[10px] font-medium text-muted-foreground">
                Todos
              </div>
              {agent.todos.length === 0 ? (
                <div className="text-[11px] text-muted-foreground">
                  No todos
                </div>
              ) : (
                <div className="space-y-1">
                  {agent.todos
                    .slice(Math.max(agent.todos.length - 3, 0))
                    .reverse()
                    .map((todo) => (
                      <div
                        key={`${agentId}-${todo.text}`}
                        className="text-[11px] leading-relaxed text-foreground/85"
                      >
                        {todo.text}
                      </div>
                    ))}
                  {agent.todos.length > 3 ? (
                    <div className="text-[10px] text-muted-foreground">
                      +{agent.todos.length - 3} more
                    </div>
                  ) : null}
                </div>
              )}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </ViewportPortal>
  );
}
