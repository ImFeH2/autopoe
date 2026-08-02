import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ChatMessages } from "@/components/ChatMessages";

const agent = {
  id: "leader",
  name: "Leader",
  role: "Leader",
  status: "idle" as const,
  model: "test",
  home: "/data/projects/default/agents/leader/home",
};

describe("ChatMessages", () => {
  it("renders the empty chat", () => {
    const markup = renderToStaticMarkup(
      <ChatMessages
        agent={agent}
        connection="ready"
        error={null}
        messages={[]}
        onInspect={() => undefined}
      />,
    );

    expect(markup).toContain("Leader");
    expect(markup).toContain("Ready");
  });

  it("renders streamed agent content", () => {
    const markup = renderToStaticMarkup(
      <ChatMessages
        agent={agent}
        connection="ready"
        error={null}
        messages={[
          {
            id: "turn-1-agent",
            author: "leader",
            content: "Flowent",
            status: "streaming",
          },
        ]}
        onInspect={() => undefined}
      />,
    );

    expect(markup).toContain("Leader");
    expect(markup).toContain("Flowent");
  });
});
