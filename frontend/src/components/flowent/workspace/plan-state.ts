import type {
  WorkspacePlan,
  WorkspacePlanItem,
} from "@/components/flowent/workspace/plan-tray";
import type { Message } from "@/features/workspace/model/message-types";

export function latestPlanFromMessages(
  messages: Message[],
): WorkspacePlan | null {
  for (
    let messageIndex = messages.length - 1;
    messageIndex >= 0;
    messageIndex -= 1
  ) {
    const message = messages[messageIndex];
    if (message?.author !== "assistant") {
      continue;
    }

    const tools = message.tools ?? [];
    for (let toolIndex = tools.length - 1; toolIndex >= 0; toolIndex -= 1) {
      const tool = tools[toolIndex];
      if (tool.name !== "update_plan") {
        continue;
      }

      const items =
        planItemsFromToolPayload(tool.result) ??
        planItemsFromToolPayload(tool.arguments);
      if (items?.length) {
        return { items };
      }
    }
  }

  return null;
}

function planItemsFromToolPayload(
  payload: Record<string, unknown> | null | undefined,
) {
  const rawItems = payload?.items;
  if (!Array.isArray(rawItems)) {
    return null;
  }

  return rawItems.flatMap((item): WorkspacePlanItem[] => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return [];
    }
    const value = item as Record<string, unknown>;
    const step = typeof value.step === "string" ? value.step.trim() : "";
    if (!step) {
      return [];
    }
    return [
      {
        status: normalizePlanStatus(value.status),
        step,
      },
    ];
  });
}

function normalizePlanStatus(status: unknown): WorkspacePlanItem["status"] {
  if (
    status === "completed" ||
    status === "in_progress" ||
    status === "pending"
  ) {
    return status;
  }

  return "pending";
}
