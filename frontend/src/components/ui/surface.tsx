import type { HTMLAttributes, ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const surfacePanelClass =
  "rounded-xl border border-border bg-card/30 shadow-none";
export const surfacePanelSoftClass =
  "rounded-xl bg-card/[0.18] ring-1 ring-white/[0.04]";
export const sectionSurfaceClass =
  "overflow-hidden rounded-xl border border-border bg-surface-2 shadow-sm";
export const mutedLabelClass =
  "text-[12px] font-medium text-muted-foreground/80";
export const smallMutedTextClass =
  "text-[11px] leading-relaxed text-muted-foreground";

const panelPaddingClass = {
  none: "",
  sm: "px-4 py-3",
  md: "p-5",
  lg: "p-6",
};

type PanelCardProps = HTMLAttributes<HTMLElement> & {
  as?: "article" | "div" | "section";
  padding?: keyof typeof panelPaddingClass;
  selected?: boolean;
};

export function PanelCard({
  as: Comp = "section",
  children,
  className,
  padding = "md",
  selected = false,
  ...props
}: PanelCardProps) {
  return (
    <Comp
      className={cn(
        surfacePanelClass,
        panelPaddingClass[padding],
        selected && "bg-accent/20",
        className,
      )}
      {...props}
    >
      {children}
    </Comp>
  );
}

type IconTileTone = "danger" | "default" | "idle" | "primary" | "running";

const iconTileToneClass: Record<IconTileTone, string> = {
  default: "border-border bg-accent/20 text-muted-foreground",
  danger: "border-destructive/20 bg-destructive/10 text-destructive",
  idle: "border-graph-status-idle/20 bg-graph-status-idle/[0.12] text-graph-status-idle",
  primary: "border-primary/20 bg-primary/[0.1] text-primary",
  running:
    "border-graph-status-running/20 bg-graph-status-running/[0.12] text-graph-status-running",
};

export function IconTile({
  className,
  icon: Icon,
  size = "md",
  tone = "default",
}: {
  className?: string;
  icon: LucideIcon;
  size?: "lg" | "md" | "sm";
  tone?: IconTileTone;
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-center rounded-xl border shadow-sm",
        size === "lg" ? "size-14" : size === "sm" ? "size-9" : "size-12",
        iconTileToneClass[tone],
        className,
      )}
    >
      <Icon
        className={cn(
          size === "lg" ? "size-6" : size === "sm" ? "size-4" : "size-5",
        )}
      />
    </div>
  );
}

type PageStateTone = "danger" | "default" | "idle" | "running";

export function PageState({
  action,
  className,
  description,
  icon,
  minHeightClassName = "min-h-[280px]",
  title,
  tone = "default",
}: {
  action?: ReactNode;
  className?: string;
  description?: ReactNode;
  icon?: LucideIcon;
  minHeightClassName?: string;
  title: string;
  tone?: PageStateTone;
}) {
  return (
    <PanelCard
      className={cn(
        "flex flex-col items-center justify-center text-center",
        minHeightClassName,
        className,
      )}
    >
      {icon ? <IconTile icon={icon} tone={tone} /> : null}
      <h2 className="mt-5 text-xl font-medium text-foreground">{title}</h2>
      {description ? (
        <p className="mt-2 max-w-xl text-[13px] leading-6 text-muted-foreground">
          {description}
        </p>
      ) : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </PanelCard>
  );
}

export function MetricCard({
  accentClassName,
  className,
  icon: Icon,
  label,
  value,
}: {
  accentClassName?: string;
  className?: string;
  icon?: LucideIcon;
  label: string;
  value: ReactNode;
}) {
  return (
    <PanelCard
      className={cn(
        "flex min-h-[140px] flex-col justify-between gap-4 py-4",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm font-medium text-muted-foreground">{label}</div>
        {Icon ? (
          <div
            className={cn(
              "flex size-8 items-center justify-center rounded-md bg-accent/20 text-muted-foreground",
              accentClassName,
            )}
          >
            <Icon className="size-4" />
          </div>
        ) : null}
      </div>
      <div className="text-2xl font-semibold leading-none tracking-tight">
        {value}
      </div>
    </PanelCard>
  );
}

type StatusTone =
  | "danger"
  | "idle"
  | "muted"
  | "neutral"
  | "primary"
  | "running";

const statusToneClass: Record<StatusTone, string> = {
  danger: "border-destructive/30 bg-destructive/10 text-destructive",
  idle: "border-graph-status-idle/20 bg-graph-status-idle/[0.12] text-graph-status-idle",
  muted: "border-border bg-accent/25 text-muted-foreground",
  neutral: "border-border bg-accent/20 text-muted-foreground",
  primary: "border-primary/20 bg-primary/[0.1] text-primary",
  running:
    "border-graph-status-running/20 bg-graph-status-running/[0.12] text-graph-status-running",
};

export function StatusChip({
  children,
  className,
  tone = "neutral",
  uppercase = false,
}: {
  children: ReactNode;
  className?: string;
  tone?: StatusTone;
  uppercase?: boolean;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-fit w-fit shrink-0 items-center rounded-full border px-2.5 py-1 text-[10px] font-medium",
        uppercase && "uppercase tracking-[0.14em]",
        statusToneClass[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function FilterToggle({
  active,
  label,
  onClick,
  variant = "pill",
}: {
  active: boolean;
  label: string;
  onClick: () => void;
  variant?: "pill" | "tab";
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={onClick}
      className={cn(
        variant === "pill"
          ? "inline-flex h-8 items-center rounded-full border px-3 text-[12px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          : "inline-flex h-8 -mb-px items-center border-b-2 px-1 text-[12px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
        variant === "pill"
          ? active
            ? "border-border bg-card/30 text-foreground"
            : "border-transparent bg-card/20 text-muted-foreground hover:bg-accent/25 hover:text-foreground"
          : active
            ? "border-primary text-foreground"
            : "border-transparent text-muted-foreground hover:text-foreground",
      )}
    >
      {label}
    </Button>
  );
}

export function CodeBlock({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <pre
      className={cn(
        "select-text overflow-auto rounded-xl border border-border bg-background/50 p-4 text-[11px] font-mono leading-6 text-foreground/75 scrollbar-none",
        className,
      )}
    >
      {children}
    </pre>
  );
}

export function ReadonlyBlock({
  className,
  label,
  mono = false,
  value,
}: {
  className?: string;
  label: string;
  mono?: boolean;
  value: string;
}) {
  return (
    <div className={cn("space-y-2", className)}>
      <p className={mutedLabelClass}>{label}</p>
      <pre
        className={cn(
          "min-h-[44px] select-text whitespace-pre-wrap break-all rounded-xl border border-border bg-background/40 px-4 py-3 text-[12px] leading-6 text-foreground/80",
          mono && "font-mono text-[11px]",
        )}
      >
        {value}
      </pre>
    </div>
  );
}

export function DetailSection({
  children,
  className,
  title,
}: {
  children: ReactNode;
  className?: string;
  title: string;
}) {
  return (
    <section className={cn("border-t border-border pt-3.5", className)}>
      <p className="text-[10px] font-semibold text-muted-foreground">{title}</p>
      <div className="mt-2">{children}</div>
    </section>
  );
}
