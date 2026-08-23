import { describe, expect, it } from "vitest";
import {
  agentRenameConfirmationCopy,
  agentRenameDisabledReason,
  agentRenameInlineError,
  agentRenameSuccessCopy,
  canRenameAgent,
  hasAgentRenameBoundaryWhitespace,
  isCaseOnlyAgentRenameHint,
} from "./agent-rename-policy";

describe("agent rename policy", () => {
  it.each(["idle", "paused", "error"] as const)(
    "allows renaming an Agent whose status is %s",
    (status) => {
      expect(canRenameAgent(status)).toBe(true);
      expect(agentRenameDisabledReason(status)).toBeNull();
    },
  );

  it("blocks a running Agent with an actionable reason", () => {
    expect(canRenameAgent("running")).toBe(false);
    expect(agentRenameDisabledReason("running")).toContain("run to finish");
    expect(agentRenameDisabledReason("running")).toContain("fully paused");
  });

  it("blocks a pausing Agent until it is fully paused", () => {
    expect(canRenameAgent("pausing")).toBe(false);
    expect(agentRenameDisabledReason("pausing")).toBe(
      "Wait until this Agent is fully paused before renaming.",
    );
  });

  it("explains the rename confirmation boundaries", () => {
    expect(agentRenameConfirmationCopy("Ada", "Grace")).toEqual({
      title: "Rename Ada to Grace?",
      description:
        "Existing structured @ mentions will display the new name. The Member identity, message text, and notification history will not change.",
    });
  });

  it("provides concise visible and assistive success copy", () => {
    expect(agentRenameSuccessCopy("Ada", "Grace")).toEqual({
      message: "Renamed Ada to Grace.",
      announcement: "Agent Ada was renamed to Grace.",
    });
  });

  it.each([
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
  ])("maps %s to a user-facing inline error", (code, message) => {
    expect(agentRenameInlineError(code)).toBe(message);
  });

  it("does not expose an unknown backend error code", () => {
    const internalCode = "database_constraint_internal_42";
    const message = agentRenameInlineError(internalCode);

    expect(message).toBe("Couldn't rename this Agent. Try again.");
    expect(message).not.toContain(internalCode);
  });

  it("reports boundary whitespace without changing the draft", () => {
    const drafts = [" Ada", "Ada ", "\tAda", "Ada\n"];
    const originalDrafts = [...drafts];

    for (const draft of drafts) {
      expect(hasAgentRenameBoundaryWhitespace(draft)).toBe(true);
    }
    expect(drafts).toEqual(originalDrafts);
    expect(hasAgentRenameBoundaryWhitespace("Ada")).toBe(false);
    expect(hasAgentRenameBoundaryWhitespace("Ada Lovelace")).toBe(false);
    expect(hasAgentRenameBoundaryWhitespace("")).toBe(false);
  });

  it("treats case-only detection as a non-validating UI hint", () => {
    expect(isCaseOnlyAgentRenameHint("Ada", "ADA")).toBe(true);
    expect(isCaseOnlyAgentRenameHint("Straße", "STRASSE")).toBe(true);
    expect(isCaseOnlyAgentRenameHint("Ada", "Ada")).toBe(false);
    expect(isCaseOnlyAgentRenameHint("Ada", "Grace")).toBe(false);
    expect(isCaseOnlyAgentRenameHint(" Ada", "ADA")).toBe(false);
  });
});
