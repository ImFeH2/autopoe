import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

class ResizeObserverMock implements ResizeObserver {
  constructor(_callback: ResizeObserverCallback) {}

  disconnect() {}

  observe() {}

  unobserve() {}
}

globalThis.ResizeObserver = ResizeObserverMock;

afterEach(cleanup);
