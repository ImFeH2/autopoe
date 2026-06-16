import type { ContextUsageInfo, Message } from "@/components/flowent/types";

const CONTEXT_CAPACITY_LIMIT = 120_000;
const CONTEXT_BASELINE_UNITS = 12_000;

export type ContextCapacity = {
  percent: number;
  tone: "critical" | "neutral" | "warning";
  total: number;
  used: number;
};

export function contextCapacityFromMessages(
  messages: Message[],
  draft: string,
  usageInfo: ContextUsageInfo | null,
  contextWindowLimit: number | null,
): ContextCapacity {
  const latestUsageIndex = latestUsageInfoMessageIndex(messages);
  const latestUsageInfo =
    usageInfo ??
    (latestUsageIndex >= 0 ? messages[latestUsageIndex].usage_info : null);
  const baseUsed = latestUsageInfo?.last_token_usage.total_tokens;
  const countedMessages =
    latestUsageInfo && latestUsageIndex >= 0
      ? messages.slice(latestUsageIndex + 1)
      : latestUsageInfo
        ? []
        : messages;
  const used = [
    ...countedMessages.map((message) => message.content),
    draft,
  ].reduce(
    (total, content) => total + approximateContextUnits(content),
    Math.max(0, baseUsed ?? 0),
  );
  const total = Math.max(
    1,
    contextWindowLimit ??
      latestUsageInfo?.model_context_window ??
      CONTEXT_CAPACITY_LIMIT,
  );
  const percent = contextCapacityPercent(used, total);

  return {
    percent,
    tone: percent > 90 ? "critical" : percent >= 75 ? "warning" : "neutral",
    total,
    used,
  };
}

export function formatContextUnits(units: number) {
  if (units >= 1000) {
    return `${Math.floor(units / 1000)}k`;
  }

  return units.toString();
}

function latestUsageInfoMessageIndex(messages: Message[]) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].usage_info) {
      return index;
    }
  }
  return -1;
}

function contextCapacityPercent(used: number, total: number) {
  if (total <= CONTEXT_BASELINE_UNITS) {
    return used > 0 ? 100 : 0;
  }

  const effectiveUsed = Math.max(0, used - CONTEXT_BASELINE_UNITS);
  const effectiveTotal = total - CONTEXT_BASELINE_UNITS;
  return Math.min(100, Math.floor((effectiveUsed / effectiveTotal) * 100));
}

function approximateContextUnits(content: string) {
  if (!content) {
    return 0;
  }
  return Math.max(1, Math.ceil(new TextEncoder().encode(content).length / 4));
}
