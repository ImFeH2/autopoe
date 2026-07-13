import {
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { useReducedMotion } from "framer-motion";
import { Menu } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Tabs } from "@/components/ui/tabs";
import type { ViewId } from "@/app/navigation/view-types";
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
import { SidebarPanel } from "@/components/flowent/app-shell/sidebar-panel";
import { sidebarTransitionClassName } from "@/components/flowent/app-shell/sidebar-motion";
import type { Workflow } from "@/features/workflows/model/workflow-types";
import { cn } from "@/lib/utils";

export function AppShell({
  activeProviderName,
  activeView,
  activeWorkflowId,
  children,
  onNewWorkflow,
  onWorkflowDelete,
  onWorkflowRename,
  onViewChange,
  onWorkflowSelect,
  workflows,
}: {
  activeProviderName?: string;
  activeView: ViewId;
  activeWorkflowId?: string;
  children: ReactNode;
  onNewWorkflow: () => void;
  onWorkflowDelete: (workflowId: string) => void;
  onWorkflowRename: (workflowId: string, nextName: string) => void;
  onViewChange: (value: ViewId) => void;
  onWorkflowSelect: (workflowId: string) => void;
  workflows: Workflow[];
}) {
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

  return (
    <Tabs
      value={activeView}
      onValueChange={(value) => onViewChange(value as ViewId)}
      orientation="vertical"
      className={cn(
        "grid h-[var(--flowent-viewport-height)] min-h-0 gap-0 overflow-hidden bg-black pt-[var(--flowent-safe-area-top)] pr-[var(--flowent-safe-area-right)] pb-[var(--flowent-safe-area-bottom)] pl-[var(--flowent-safe-area-left)] text-white transition-[grid-template-columns] max-[900px]:grid-cols-1 max-[900px]:grid-rows-[auto_minmax(0,1fr)]",
        shouldReduceMotion || isSidebarResizing
          ? "duration-0"
          : cn("duration-300", sidebarTransitionClassName),
      )}
      style={
        isSidebarNarrowLayout
          ? undefined
          : {
              gridTemplateColumns: isSidebarCollapsed
                ? `${sidebarCollapsedWidth}px minmax(0, 1fr)`
                : `${sidebarWidth}px minmax(0, 1fr)`,
            }
      }
    >
      <Dialog open={isMobileSidebarOpen} onOpenChange={setIsMobileSidebarOpen}>
        <div className="hidden h-14 min-h-14 items-center border-b border-white/10 bg-black px-3 max-[900px]:flex">
          <Button
            aria-label="Menu"
            className="flowent-sidebar-chrome-button size-10 cursor-pointer rounded-xl border border-transparent bg-transparent p-0 shadow-none hover:bg-white/[0.08]"
            onClick={() => setIsMobileSidebarOpen(true)}
            size="icon"
            title="Menu"
            type="button"
            variant="ghost"
          >
            <Menu aria-hidden="true" />
          </Button>
        </div>
        <DialogContent
          aria-describedby={undefined}
          className="flowent-mobile-sidebar-drawer top-0 left-0 flex h-[var(--flowent-viewport-height)] max-h-none w-[257px] max-w-[calc(100vw-64px)] translate-x-0 translate-y-0 rounded-none border-0 bg-black p-0 text-white ring-0 shadow-none duration-300 sm:max-w-[257px] data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:slide-out-to-left-full data-[state=closed]:zoom-out-100 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:slide-in-from-left-full data-[state=open]:zoom-in-100"
          overlayClassName="flowent-mobile-sidebar-overlay bg-white/10 backdrop-blur-[1px] duration-300 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0"
          showCloseButton={false}
        >
          <DialogTitle className="sr-only">Navigation</DialogTitle>
          <SidebarPanel
            activeProviderName={activeProviderName}
            activeView={activeView}
            activeWorkflowId={activeWorkflowId}
            isMobileDrawer
            isSidebarCollapsed={false}
            isWorkflowSectionOpen={isWorkflowSectionOpen}
            onCloseMobileSidebar={() => setIsMobileSidebarOpen(false)}
            onNewWorkflow={onNewWorkflow}
            onWorkflowDelete={onWorkflowDelete}
            onWorkflowRename={onWorkflowRename}
            onWorkflowSectionOpenChange={setIsWorkflowSectionOpen}
            onWorkflowSelect={onWorkflowSelect}
            shouldReduceMotion={shouldReduceMotion}
            toggleSidebar={toggleSidebar}
            workflows={workflows}
          />
        </DialogContent>
      </Dialog>
      <aside
        className={cn(
          "relative min-h-0 max-[900px]:hidden",
          shouldReduceMotion
            ? "duration-0"
            : cn("duration-300", sidebarTransitionClassName),
        )}
      >
        <SidebarPanel
          activeProviderName={activeProviderName}
          activeView={activeView}
          activeWorkflowId={activeWorkflowId}
          isSidebarCollapsed={isSidebarCollapsed}
          isWorkflowSectionOpen={isWorkflowSectionOpen}
          onNewWorkflow={onNewWorkflow}
          onWorkflowDelete={onWorkflowDelete}
          onWorkflowRename={onWorkflowRename}
          onWorkflowSectionOpenChange={setIsWorkflowSectionOpen}
          onWorkflowSelect={onWorkflowSelect}
          shouldReduceMotion={shouldReduceMotion}
          toggleSidebar={toggleSidebar}
          workflows={workflows}
        />
        {!isSidebarNarrowLayout ? (
          <Button
            aria-label="Toggle sidebar from boundary"
            className={cn(
              "absolute top-0 right-[-4px] z-10 hidden h-full w-2 rounded-none border-0 bg-transparent p-0 shadow-none transition-colors hover:bg-transparent focus-visible:bg-transparent active:bg-transparent active:not-aria-[haspopup]:translate-y-0 dark:hover:bg-transparent dark:focus-visible:bg-transparent sm:block",
              isSidebarCollapsed ? "cursor-pointer" : "cursor-ew-resize",
            )}
            onClick={handleSidebarDividerClick}
            onDoubleClick={handleSidebarDividerDoubleClick}
            onPointerDown={handleSidebarDividerPointerDown}
            tabIndex={-1}
            title="Toggle sidebar"
            type="button"
            variant="ghost"
          />
        ) : null}
      </aside>

      <main className="min-h-0 min-w-0 overflow-hidden bg-black">
        {children}
      </main>
    </Tabs>
  );
}
