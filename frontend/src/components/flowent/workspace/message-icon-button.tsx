import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export function MessageIconButton({
  children,
  className,
  disabled,
  label,
  onClick,
}: {
  children: ReactNode;
  className?: string;
  disabled?: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          aria-label={label}
          className={cn(
            "size-7 rounded-lg border-0 bg-transparent text-white/45 shadow-none transition-colors hover:bg-white/10 hover:text-white focus-visible:ring-2 focus-visible:ring-white/20 disabled:pointer-events-auto disabled:cursor-not-allowed disabled:text-white/20 disabled:opacity-100 disabled:hover:bg-transparent",
            className,
          )}
          disabled={disabled}
          onClick={onClick}
          size="icon-sm"
          type="button"
          variant="ghost"
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={6}>
        {label}
      </TooltipContent>
    </Tooltip>
  );
}
