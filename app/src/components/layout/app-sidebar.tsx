import {
  Badge,
  Button,
  MessageSquare,
  Settings2,
  Tooltip,
  Users,
} from "@/components/ui";

export type WorkspaceView = "discussions" | "members" | "settings";

type AppSidebarProps = {
  discussionCount: number;
  memberCount: number;
  onSelectView: (view: WorkspaceView) => void;
  view: WorkspaceView;
  workingDirectory: string;
};

const navigation = [
  { icon: MessageSquare, label: "Discussions", view: "discussions" },
  { icon: Users, label: "Members", view: "members" },
] as const;

export function AppSidebar({
  discussionCount,
  memberCount,
  onSelectView,
  view,
  workingDirectory,
}: AppSidebarProps) {
  const counts: Record<Exclude<WorkspaceView, "settings">, number> = {
    discussions: discussionCount,
    members: memberCount,
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
            <Tooltip content={item.label} key={item.view} side="right">
              <Button
                aria-current={view === item.view ? "page" : undefined}
                aria-label={item.label}
                className="sidebar-nav-button"
                onClick={() => onSelectView(item.view)}
                variant={view === item.view ? "secondary" : "quiet"}
              >
                <Icon aria-hidden="true" size={15} />
                <span>{item.label}</span>
                <Badge className="sidebar-count" size="small">
                  {counts[item.view]}
                </Badge>
              </Button>
            </Tooltip>
          );
        })}
      </nav>

      <div className="sidebar-footer">
        <Tooltip content="Settings" side="right">
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
        </Tooltip>
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
