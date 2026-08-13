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

  it("keeps the sidebar focused on global destinations", () => {
    const markup = renderToStaticMarkup(
      <AppSidebar
        agentCount={2}
        discussionCount={1}
        memberCount={3}
        onSelectView={() => undefined}
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
    expect(markup).not.toContain("Recent");
    expect(markup).not.toContain("Launch narrative");
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
