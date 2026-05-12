import { Info } from "lucide-react";
import type { ReactNode } from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { PanelCard } from "@/components/surface";
import { cn } from "@/lib/utils";

interface PageScaffoldProps {
  children: ReactNode;
  className?: string;
}

interface SoftPanelProps {
  children: ReactNode;
  className?: string;
}

interface PageTitleBarProps {
  actions?: ReactNode;
  className?: string;
  hint?: string;
  title: string;
}

export function PageScaffold({ children, className }: PageScaffoldProps) {
  return (
    <div
      className={cn("flex h-full flex-col min-h-0 overflow-hidden", className)}
    >
      {children}
    </div>
  );
}

export function SoftPanel({ children, className }: SoftPanelProps) {
  return (
    <PanelCard
      as="section"
      padding="md"
      className={cn(
        "border-transparent bg-card/[0.18] ring-1 ring-white/[0.04]",
        className,
      )}
    >
      {children}
    </PanelCard>
  );
}

export function PageTitleBar({
  actions,
  className,
  hint,
  title,
}: PageTitleBarProps) {
  return (
    <div className={cn("border-b border-border/70 pb-4", className)}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-2">
          <h1 className="text-[28px] font-medium tracking-[-0.04em] text-foreground">
            {title}
          </h1>
          {hint ? (
            <TooltipProvider delayDuration={150}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="inline-flex size-7 items-center justify-center rounded-full border border-border/70 bg-card/20 text-muted-foreground transition-colors hover:bg-accent/35 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                    aria-label={`${title} details`}
                  >
                    <Info className="size-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="right" className="max-w-xs px-3 py-2">
                  {hint}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          ) : null}
        </div>
        {actions ? (
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {actions}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function SectionHeader({ title }: { title: string }) {
  return (
    <div className="mb-4">
      <h2 className="text-[14px] font-medium tracking-tight text-foreground/90">
        {title}
      </h2>
    </div>
  );
}

export function FormSection({
  children,
  className,
  contentClassName,
  separated = false,
  title,
}: {
  children: ReactNode;
  className?: string;
  contentClassName?: string;
  separated?: boolean;
  title: string;
}) {
  return (
    <section
      className={cn(
        separated ? "border-t border-border pt-8" : "mb-10",
        className,
      )}
    >
      <SectionHeader title={title} />
      <div
        className={cn(
          "rounded-xl border border-white/[0.04] bg-card/[0.03] shadow-sm px-5 transition-colors",
          contentClassName,
        )}
      >
        {children}
      </div>
    </section>
  );
}

export function SettingsRow({
  label,
  description,
  children,
  valueClassName,
}: {
  label: string;
  description?: string;
  children: ReactNode;
  valueClassName?: string;
}) {
  return (
    <div className="flex flex-col gap-2 border-b border-border/40 py-5 last:border-b-0 md:flex-row md:items-start md:justify-between md:gap-8 hover:bg-muted/10 transition-colors">
      <div className="min-w-0 shrink-0 md:w-[35%] pt-1">
        <label className="block text-[13px] font-medium text-foreground/80 tracking-tight">
          {label}
        </label>
        {description && (
          <p className="mt-1 text-[12px] text-muted-foreground/70 leading-relaxed pr-4">
            {description}
          </p>
        )}
      </div>
      <div
        className={cn(
          "w-full min-w-0 flex-1 md:w-[65%] flex md:justify-end",
          valueClassName,
        )}
      >
        <div className="w-full md:max-w-md space-y-3">{children}</div>
      </div>
    </div>
  );
}

export function SettingsStack({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 border-b border-border/40 py-5 last:border-b-0 hover:bg-muted/10 transition-colors">
      <div className="min-w-0 pt-1">
        <label className="block text-[13px] font-medium text-foreground/80 tracking-tight">
          {label}
        </label>
        {description && (
          <p className="mt-1.5 text-[12px] text-muted-foreground/70 leading-relaxed max-w-2xl">
            {description}
          </p>
        )}
      </div>
      <div className="w-full mt-1">{children}</div>
    </div>
  );
}

export function SettingsGroup({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "mt-3 flex flex-col gap-3 rounded-lg border border-border/40 bg-background/30 p-4",
        className,
      )}
    >
      {children}
    </div>
  );
}
