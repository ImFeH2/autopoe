import type { AgentMember } from "@/lib/backend";

type AgentStatus = AgentMember["status"];

const BUSY_REASONS: Partial<Record<AgentStatus, string>> = {
  running:
    "Wait for this Agent's run to finish, or pause it and wait until it is fully paused before renaming.",
  pausing: "Wait until this Agent is fully paused before renaming.",
};

const INLINE_ERROR_MESSAGES = new Map<string, string>([
  ["duplicate_name", "An active Organization member already uses that name."],
  [
    "invalid_name",
    "Enter a valid mention-safe name without leading or trailing whitespace.",
  ],
  [
    "agent_busy",
    "This Agent is running or pausing. Wait for the run to finish or until the Agent is fully paused, then try again.",
  ],
  ["member_deleted", "Deleted Agents cannot be renamed."],
]);

const UNKNOWN_INLINE_ERROR = "Couldn't rename this Agent. Try again.";

export function canRenameAgent(status: AgentStatus): boolean {
  return status !== "running" && status !== "pausing";
}

export function agentRenameDisabledReason(status: AgentStatus): string | null {
  return BUSY_REASONS[status] ?? null;
}

export function agentRenameConfirmationCopy(
  currentName: string,
  nextName: string,
) {
  return {
    title: `Rename ${currentName} to ${nextName}?`,
    description:
      "Existing structured @ mentions will display the new name. The Member identity, message text, and notification history will not change.",
  };
}

export function agentRenameSuccessCopy(currentName: string, nextName: string) {
  return {
    message: `Renamed ${currentName} to ${nextName}.`,
    announcement: `Agent ${currentName} was renamed to ${nextName}.`,
  };
}

export function agentRenameInlineError(
  code: string,
  lengthError?: string | null,
): string {
  return lengthError ?? INLINE_ERROR_MESSAGES.get(code) ?? UNKNOWN_INLINE_ERROR;
}

export function hasAgentRenameBoundaryWhitespace(name: string): boolean {
  return name.trim() !== name;
}

/**
 * Advisory UI hint only. The backend remains authoritative for normalized
 * equality, mention-safe validity, and Organization-wide uniqueness.
 */
export function isCaseOnlyAgentRenameHint(
  currentName: string,
  nextName: string,
): boolean {
  if (currentName === nextName) {
    return false;
  }
  return (
    currentName.toLowerCase() === nextName.toLowerCase() ||
    currentName.toUpperCase() === nextName.toUpperCase()
  );
}
