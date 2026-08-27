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
};

const navigation = [
  {
    count: "discussions",
    icon: MessageSquare,
    label: "Discussions",
    view: "discussions",
  },
  { count: "members", icon: Users, label: "Members", view: "members" },
  { icon: Settings2, label: "Settings", view: "settings" },
] as const;

export function AppSidebar({
  discussionCount,
  memberCount,
  onSelectView,
  view,
}: AppSidebarProps) {
  const counts: Record<Exclude<WorkspaceView, "settings">, number> = {
    discussions: discussionCount,
    members: memberCount,
  };

  return (
    <aside className="app-sidebar border-border border-r bg-surface-subtle">
      <div className="sidebar-brand">
        <img
          alt=""
          aria-hidden="true"
          className="sidebar-brand-mark"
          src="/icon.png"
        />
        <h1 className="app-brand m-0 font-semibold">Huddol</h1>
      </div>

      <nav className="sidebar-navigation" aria-label="Workspace">
        {navigation.map((item) => {
          const Icon = item.icon;
          const count = "count" in item ? counts[item.count] : null;
          return (
            <Tooltip content={item.label} key={item.view} side="right">
              <Button
                aria-current={view === item.view ? "page" : undefined}
                aria-label={item.label}
                className={`sidebar-nav-button${item.view === "settings" ? " sidebar-nav-button--bottom" : ""}`}
                onClick={() => onSelectView(item.view)}
                variant={view === item.view ? "secondary" : "quiet"}
              >
                <Icon aria-hidden="true" size={15} />
                <span>{item.label}</span>
                {count === null ? null : (
                  <Badge className="sidebar-count" size="small">
                    {count}
                  </Badge>
                )}
              </Button>
            </Tooltip>
          );
        })}
      </nav>
    </aside>
  );
}
