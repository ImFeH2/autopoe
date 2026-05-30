const viewportHeightProperty = "--flowent-viewport-height";

export function initializeViewportHeight() {
  if (typeof window === "undefined") {
    return;
  }

  const setViewportHeight = () => {
    const viewportHeight = window.visualViewport?.height ?? window.innerHeight;

    document.documentElement.style.setProperty(
      viewportHeightProperty,
      `${Math.round(viewportHeight)}px`,
    );
  };

  setViewportHeight();

  window.addEventListener("resize", setViewportHeight, { passive: true });
  window.visualViewport?.addEventListener("resize", setViewportHeight, {
    passive: true,
  });
  window.visualViewport?.addEventListener("scroll", setViewportHeight, {
    passive: true,
  });
}
