import { Info, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

interface WorkspaceCommandDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: ReactNode;
  footer: ReactNode;
  bodyClassName?: string;
  className?: string;
  tone?: "default" | "black";
}

export function WorkspaceCommandDialog({
  open,
  onOpenChange,
  title,
  children,
  footer,
  bodyClassName,
  className,
  tone = "default",
}: WorkspaceCommandDialogProps) {
  const isBlack = tone === "black";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className={cn(
          "flex max-h-[calc(100svh-2rem)] flex-col p-0",
          isBlack &&
            "border border-white/10 bg-black text-white ring-white/10 shadow-2xl",
          className,
        )}
      >
        <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden p-6">
          {!isBlack ? (
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-foreground/[0.04] to-transparent opacity-50" />
          ) : null}
          <DialogClose asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label="Close dialog"
              className={cn(
                "absolute right-4 top-4 z-20 size-7 rounded-md",
                isBlack
                  ? "bg-transparent text-white/45 hover:bg-white/10 hover:text-white"
                  : "bg-accent/45 text-muted-foreground hover:bg-accent/65 hover:text-accent-foreground",
              )}
            >
              <X className="size-3.5" />
            </Button>
          </DialogClose>

          <DialogHeader className="relative z-10 shrink-0 pr-8">
            <DialogTitle
              className={cn(
                "text-[1.1rem] font-medium",
                isBlack ? "text-white/90" : "text-foreground",
              )}
            >
              {title}
            </DialogTitle>
            <DialogDescription className="sr-only">{title}</DialogDescription>
          </DialogHeader>

          <div
            className={cn(
              "relative z-10 mt-6 min-h-0 flex-1 space-y-4 overflow-y-auto pr-1 scrollbar-none",
              bodyClassName,
            )}
            data-testid="workspace-command-dialog-body"
          >
            {children}
          </div>

          <DialogFooter
            className={cn(
              isBlack
                ? "relative z-10 -mx-6 mb-0 mt-5 shrink-0 rounded-none border-t border-white/10 bg-transparent px-6 pb-0 pt-4"
                : "relative z-10 mt-6 shrink-0 border-t border-border pt-4",
            )}
          >
            {footer}
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function WorkspaceDialogField({
  label,
  hint,
  hintMode = "text",
  tone = "default",
  className,
  children,
}: {
  label: string;
  hint?: string;
  hintMode?: "text" | "tooltip";
  tone?: "default" | "black";
  className?: string;
  children: ReactNode;
}) {
  const labelClassName =
    tone === "black" ? "text-white/65" : "text-foreground/80";
  const hintClassName =
    tone === "black" ? "text-white/35" : "text-muted-foreground";

  if (hintMode === "tooltip") {
    return (
      <div className={cn("block space-y-1.5", className)}>
        <div className="flex items-center justify-between gap-3">
          <span
            className={cn(
              "inline-flex min-w-0 items-center gap-1.5 text-sm font-medium",
              labelClassName,
            )}
          >
            <span className="truncate">{label}</span>
            {hint ? (
              <TooltipProvider delayDuration={150}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      aria-label={`${label} details`}
                      className={cn(
                        "size-5 rounded-full",
                        tone === "black"
                          ? "text-white/35 hover:bg-white/10 hover:text-white/80"
                          : "text-muted-foreground hover:bg-accent/35 hover:text-foreground",
                      )}
                    >
                      <Info className="size-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent
                    side="top"
                    sideOffset={8}
                    className="max-w-[min(18rem,calc(100vw-2rem))] whitespace-normal px-3 py-2 text-center leading-relaxed"
                  >
                    {hint}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            ) : null}
          </span>
        </div>
        {children}
      </div>
    );
  }

  return (
    <label className={cn("block space-y-1.5", className)}>
      <div className="flex items-center justify-between gap-3">
        <span className={cn("text-sm font-medium", labelClassName)}>
          {label}
        </span>
        {hint ? (
          <span className={cn("text-xs", hintClassName)}>{hint}</span>
        ) : null}
      </div>
      {children}
    </label>
  );
}

export function WorkspaceDialogMeta({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-accent/35 px-3.5 py-2.5 text-xs text-muted-foreground">
      {children}
    </div>
  );
}
