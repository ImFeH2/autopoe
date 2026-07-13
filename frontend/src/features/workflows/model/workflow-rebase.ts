import type { Workflow } from "@/features/workflows/model/workflow-types";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const valuesMatch = (left: unknown, right: unknown) =>
  JSON.stringify(left) === JSON.stringify(right);

function rebaseChangedValue(
  base: unknown,
  current: unknown,
  latest: unknown,
): unknown {
  if (valuesMatch(base, current)) {
    return latest;
  }
  if (Array.isArray(base) && Array.isArray(current) && Array.isArray(latest)) {
    const keyed = [...base, ...current, ...latest].every(
      (item) => isRecord(item) && typeof item.id === "string",
    );
    if (!keyed) {
      return current;
    }
    const baseById = new Map(
      base.map((item) => [(item as Record<string, unknown>).id, item]),
    );
    const currentById = new Map(
      current.map((item) => [(item as Record<string, unknown>).id, item]),
    );
    const latestById = new Map(
      latest.map((item) => [(item as Record<string, unknown>).id, item]),
    );
    const rebased = latest.flatMap((latestItem) => {
      const id = (latestItem as Record<string, unknown>).id;
      const currentItem = currentById.get(id);
      const baseItem = baseById.get(id);
      if (baseItem !== undefined && currentItem === undefined) {
        return [];
      }
      if (currentItem === undefined) {
        return [latestItem];
      }
      return [rebaseChangedValue(baseItem, currentItem, latestItem)];
    });
    for (const currentItem of current) {
      const id = (currentItem as Record<string, unknown>).id;
      if (!baseById.has(id) && !latestById.has(id)) {
        rebased.push(currentItem);
      }
    }
    return rebased;
  }
  if (isRecord(base) && isRecord(current) && isRecord(latest)) {
    const rebased: Record<string, unknown> = {};
    const keys = new Set([
      ...Object.keys(base),
      ...Object.keys(current),
      ...Object.keys(latest),
    ]);
    for (const key of keys) {
      const hasBase = Object.hasOwn(base, key);
      const hasCurrent = Object.hasOwn(current, key);
      const hasLatest = Object.hasOwn(latest, key);
      if (hasBase && !hasCurrent) {
        continue;
      }
      if (!hasCurrent) {
        if (hasLatest) {
          rebased[key] = latest[key];
        }
        continue;
      }
      if (!hasBase) {
        rebased[key] = current[key];
        continue;
      }
      if (!hasLatest) {
        continue;
      }
      rebased[key] = rebaseChangedValue(base[key], current[key], latest[key]);
    }
    return rebased;
  }
  return current;
}

export const rebaseWorkflowChanges = (
  base: Workflow,
  current: Workflow,
  latest: Workflow,
) => rebaseChangedValue(base, current, latest) as Workflow;
