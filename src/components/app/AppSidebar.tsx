import { Button, Tooltip } from "@radix-ui/themes";
import {
  Bot,
  MessageSquare,
  Network,
  PlayCircle,
  Settings,
} from "lucide-react";
import { Brand } from "@/components/app/Brand";
import type { AppView } from "@/types/navigation";

interface AppSidebarProps {
  activeView: AppView;
  onNavigate: (view: AppView) => void;
}

const primaryItems = [
  { id: "workflows", label: "Workflows", icon: Network },
  { id: "agents", label: "Agents", icon: Bot },
  { id: "runs", label: "Runs", icon: PlayCircle },
  { id: "chat", label: "Chat", icon: MessageSquare },
] satisfies Array<{
  id: AppView;
  label: string;
  icon: typeof Network;
}>;

export function AppSidebar({ activeView, onNavigate }: AppSidebarProps) {
  return (
    <aside className="app-sidebar">
      <div className="sidebar-brand-row">
        <Brand />
      </div>

      <nav className="primary-nav" aria-label="Main navigation">
        {primaryItems.map((item) => {
          const Icon = item.icon;
          return (
            <Tooltip content={item.label} key={item.id} side="right">
              <Button
                aria-current={activeView === item.id ? "page" : undefined}
                className="nav-button"
                color="gray"
                highContrast
                onClick={() => onNavigate(item.id)}
                variant="ghost"
              >
                <Icon size={17} strokeWidth={1.7} />
                <span>{item.label}</span>
              </Button>
            </Tooltip>
          );
        })}
      </nav>

      <div className="sidebar-spacer" />

      <Button
        aria-current={activeView === "settings" ? "page" : undefined}
        className="nav-button"
        color="gray"
        highContrast
        onClick={() => onNavigate("settings")}
        variant="ghost"
      >
        <Settings size={17} strokeWidth={1.7} />
        <span>Settings</span>
      </Button>

      <div className="runtime-card">
        <span className="status-light" data-state="ready" aria-hidden="true" />
        <span>Runtime</span>
        <span className="runtime-state">Ready</span>
      </div>
    </aside>
  );
}
