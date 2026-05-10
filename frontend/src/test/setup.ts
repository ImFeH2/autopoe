import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import type { Node } from "@xyflow/react";
import { afterEach } from "vitest";

afterEach(() => {
  cleanup();
});

if (!window.requestAnimationFrame) {
  window.requestAnimationFrame = (callback) =>
    window.setTimeout(() => callback(performance.now()), 16);
}

if (!window.cancelAnimationFrame) {
  window.cancelAnimationFrame = (handle) => {
    window.clearTimeout(handle);
  };
}

if (!window.matchMedia) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

class WorkerMock {
  onmessage: ((ev: MessageEvent) => void) | null = null;
  postMessage(data: { nodes: Node[]; key: string }) {
    if (!this.onmessage) {
      return;
    }

    const columnCount = Math.max(1, Math.ceil(Math.sqrt(data.nodes.length)));
    const positions = data.nodes.map((node, index) => ({
      id: node.id,
      position: {
        x: (index % columnCount) * 260,
        y: Math.floor(index / columnCount) * 180,
      },
    }));

    queueMicrotask(() => {
      this.onmessage?.({
        data: { positions, key: data.key },
      } as MessageEvent);
    });
  }
  terminate() {}
}

Object.defineProperty(globalThis, "Worker", {
  configurable: true,
  writable: true,
  value: WorkerMock,
});
