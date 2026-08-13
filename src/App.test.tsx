import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import App, { shouldSubmitMessage } from "@/App";
import { AppSidebar } from "@/components/layout";
import { Button, Input, Textarea } from "@/components/ui";

describe("App", () => {
  it("renders a clear startup state before the backend responds", () => {
    const markup = renderToStaticMarkup(<App />);

    expect(markup).toContain("Starting Flowent");
  });

  it("submits Enter but preserves Shift+Enter and IME composition", () => {
    expect(
      shouldSubmitMessage({
        key: "Enter",
        shiftKey: false,
        isComposing: false,
      }),
    ).toBe(true);
    expect(
      shouldSubmitMessage({ key: "Enter", shiftKey: true, isComposing: false }),
    ).toBe(false);
    expect(
      shouldSubmitMessage({ key: "Enter", shiftKey: false, isComposing: true }),
    ).toBe(false);
  });

  it("separates workspace functions and recent Discussions in the sidebar", () => {
    const markup = renderToStaticMarkup(
      <AppSidebar
        agentCount={2}
        discussions={[{ id: 1, messageCount: 4, topic: "Launch narrative" }]}
        memberCount={3}
        onSelectDiscussion={() => undefined}
        onSelectView={() => undefined}
        selectedDiscussionId={1}
        view="discussions"
        workingDirectory="/project/flowent"
      />,
    );

    expect(markup).toContain('aria-label="Workspace"');
    expect(markup).not.toContain(">Overview<");
    expect(markup).not.toContain("Organization 1");
    expect(markup).toContain(">Discussions<");
    expect(markup).toContain(">Members<");
    expect(markup).toContain(">Agents<");
    expect(markup).toContain(">Settings<");
    expect(markup).toContain("Recent");
    expect(markup).toContain("Launch narrative");
    expect(markup).toContain("4 messages");
    expect(markup).toContain("/project/flowent");
  });

  it("renders production controls with accessible native semantics", () => {
    const markup = renderToStaticMarkup(
      <form>
        <Input aria-label="Agent name" />
        <Textarea aria-label="Message" />
        <Button type="submit">Send</Button>
      </form>,
    );

    expect(markup).toContain('aria-label="Agent name"');
    expect(markup).toContain('aria-label="Message"');
    expect(markup).toContain('type="submit"');
    expect(markup).toContain(">Send</button>");
  });
});
