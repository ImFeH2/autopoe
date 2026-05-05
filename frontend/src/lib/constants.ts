import {
  Bot,
  Code2,
  GitBranch,
  Merge,
  Play,
  Shield,
  Sparkles,
} from "lucide-react";
import { type AgentState, type NodeType } from "@/types";

export const nodeTypeIcon = {
  assistant: Shield,
  agent: Bot,
  trigger: Play,
  llm: Sparkles,
  code: Code2,
  if: GitBranch,
  merge: Merge,
} as const;

export function getNodeLabel({
  name,
  roleName,
  nodeType,
  isLeader = false,
}: {
  name: string | null;
  roleName: string | null;
  nodeType: NodeType;
  isLeader?: boolean;
}): string {
  return (
    name ??
    roleName ??
    (nodeType === "assistant"
      ? "Assistant"
      : nodeType === "trigger"
        ? "Trigger"
        : nodeType === "llm"
          ? "Model"
          : nodeType === "code"
            ? "Code"
            : nodeType === "if"
              ? "If"
              : nodeType === "merge"
                ? "Merge"
                : isLeader
                  ? "Leader"
                  : "Agent")
  );
}

export const stateColor: Record<AgentState, string> = {
  running: "bg-graph-status-running",
  idle: "bg-graph-status-idle",
  sleeping: "bg-graph-status-sleeping",
  initializing: "bg-graph-status-initializing",
  error: "bg-graph-status-error",
  terminated: "bg-graph-status-terminated",
};

export const stateBadgeColor: Record<AgentState, string> = {
  running:
    "border-graph-status-running/18 bg-graph-status-running/[0.12] text-graph-status-running",
  idle: "border-graph-status-idle/10 bg-graph-status-idle/[0.04] text-graph-status-idle/72",
  sleeping:
    "border-graph-status-sleeping/18 bg-graph-status-sleeping/[0.12] text-graph-status-sleeping",
  initializing:
    "border-graph-status-initializing/14 bg-graph-status-initializing/[0.07] text-graph-status-initializing/84",
  error:
    "border-graph-status-error/20 bg-graph-status-error/[0.09] text-graph-status-error",
  terminated: "border-border bg-accent/35 text-muted-foreground",
};

export const stateRing: Record<AgentState, string> = {
  running: "agent-state-ring-running",
  idle: "agent-state-ring-idle",
  sleeping: "agent-state-ring-sleeping",
  initializing: "agent-state-ring-initializing",
  error: "agent-state-ring-error",
  terminated: "agent-state-ring-terminated",
};
