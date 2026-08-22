import { readFileSync } from "node:fs";
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
  humanUnreadForDiscussion,
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

  it("derives unread and @Human counts from Human read state and subset truth", () => {
    const discussion = {
      id: 1,
      topic: "Unread",
      member_ids: [1, 2],
      human_read_states: [
        {
          member_id: 1,
          read_through_message_id: 1,
          seen_message_ids: [3],
        },
      ],
      messages: [
        { id: 1, sender_id: 2, body: "Read", references: [], mentions: [] },
        {
          id: 2,
          sender_id: 2,
          body: "Mention",
          references: [],
          mentions: [],
          human_mentions: [{ member_id: 1, status: "unread" as const }],
        },
        { id: 3, sender_id: 2, body: "Seen", references: [], mentions: [] },
        { id: 4, sender_id: 1, body: "Own", references: [], mentions: [] },
        { id: 5, sender_id: 2, body: "Unread", references: [], mentions: [] },
      ],
    };

    expect(humanUnreadForDiscussion(discussion)).toEqual({
      unreadMessageIds: [2, 5],
      unreadHumanMentionMessageIds: [2],
      unreadCount: 2,
      unreadHumanMentionCount: 1,
      firstUnreadMessageId: 2,
    });
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
          onOpenMember={() => undefined}
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
    expect(markup).toContain('aria-label="You, Human"');
    expect(markup).toContain(
      'data-member-navigation-key="discussion:1:member:1"',
    );
    expect(markup).toContain(
      'data-member-navigation-key="discussion:1:member:2"',
    );
    expect(markup).toContain('data-discussion-focus-id="1" tabindex="-1"');
    expect(markup).toMatch(
      /<button[^>]*aria-label="You, Human"[^>]*class="discussion-member-avatar discussion-member-avatar--human"/u,
    );
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
    const styles = readFileSync(
      new URL("./features/discussions/discussions.css", import.meta.url),
      "utf8",
    );
    expect(styles).toMatch(/\.discussion-member-avatar:hover\s*\{/u);
    expect(styles).toMatch(/\.discussion-member-avatar:focus-visible\s*\{/u);
    expect(styles).toMatch(/\.discussion-title:focus-visible\s*\{/u);
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
          onOpenMember={() => undefined}
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
          onOpenMember={() => undefined}
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

  it("keeps active Mention body and status names current", () => {
    const renamedAgent = {
      id: 2,
      type: "agent" as const,
      name: "NewName",
      status: "idle" as const,
    };
    const laterSameNameAgent = {
      id: 4,
      type: "agent" as const,
      name: "OldGone",
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
          body: "@OldName **Bold request**\nnext line",
          references: [
            {
              member_id: 2,
              name: "OldName",
              start: 0,
              end: 8,
              in_discussion: true,
              notified: true,
              deleted: false,
            },
          ],
          mentions: [{ member_id: 2, status: "read" as const }],
        },
        {
          id: 2,
          sender_id: 1,
          body: "@OldGone",
          references: [
            {
              member_id: 3,
              name: "OldGone",
              start: 0,
              end: 8,
              in_discussion: true,
              notified: true,
              deleted: true,
            },
          ],
          mentions: [{ member_id: 3, status: "pending" as const }],
        },
      ],
    };
    const markup = renderToStaticMarkup(
      <TooltipProvider>
        <DiscussionsPage
          agents={[renamedAgent, laterSameNameAgent]}
          disabled={false}
          discussions={[discussion]}
          error={null}
          isCreating={false}
          members={[
            { id: 1, type: "human", name: "You" },
            renamedAgent,
            laterSameNameAgent,
          ]}
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
          onOpenMember={() => undefined}
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
    expect(markup).toContain("@NewName · READ");
    expect(markup).toContain('title="@NewName · read"');
    expect(markup).not.toContain("@OldName");
    expect(markup).toContain("@OldGone · PENDING");
    expect(markup).toContain('title="@OldGone · pending · Deleted Agent"');
    expect(markup).not.toContain('aria-label="Open OldGone in Members"');
  });

  it("renders unread badges, divider, and jump controls from props", () => {
    const agent = {
      id: 2,
      type: "agent" as const,
      name: "Ada",
      status: "idle" as const,
    };
    const discussion = {
      id: 1,
      topic: "Unread work",
      member_ids: [1, 2],
      human_read_states: [
        {
          member_id: 1,
          read_through_message_id: null,
          seen_message_ids: [],
        },
      ],
      messages: [
        {
          id: 1,
          sender_id: 2,
          body: "@You please review",
          references: [],
          mentions: [],
          human_mentions: [{ member_id: 1, status: "unread" as const }],
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
          onOpenMember={() => undefined}
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

    expect(markup).toContain('aria-label="1 unread messages"');
    expect(markup).toContain('aria-label="Unread message navigation"');
    expect(markup).toContain("Jump to first unread message (1 unread)");
    expect(markup).toContain("Jump to next unread mention (1 unread)");
    expect(markup).toContain('<hr aria-label="New messages"');
    expect(markup).toContain('data-message-id="1" tabindex="-1"');
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
          onBackToDiscussion={() => undefined}
          onCreateAgent={() => undefined}
          onDeleteAgent={() => undefined}
          onPauseAgent={() => undefined}
          onResumeAgent={() => undefined}
          onSelectMember={() => undefined}
          selectedMember={agent}
          sourceDiscussionTopic="Repository work"
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
    expect(markup).toContain('aria-label="Back to Repository work discussion"');
    expect(markup).toContain('data-member-return-focus="true"');
    expect(markup).toContain('data-member-overview-focus=""');
    expect(markup).toContain('title="Return to Repository work"');
    expect(markup).not.toContain('aria-label="Resume Ada"');
    expect(markup).toContain("Agent · IDLE");
    expect(markup).toContain('aria-label="Agent details"');
    expect(markup).toContain('aria-selected="true"');
    expect(markup).toContain(">Overview<");
    expect(markup).toContain(">Memory<");
    expect(markup).toContain(">History<");
    expect(markup).toContain(">Member ID<");
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

  it("renders a minimal Human Overview with a source Discussion return", () => {
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
          onBackToDiscussion={() => undefined}
          onCreateAgent={() => undefined}
          onDeleteAgent={() => undefined}
          onPauseAgent={() => undefined}
          onResumeAgent={() => undefined}
          onSelectMember={() => undefined}
          selectedMember={human}
          sourceDiscussionTopic="Repository work"
        />
      </TooltipProvider>,
    );

    expect(markup).toContain('aria-label="Open You"');
    expect(markup).toContain('aria-label="You details"');
    expect(markup).toContain('aria-label="Human details"');
    expect(markup).toContain('aria-label="Back to Repository work discussion"');
    expect(markup).toContain('data-member-return-focus="true"');
    expect(markup).toContain('data-member-overview-focus="true"');
    expect(markup).toContain('title="Return to Repository work"');
    expect(markup).toContain(">Overview<");
    expect(markup).toContain(">Human<");
    expect(markup).not.toContain(">Member ID<");
    expect(markup).not.toContain("Human 1");
    expect(markup).not.toContain(">Memory<");
    expect(markup).not.toContain(">History<");
    expect(markup).not.toContain("StatusIndicator");
    expect(markup).not.toContain('aria-label="Delete You"');
  });

  it("uses a stable Back accessible-name fallback without a source topic", () => {
    const human = { id: 1, type: "human" as const, name: "Current Viewer" };
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
          onBackToDiscussion={() => undefined}
          onCreateAgent={() => undefined}
          onDeleteAgent={() => undefined}
          onPauseAgent={() => undefined}
          onResumeAgent={() => undefined}
          onSelectMember={() => undefined}
          selectedMember={human}
          sourceDiscussionTopic="   "
        />
      </TooltipProvider>,
    );

    expect(markup).toContain('aria-label="Back to source discussion"');
    expect(markup).not.toContain('aria-label="Back to Discussion"');
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
