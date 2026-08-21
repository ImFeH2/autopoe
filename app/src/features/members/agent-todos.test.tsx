import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AgentTodos } from "./agent-todos";

describe("AgentTodos", () => {
  it("keeps Todo separate from runtime and Turn scheduling", () => {
    const markup = renderToStaticMarkup(<AgentTodos agentId={2} />);

    expect(markup).toContain(">Todos<");
    expect(markup).toContain("does not schedule a Turn");
    expect(markup).toContain("currently running");
    expect(markup).toContain("Loading Todos");
  });
});
