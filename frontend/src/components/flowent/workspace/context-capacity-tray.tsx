import { Activity } from "lucide-react";
import { useTranslation } from "react-i18next";

import type { ContextCapacity } from "@/components/flowent/workspace/context-capacity";
import { formatContextUnits } from "@/components/flowent/workspace/context-capacity";
import { cn } from "@/lib/utils";

export function ContextCapacityTray({
  capacity,
  isRefining,
}: {
  capacity: ContextCapacity;
  isRefining: boolean;
}) {
  const { t } = useTranslation();
  const toneClassName =
    capacity.tone === "critical"
      ? "bg-red-500"
      : capacity.tone === "warning"
        ? "bg-amber-500"
        : "bg-zinc-400";
  const textClassName =
    capacity.tone === "critical"
      ? "text-red-400"
      : capacity.tone === "warning"
        ? "text-amber-400"
        : "text-zinc-300";
  const capacityAmount = `${formatContextUnits(capacity.used)} / ${formatContextUnits(capacity.total)}`;

  return (
    <div
      aria-busy={isRefining}
      aria-live="polite"
      className="flex min-h-9 items-center justify-between gap-3 border-t border-zinc-800/50 bg-zinc-900/40 px-4 py-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] transition-colors"
    >
      <div className="flex min-w-0 items-center gap-2 text-[10px] font-semibold tracking-wider text-zinc-500 uppercase">
        <Activity
          aria-hidden="true"
          className={cn("size-3 shrink-0", isRefining && "animate-pulse")}
        />
        <span className="hidden sm:inline">{t("workspace.context.label")}</span>
      </div>
      <div className="flex min-w-0 items-center gap-2">
        <span
          className={cn(
            "text-[10px] font-semibold whitespace-nowrap",
            isRefining
              ? "animate-pulse text-zinc-300"
              : "text-zinc-500 uppercase",
          )}
        >
          {isRefining ? t("workspace.context.refining") : capacityAmount}
        </span>
        <div
          aria-label={t("workspace.context.capacityStatus")}
          aria-valuemax={100}
          aria-valuemin={0}
          aria-valuenow={capacity.percent}
          className="h-1 w-16 overflow-hidden rounded-full bg-zinc-800 sm:w-24"
          role="progressbar"
        >
          <div
            className={cn(
              "h-full rounded-full transition-all duration-500 ease-in-out",
              isRefining &&
                "flowent-context-refining-indicator w-1/3 opacity-80",
              toneClassName,
            )}
            style={{ width: isRefining ? undefined : `${capacity.percent}%` }}
          />
        </div>
        {!isRefining && (
          <span className={cn("text-[10px] font-semibold", textClassName)}>
            {capacity.percent}%
          </span>
        )}
      </div>
    </div>
  );
}
