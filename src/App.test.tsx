import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import App, {
  filterDiscussions,
  formatMessageCount,
  isModelSettingsDirty,
  isObservabilitySettingsDirty,
  shouldSubmitMessage,
} from "@/App";
import { AppSidebar } from "@/components/layout";
import {
  Badge,
  Button,
  Input,
  ListButton,
  StatusIndicator,
  Textarea,
} from "@/components/ui";

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

  it("marks model settings dirty only when the saved values change", () => {
    const current = {
      api_type: "openai-chat" as const,
      base_url: "https://api.example.com",
      model: "model-a",
      has_api_key: true,
    };
    const unchanged = {
      apiType: "openai-chat" as const,
      baseUrl: "https://api.example.com",
      apiKey: "",
      model: "model-a",
    };

    expect(isModelSettingsDirty(current, unchanged)).toBe(false);
    expect(
      isModelSettingsDirty(current, { ...unchanged, apiKey: "replacement" }),
    ).toBe(true);
    expect(
      isModelSettingsDirty(current, {
        ...unchanged,
        apiType: "openai-responses",
      }),
    ).toBe(true);
  });

  it("marks tracing settings dirty without requiring saved secrets", () => {
    const current = {
      enabled: true,
      base_url: "https://cloud.langfuse.com",
      public_key: "pk-lf-test",
      environment: "development",
      capture_content: false,
      has_secret_key: true,
    };
    const unchanged = {
      enabled: true,
      baseUrl: "https://cloud.langfuse.com",
      publicKey: "pk-lf-test",
      secretKey: "",
      environment: "development",
      captureContent: false,
    };

    expect(isObservabilitySettingsDirty(current, unchanged)).toBe(false);
    expect(
      isObservabilitySettingsDirty(current, {
        ...unchanged,
        captureContent: true,
      }),
    ).toBe(true);
    expect(
      isObservabilitySettingsDirty(current, {
        ...unchanged,
        secretKey: "replacement",
      }),
    ).toBe(true);
  });

  it("formats Discussion message counts with correct grammar", () => {
    expect(formatMessageCount(0)).toBe("0 messages");
    expect(formatMessageCount(1)).toBe("1 message");
    expect(formatMessageCount(2)).toBe("2 messages");
  });

  it("filters Discussions by topic without changing their order", () => {
    const discussions = [
      {
        id: 1,
        topic: "Repository work",
        member_ids: [1, 2],
        messages: [],
      },
      {
        id: 2,
        topic: "Review history",
        member_ids: [1, 2],
        messages: [],
      },
    ];

    expect(filterDiscussions(discussions, "  REview ")).toEqual([
      discussions[1],
    ]);
    expect(filterDiscussions(discussions, " ")).toEqual(discussions);
    expect(filterDiscussions(discussions, "missing")).toEqual([]);
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
        <Textarea aria-label="Message" variant="composer" />
        <Button type="submit">Send</Button>
      </form>,
    );

    expect(markup).toContain('aria-label="Agent name"');
    expect(markup).toContain('aria-label="Message"');
    expect(markup).toContain("ui-textarea--composer");
    expect(markup).toContain('type="submit"');
    expect(markup).toContain(">Send</button>");
  });

  it("exposes reusable list, badge, and status semantics", () => {
    const markup = renderToStaticMarkup(
      <div>
        <ListButton
          active
          aria-label="Open Repository work"
          meta="2 messages"
          title="Repository work"
        />
        <Badge tone="success">ACKED</Badge>
        <StatusIndicator tone="success">IDLE</StatusIndicator>
      </div>,
    );

    expect(markup).toContain('aria-current="page"');
    expect(markup).toContain('aria-label="Open Repository work"');
    expect(markup).toContain("Repository work");
    expect(markup).toContain("2 messages");
    expect(markup).toContain("ACKED");
    expect(markup).toContain("IDLE");
  });
});
