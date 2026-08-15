import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import App from "@/App";
import { AppSidebar } from "@/components/layout";
import {
  Badge,
  Button,
  Input,
  ListButton,
  SegmentedControl,
  StatusIndicator,
  Textarea,
  Tooltip,
  TooltipProvider,
} from "@/components/ui";
import {
  DiscussionsPage,
  filterDiscussions,
  formatMessageCount,
} from "@/features/discussions";
import { MembersPage } from "@/features/members";
import {
  isModelSettingsDirty,
  isObservabilitySettingsDirty,
} from "@/features/settings";

describe("App", () => {
  it("renders a clear startup state before the backend responds", () => {
    const markup = renderToStaticMarkup(<App />);

    expect(markup).toContain("Starting Flowent");
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

  it("renders mention selection inside the Message combobox", () => {
    const agent = {
      id: 2,
      type: "agent" as const,
      name: "Ada",
      status: "idle" as const,
    };
    const discussion = {
      id: 1,
      topic: "Repository work",
      member_ids: [1, 2],
      messages: [],
    };
    const markup = renderToStaticMarkup(
      <TooltipProvider>
        <DiscussionsPage
          agents={[agent]}
          disabled={false}
          discussions={[discussion]}
          error={null}
          isCreating={false}
          members={[{ id: 1, type: "human", name: "You" }, agent]}
          messageBody=""
          messageInputRef={{ current: null }}
          messageMentions={[]}
          onCreateAgent={() => undefined}
          onCreateDiscussion={() => undefined}
          onDialogCloseAutoFocus={() => false}
          onDialogOpenChange={() => undefined}
          onMessageChange={() => undefined}
          onSelectDiscussion={() => undefined}
          onSend={() => undefined}
          onToggleMember={() => undefined}
          selectedDiscussion={discussion}
          selectedMemberIds={[]}
          setTopic={() => undefined}
          topic=""
        />
      </TooltipProvider>,
    );

    expect(markup).toContain('role="combobox"');
    expect(markup).toContain('aria-autocomplete="list"');
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).not.toContain("mention-picker");
    expect(markup).not.toContain(">Mention<");
  });

  it("keeps the sidebar focused on global destinations", () => {
    const markup = renderToStaticMarkup(
      <TooltipProvider>
        <AppSidebar
          discussionCount={1}
          memberCount={3}
          onSelectView={() => undefined}
          view="discussions"
        />
      </TooltipProvider>,
    );

    expect(markup).toContain('aria-label="Workspace"');
    expect(markup).not.toContain(">Overview<");
    expect(markup).not.toContain("Organization 1");
    expect(markup).toContain(">Discussions<");
    expect(markup).toContain(">Members<");
    expect(markup).not.toContain(">Agents<");
    expect(markup).toContain(">Settings<");
    expect(markup).not.toContain("Recent");
    expect(markup).not.toContain("Launch narrative");
    expect(markup).not.toContain("/project/flowent");
    expect(markup).not.toContain(">You<");
    expect(markup).not.toContain("sidebar-settings-button");
    expect(markup).toContain("sidebar-nav-button--bottom");
    const navigationButtons = [...markup.matchAll(/class="([^"]+)"/g)].filter(
      ([, className]) => className.split(" ").includes("sidebar-nav-button"),
    );
    expect(navigationButtons).toHaveLength(3);
  });

  it("renders Members as a selectable list with Agent details", () => {
    const agent = {
      id: 2,
      type: "agent" as const,
      name: "Ada",
      status: "idle" as const,
    };
    const markup = renderToStaticMarkup(
      <TooltipProvider>
        <MembersPage
          agentName=""
          disabled={false}
          error={null}
          isCreatingAgent={false}
          members={[{ id: 1, type: "human", name: "You" }, agent]}
          onAgentDialogOpenChange={() => undefined}
          onAgentNameChange={() => undefined}
          onCreateAgent={() => undefined}
          onRetryAgent={() => undefined}
          onSelectMember={() => undefined}
          selectedMember={agent}
        />
      </TooltipProvider>,
    );

    expect(markup).toContain('aria-label="Member list"');
    expect(markup).toContain('aria-label="New Agent"');
    expect(markup).toContain('aria-label="Open You"');
    expect(markup).toContain('aria-label="Open Ada"');
    expect(markup).toContain('aria-current="page"');
    expect(markup).toContain('aria-label="Ada details"');
    expect(markup).toContain("Agent · IDLE");
    expect(markup).toContain(">Member ID<");
  });

  it("renders persistent Agent history as one continuous timeline", () => {
    const agent = {
      id: 2,
      type: "agent" as const,
      name: "Ada",
      status: "running" as const,
    };
    const markup = renderToStaticMarkup(
      <TooltipProvider>
        <MembersPage
          agentName=""
          disabled={false}
          error={null}
          history={{
            status: "ready",
            history: {
              agent_id: 2,
              runs: [
                {
                  run_id: "run-1",
                  status: "running",
                  started_at: "2026-08-15T00:00:00+00:00",
                  completed_at: null,
                  usage: null,
                  event_sequence: 3,
                  entries: [
                    {
                      id: "activation",
                      type: "activation",
                      timestamp: "2026-08-15T00:00:00+00:00",
                      state: "complete",
                      activation: { discussion_id: 1, message_id: 3 },
                    },
                    {
                      id: "tool",
                      type: "tool_call",
                      timestamp: "2026-08-15T00:00:01+00:00",
                      state: "complete",
                      tool_name: "discussion",
                      content: '{"action":"read"}',
                    },
                    {
                      id: "reply",
                      type: "assistant",
                      timestamp: "2026-08-15T00:00:02+00:00",
                      state: "streaming",
                      content: "Continuing the same context",
                    },
                  ],
                },
              ],
            },
          }}
          isCreatingAgent={false}
          members={[{ id: 1, type: "human", name: "You" }, agent]}
          onAgentDialogOpenChange={() => undefined}
          onAgentNameChange={() => undefined}
          onCreateAgent={() => undefined}
          onRetryAgent={() => undefined}
          onSelectMember={() => undefined}
          selectedMember={agent}
        />
      </TooltipProvider>,
    );

    expect(markup).toContain('aria-label="Ada history"');
    expect(markup).toContain("Discussion 1 · Message 3");
    expect(markup).toContain("Tool call");
    expect(markup).toContain("discussion");
    expect(markup).toContain("Continuing the same context");
    expect(markup).toContain("Streaming");
  });

  it("shows Agent errors and Retry in Member details", () => {
    const agent = {
      id: 2,
      type: "agent" as const,
      name: "Ada",
      status: "error" as const,
      error: "Model request failed",
    };
    const markup = renderToStaticMarkup(
      <TooltipProvider>
        <MembersPage
          agentName=""
          disabled={false}
          error={null}
          isCreatingAgent={false}
          members={[{ id: 1, type: "human", name: "You" }, agent]}
          onAgentDialogOpenChange={() => undefined}
          onAgentNameChange={() => undefined}
          onCreateAgent={() => undefined}
          onRetryAgent={() => undefined}
          onSelectMember={() => undefined}
          selectedMember={agent}
        />
      </TooltipProvider>,
    );

    expect(markup).toContain('aria-label="Agent error"');
    expect(markup).toContain('role="alert"');
    expect(markup).toContain("Model request failed");
    expect(markup).toContain('aria-label="Retry Ada"');
  });

  it("keeps Human Member details empty", () => {
    const human = { id: 1, type: "human" as const, name: "You" };
    const markup = renderToStaticMarkup(
      <TooltipProvider>
        <MembersPage
          agentName=""
          disabled={false}
          error={null}
          isCreatingAgent={false}
          members={[human]}
          onAgentDialogOpenChange={() => undefined}
          onAgentNameChange={() => undefined}
          onCreateAgent={() => undefined}
          onRetryAgent={() => undefined}
          onSelectMember={() => undefined}
          selectedMember={human}
        />
      </TooltipProvider>,
    );

    expect(markup).toContain('aria-label="Open You"');
    expect(markup).not.toContain("Select a member");
    expect(markup).not.toContain("member-agent-detail");
    expect(markup).not.toContain(">Member ID<");
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

  it("exposes an accessible segmented radio group", () => {
    const markup = renderToStaticMarkup(
      <SegmentedControl
        aria-label="API type"
        onValueChange={() => undefined}
        options={[
          { label: "Chat", value: "chat" },
          { label: "Responses", value: "responses" },
        ]}
        value="chat"
      />,
    );

    expect(markup).toContain('role="radiogroup"');
    expect(markup).toContain('aria-label="API type"');
    expect(markup).toContain('role="radio"');
    expect(markup).toContain('aria-checked="true"');
    expect(markup).toContain('aria-checked="false"');
  });

  it("keeps disabled Tooltip triggers visually hoverable", () => {
    const markup = renderToStaticMarkup(
      <TooltipProvider>
        <Tooltip content="Create an Agent first">
          <Button aria-label="New discussion" disabled size="icon">
            +
          </Button>
        </Tooltip>
      </TooltipProvider>,
    );

    expect(markup).toContain("ui-tooltip-trigger");
    expect(markup).toContain('aria-label="New discussion"');
    expect(markup).toContain("disabled");
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
