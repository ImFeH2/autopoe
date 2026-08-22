import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const styles = readFileSync(new URL("./members.css", import.meta.url), "utf8");
const membersPage = readFileSync(
  new URL("./members-page.tsx", import.meta.url),
  "utf8",
);

function rule(selector: string) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const match = styles.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, "u"));
  expect(match, `${selector} should have a CSS rule`).not.toBeNull();
  return match?.[1] ?? "";
}

describe("Agent details layout contracts", () => {
  it("fills the History panel while keeping the viewport as its scroll owner", () => {
    expect(rule(".agent-history")).toMatch(/height:\s*100%;/u);
    expect(rule(".agent-history")).toMatch(
      /grid-template-rows:\s*auto minmax\(0, 1fr\);/u,
    );
    expect(rule(".agent-history-viewport")).toMatch(/overflow-y:\s*auto;/u);
    expect(rule(".agent-history-viewport:focus-visible")).toMatch(
      /outline:\s*2px solid var\(--color-accent\);/u,
    );
    expect(rule(".agent-history-viewport:focus-visible")).toMatch(
      /outline-offset:\s*-2px;/u,
    );
    expect(rule(".member-detail-body")).toMatch(/overflow:\s*hidden;/u);
    expect(membersPage).toMatch(
      /className="agent-history-viewport"[\s\S]{0,180}tabIndex=\{0\}/u,
    );
  });

  it("pads only direct Memory loading, error, and empty states", () => {
    expect(rule(".agent-memory > .agent-section-empty")).toMatch(
      /padding:\s*18px 30px;/u,
    );
    expect(rule(".agent-section-empty")).toMatch(/padding:\s*18px 0;/u);
  });
});
