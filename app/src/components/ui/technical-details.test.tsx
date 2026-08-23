import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { copyTechnicalId, TechnicalDetails } from "./technical-details";

describe("TechnicalDetails", () => {
  it("renders IDs in default-collapsed technical disclosure", () => {
    const markup = renderToStaticMarkup(
      <TechnicalDetails
        identifiers={[
          { label: "Discussion", value: 12 },
          { label: "Message", value: 34 },
        ]}
      />,
    );

    expect(markup).toContain("<details");
    expect(markup).not.toContain(' open="');
    expect(markup).toContain("<summary>Technical details</summary>");
    expect(markup).toContain("<dt>Discussion</dt>");
    expect(markup).toContain("<code>12</code>");
    expect(markup).toContain('aria-label="Copy Discussion ID"');
    expect(markup).toContain(">Copy ID</button>");
  });

  it("copies the raw ID value", async () => {
    let copied = "";
    await copyTechnicalId(42, {
      writeText: async (value) => {
        copied = value;
      },
    });
    expect(copied).toBe("42");
  });
});
