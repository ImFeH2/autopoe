export const SIDEBAR_DEFAULT_WIDTH = 232;
export const SIDEBAR_MIN_WIDTH = 196;
export const SIDEBAR_MAX_WIDTH = 320;
export const SIDEBAR_CONDENSED_EPSILON = 1;
export const SIDEBAR_EXPANDED_MEMORY_GAP = 8;

export function clampSidebarWidth(width: number): number {
  return Math.max(SIDEBAR_MIN_WIDTH, Math.min(SIDEBAR_MAX_WIDTH, width));
}

export function isSidebarCondensed(width: number): boolean {
  return width <= SIDEBAR_MIN_WIDTH + SIDEBAR_CONDENSED_EPSILON;
}

export function shouldRememberSidebarWidth(width: number): boolean {
  return width > SIDEBAR_MIN_WIDTH + SIDEBAR_EXPANDED_MEMORY_GAP;
}

export function getNextSidebarToggleWidth(
  currentWidth: number,
  lastExpandedWidth: number,
): number {
  if (isSidebarCondensed(currentWidth)) {
    return clampSidebarWidth(
      Math.max(lastExpandedWidth, SIDEBAR_DEFAULT_WIDTH),
    );
  }

  return SIDEBAR_MIN_WIDTH;
}
