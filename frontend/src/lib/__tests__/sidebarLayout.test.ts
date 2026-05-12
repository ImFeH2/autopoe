import { describe, expect, it } from "vitest";
import {
  getSidebarRenderWidth,
  shouldRememberSidebarWidth,
  SIDEBAR_DEFAULT_WIDTH,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
  SIDEBAR_RAIL_WIDTH,
  SIDEBAR_WIDTH_TRANSITION,
} from "@/lib/sidebarLayout";

describe("sidebarLayout", () => {
  it("uses the saved full navigation width while expanded", () => {
    expect(getSidebarRenderWidth(280, false)).toBe(280);
  });

  it("uses a dedicated icon rail width while compressed", () => {
    expect(getSidebarRenderWidth(280, true)).toBe(SIDEBAR_RAIL_WIDTH);
  });

  it("clamps full navigation widths to the desktop sidebar bounds", () => {
    expect(getSidebarRenderWidth(120, false)).toBe(SIDEBAR_MIN_WIDTH);
    expect(getSidebarRenderWidth(420, false)).toBe(SIDEBAR_MAX_WIDTH);
  });

  it("keeps the default width within the complete navigation range", () => {
    expect(getSidebarRenderWidth(SIDEBAR_DEFAULT_WIDTH, false)).toBe(
      SIDEBAR_DEFAULT_WIDTH,
    );
  });

  it("only remembers widths that are clearly expanded", () => {
    expect(shouldRememberSidebarWidth(SIDEBAR_MIN_WIDTH)).toBe(false);
    expect(shouldRememberSidebarWidth(SIDEBAR_MIN_WIDTH + 4)).toBe(false);
    expect(shouldRememberSidebarWidth(SIDEBAR_MIN_WIDTH + 12)).toBe(true);
  });

  it("keeps the sidebar mode change easy to follow", () => {
    expect(SIDEBAR_WIDTH_TRANSITION.duration).toBeGreaterThanOrEqual(0.35);
  });
});
