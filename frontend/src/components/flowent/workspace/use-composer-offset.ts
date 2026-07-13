import { useEffect, useRef } from "react";

export function useComposerOffset(onOffsetChange: (value: number) => void) {
  const composerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const composer = composerRef.current;
    if (!composer) {
      return;
    }
    let animationFrameId = 0;

    const updateOffset = () => {
      animationFrameId = 0;
      const measuredBottomOffset = Number.parseFloat(
        getComputedStyle(composer).bottom,
      );
      const bottomOffset = Number.isFinite(measuredBottomOffset)
        ? measuredBottomOffset
        : 0;

      onOffsetChange(composer.offsetHeight + bottomOffset + 24);
    };

    const scheduleUpdateOffset = () => {
      if (animationFrameId !== 0) {
        window.cancelAnimationFrame(animationFrameId);
      }

      animationFrameId = window.requestAnimationFrame(updateOffset);
    };

    updateOffset();

    window.addEventListener("resize", scheduleUpdateOffset, {
      passive: true,
    });
    window.addEventListener("focusin", scheduleUpdateOffset, {
      passive: true,
    });
    window.addEventListener("focusout", scheduleUpdateOffset, {
      passive: true,
    });
    window.visualViewport?.addEventListener("resize", scheduleUpdateOffset, {
      passive: true,
    });
    window.visualViewport?.addEventListener("scroll", scheduleUpdateOffset, {
      passive: true,
    });

    if (typeof ResizeObserver === "undefined") {
      return () => {
        if (animationFrameId !== 0) {
          window.cancelAnimationFrame(animationFrameId);
        }
        window.removeEventListener("resize", scheduleUpdateOffset);
        window.removeEventListener("focusin", scheduleUpdateOffset);
        window.removeEventListener("focusout", scheduleUpdateOffset);
        window.visualViewport?.removeEventListener(
          "resize",
          scheduleUpdateOffset,
        );
        window.visualViewport?.removeEventListener(
          "scroll",
          scheduleUpdateOffset,
        );
      };
    }

    const resizeObserver = new ResizeObserver(scheduleUpdateOffset);
    resizeObserver.observe(composer);

    return () => {
      if (animationFrameId !== 0) {
        window.cancelAnimationFrame(animationFrameId);
      }
      window.removeEventListener("resize", scheduleUpdateOffset);
      window.removeEventListener("focusin", scheduleUpdateOffset);
      window.removeEventListener("focusout", scheduleUpdateOffset);
      window.visualViewport?.removeEventListener(
        "resize",
        scheduleUpdateOffset,
      );
      window.visualViewport?.removeEventListener(
        "scroll",
        scheduleUpdateOffset,
      );
      resizeObserver.disconnect();
    };
  }, [onOffsetChange]);

  return composerRef;
}
