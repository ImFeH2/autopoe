import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TooltipProvider } from "@/components/ui";
import { AgentRenameEditor } from "./agent-rename-editor";

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
