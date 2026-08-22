import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  getMemberStatusPresentation,
  MemberStatusAvatar,
} from "./member-status-avatar";

function render(
  status: string | null | undefined,
  variant: "member" | "message" = "member",
) {
  return renderToStaticMarkup(
    <MemberStatusAvatar
      name="Ada Lovelace"
      status={status}
      variant={variant}
    />,
  );
}

describe("getMemberStatusPresentation", () => {
  it("owns the pausing to running normalization and four presentations", () => {
    expect(getMemberStatusPresentation("pausing")).toEqual({
      label: "Running",
      shape: "ring",
      status: "running",
    });
    expect(getMemberStatusPresentation("running")?.label).toBe("Running");
    expect(getMemberStatusPresentation("idle")?.shape).toBe("dot");
    expect(getMemberStatusPresentation("paused")?.shape).toBe("pause");
    expect(getMemberStatusPresentation("error")?.shape).toBe("diamond");
  });

  it("fails closed for human, missing, and unknown statuses", () => {
    expect(getMemberStatusPresentation(null)).toBeNull();
    expect(getMemberStatusPresentation(undefined)).toBeNull();
    expect(getMemberStatusPresentation("human")).toBeNull();
    expect(getMemberStatusPresentation("future-status")).toBeNull();
  });
});

describe("MemberStatusAvatar", () => {
  it.each([
    ["running", "Running", "ring"],
    ["idle", "Idle", "dot"],
    ["paused", "Paused", "pause"],
    ["error", "Error", "diamond"],
  ])("renders %s with a label and non-color shape", (status, label, shape) => {
    const markup = render(status);

    expect(markup).toContain(`aria-label="Ada Lovelace, ${label}"`);
    expect(markup).toContain(`data-status-label="${label}"`);
    expect(markup).toContain(`data-status-shape="${shape}"`);
    expect(markup).toContain(`>${label}</span>`);
  });

  it("keeps the message variant compact, semantic, and non-interactive", () => {
    const markup = render("pausing", "message");

    expect(markup).toContain("member-status-avatar--message");
    expect(markup).toContain('data-member-status="running"');
    expect(markup).toContain('aria-hidden="true"');
    expect(markup).not.toContain("aria-label=");
    expect(markup).not.toContain('role="img"');
    expect(markup).not.toContain("tabindex=");
    expect(markup).not.toContain("aria-live=");
    expect(markup).not.toContain("member-status-avatar__label");
  });

  it("renders identity without a fabricated status for humans or unknowns", () => {
    const human = render(undefined, "message");
    const unknown = render("future-status", "message");

    for (const markup of [human, unknown]) {
      expect(markup).toContain('aria-hidden="true"');
      expect(markup).toContain('data-member-status="none"');
      expect(markup).not.toContain("aria-label=");
      expect(markup).not.toContain('role="img"');
      expect(markup).not.toContain("member-status-avatar__mark");
      expect(markup).not.toContain("data-status-label");
    }
  });

  it("uses fixed message geometry and static reduced-motion status shapes", () => {
    const styles = readFileSync(
      new URL("./member-status-avatar.css", import.meta.url),
      "utf8",
    );

    expect(styles).toMatch(
      /\.member-status-avatar--message\s*\{[^}]*width:\s*24px;[^}]*height:\s*24px;[^}]*flex:\s*0 0 24px;/su,
    );
    expect(styles).toContain("member-status-avatar__mark--ring");
    expect(styles).toContain("member-status-avatar__mark--dot");
    expect(styles).toContain("member-status-avatar__mark--pause");
    expect(styles).toContain("member-status-avatar__mark--diamond");
    expect(styles).toMatch(/@media \(prefers-reduced-motion: reduce\)/u);
    expect(styles).toMatch(/animation:\s*none;/u);
  });
});
