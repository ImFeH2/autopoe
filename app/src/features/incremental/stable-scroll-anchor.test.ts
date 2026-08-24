import { describe, expect, it } from "vitest";
import {
  captureStableScrollAnchor,
  restoreStableScrollAnchor,
} from "./stable-scroll-anchor";

function element(id: number, top: number, bottom: number) {
  return {
    dataset: { messageId: String(id) },
    getBoundingClientRect: () => ({ top, bottom }),
  } as unknown as HTMLElement;
}
describe("stable scroll anchor", () => {
  it("restores by stable message pixel offset", () => {
    const target = element(7, 140, 170);
    const viewport = {
      scrollTop: 50,
      getBoundingClientRect: () => ({ top: 100 }),
      querySelectorAll: () => [element(5, 80, 95), target],
      querySelector: () => element(7, 165, 195),
    } as unknown as HTMLElement;
    expect(captureStableScrollAnchor(viewport)).toEqual({
      messageId: 7,
      offset: 40,
    });
    expect(
      restoreStableScrollAnchor(viewport, { messageId: 7, offset: 40 }),
    ).toBe(true);
    expect(viewport.scrollTop).toBe(75);
  });
});
