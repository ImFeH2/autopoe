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
  discussionAgentStatus,
  filterDiscussions,
  formatMessageCount,
} from "@/features/discussions";
import { MembersPage } from "@/features/members";
import {
  isModelSettingsDirty,
  isObservabilitySettingsDirty,
  parseContextWindow,
  SettingsPage,
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
      context_window: 1_050_000,
      has_api_key: true,
    };
    const unchanged = {
      apiType: "openai-chat" as const,
      baseUrl: "https://api.example.com",
      apiKey: "",
      model: "model-a",
      contextWindow: "1050000",
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
    expect(
      isModelSettingsDirty(current, {
        ...unchanged,
        contextWindow: "200000",
      }),
    ).toBe(true);
  });

  it("parses optional context window values as safe integers", () => {
    expect(parseContextWindow("")).toBeNull();
    expect(parseContextWindow(" 1050000 ")).toBe(1_050_000);
    expect(() => parseContextWindow("1.5")).toThrow(
      "Context window must be an integer of at least 2",
    );
  });

  it("renders an accessible context window input", () => {
    const markup = renderToStaticMarkup(<SettingsPage />);

    expect(markup).toContain('aria-label="Context window"');
    expect(markup).toContain('id="model-context-window"');
    expect(markup).toContain('type="number"');
    expect(markup).toContain('placeholder="1050000"');
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

  it("presents the transitional pausing state as Running in Discussions", () => {
    expect(discussionAgentStatus("pausing")).toBe("running");
    expect(discussionAgentStatus("paused")).toBe("paused");
  });

  it("renders accessible live Agent status marks only on Discussion member avatars", () => {
    const agents = [
      {
        id: 2,
        type: "agent" as const,
        name: "Run",
        status: "running" as const,
      },
      {
        id: 3,
        type: "agent" as const,
        name: "Idle",
        status: "idle" as const,
      },
      {
        id: 4,
        type: "agent" as const,
        name: "Pause",
        status: "paused" as const,
      },
      {
        id: 5,
        type: "agent" as const,
        name: "Error",
        status: "error" as const,
        error: "Connection lost",
      },
      {
        id: 6,
        type: "agent" as const,
        name: "Stopping",
        status: "pausing" as const,
      },
    ];
    const discussion = {
      id: 1,
      topic: "Live status",
      member_ids: [1, 2, 3, 4, 5, 6],
      messages: [
        {
          id: 1,
          sender_id: 2,
          body: "Historical message",
          references: [],
          mentions: [],
        },
      ],
    };
    const markup = renderToStaticMarkup(
      <TooltipProvider>
        <DiscussionsPage
          agents={agents}
          disabled={false}
          discussions={[discussion]}
          error={null}
          isCreating={false}
          members={[{ id: 1, type: "human", name: "You" }, ...agents]}
          messageBody=""
          messageInputRef={{ current: null }}
          messageMentions={[]}
          mentionSyntax={{ enabled: true, issues: [] }}
          onCreateAgent={() => undefined}
          onCreateDiscussion={() => undefined}
          onDeleteDiscussion={() => undefined}
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

    expect(markup).toContain("Discussion members:");
    expect(markup).toContain("You, Human");
    expect(markup).toContain('aria-label="Run, Agent status: Running"');
    expect(markup).toContain('aria-label="Idle, Agent status: Idle"');
    expect(markup).toContain('aria-label="Pause, Agent status: Paused"');
    expect(markup).toContain('aria-label="Error, Agent status: Error"');
    expect(markup).toContain('aria-label="Stopping, Agent status: Running"');
    expect(markup.match(/data-agent-status="running"/g)).toHaveLength(2);
    expect(markup.match(/data-agent-status="idle"/g)).toHaveLength(1);
    expect(markup.match(/data-agent-status="paused"/g)).toHaveLength(1);
    expect(markup.match(/data-agent-status="error"/g)).toHaveLength(1);
    expect(markup).toContain('class="message-avatar" aria-hidden="true"');
    expect(markup).not.toContain("message-avatar--running");
  });

  it("renders every member and focusable Agent status in crowded Discussions", () => {
    const statuses = ["idle", "running", "paused", "pausing"] as const;
    const agents = Array.from({ length: 24 }, (_, index) => ({
      id: index + 2,
      type: "agent" as const,
      name: `Crowd ${String(index + 1).padStart(2, "0")}`,
      status: statuses[index % statuses.length],
    }));
    const discussion = {
      id: 1,
      topic: "Crowded status",
      member_ids: [1, ...agents.map((agent) => agent.id)],
      messages: [],
    };
    const markup = renderToStaticMarkup(
      <TooltipProvider>
        <DiscussionsPage
          agents={agents}
          disabled={false}
          discussions={[discussion]}
          error={null}
          isCreating={false}
          members={[{ id: 1, type: "human", name: "You" }, ...agents]}
          messageBody=""
          messageInputRef={{ current: null }}
          messageMentions={[]}
          mentionSyntax={{ enabled: true, issues: [] }}
          onCreateAgent={() => undefined}
          onCreateDiscussion={() => undefined}
          onDeleteDiscussion={() => undefined}
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

    expect(markup).toContain("You, Human");
    for (const agent of agents) {
      const status = discussionAgentStatus(agent.status);
      const label = status[0].toUpperCase() + status.slice(1);
      expect(markup).toContain(
        `aria-label="${agent.name}, Agent status: ${label}"`,
      );
    }
    expect(markup.match(/data-agent-status=/g)).toHaveLength(agents.length);
    expect(
      markup.match(
        /<button[^>]*class="discussion-member-avatar[^>]*data-agent-status=[^>]*type="button"/g,
      ),
    ).toHaveLength(agents.length);
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
          mentionSyntax={{ enabled: true, issues: [] }}
          onCreateAgent={() => undefined}
          onCreateDiscussion={() => undefined}
          onDeleteDiscussion={() => undefined}
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
    expect(markup).toContain('aria-label="Delete Repository work"');
  });

  it("renders Markdown before structured Mention statuses", () => {
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
      messages: [
        {
          id: 1,
          sender_id: 1,
          body: "**Bold request**\nnext line",
          references: [
            {
              member_id: 2,
              name: "Ada",
              start: null,
              end: null,
              in_discussion: true,
              notified: true,
              deleted: true,
            },
          ],
          mentions: [{ member_id: 2, status: "read" as const }],
        },
      ],
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
          messageBody="composer changes do not belong to sent Markdown"
          messageInputRef={{ current: null }}
          messageMentions={[]}
          mentionSyntax={{ enabled: true, issues: [] }}
          onCreateAgent={() => undefined}
          onCreateDiscussion={() => undefined}
          onDeleteDiscussion={() => undefined}
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

    const markdownIndex = markup.indexOf("<strong>Bold request</strong>");
    const mentionIndex = markup.indexOf('class="mention-statuses"');
    expect(markdownIndex).toBeGreaterThan(-1);
    expect(markup).toContain("<br/>\nnext line");
    expect(mentionIndex).toBeGreaterThan(markdownIndex);
    expect(markup).toContain("@Ada · READ");
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
          onDeleteAgent={() => undefined}
          onPauseAgent={() => undefined}
          onResumeAgent={() => undefined}
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
    expect(markup).toContain('aria-label="Pause Ada"');
    expect(markup).not.toContain('aria-label="Resume Ada"');
    expect(markup).toContain("Agent · IDLE");
    expect(markup).toContain('aria-label="Agent details"');
    expect(markup).toContain('aria-selected="true"');
    expect(markup).toContain(">Overview<");
    expect(markup).toContain(">Memory<");
    expect(markup).toContain(">History<");
    expect(markup).not.toContain(">Member ID<");
    expect(markup).toContain("<summary>Technical details</summary>");
    expect(markup).toContain('aria-label="Copy Member ID"');
    expect(markup).toContain("does not schedule a Turn");
  });

  it("keeps persistent Agent history behind the History tab", () => {
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
                      id: "reminder",
                      type: "reminder",
                      timestamp: "2026-08-15T00:00:00+00:00",
                      state: "complete",
                      reminder: {
                        mentions: [
                          {
                            discussion_id: 1,
                            message_id: 3,
                            sender_id: 1,
                            body: "Request",
                            previously_reminded: false,
                          },
                        ],
                      },
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
          onDeleteAgent={() => undefined}
          onPauseAgent={() => undefined}
          onResumeAgent={() => undefined}
          onSelectMember={() => undefined}
          selectedMember={agent}
        />
      </TooltipProvider>,
    );

    expect(markup).toContain('id="agent-2-history-tab"');
    expect(markup).toContain('aria-controls="agent-2-history-panel"');
    expect(markup).not.toContain('aria-label="Ada history"');
    expect(markup).not.toContain("Continuing the same context");
    expect(markup).toContain('aria-label="Delete Ada"');
    expect(markup).not.toContain('aria-label="Delete You"');
    expect(markup).toContain("Loading Todos");
  });

  it.each(["paused", "pausing"] as const)(
    "renders Resume for %s Agents",
    (status) => {
      const agent = {
        id: 2,
        type: "agent" as const,
        name: "Ada",
        status,
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
            onDeleteAgent={() => undefined}
            onPauseAgent={() => undefined}
            onResumeAgent={() => undefined}
            onSelectMember={() => undefined}
            selectedMember={agent}
          />
        </TooltipProvider>,
      );
      const deleteButton = markup.match(
        /<button[^>]*aria-label="Delete Ada"[^>]*>/,
      )?.[0];

      expect(markup).toContain('aria-label="Resume Ada"');
      expect(markup).not.toContain('aria-label="Pause Ada"');
      expect(markup).toContain(status.toUpperCase());
      if (status === "pausing") {
        expect(deleteButton).toContain("disabled");
      } else {
        expect(deleteButton).not.toContain("disabled");
      }
    },
  );

  it("shows Agent errors without an automatic recovery action", () => {
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
          onDeleteAgent={() => undefined}
          onPauseAgent={() => undefined}
          onResumeAgent={() => undefined}
          onSelectMember={() => undefined}
          selectedMember={agent}
        />
      </TooltipProvider>,
    );

    expect(markup).toContain('aria-label="Agent error"');
    expect(markup).toContain('role="alert"');
    expect(markup).toContain("Model request failed");
    expect(markup).not.toContain("Retry Ada");
  });

  it("renders readable Human details with the ID isolated technically", () => {
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
          onDeleteAgent={() => undefined}
          onPauseAgent={() => undefined}
          onResumeAgent={() => undefined}
          onSelectMember={() => undefined}
          selectedMember={human}
        />
      </TooltipProvider>,
    );

    expect(markup).toContain('aria-label="Open You"');
    expect(markup).not.toContain("Select a member");
    expect(markup).toContain('aria-label="You details"');
    expect(markup).toContain(">Human<");
    expect(markup).not.toContain(">Member ID<");
    expect(markup).toContain("<summary>Technical details</summary>");
    expect(markup).toContain('aria-label="Copy Member ID"');
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
