import {
  Bot,
  Button,
  ChevronDown,
  Grid2X2,
  MessageSquare,
  Settings2,
  Users,
} from "@/components/ui";

export type WorkspaceView = "overview" | "discussions" | "members" | "agents";

type SidebarDiscussion = {
  id: number;
  messageCount: number;
  topic: string;
};

type AppSidebarProps = {
  agentCount: number;
  discussions: SidebarDiscussion[];
  memberCount: number;
  onSelectDiscussion: (discussionId: number) => void;
  onSelectView: (view: WorkspaceView) => void;
  selectedDiscussionId?: number;
  view: WorkspaceView;
  workingDirectory: string;
};

const navigation = [
  { icon: Grid2X2, label: "Overview", view: "overview" },
  { icon: MessageSquare, label: "Discussions", view: "discussions" },
  { icon: Users, label: "Members", view: "members" },
  { icon: Bot, label: "Agents", view: "agents" },
] as const;

export function AppSidebar({
  agentCount,
  discussions,
  memberCount,
  onSelectDiscussion,
  onSelectView,
  selectedDiscussionId,
  view,
  workingDirectory,
}: AppSidebarProps) {
  const counts: Record<WorkspaceView, number | undefined> = {
    overview: undefined,
    discussions: discussions.length,
    members: memberCount,
    agents: agentCount,
  };

  return (
    <aside className="app-sidebar border-border border-r bg-surface-subtle">
      <div className="sidebar-brand">
        <span className="sidebar-brand-mark" aria-hidden="true">
          F
        </span>
        <h1 className="app-brand m-0 font-semibold">Flowent</h1>
      </div>

      <div className="organization-switcher">
        <span className="organization-mark" aria-hidden="true">
          1
        </span>
        <span className="truncate">Organization 1</span>
        <ChevronDown aria-hidden="true" size={14} />
      </div>

      <nav className="sidebar-navigation" aria-label="Workspace">
        {navigation.map((item) => {
          const Icon = item.icon;
          return (
            <Button
              aria-current={view === item.view ? "page" : undefined}
              aria-label={item.label}
              className="sidebar-nav-button"
              key={item.view}
              onClick={() => onSelectView(item.view)}
              variant={view === item.view ? "secondary" : "quiet"}
            >
              <Icon aria-hidden="true" size={15} />
              <span>{item.label}</span>
              {counts[item.view] !== undefined ? (
                <span className="sidebar-count">{counts[item.view]}</span>
              ) : null}
            </Button>
          );
        })}
      </nav>

      <section className="sidebar-recent" aria-labelledby="recent-title">
        <h2 className="sidebar-section-label" id="recent-title">
          Recent
        </h2>
        <div className="sidebar-recent-list">
          {discussions.length === 0 ? (
            <p className="caption-text m-0 text-text-tertiary">
              No discussions
            </p>
          ) : (
            discussions.map((discussion) => (
              <Button
                aria-label={`Open ${discussion.topic}`}
                aria-current={
                  view === "discussions" &&
                  selectedDiscussionId === discussion.id
                    ? "page"
                    : undefined
                }
                className="sidebar-recent-button"
                key={discussion.id}
                onClick={() => onSelectDiscussion(discussion.id)}
                variant={
                  view === "discussions" &&
                  selectedDiscussionId === discussion.id
                    ? "secondary"
                    : "quiet"
                }
              >
                <span className="sidebar-recent-copy">
                  <span className="sidebar-recent-title">
                    {discussion.topic}
                  </span>
                  <span className="meta-text text-text-tertiary">
                    {discussion.messageCount} messages
                  </span>
                </span>
              </Button>
            ))
          )}
        </div>
      </section>

      <footer className="sidebar-user" title={workingDirectory}>
        <span className="sidebar-user-mark" aria-hidden="true">
          Y
        </span>
        <span className="sidebar-user-copy">
          <strong>You</strong>
          <span className="truncate">{workingDirectory}</span>
        </span>
        <Settings2 aria-hidden="true" size={14} />
      </footer>
    </aside>
  );
}
