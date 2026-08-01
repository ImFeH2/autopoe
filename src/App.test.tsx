import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Identity } from "@/App";

describe("Identity", () => {
  it("renders the app information", () => {
    const markup = renderToStaticMarkup(
      <Identity info={{ name: "Flowent", version: "0.0.0" }} />,
    );

    expect(markup).toContain("Flowent");
    expect(markup).toContain("v0.0.0");
  });
});
