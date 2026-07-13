import {
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { useReducedMotion } from "framer-motion";

import {
  clampSidebarWidth,
  isSidebarNarrowViewport,
  readStoredSidebarWidth,
  sidebarClickDelayMs,
  sidebarCollapsedWidth,
  sidebarDefaultWidth,
  sidebarDragThreshold,
  sidebarNarrowLayoutQuery,
  writeStoredSidebarWidth,
} from "@/components/flowent/app-shell/app-shell-storage";

export function useSidebarLayout() {
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isSidebarNarrowLayout, setIsSidebarNarrowLayout] = useState(() =>
    isSidebarNarrowViewport(),
  );
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(() =>
    readStoredSidebarWidth(),
  );
  const [isSidebarResizing, setIsSidebarResizing] = useState(false);
  const [isWorkflowSectionOpen, setIsWorkflowSectionOpen] = useState(true);
  const sidebarClickTimeoutRef = useRef<number | null>(null);
  const sidebarDividerWasDraggedRef = useRef(false);
  const shouldReduceMotion = useReducedMotion() ?? false;
  const clearSidebarClickTimeout = useCallback(() => {
    if (sidebarClickTimeoutRef.current === null) {
      return;
    }
    window.clearTimeout(sidebarClickTimeoutRef.current);
    sidebarClickTimeoutRef.current = null;
  }, []);
  const toggleSidebar = useCallback(() => {
    setIsSidebarCollapsed((current) => !current);
  }, []);

  const handleSidebarDividerClick = useCallback(
    (event: ReactMouseEvent<HTMLButtonElement>) => {
      if (sidebarDividerWasDraggedRef.current) {
        event.preventDefault();
        sidebarDividerWasDraggedRef.current = false;
        return;
      }
      if (event.detail > 1) {
        return;
      }
      clearSidebarClickTimeout();
      sidebarClickTimeoutRef.current = window.setTimeout(() => {
        sidebarClickTimeoutRef.current = null;
        toggleSidebar();
      }, sidebarClickDelayMs);
    },
    [clearSidebarClickTimeout, toggleSidebar],
  );

  const handleSidebarDividerDoubleClick = useCallback(
    (event: ReactMouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      clearSidebarClickTimeout();
      setSidebarWidth(sidebarDefaultWidth);
      writeStoredSidebarWidth(sidebarDefaultWidth);
      setIsSidebarCollapsed(false);
    },
    [clearSidebarClickTimeout],
  );

  const handleSidebarDividerPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      if (event.button !== 0 || isSidebarCollapsed) {
        return;
      }

      const startX = event.clientX;
      const startWidth = sidebarWidth;
      let latestWidth = startWidth;
      let isDragging = false;
      const originalCursor = document.body.style.cursor;

      const handlePointerMove = (pointerEvent: PointerEvent) => {
        const deltaX = pointerEvent.clientX - startX;
        if (!isDragging && Math.abs(deltaX) < sidebarDragThreshold) {
          return;
        }
        if (!isDragging) {
          isDragging = true;
          sidebarDividerWasDraggedRef.current = true;
          setIsSidebarResizing(true);
          document.body.style.cursor = "ew-resize";
        }
        latestWidth = clampSidebarWidth(startWidth + deltaX);
        setSidebarWidth(latestWidth);
      };

      const handlePointerUp = () => {
        window.removeEventListener("pointermove", handlePointerMove);
        window.removeEventListener("pointerup", handlePointerUp);
        document.body.style.cursor = originalCursor;
        setIsSidebarResizing(false);
        if (isDragging) {
          writeStoredSidebarWidth(latestWidth);
        }
      };

      window.addEventListener("pointermove", handlePointerMove);
      window.addEventListener("pointerup", handlePointerUp);
    },
    [isSidebarCollapsed, sidebarWidth],
  );

  useEffect(() => {
    if (typeof window.matchMedia !== "function") {
      return;
    }

    const mediaQuery = window.matchMedia(sidebarNarrowLayoutQuery);
    const handleChange = () => {
      setIsSidebarNarrowLayout(mediaQuery.matches);
      if (mediaQuery.matches) {
        setIsSidebarCollapsed(false);
        return;
      }
      setIsMobileSidebarOpen(false);
    };

    handleChange();
    mediaQuery.addEventListener("change", handleChange);
    return () => {
      mediaQuery.removeEventListener("change", handleChange);
    };
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!event.ctrlKey || event.metaKey || event.altKey) {
        return;
      }
      if (event.code !== "KeyB") {
        return;
      }
      event.preventDefault();
      if (isSidebarNarrowLayout) {
        setIsMobileSidebarOpen((current) => !current);
        return;
      }
      toggleSidebar();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isSidebarNarrowLayout, toggleSidebar]);

  useEffect(
    () => () => {
      clearSidebarClickTimeout();
    },
    [clearSidebarClickTimeout],
  );

  return {
    handleSidebarDividerClick,
    handleSidebarDividerDoubleClick,
    handleSidebarDividerPointerDown,
    isMobileSidebarOpen,
    isSidebarCollapsed,
    isSidebarNarrowLayout,
    isSidebarResizing,
    isWorkflowSectionOpen,
    setIsMobileSidebarOpen,
    setIsWorkflowSectionOpen,
    shouldReduceMotion,
    sidebarGridTemplateColumns: isSidebarNarrowLayout
      ? undefined
      : isSidebarCollapsed
        ? `${sidebarCollapsedWidth}px minmax(0, 1fr)`
        : `${sidebarWidth}px minmax(0, 1fr)`,
    toggleSidebar,
  };
}
