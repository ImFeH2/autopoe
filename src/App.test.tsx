import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AppStatus } from "@/App";

describe("AppStatus", () => {
  it("renders the app information", () => {
    const markup = renderToStaticMarkup(
      <AppStatus
        state={{
          status: "ready",
          info: { name: "Flowent", version: "0.0.0" },
        }}
      />,
    );

    expect(markup).toContain("Flowent v0.0.0");
  });
});
