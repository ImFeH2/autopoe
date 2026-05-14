import type { CSSProperties, HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

type ShellBackgroundVariant = "app" | "access";
type ShellSurfaceVariant = "workspace" | "page" | "access";

const backgroundStyles: Record<ShellBackgroundVariant, string> = {
  app: "var(--shell-app-bg)",
  access: "var(--shell-access-bg)",
};

const surfaceStyles: Record<ShellSurfaceVariant, string> = {
  workspace: "var(--shell-surface-workspace)",
  page: "var(--shell-surface-page)",
  access: "var(--shell-surface-access)",
};

interface ShellBackgroundProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  variant: ShellBackgroundVariant;
}

interface ShellSurfaceProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  variant: ShellSurfaceVariant;
}

export function ShellBackground({
  children,
  className,
  style,
  variant,
  ...props
}: ShellBackgroundProps) {
  return (
    <div
      {...props}
      className={cn(
        "relative overflow-hidden",
        variant === "app" ? "h-screen" : "min-h-screen",
        className,
      )}
      style={
        {
          ...style,
          background: backgroundStyles[variant],
        } as CSSProperties
      }
    >
      {children}
    </div>
  );
}

export function ShellSurface({
  children,
  className,
  style,
  variant,
  ...props
}: ShellSurfaceProps) {
  return (
    <div
      {...props}
      className={cn("relative isolate overflow-hidden", className)}
      style={
        {
          ...style,
          background: surfaceStyles[variant],
        } as CSSProperties
      }
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-px"
        style={{ background: "var(--shell-hairline)" }}
      />
      {children}
    </div>
  );
}
