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
  className?: string;
}

export function WorkspaceCommandDialog({
  open,
  onOpenChange,
  title,
  children,
  footer,
  className,
}: WorkspaceCommandDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn("flex max-h-[calc(100svh-2rem)] flex-col p-0", className)}
      >
        <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden p-6">
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-foreground/[0.04] to-transparent opacity-50" />
          <DialogClose asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label="Close dialog"
              className="absolute right-4 top-4 z-20 size-7 rounded-md bg-accent/45 text-muted-foreground hover:bg-accent/65 hover:text-accent-foreground"
            >
              <X className="size-3.5" />
            </Button>
          </DialogClose>

          <DialogHeader className="relative z-10 shrink-0 pr-8">
            <DialogTitle className="text-[1.1rem] font-medium text-foreground">
              {title}
            </DialogTitle>
            <DialogDescription className="sr-only">{title}</DialogDescription>
          </DialogHeader>

          <div
            className="relative z-10 mt-6 min-h-0 flex-1 space-y-4 overflow-y-auto pr-1 scrollbar-none"
            data-testid="workspace-command-dialog-body"
          >
            {children}
          </div>

          <DialogFooter className="relative z-10 mt-6 shrink-0 border-t border-border pt-4">
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
  children,
}: {
  label: string;
  hint?: string;
  hintMode?: "text" | "tooltip";
  children: ReactNode;
}) {
  if (hintMode === "tooltip") {
    return (
      <div className="block space-y-1.5">
        <div className="flex items-center justify-between gap-3">
          <span className="inline-flex min-w-0 items-center gap-1.5 text-sm font-medium text-foreground/80">
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
                      className="size-5 rounded-full text-muted-foreground hover:bg-accent/35 hover:text-foreground"
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
    <label className="block space-y-1.5">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium text-foreground/80">{label}</span>
        {hint ? (
          <span className="text-xs text-muted-foreground">{hint}</span>
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
