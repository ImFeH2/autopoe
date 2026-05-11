import { cn } from "@/lib/utils";
import React, { useRef } from "react";

interface PanelResizerProps {
  onMouseDown: (e: React.MouseEvent) => void;
  isDragging: boolean;
  position: "left" | "right";
  className?: string;
  onToggle?: () => void;
  toggleLabel?: string;
  togglePressed?: boolean;
}

export function PanelResizer({
  onMouseDown,
  isDragging,
  position,
  className,
  onToggle,
  toggleLabel,
  togglePressed,
}: PanelResizerProps) {
  const pointerStartRef = useRef<{
    x: number;
    y: number;
    toggleOnClick: boolean;
  } | null>(null);

  const startResize = (event: React.MouseEvent, toggleOnClick: boolean) => {
    if (event.detail > 1) {
      event.preventDefault();
      return;
    }

    pointerStartRef.current = {
      x: event.clientX,
      y: event.clientY,
      toggleOnClick,
    };
    onMouseDown(event);
  };

  const handleMouseDown = (event: React.MouseEvent) => {
    startResize(event, true);
  };

  const handleToggleMouseDown = (event: React.MouseEvent) => {
    event.stopPropagation();
    startResize(event, false);
  };

  const handleClick = (event: React.MouseEvent) => {
    event.stopPropagation();
    const pointerStart = pointerStartRef.current;
    pointerStartRef.current = null;
    if (!onToggle || !pointerStart?.toggleOnClick) {
      return;
    }

    const moved =
      Math.abs(event.clientX - pointerStart.x) +
      Math.abs(event.clientY - pointerStart.y);
    if (moved <= 3) {
      onToggle();
    }
  };

  const handleToggleClick = (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const pointerStart = pointerStartRef.current;
    pointerStartRef.current = null;
    if (!onToggle || !pointerStart) {
      return;
    }

    const moved =
      Math.abs(event.clientX - pointerStart.x) +
      Math.abs(event.clientY - pointerStart.y);
    if (moved <= 3) {
      onToggle();
    }
  };

  return (
    <div
      onMouseDown={handleMouseDown}
      onClick={handleClick}
      className={cn(
        "absolute top-0 bottom-0 z-50 w-2 cursor-col-resize flex items-center justify-center -mx-1 group/resizer",
        position === "left" ? "left-0" : "right-0",
        className,
      )}
    >
      <div
        className={cn(
          "w-[2px] h-full transition-[background-color,box-shadow,opacity] duration-150 delay-100",
          isDragging
            ? "bg-primary/50 shadow-[0_0_18px_var(--sidebar-ring)]"
            : "bg-transparent group-hover/resizer:bg-primary/30",
        )}
      />
      {onToggle ? (
        <button
          type="button"
          aria-label={toggleLabel}
          aria-pressed={togglePressed}
          onMouseDown={handleToggleMouseDown}
          onClick={handleToggleClick}
          className={cn(
            "absolute top-1/2 z-10 flex h-14 w-4 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full border border-sidebar-border bg-sidebar/92 shadow-[0_10px_28px_rgba(0,0,0,0.28)] backdrop-blur-md outline-hidden transition-[opacity,transform,background-color,border-color,box-shadow] duration-180",
            "opacity-45 duration-[180ms] hover:scale-105 hover:border-sidebar-ring/40 hover:bg-sidebar-accent hover:opacity-100 hover:shadow-[0_12px_34px_rgba(0,0,0,0.34)] focus-visible:scale-105 focus-visible:border-sidebar-ring/55 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring/40",
            position === "left"
              ? "left-0 -translate-x-1/2"
              : "right-0 translate-x-1/2",
          )}
        >
          <span
            aria-hidden="true"
            className={cn(
              "h-7 w-[2px] rounded-full bg-sidebar-foreground/38 transition-[background-color,box-shadow] duration-180",
              isDragging
                ? "bg-sidebar-foreground/76 shadow-[0_0_14px_var(--sidebar-ring)]"
                : "group-hover/resizer:bg-sidebar-foreground/66",
            )}
          />
        </button>
      ) : null}
    </div>
  );
}
