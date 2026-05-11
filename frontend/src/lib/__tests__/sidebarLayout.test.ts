import { describe, expect, it } from "vitest";
import {
  getNextSidebarToggleWidth,
  isSidebarCondensed,
  shouldRememberSidebarWidth,
  SIDEBAR_DEFAULT_WIDTH,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
} from "@/lib/sidebarLayout";

describe("sidebarLayout", () => {
  it("toggles an expanded sidebar to the minimum complete navigation width", () => {
    expect(getNextSidebarToggleWidth(280, 280)).toBe(SIDEBAR_MIN_WIDTH);
  });

  it("restores the last expanded width from the condensed boundary", () => {
    expect(getNextSidebarToggleWidth(SIDEBAR_MIN_WIDTH, 284)).toBe(284);
  });

  it("uses the default width when the remembered width is too narrow", () => {
    expect(getNextSidebarToggleWidth(SIDEBAR_MIN_WIDTH, 198)).toBe(
      SIDEBAR_DEFAULT_WIDTH,
    );
  });

  it("keeps restored widths within the desktop sidebar bounds", () => {
    expect(getNextSidebarToggleWidth(SIDEBAR_MIN_WIDTH, 420)).toBe(
      SIDEBAR_MAX_WIDTH,
    );
  });

  it("only remembers widths that are clearly expanded", () => {
    expect(shouldRememberSidebarWidth(SIDEBAR_MIN_WIDTH)).toBe(false);
    expect(shouldRememberSidebarWidth(SIDEBAR_MIN_WIDTH + 4)).toBe(false);
    expect(shouldRememberSidebarWidth(SIDEBAR_MIN_WIDTH + 12)).toBe(true);
  });

  it("treats the lower bound as the condensed state", () => {
    expect(isSidebarCondensed(SIDEBAR_MIN_WIDTH)).toBe(true);
    expect(isSidebarCondensed(SIDEBAR_MIN_WIDTH + 4)).toBe(false);
  });
});
