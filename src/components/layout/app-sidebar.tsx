import { Bot, Button, MessageSquare, Settings2, Users } from "@/components/ui";

export type WorkspaceView = "discussions" | "members" | "agents" | "settings";

type AppSidebarProps = {
  agentCount: number;
  discussionCount: number;
  memberCount: number;
  onSelectView: (view: WorkspaceView) => void;
  view: WorkspaceView;
  workingDirectory: string;
};

const navigation = [
  { icon: MessageSquare, label: "Discussions", view: "discussions" },
  { icon: Users, label: "Members", view: "members" },
  { icon: Bot, label: "Agents", view: "agents" },
] as const;

export function AppSidebar({
  agentCount,
  discussionCount,
  memberCount,
  onSelectView,
  view,
  workingDirectory,
}: AppSidebarProps) {
  const counts: Record<Exclude<WorkspaceView, "settings">, number> = {
    discussions: discussionCount,
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
              <span className="sidebar-count">{counts[item.view]}</span>
            </Button>
          );
        })}
      </nav>

      <div className="sidebar-footer">
        <Button
          aria-current={view === "settings" ? "page" : undefined}
          aria-label="Settings"
          className="sidebar-settings-button"
          onClick={() => onSelectView("settings")}
          variant={view === "settings" ? "secondary" : "quiet"}
        >
          <Settings2 aria-hidden="true" size={15} />
          <span>Settings</span>
        </Button>
        <footer className="sidebar-user" title={workingDirectory}>
          <span className="sidebar-user-mark" aria-hidden="true">
            Y
          </span>
          <span className="sidebar-user-copy">
            <strong>You</strong>
            <span className="truncate">{workingDirectory}</span>
          </span>
        </footer>
      </div>
    </aside>
  );
}
