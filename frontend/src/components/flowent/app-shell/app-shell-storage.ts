const pinnedWorkflowStorageKey = "flowent:pinned-workflows";
const sidebarWidthStorageKey = "flowent:sidebar-width";
const sidebarMinWidth = 196;
const sidebarMaxWidth = 360;

export const sidebarCollapsedWidth = 64;
export const sidebarDefaultWidth = 232;
export const sidebarDragThreshold = 4;
export const sidebarClickDelayMs = 180;
export const sidebarNarrowLayoutQuery = "(max-width: 900px)";

export function readPinnedWorkflowIds() {
  if (typeof window === "undefined") {
    return [];
  }
  try {
    const value = window.localStorage.getItem(pinnedWorkflowStorageKey);
    if (!value) {
      return [];
    }
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter(
      (workflowId): workflowId is string => typeof workflowId === "string",
    );
  } catch {
    return [];
  }
}

export function writePinnedWorkflowIds(workflowIds: string[]) {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(
    pinnedWorkflowStorageKey,
    JSON.stringify(workflowIds),
  );
}

export function clampSidebarWidth(width: number) {
  return Math.min(sidebarMaxWidth, Math.max(sidebarMinWidth, width));
}

export function readStoredSidebarWidth() {
  if (typeof window === "undefined") {
    return sidebarDefaultWidth;
  }
  const storedValue = window.localStorage.getItem(sidebarWidthStorageKey);
  if (!storedValue) {
    return sidebarDefaultWidth;
  }
  const storedWidth = Number(storedValue);
  if (!Number.isFinite(storedWidth)) {
    return sidebarDefaultWidth;
  }
  return clampSidebarWidth(storedWidth);
}

export function writeStoredSidebarWidth(width: number) {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(
    sidebarWidthStorageKey,
    String(clampSidebarWidth(width)),
  );
}

export function isSidebarNarrowViewport() {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia(sidebarNarrowLayoutQuery).matches
  );
}
