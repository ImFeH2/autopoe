import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui";
import {
  AgentRenameEditor,
  returnToAgentRenameEditor,
  shouldReturnToAgentRenameEditor,
} from "./agent-rename-editor";
import { agentRenameDisabledReason } from "./agent-rename-policy";

function render(status: "idle" | "running" | "pausing" | "paused" | "error") {
  return renderToStaticMarkup(
    <TooltipProvider>
      <AgentRenameEditor
        agent={{ id: 2, type: "agent", name: "Ada", status }}
        onRename={async () => undefined}
      />
    </TooltipProvider>,
  );
}

describe("AgentRenameEditor", () => {
  it("offers rename from an eligible Agent overview", () => {
    const markup = render("idle");

    expect(markup).toContain(">Rename</button>");
    expect(markup).not.toContain("fully paused before renaming");
    expect(markup).toContain('aria-live="polite"');
  });

  it("returns from confirmation to the focused input without changing the draft", () => {
    let confirming = true;
    const draft = "Grace";
    const focus = vi.fn();
    const select = vi.fn();
    let frame: FrameRequestCallback | undefined;

    returnToAgentRenameEditor(
      (next) => {
        confirming = next;
      },
      () => ({ focus, select }),
      (callback) => {
        frame = callback;
        return 1;
      },
    );

    expect(confirming).toBe(false);
    expect(draft).toBe("Grace");
    expect(focus).not.toHaveBeenCalled();
    frame?.(0);
    expect(focus).toHaveBeenCalledOnce();
    expect(select).toHaveBeenCalledOnce();
  });

  it("returns a busy confirmation to the focused draft with a readable reason", () => {
    let confirming = true;
    const draft = "Grace";
    const focus = vi.fn();
    const select = vi.fn();
    let frame: FrameRequestCallback | undefined;

    expect(shouldReturnToAgentRenameEditor(confirming, false, "running")).toBe(
      true,
    );
    returnToAgentRenameEditor(
      (next) => {
        confirming = next;
      },
      () => ({ focus, select }),
      (callback) => {
        frame = callback;
        return 1;
      },
    );
    frame?.(0);

    expect(confirming).toBe(false);
    expect(draft).toBe("Grace");
    expect(focus).toHaveBeenCalledOnce();
    expect(select).toHaveBeenCalledOnce();
    expect(agentRenameDisabledReason("running")).toContain("fully paused");
  });

  it.each(["running", "pausing"] as const)(
    "disables rename with a readable reason while %s",
    (status) => {
      const markup = render(status);

      expect(markup).toContain("disabled");
      expect(markup).toContain("fully paused before renaming");
      expect(markup).toContain(`agent-2-rename-reason`);
    },
  );
});
