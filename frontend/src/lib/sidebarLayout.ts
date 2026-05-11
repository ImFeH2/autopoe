export const SIDEBAR_DEFAULT_WIDTH = 232;
export const SIDEBAR_MIN_WIDTH = 196;
export const SIDEBAR_MAX_WIDTH = 320;
export const SIDEBAR_RAIL_WIDTH = 68;
export const SIDEBAR_EXPANDED_MEMORY_GAP = 8;

export function clampSidebarWidth(width: number): number {
  return Math.max(SIDEBAR_MIN_WIDTH, Math.min(SIDEBAR_MAX_WIDTH, width));
}

export function shouldRememberSidebarWidth(width: number): boolean {
  return width > SIDEBAR_MIN_WIDTH + SIDEBAR_EXPANDED_MEMORY_GAP;
}

export function getSidebarRenderWidth(
  expandedWidth: number,
  iconRail: boolean,
): number {
  return iconRail ? SIDEBAR_RAIL_WIDTH : clampSidebarWidth(expandedWidth);
}
