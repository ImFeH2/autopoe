import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
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
  DiscussionForm,
  DiscussionsPage,
  discussionAgentStatus,
  discussionEntryAccessibleLabel,
  filterDiscussions,
  formatMessageCount,
  formatMessageTimestamp,
  humanUnreadForDiscussion,
  observeActivityBarHeight,
  positionInitialDiscussionMessages,
  preserveActivityBarScrollAnchor,
} from "@/features/discussions";
import { MembersPage } from "@/features/members";
import {
  isExecutionSettingsDirty,
  isModelSettingsDirty,
  isObservabilitySettingsDirty,
  parseContextWindow,
  SettingsPage,
} from "@/features/settings";

const memberNamePolicy = {
  normalization: "NFKC" as const,
  max_code_points: 32,
  max_utf8_bytes: 128,
};

describe("App", () => {
  it("renders a clear startup state before the backend responds", () => {
    const markup = renderToStaticMarkup(<App />);

    expect(markup).toContain("Starting Huddol");
  });

  it("marks execution settings dirty only when the selection changes", () => {
    const current = {
      platform: "windows",
      selected_backend: "native" as const,
      active_backend: "native" as const,
      wsl_available: true,
      wsl_distribution: "Debian",
      restart_required: false,
    };

    expect(isExecutionSettingsDirty(current, "native")).toBe(false);
    expect(isExecutionSettingsDirty(current, "wsl")).toBe(true);
    expect(isExecutionSettingsDirty(null, "native")).toBe(false);
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

  it("formats Message timestamps as stable local clock time", () => {
    const sentAt = new Date("2026-08-22T12:34:56.789Z");
    const todayUs = formatMessageTimestamp(
      sentAt.toISOString(),
      new Date(sentAt),
      "en-US",
    );
    const todayGb = formatMessageTimestamp(
      sentAt.toISOString(),
      new Date(sentAt),
      "en-GB",
    );
    expect(todayUs.compact).toMatch(/(?:AM|PM)$/);
    expect(todayGb.compact).toMatch(/^\d{2}:\d{2}$/);
    expect(todayUs.full).toMatch(/:\d{2}/);

    const historical = formatMessageTimestamp(
      "2026-07-21T12:34:56.789Z",
      new Date(sentAt),
      "en-GB",
    );
    expect(historical.compact).toMatch(/\d{2}:\d{2}$/);
    expect(historical.compact).not.toBe(todayGb.compact);
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
          joined_after_message_id: 0,
          read_through_message_id: 1,
          seen_message_ids: [3],
        },
      ],
      messages: [
        {
          id: 1,
          sender_id: 2,
          body: "Read",
          created_at: null,
          references: [],
          mentions: [],
        },
        {
          id: 2,
          sender_id: 2,
          body: "Mention",
          created_at: null,
          references: [],
          mentions: [],
          human_mentions: [{ member_id: 1, status: "unread" as const }],
        },
        {
          id: 3,
          sender_id: 2,
          body: "Seen",
          created_at: null,
          references: [],
          mentions: [],
        },
        {
          id: 4,
          sender_id: 1,
          body: "Own",
          created_at: null,
          references: [],
          mentions: [],
        },
        {
          id: 5,
          sender_id: 2,
          body: "Unread",
          created_at: null,
          references: [],
          mentions: [],
        },
      ],
    };

    expect(humanUnreadForDiscussion(discussion, 1)).toEqual({
      unreadMessageIds: [5],
      unreadHumanMentionMessageIds: [],
      unreadCount: 1,
      unreadHumanMentionCount: 0,
      firstUnreadMessageId: 5,
    });
  });

  it("does not report messages at or before a Human membership cutoff", () => {
    const discussion = {
      id: 1,
      topic: "Joined later",
      member_ids: [1, 2],
      human_read_states: [
        {
          member_id: 1,
          joined_after_message_id: 2,
          read_through_message_id: null,
          seen_message_ids: [],
        },
      ],
      messages: [
        {
          id: 1,
          sender_id: 2,
          body: "Old",
          created_at: null,
          references: [],
          mentions: [],
          human_mentions: [{ member_id: 1, status: "unread" as const }],
        },
        {
          id: 2,
          sender_id: 2,
          body: "Cutoff",
          created_at: null,
          references: [],
          mentions: [],
        },
        {
          id: 3,
          sender_id: 2,
          body: "New",
          created_at: null,
          references: [],
          mentions: [],
          human_mentions: [{ member_id: 1, status: "unread" as const }],
        },
      ],
    };

    expect(humanUnreadForDiscussion(discussion, 1)).toEqual({
      unreadMessageIds: [3],
      unreadHumanMentionMessageIds: [3],
      unreadCount: 1,
      unreadHumanMentionCount: 1,
      firstUnreadMessageId: 3,
    });
  });

  it("shows total unread and a prominent @Human subset badge independently", () => {
    const agent = {
      id: 2,
      type: "agent" as const,
      name: "Ada",
      status: "idle" as const,
    };
    const message = (id: number, mentioned = false) => ({
      id,
      sender_id: 2,
      body: `Message ${id}`,
      created_at: null,
      references: [],
      mentions: [],
      ...(mentioned
        ? {
            human_mentions: [{ member_id: 1, status: "unread" as const }],
          }
        : {}),
    });
    const discussions = [
      {
        id: 1,
        topic: "Both badges",
        member_ids: [1, 2],
        human_read_states: [
          {
            member_id: 1,
            joined_after_message_id: 0,
            read_through_message_id: null,
            seen_message_ids: [],
          },
        ],
        messages: [message(1, true), message(2)],
      },
      {
        id: 2,
        topic: "Ordinary only",
        member_ids: [1, 2],
        human_read_states: [
          {
            member_id: 1,
            joined_after_message_id: 0,
            read_through_message_id: null,
            seen_message_ids: [],
          },
        ],
        messages: [message(1)],
      },
      {
        id: 3,
        topic: "Seen mention",
        member_ids: [1, 2],
        human_read_states: [
          {
            member_id: 1,
            joined_after_message_id: 0,
            read_through_message_id: null,
            seen_message_ids: [1],
          },
        ],
        messages: [message(1, true)],
      },
    ];
    const markup = renderToStaticMarkup(
      <TooltipProvider>
        <DiscussionsPage
          agents={[agent]}
          currentHumanMemberId={1}
          disabled={false}
          discussions={discussions}
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
          onUpdateDiscussionMembers={async () => true}
          onDialogCloseAutoFocus={() => false}
          onDialogOpenChange={() => undefined}
          onMessageChange={() => undefined}
          onOpenMember={() => undefined}
          onSelectDiscussion={() => undefined}
          onSend={() => undefined}
          onToggleMember={() => undefined}
          selectedMemberIds={[]}
          setTopic={() => undefined}
          topic=""
        />
      </TooltipProvider>,
    );

    expect(markup.match(/aria-label="2 unread messages"/gu)).toHaveLength(1);
    expect(markup.match(/aria-label="1 unread messages"/gu)).toHaveLength(1);
    expect(
      markup.match(/aria-label="1 unread mentions for you"/gu),
    ).toHaveLength(1);
    expect(markup).toContain(">@1</span>");
    expect(markup.match(/aria-label="Manage [^"]+ members"/gu)).toHaveLength(3);
  });

  it("presents the transitional pausing state as Running in Discussions", () => {
    expect(discussionAgentStatus("pausing")).toBe("running");
    expect(discussionAgentStatus("paused")).toBe("paused");
  });

  it("renders live Agent status marks on Discussion members and message avatars", () => {
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
        ...[1, 2, 3, 4, 5, 6, 99].map((senderId) => ({
          id: senderId,
          sender_id: senderId,
          body: `Message from ${senderId}`,
          created_at: null,
          references: [],
          mentions: [],
        })),
        {
          id: 100,
          sender_id: 100,
          sender_name: "Former Agent",
          body: "Historical message from a deleted member",
          created_at: null,
          references: [],
          mentions: [],
        },
      ],
    };
    const markup = renderToStaticMarkup(
      <TooltipProvider>
        <DiscussionsPage
          agents={agents}
          currentHumanMemberId={1}
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
      /<button[^>]*class="member-status-avatar member-status-avatar--member member-status-avatar--human member-status-avatar--interactive"[^>]*aria-label="You, Human"/u,
    );
    expect(markup).toContain('aria-label="Run, Agent status: Running"');
    expect(markup).toContain('aria-label="Idle, Agent status: Idle"');
    expect(markup).toContain('aria-label="Pause, Agent status: Paused"');
    expect(markup).toContain('aria-label="Error, Agent status: Error"');
    expect(markup).toContain('aria-label="Stopping, Agent status: Running"');
    expect(markup.match(/data-variant="member"/g)).toHaveLength(6);
    expect(markup.match(/data-variant="message"/g)).toHaveLength(8);
    expect(markup.match(/data-member-status="running"/g)).toHaveLength(4);
    expect(markup.match(/data-member-status="idle"/g)).toHaveLength(2);
    expect(markup.match(/data-member-status="paused"/g)).toHaveLength(2);
    expect(markup.match(/data-member-status="error"/g)).toHaveLength(2);
    expect(markup.match(/data-member-status="none"/g)).toHaveLength(4);
    for (const name of ["You", "Run", "Idle", "Pause", "Error", "Stopping"]) {
      expect(markup).toContain(`aria-label="Open member details for ${name}"`);
    }
    expect(markup.match(/member-status-avatar--message/g)).toHaveLength(8);
    expect(markup).toContain(
      'class="member-status-avatar member-status-avatar--message member-status-avatar--unknown message-avatar"',
    );
    expect(markup).toContain(
      'class="member-status-avatar member-status-avatar--message member-status-avatar--deleted message-avatar"',
    );
    expect(markup).toContain(
      '<span class="sr-only">Former Agent, Deleted member</span><span aria-hidden="true">Former Agent</span>',
    );
    expect(markup).not.toContain("Open member details for Former Agent");
    expect(markup).toContain(
      'data-member-navigation-key="discussion:1:message:2:member:2"',
    );
    expect(
      markup.match(
        /data-identicon-pattern="010\/101\/110\/111\/100" data-identicon-version="v1" data-member-id="2"/g,
      ),
    ).toHaveLength(2);
    for (const [name, label] of [
      ["Run", "Running"],
      ["Idle", "Idle"],
      ["Pause", "Paused"],
      ["Error", "Error"],
      ["Stopping", "Running"],
    ]) {
      const accessibleSender = `<strong><span class="sr-only">${name}, Agent status: ${label}</span><span aria-hidden="true">${name}</span></strong>`;
      expect(markup.split(accessibleSender)).toHaveLength(2);
    }
    expect(markup).toContain("<strong>You</strong>");
    expect(markup).toContain("<strong>Unknown</strong>");
    expect(markup).not.toMatch(/member-status-avatar[^>]*aria-live=/u);
    expect(markup).not.toMatch(/member-status-avatar[^>]*tabindex=/u);
    const avatarStyles = readFileSync(
      new URL("./components/ui/member-status-avatar.css", import.meta.url),
      "utf8",
    );
    const discussionStyles = readFileSync(
      new URL("./features/discussions/discussions.css", import.meta.url),
      "utf8",
    );
    expect(avatarStyles).toMatch(
      /\.member-status-avatar--interactive:hover\s+\.member-status-avatar__identity\s*\{/u,
    );
    expect(avatarStyles).toMatch(
      /\.member-status-avatar--interactive:focus-visible\s*\{/u,
    );
    expect(discussionStyles).toMatch(
      /\.message-row\s*\{[^}]*align-items:\s*flex-start;/su,
    );
    expect(discussionStyles).toMatch(
      /\.message-avatar\s*\{[^}]*align-self:\s*flex-start;/su,
    );
    expect(discussionStyles).toMatch(/\.discussion-title:focus-visible\s*\{/u);
    expect(discussionStyles).toMatch(
      /\.message-meta\s*\{[^}]*flex-wrap:\s*wrap;/su,
    );
    expect(discussionStyles).toMatch(
      /\.message-meta span\s*\{[^}]*white-space:\s*nowrap;/su,
    );
    expect(discussionStyles).toMatch(
      /\.message-meta strong\s*\{[^}]*overflow-wrap:\s*anywhere;/su,
    );
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
          currentHumanMemberId={1}
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
    expect(markup.match(/data-member-identity="agent"/g)).toHaveLength(
      agents.length,
    );
    expect(
      markup.match(
        /<button[^>]*class="member-status-avatar member-status-avatar--member member-status-avatar--agent member-status-avatar--interactive"[^>]*type="button"/g,
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
          currentHumanMemberId={1}
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
          created_at: "2026-08-22T12:34:56.789Z",
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
          sender_id: 2,
          body: "@OldGone",
          created_at: "2026-07-21T12:34:56.789Z",
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
        {
          id: 3,
          sender_id: 1,
          body: "  \n",
          created_at: "2026-08-22T12:35:56.789Z",
          references: [],
          mentions: [],
        },
        {
          id: 4,
          sender_id: 1,
          body: "Gray summary sentinel unique",
          created_at: "2026-08-22T12:36:56.789Z",
          references: [],
          mentions: [],
        },
        {
          id: 5,
          sender_id: 1,
          body: `Long body sentinel ${"x".repeat(120)}`,
          created_at: "2026-08-22T12:37:56.789Z",
          references: [],
          mentions: [],
        },
      ],
    };
    const markup = renderToStaticMarkup(
      <TooltipProvider>
        <DiscussionsPage
          agents={[renamedAgent, laterSameNameAgent]}
          currentHumanMemberId={1}
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
    const messageMeta =
      markup.match(/<header class="message-meta">[\s\S]*?<\/header>/gu) ?? [];
    expect(markdownIndex).toBeGreaterThan(-1);
    expect(markup).toContain("<br/>\nnext line");
    expect(mentionIndex).toBeGreaterThan(markdownIndex);
    expect(messageMeta).toHaveLength(5);
    for (const meta of messageMeta) {
      expect(meta).not.toMatch(/<\/strong><span>/u);
      expect(meta).not.toContain("Bold request");
      expect(meta).not.toContain("next line");
      expect(meta).not.toContain("No message content");
      expect(meta).not.toContain("Gray summary sentinel unique");
      expect(meta).not.toContain("Long body sentinel");
    }
    expect(markup.split("Gray summary sentinel unique")).toHaveLength(2);
    expect(markup.split("Long body sentinel")).toHaveLength(2);
    expect(markup.match(/class="message-markdown"/gu)).toHaveLength(5);
    expect(markup).toContain("@NewName · READ");
    expect(markup).toContain('title="@NewName · read"');
    expect(markup).not.toContain("@OldName");
    expect(markup).toContain("@OldGone · PENDING");
    expect(markup).toContain('title="@OldGone · pending · Deleted Agent"');
    expect(markup).not.toContain('aria-label="Open OldGone in Members"');
    expect(markup.match(/class="message-timestamp font-mono"/g)).toHaveLength(
      5,
    );
    expect(markup.match(/<time aria-hidden="true" dateTime=/g)).toHaveLength(5);
    expect(markup.match(/<span class="sr-only">Sent /g)).toHaveLength(5);
    expect(markup).not.toContain(", sent ");
    expect(markup).toContain("message-row--human");
    expect(markup).toContain("message-row--agent");
  });

  it("includes total unread and the @me subset in the discussion entry name", () => {
    expect(discussionEntryAccessibleLabel("Review", 2, 1)).toBe(
      "Open Review. 2 unread messages, including 1 unread mention for you.",
    );
    expect(discussionEntryAccessibleLabel("Review", 2, 0)).toBe(
      "Open Review. 2 unread messages.",
    );
    expect(discussionEntryAccessibleLabel("Review", 0, 0)).toBe("Open Review");
  });

  it("positions an initially unread discussion at its first unread message", () => {
    const target = {
      focus: vi.fn(),
      scrollIntoView: vi.fn(),
    };
    const log = {
      querySelector: vi.fn(() => target),
      scrollHeight: 900,
      scrollTop: 37,
    };

    expect(
      positionInitialDiscussionMessages(log as unknown as HTMLElement, 12),
    ).toBe("first-unread");
    expect(log.querySelector).toHaveBeenCalledWith('[data-message-id="12"]');
    expect(target.scrollIntoView).toHaveBeenCalledWith({ block: "center" });
    expect(target.focus).toHaveBeenCalledOnce();
    expect(log.scrollTop).toBe(37);
  });

  it("follows the bottom when an opened discussion has no historical unread", () => {
    const log = {
      querySelector: vi.fn(),
      scrollHeight: 900,
      scrollTop: 37,
    };

    expect(
      positionInitialDiscussionMessages(
        log as unknown as HTMLElement,
        undefined,
      ),
    ).toBe("bottom");
    expect(log.scrollTop).toBe(900);
    expect(log.querySelector).not.toHaveBeenCalled();
  });

  it("preserves the message screen position or follows the bottom for every bar height change", () => {
    const log = { scrollHeight: 1_200, scrollTop: 420 };
    const messageOffsetTop = 600;
    let logViewportTop = 200;
    const messageViewportTop = () =>
      logViewportTop + messageOffsetTop - log.scrollTop;

    preserveActivityBarScrollAnchor(log, null, 64, false);
    expect(log.scrollTop).toBe(420);
    preserveActivityBarScrollAnchor(log, 64, 64, false);
    expect(log.scrollTop).toBe(420);

    const beforeRemoval = messageViewportTop();
    logViewportTop -= 64;
    preserveActivityBarScrollAnchor(log, 64, 0, false);
    expect(messageViewportTop()).toBe(beforeRemoval);

    const beforeRetryWrap = messageViewportTop();
    logViewportTop += 96;
    preserveActivityBarScrollAnchor(log, 0, 96, false);
    expect(messageViewportTop()).toBe(beforeRetryWrap);

    log.scrollHeight = 1_480;
    preserveActivityBarScrollAnchor(log, 96, 120, true);
    expect(log.scrollTop).toBe(1_480);
  });

  it("tracks real activity-bar height changes across pending, error, retry, and narrow wrapping", () => {
    let notifyResize: () => void = () => undefined;
    const observe = vi.fn();
    const disconnect = vi.fn();
    let barHeight = 64;
    const bar = {
      get offsetHeight() {
        return barHeight;
      },
    } as HTMLElement;
    const heights: number[] = [];
    const cleanup = observeActivityBarHeight(
      bar,
      (height) => heights.push(height),
      (callback) => {
        notifyResize = () => callback([], {} as ResizeObserver);
        return { disconnect, observe };
      },
    );

    expect(observe).toHaveBeenCalledWith(bar);
    barHeight = 80;
    notifyResize();
    barHeight = 112;
    notifyResize();
    barHeight = 72;
    notifyResize();
    expect(heights).toEqual([80, 112, 72]);

    cleanup();
    expect(disconnect).toHaveBeenCalledOnce();
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
          joined_after_message_id: 0,
          read_through_message_id: null,
          seen_message_ids: [],
        },
      ],
      messages: [
        {
          id: 1,
          sender_id: 2,
          body: "@You please review",
          created_at: null,
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
          currentHumanMemberId={1}
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

    expect(markup).toContain(
      'aria-label="Open Unread work. 1 unread message, including 1 unread mention for you."',
    );
    expect(markup).toContain('aria-label="1 unread messages"');
    expect(markup).toContain('aria-label="New Discussion activity"');
    expect(markup).toContain("Jump to first unread message (1 unread)");
    expect(markup).toContain("Jump to next unread mention (1 unread)");
    expect(markup).toContain('<hr aria-label="New messages"');
    expect(markup).toContain('data-message-id="1" tabindex="-1"');
  });

  it("keeps @me access inside Discussions without a standalone Mentions surface", () => {
    const agent = {
      id: 2,
      type: "agent" as const,
      name: "RenamedAgent",
      status: "idle" as const,
    };
    const discussion = {
      id: 1,
      topic: "Human review",
      member_ids: [1, 2],
      messages: [
        {
          id: 1,
          sender_id: 2,
          sender_name: "OriginalAgent",
          body: "@Owner review",
          created_at: null,
          references: [
            {
              member_id: 1,
              name: "Owner",
              start: 0,
              end: 6,
              in_discussion: true,
              notified: true,
              deleted: false,
            },
          ],
          mentions: [],
          human_mentions: [{ member_id: 1, status: "unread" as const }],
        },
      ],
    };
    const markup = renderToStaticMarkup(
      <TooltipProvider>
        <DiscussionsPage
          agents={[agent]}
          currentHumanMemberId={1}
          disabled={false}
          discussions={[discussion]}
          error={null}
          isCreating={false}
          members={[{ id: 1, type: "human", name: "Owner" }, agent]}
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

    expect(markup).not.toContain('aria-label="Human mention notifications"');
    expect(markup).not.toContain("<h2>Mentions</h2>");
    expect(markup).toContain(
      'aria-label="Open Human review. 1 unread message, including 1 unread mention for you."',
    );
    expect(markup).toContain("Jump to next unread mention (1 unread)");
    expect(markup).toContain(
      '<span class="sr-only">OriginalAgent, Agent status: Idle</span><span aria-hidden="true">OriginalAgent</span>',
    );
    expect(markup).toContain(
      'aria-label="Open member details for OriginalAgent"',
    );
    expect(markup).toContain(
      'data-member-navigation-key="discussion:1:message:1:member:2"',
    );
    expect(markup).not.toContain(
      '<span class="sr-only">RenamedAgent, Agent status: Idle</span>',
    );
    expect(markup).toContain(
      'aria-label="Open delivery details for @Owner: Status unknown ?"',
    );
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
    expect(markup).not.toContain(">Mentions<");
    expect(markup).not.toContain('aria-label="Mentions"');
    expect(markup).toContain(">Members<");
    expect(markup).not.toContain(">Agents<");
    expect(markup).toContain(">Permissions<");
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
    expect(navigationButtons).toHaveLength(4);
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
          namePolicy={memberNamePolicy}
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
    expect(markup).not.toContain(">Member ID<");
    expect(markup).not.toContain("Technical details");
    expect(markup).not.toContain('aria-label="Copy Member ID"');
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
          namePolicy={memberNamePolicy}
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
            namePolicy={memberNamePolicy}
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
          namePolicy={memberNamePolicy}
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
          namePolicy={memberNamePolicy}
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
    expect(markup).toContain(">Formal name<");
    expect(markup).toContain('aria-label="Rename current Human"');
    expect(markup).toContain('id="human-formal-name"');
    expect(markup).toContain(
      "32 Unicode code points after NFKC normalization and 128 UTF-8 bytes",
    );
    expect(markup).not.toContain(">Member ID<");
    expect(markup).not.toContain("Technical details");
    expect(markup).not.toContain('aria-label="Copy Member ID"');
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
          namePolicy={memberNamePolicy}
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

  it("shows Humans as inherent Discussion participants without controls", () => {
    const markup = renderToStaticMarkup(
      <DiscussionForm
        agents={[{ id: 2, name: "Ada" }]}
        humans={[
          { id: 1, name: "Owner" },
          { id: 3, name: "Guest" },
        ]}
        disabled={false}
        error={null}
        onCancel={() => undefined}
        onSubmit={() => undefined}
        onToggleMember={() => undefined}
        selectedMemberIds={[]}
        setTopic={() => undefined}
        topic="Work"
      />,
    );

    expect(markup).toContain('aria-label="Inherent Human participants"');
    expect(markup).toContain("Owner · Human");
    expect(markup).toContain("Guest · Human");
    expect(markup).not.toContain("discussion-member-1");
    expect(markup).not.toContain("discussion-member-3");
    expect(markup).toContain("discussion-member-2");
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
