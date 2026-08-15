import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ComponentLab } from "@/component-lab/component-lab";
import { TooltipProvider } from "@/components/ui";

describe("ComponentLab", () => {
  it("renders production component families and states", () => {
    const markup = renderToStaticMarkup(
      <TooltipProvider>
        <ComponentLab />
      </TooltipProvider>,
    );

    for (const section of [
      "Actions",
      "Inputs",
      "Selection and status",
      "Lists",
      "Overlays",
      "Layout",
    ]) {
      expect(markup).toContain(`>${section}<`);
    }
    expect(markup).toContain("ui-button--primary");
    expect(markup).toContain("ui-segmented-control");
    expect(markup).toContain("ui-list-button");
    expect(markup).toContain("ui-menu-option");
    expect(markup).toContain("app-sidebar");
    expect(markup).toContain("disabled");
  });
});
