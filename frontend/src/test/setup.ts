import "@testing-library/jest-dom/vitest";
import "@/i18n/i18n";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

const elementPrototype = Element.prototype as Element & {
  hasPointerCapture?: (pointerId: number) => boolean;
  releasePointerCapture?: (pointerId: number) => void;
  scrollIntoView?: () => void;
};

if (!elementPrototype.hasPointerCapture) {
  elementPrototype.hasPointerCapture = () => false;
}

if (!elementPrototype.releasePointerCapture) {
  elementPrototype.releasePointerCapture = () => undefined;
}

if (!elementPrototype.scrollIntoView) {
  elementPrototype.scrollIntoView = () => undefined;
}

class ResizeObserverStub implements ResizeObserver {
  constructor() {}

  disconnect() {}

  observe() {}

  unobserve() {}
}

if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = ResizeObserverStub;
}

afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/");
});
