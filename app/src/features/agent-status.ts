import type { AgentMember } from "@/lib/backend";

export function agentStatusTone(status: AgentMember["status"]) {
  if (status === "error") {
    return "danger" as const;
  }
  if (status === "running" || status === "pausing") {
    return "accent" as const;
  }
  if (status === "paused") {
    return "neutral" as const;
  }
  return "success" as const;
}
