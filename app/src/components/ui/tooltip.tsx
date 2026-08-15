import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import {
  cloneElement,
  type MouseEventHandler,
  type ReactElement,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";

type TooltipProviderProps = {
  children: ReactNode;
};

type TooltipTriggerProps = {
  disabled?: boolean;
  onMouseLeave?: MouseEventHandler<HTMLElement>;
  onMouseMove?: MouseEventHandler<HTMLElement>;
};

type TooltipProps = {
  children: ReactElement<TooltipTriggerProps>;
  content: ReactNode;
  disabledTrigger?: boolean;
  side?: "top" | "right" | "bottom" | "left";
};

export function TooltipProvider({ children }: TooltipProviderProps) {
  return (
    <TooltipPrimitive.Provider delayDuration={400} skipDelayDuration={300}>
      {children}
    </TooltipPrimitive.Provider>
  );
}

export function Tooltip({
  children,
  content,
  disabledTrigger = children.props.disabled ?? false,
  side = "top",
}: TooltipProps) {
  const [open, setOpen] = useState(false);
  const openTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const delay = disabledTrigger ? 0 : 400;
  const trigger = disabledTrigger ? (
    <span className="ui-tooltip-trigger">{children}</span>
  ) : (
    children
  );

  function clearOpenTimer() {
    if (openTimerRef.current !== null) {
      clearTimeout(openTimerRef.current);
      openTimerRef.current = null;
    }
  }

  function handleMouseMove(event: React.MouseEvent<HTMLElement>) {
    trigger.props.onMouseMove?.(event);
    if (open || openTimerRef.current !== null) {
      return;
    }
    if (delay === 0) {
      setOpen(true);
      return;
    }
    openTimerRef.current = setTimeout(() => {
      openTimerRef.current = null;
      setOpen(true);
    }, delay);
  }

  function handleMouseLeave(event: React.MouseEvent<HTMLElement>) {
    trigger.props.onMouseLeave?.(event);
    clearOpenTimer();
    setOpen(false);
  }

  useEffect(
    () => () => {
      if (openTimerRef.current !== null) {
        clearTimeout(openTimerRef.current);
      }
    },
    [],
  );

  return (
    <TooltipPrimitive.Root
      delayDuration={delay}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          clearOpenTimer();
        }
        setOpen(nextOpen);
      }}
      open={open}
    >
      <TooltipPrimitive.Trigger asChild>
        {cloneElement(trigger, {
          onMouseLeave: handleMouseLeave,
          onMouseMove: handleMouseMove,
        })}
      </TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          className="ui-tooltip-content"
          side={side}
          sideOffset={7}
        >
          {content}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}
