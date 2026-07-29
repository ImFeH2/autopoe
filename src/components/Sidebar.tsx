import { Button } from "@radix-ui/themes";
import { ChatIcon, PlusIcon } from "@/components/Icons";

interface SidebarProps {
  disabled: boolean;
  title: string;
  onNew: () => void;
}

export function Sidebar({ disabled, title, onNew }: SidebarProps) {
  return (
    <aside className="sidebar">
      <div className="brand-row">
        <span className="brand-mark" aria-hidden="true">
          <span />
        </span>
        <span className="brand-name">Flowent</span>
      </div>

      <Button
        className="new-chat-button"
        color="gray"
        disabled={disabled}
        highContrast
        onClick={onNew}
        variant="soft"
      >
        <PlusIcon />
        New
      </Button>

      <nav className="history" aria-label="Conversations">
        <span className="history-label">Today</span>
        <Button
          aria-current="page"
          className="history-item"
          color="gray"
          highContrast
          variant="ghost"
        >
          <ChatIcon />
          <span>{title}</span>
        </Button>
      </nav>

      <div className="runtime-status">
        <span className="runtime-dot" aria-hidden="true" />
        <span>Local runtime</span>
        <span className="runtime-tag">Demo</span>
      </div>
    </aside>
  );
}
