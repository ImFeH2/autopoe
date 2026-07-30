import type { ReactNode } from "react";

interface AppHeaderProps {
  title: string;
  meta?: string;
  actions?: ReactNode;
}

export function AppHeader({ title, meta, actions }: AppHeaderProps) {
  return (
    <header className="app-header" data-tauri-drag-region>
      <div className="header-title" data-tauri-drag-region>
        <span>{title}</span>
        {meta ? <span className="header-meta">{meta}</span> : null}
      </div>
      {actions ? <div className="header-actions">{actions}</div> : null}
    </header>
  );
}
