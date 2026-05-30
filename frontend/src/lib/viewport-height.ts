const viewportHeightProperty = "--flowent-viewport-height";
const keyboardOffsetProperty = "--flowent-keyboard-offset";
const keyboardOffsetThreshold = 120;

export function initializeViewportHeight() {
  if (typeof window === "undefined") {
    return;
  }

  const supportsDynamicViewportHeight =
    typeof CSS !== "undefined" && CSS.supports("height", "100dvh");
  let lastViewportHeight = readLayoutViewportHeight();
  let lastKeyboardOffset = 0;
  let animationFrameId = 0;

  const setViewportHeight = (height: number) => {
    document.documentElement.style.setProperty(
      viewportHeightProperty,
      `${height}px`,
    );
  };

  const setKeyboardOffset = (offset: number) => {
    document.documentElement.style.setProperty(
      keyboardOffsetProperty,
      `${offset}px`,
    );
  };

  const updateViewport = (forceViewportHeight = false) => {
    animationFrameId = 0;

    const nextViewportHeight = readLayoutViewportHeight();
    const nextKeyboardOffset = readKeyboardOffset(nextViewportHeight);
    const isKeyboardResize =
      isEditableElementFocused() &&
      lastViewportHeight - nextViewportHeight > keyboardOffsetThreshold;

    if (!supportsDynamicViewportHeight) {
      if (forceViewportHeight || !isKeyboardResize) {
        lastViewportHeight = nextViewportHeight;
        setViewportHeight(nextViewportHeight);
      }
    }

    if (nextKeyboardOffset !== lastKeyboardOffset) {
      lastKeyboardOffset = nextKeyboardOffset;
      setKeyboardOffset(nextKeyboardOffset);
    }
  };

  const scheduleViewportUpdate = (forceViewportHeight = false) => {
    if (animationFrameId !== 0) {
      window.cancelAnimationFrame(animationFrameId);
    }

    animationFrameId = window.requestAnimationFrame(() =>
      updateViewport(forceViewportHeight),
    );
  };

  updateViewport(true);

  window.addEventListener("resize", () => scheduleViewportUpdate(), {
    passive: true,
  });
  window.addEventListener(
    "orientationchange",
    () => scheduleViewportUpdate(true),
    { passive: true },
  );
  window.addEventListener("focusin", () => scheduleViewportUpdate(), {
    passive: true,
  });
  window.addEventListener("focusout", () => scheduleViewportUpdate(), {
    passive: true,
  });
  window.visualViewport?.addEventListener(
    "resize",
    () => scheduleViewportUpdate(),
    { passive: true },
  );
  window.visualViewport?.addEventListener(
    "scroll",
    () => scheduleViewportUpdate(),
    { passive: true },
  );
}

function readLayoutViewportHeight() {
  return Math.round(
    document.documentElement.clientHeight || window.innerHeight || 0,
  );
}

function readKeyboardOffset(layoutViewportHeight: number) {
  if (!isEditableElementFocused()) {
    return 0;
  }

  const visualViewport = window.visualViewport;
  if (!visualViewport) {
    return 0;
  }

  const offset = Math.max(
    0,
    layoutViewportHeight - visualViewport.height - visualViewport.offsetTop,
  );

  return offset > keyboardOffsetThreshold ? Math.round(offset) : 0;
}

function isEditableElementFocused() {
  const activeElement = document.activeElement;

  if (activeElement instanceof HTMLTextAreaElement) {
    return !activeElement.disabled && !activeElement.readOnly;
  }

  if (activeElement instanceof HTMLInputElement) {
    const keyboardInputTypes = new Set([
      "",
      "email",
      "number",
      "password",
      "search",
      "tel",
      "text",
      "url",
    ]);

    return (
      !activeElement.disabled &&
      !activeElement.readOnly &&
      keyboardInputTypes.has(activeElement.type)
    );
  }

  return (
    activeElement instanceof HTMLElement && activeElement.isContentEditable
  );
}
