import type {
  Workflow,
  WorkflowNode,
  WorkflowRunResult,
} from "@/components/flowent/types";

type CronField = {
  values: Set<number>;
  wildcard: boolean;
};

export const workflowInputNodes = (workflow: Workflow) =>
  workflow.definition.nodes.filter((node) => node.type === "input");

export const workflowTimerNodes = (workflow: Workflow) =>
  workflow.definition.nodes.filter((node) => node.type === "timer");

export const normalizeRunInputs = (
  inputNodes: WorkflowNode[],
  values: Record<string, string>,
) => {
  const inputNodeIds = new Set(inputNodes.map((node) => node.id));
  return Object.fromEntries(
    Object.entries(values).filter(
      ([nodeId, value]) => inputNodeIds.has(nodeId) && value !== "",
    ),
  );
};

export const timerIntervalMs = (node: WorkflowNode) => {
  const seconds = Number(node.data.interval_seconds ?? 5);
  if (!Number.isFinite(seconds) || seconds < 1) {
    return 1000;
  }
  return seconds * 1000;
};

export const timerDelayMs = (node: WorkflowNode, now = new Date()) => {
  if (String(node.data.mode ?? "interval") !== "cron") {
    return timerIntervalMs(node);
  }
  return cronDelayMs(String(node.data.cron ?? "* * * * *"), now);
};

export const cronDelayMs = (expression: string, now = new Date()) => {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) {
    return 60_000;
  }

  const [minuteField, hourField, dayField, monthField, weekdayField] = fields;
  const minute = parseCronField(minuteField, 0, 59);
  const hour = parseCronField(hourField, 0, 23);
  const day = parseCronField(dayField, 1, 31);
  const month = parseCronField(monthField, 1, 12);
  const weekday = parseCronField(weekdayField, 0, 7, (value) =>
    value === 7 ? 0 : value,
  );
  if (!minute || !hour || !day || !month || !weekday) {
    return 60_000;
  }

  const candidate = new Date(now);
  candidate.setSeconds(0, 0);
  candidate.setMinutes(candidate.getMinutes() + 1);

  for (let attempts = 0; attempts < 527_040; attempts += 1) {
    if (cronMatches(candidate, { day, hour, minute, month, weekday })) {
      return Math.max(1000, candidate.getTime() - now.getTime());
    }
    candidate.setMinutes(candidate.getMinutes() + 1);
  }

  return 60_000;
};

export const waitForTimer = (delayMs: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("Run stopped.", "AbortError"));
      return;
    }
    const handleAbort = () => {
      window.clearTimeout(timeoutId);
      reject(new DOMException("Run stopped.", "AbortError"));
    };
    const timeoutId = window.setTimeout(() => {
      signal.removeEventListener("abort", handleAbort);
      resolve();
    }, delayMs);
    signal.addEventListener("abort", handleAbort, { once: true });
  });

export const isAbortError = (error: unknown) =>
  error instanceof DOMException && error.name === "AbortError";

export const workflowFailureMessage = (result: WorkflowRunResult) =>
  result.nodeResults.find((nodeResult) => nodeResult.status === "failed")
    ?.error || "Run could not be completed.";

const parseCronField = (
  field: string,
  min: number,
  max: number,
  normalize: (value: number) => number = (value) => value,
) => {
  const values = new Set<number>();
  for (const part of field.split(",")) {
    const [rangePart, stepPart] = part.split("/");
    const step = stepPart ? Number(stepPart) : 1;
    if (!Number.isInteger(step) || step < 1) {
      return null;
    }

    const range = cronRange(rangePart, min, max);
    if (!range) {
      return null;
    }
    for (let value = range.start; value <= range.end; value += step) {
      const normalized = normalize(value);
      if (normalized < min || normalized > max) {
        return null;
      }
      values.add(normalized);
    }
  }

  return values.size > 0 ? { values, wildcard: field === "*" } : null;
};

const cronRange = (value: string, min: number, max: number) => {
  if (value === "*") {
    return { end: max, start: min };
  }
  const [startText, endText] = value.split("-");
  const start = Number(startText);
  const end = endText === undefined ? start : Number(endText);
  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < min ||
    end > max ||
    start > end
  ) {
    return null;
  }
  return { end, start };
};

const cronMatches = (
  date: Date,
  fields: {
    day: CronField;
    hour: CronField;
    minute: CronField;
    month: CronField;
    weekday: CronField;
  },
) => {
  const dayMatches = fields.day.values.has(date.getDate());
  const weekdayMatches = fields.weekday.values.has(date.getDay());
  const calendarMatches =
    fields.day.wildcard || fields.weekday.wildcard
      ? dayMatches && weekdayMatches
      : dayMatches || weekdayMatches;

  return (
    fields.minute.values.has(date.getMinutes()) &&
    fields.hour.values.has(date.getHours()) &&
    fields.month.values.has(date.getMonth() + 1) &&
    calendarMatches
  );
};
