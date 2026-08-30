import type { ReactNode } from "react";
import "./shell.css";

export type Section = "discussions" | "members" | "library" | "settings";

const SECTIONS: { id: Section; label: string; glyph: string }[] = [
  { id: "discussions", label: "Discussions", glyph: "◇" },
  { id: "members", label: "Members", glyph: "◎" },
  { id: "library", label: "Library", glyph: "▤" },
];

export function Rail({
  active,
  onSelect,
}: {
  active: Section;
  onSelect: (section: Section) => void;
}) {
  return (
    <nav className="rail" aria-label="Sections">
      {SECTIONS.map((section) => (
        <button
          key={section.id}
          type="button"
          className="rail-button"
          aria-current={active === section.id ? "page" : undefined}
          aria-label={section.label}
          title={section.label}
          onClick={() => onSelect(section.id)}
        >
          {section.glyph}
        </button>
      ))}
      <span className="rail-spacer" />
      <button
        type="button"
        className="rail-button"
        aria-current={active === "settings" ? "page" : undefined}
        aria-label="Settings"
        title="Settings"
        onClick={() => onSelect("settings")}
      >
        ⚙
      </button>
    </nav>
  );
}

export function Panel({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="panel" aria-label={title}>
      <header className="panel-header">
        <span className="panel-title">{title}</span>
        {action}
      </header>
      <div className="panel-body">{children}</div>
    </section>
  );
}

export function Main({
  title,
  subtitle,
  actions,
  banner,
  children,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  banner?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="main">
      <header className="main-header">
        <div className="row-text">
          <h2 className="row-title">{title}</h2>
          {subtitle ? <span className="row-meta">{subtitle}</span> : null}
        </div>
        {actions}
      </header>
      {banner ? <div className="banner">{banner}</div> : null}
      <div className="main-body">{children}</div>
    </section>
  );
}

export function Row({
  title,
  meta,
  leading,
  trailing,
  selected,
  onClick,
}: {
  title: string;
  meta?: string;
  leading?: ReactNode;
  trailing?: ReactNode;
  selected?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      className="row"
      aria-current={selected ? "true" : undefined}
      onClick={onClick}
    >
      {leading}
      <span className="row-text">
        <span className="row-title">{title}</span>
        {meta ? <span className="row-meta">{meta}</span> : null}
      </span>
      {trailing}
    </button>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  return <div className="shell">{children}</div>;
}
