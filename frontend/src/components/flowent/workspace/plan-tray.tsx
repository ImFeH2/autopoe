import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Activity, Check, ChevronRight, Circle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type PlanItemStatus = "completed" | "in_progress" | "pending";

export type WorkspacePlanItem = {
  status: PlanItemStatus;
  step: string;
};

export type WorkspacePlan = {
  items: WorkspacePlanItem[];
};

export function PlanTray({
  isHidden,
  plan,
}: {
  isHidden: boolean;
  plan: WorkspacePlan | null;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const trayRef = useRef<HTMLDivElement>(null);
  const shouldReduceMotion = useReducedMotion();

  useEffect(() => {
    if (isHidden) {
      setIsOpen(false);
    }
  }, [isHidden]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (event.pointerType === "mouse") {
        return;
      }
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }
      if (trayRef.current?.contains(target)) {
        return;
      }
      setIsOpen(false);
    };
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    };

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  if (!plan || isHidden) {
    return null;
  }

  const completedCount = plan.items.filter(
    (item) => item.status === "completed",
  ).length;
  const summary = `Plan · ${completedCount}/${plan.items.length} done`;

  return (
    <div
      className="border-b border-zinc-800/50 bg-zinc-900/40 shadow-[inset_0_-1px_0_rgba(255,255,255,0.03)]"
      onPointerLeave={(event) => {
        if (event.pointerType === "mouse") {
          setIsOpen(false);
        }
      }}
      ref={trayRef}
    >
      <Button
        aria-expanded={isOpen}
        className="h-9 w-full justify-start gap-2 rounded-none border-0 bg-transparent px-3 text-xs font-medium text-zinc-300 shadow-none hover:bg-input/40 hover:text-white sm:text-sm"
        onClick={() => setIsOpen((current) => !current)}
        type="button"
        variant="ghost"
      >
        <ChevronRight
          aria-hidden="true"
          className={cn(
            "size-3.5 shrink-0 text-white/55 transition-transform",
            isOpen && "rotate-90",
          )}
        />
        <span className="min-w-0 flex-1 truncate text-left">{summary}</span>
      </Button>
      <AnimatePresence initial={false}>
        {isOpen ? (
          <motion.div
            animate={
              shouldReduceMotion
                ? { opacity: 1 }
                : { height: "auto", opacity: 1 }
            }
            className="overflow-hidden border-t border-zinc-800/50 bg-zinc-950/50"
            data-slot="plan-tasks-panel"
            exit={
              shouldReduceMotion ? { opacity: 1 } : { height: 0, opacity: 0 }
            }
            initial={shouldReduceMotion ? false : { height: 0, opacity: 0 }}
            key="plan-tasks-panel"
            transition={
              shouldReduceMotion
                ? { duration: 0 }
                : { duration: 0.18, ease: [0.32, 0.72, 0, 1] }
            }
          >
            <ol
              aria-label="Plan tasks"
              className="grid max-h-[150px] gap-1 overflow-auto p-1.5 sm:max-h-[25vh]"
            >
              {plan.items.map((item, index) => (
                <li
                  className={cn(
                    "grid min-w-0 grid-cols-[1.25rem_auto_minmax(0,1fr)_auto] items-start gap-2 rounded-lg px-2 py-1.5 text-sm leading-5",
                    item.status === "in_progress"
                      ? "bg-input/30 text-white"
                      : item.status === "completed"
                        ? "text-white/55"
                        : "text-white/75",
                  )}
                  key={`${index}-${item.step}`}
                >
                  <span className="text-right text-xs leading-5 text-white/35">
                    {index + 1}
                  </span>
                  <PlanStatusIcon status={item.status} />
                  <span className="min-w-0 break-words">{item.step}</span>
                  <span className="shrink-0 text-xs leading-5 text-white/45">
                    {planStatusLabel(item.status)}
                  </span>
                </li>
              ))}
            </ol>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

function PlanStatusIcon({ status }: { status: PlanItemStatus }) {
  const className = "mt-0.5 size-3.5 shrink-0";

  if (status === "completed") {
    return (
      <Check aria-hidden="true" className={cn(className, "text-white/65")} />
    );
  }
  if (status === "in_progress") {
    return (
      <Activity
        aria-hidden="true"
        className={cn(className, "animate-pulse text-white")}
      />
    );
  }

  return (
    <Circle aria-hidden="true" className={cn(className, "text-white/40")} />
  );
}

function planStatusLabel(status: PlanItemStatus) {
  if (status === "completed") {
    return "Done";
  }
  if (status === "in_progress") {
    return "Doing";
  }
  return "Pending";
}
