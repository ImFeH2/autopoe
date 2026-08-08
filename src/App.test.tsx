import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import App from "@/App";

describe("App", () => {
  it("renders the application name", () => {
    const markup = renderToStaticMarkup(<App />);

    expect(markup).toContain(">Flowent</h1>");
  });
});
