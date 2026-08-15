import type { AgentMember } from "@/lib/backend";

export function agentStatusTone(status: AgentMember["status"]) {
  if (status === "error") {
    return "danger" as const;
  }
  if (status === "running") {
    return "accent" as const;
  }
  return "success" as const;
}
