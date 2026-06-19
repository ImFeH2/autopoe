import {
  Fragment,
  type ReactNode,
  useCallback,
  useEffect,
  useState,
} from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import type { LucideIcon } from "lucide-react";
import {
  ChevronsLeft,
  ChevronsRight,
  ChevronRight,
  KeyRound,
  MessageSquare,
  Plug,
  PlusCircle,
  Radio,
  ShieldCheck,
  Settings,
  Sparkles,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { navigationLabelClassName } from "@/components/flowent/styles";
import type { ViewId, Workflow } from "@/components/flowent/types";
import { cn } from "@/lib/utils";

type NavigationItem = {
  icon: LucideIcon;
  id: ViewId;
  label: string;
};

const workspaceNavigationItem = {
  icon: MessageSquare,
  id: "workspace",
  label: "Workspace",
} satisfies NavigationItem;

const workflowsNavigationItem = {
  icon: PlusCircle,
  id: "workflows",
  label: "Workflows",
} satisfies NavigationItem;

const navigationGroups = [
  {
    label: "Tools",
    items: [
      { id: "skills", label: "Skills", icon: Sparkles },
      { id: "mcp", label: "MCP", icon: Plug },
    ],
  },
  {
    label: "Setup",
    items: [
      { id: "providers", label: "Providers", icon: KeyRound },
      { id: "channels", label: "Channels", icon: Radio },
      { id: "permissions", label: "Permissions", icon: ShieldCheck },
      { id: "settings", label: "Settings", icon: Settings },
    ],
  },
] satisfies Array<{ label: string; items: NavigationItem[] }>;

function NavigationTrigger({
  isSidebarCollapsed,
  item,
  onClick,
  shouldReduceMotion,
  suppressActiveStyle = false,
}: {
  isSidebarCollapsed: boolean;
  item: NavigationItem;
  onClick?: () => void;
  shouldReduceMotion: boolean;
  suppressActiveStyle?: boolean;
}) {
  const Icon = item.icon;

  return (
    <TabsTrigger
      aria-label={isSidebarCollapsed ? item.label : undefined}
      title={isSidebarCollapsed ? item.label : undefined}
      value={item.id}
      onClick={onClick}
      className={cn(
        "flowent-navigation-item cursor-pointer justify-start gap-2 rounded-lg border border-transparent bg-transparent px-2 py-1 shadow-none transition-colors duration-100 hover:bg-[#151515] data-[state=active]:bg-[#202020] max-[900px]:justify-center max-[560px]:min-w-fit max-[560px]:flex-none max-[560px]:px-2 max-[560px]:[&_svg]:hidden",
        navigationLabelClassName,
        "dark:hover:bg-[#151515] dark:data-[state=active]:border-transparent dark:data-[state=active]:bg-[#202020]",
        isSidebarCollapsed &&
          "justify-center gap-0 px-0 max-[900px]:justify-center max-[900px]:gap-2 max-[900px]:px-2",
        suppressActiveStyle &&
          "data-[state=active]:!bg-transparent data-[state=active]:!text-white dark:data-[state=active]:!bg-transparent",
      )}
    >
      <Icon aria-hidden="true" />
      <SidebarText
        className="flowent-navigation-text"
        isVisible={!isSidebarCollapsed}
        shouldReduceMotion={shouldReduceMotion}
      >
        {item.label}
      </SidebarText>
    </TabsTrigger>
  );
}

function WorkflowNavigationItem({
  isActive,
  onSelect,
  workflow,
}: {
  isActive: boolean;
  onSelect: (workflowId: string) => void;
  workflow: Workflow;
}) {
  return (
    <Button
      className={cn(
        "flowent-workflow-history-item h-8 w-full cursor-pointer justify-start rounded-lg border border-transparent bg-transparent px-2 py-1 text-left shadow-none transition-colors duration-100 hover:bg-[#151515] max-[900px]:justify-center max-[560px]:min-w-fit max-[560px]:flex-none max-[560px]:px-2",
        navigationLabelClassName,
        isActive && "flowent-workflow-history-item-active bg-[#202020]",
      )}
      onClick={() => onSelect(workflow.id)}
      title={workflow.name}
      type="button"
      variant="ghost"
    >
      <span className="flowent-navigation-text min-w-0 truncate">
        {workflow.name}
      </span>
    </Button>
  );
}

export function AppShell({
  activeProviderName,
  activeView,
  activeWorkflowId,
  children,
  onNewWorkflow,
  onViewChange,
  onWorkflowSelect,
  workflows,
}: {
  activeProviderName?: string;
  activeView: ViewId;
  activeWorkflowId?: string;
  children: ReactNode;
  onNewWorkflow: () => void;
  onViewChange: (value: ViewId) => void;
  onWorkflowSelect: (workflowId: string) => void;
  workflows: Workflow[];
}) {
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isWorkflowSectionOpen, setIsWorkflowSectionOpen] = useState(true);
  const shouldReduceMotion = useReducedMotion() ?? false;
  const toggleSidebar = useCallback(() => {
    setIsSidebarCollapsed((current) => !current);
  }, []);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") {
      return;
    }

    const mediaQuery = window.matchMedia("(max-width: 900px)");
    const handleChange = () => {
      if (mediaQuery.matches) {
        setIsSidebarCollapsed(false);
      }
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
      toggleSidebar();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [toggleSidebar]);

  return (
    <Tabs
      value={activeView}
      onValueChange={(value) => onViewChange(value as ViewId)}
      orientation="vertical"
      className={cn(
        "grid h-[var(--flowent-viewport-height)] min-h-0 gap-0 overflow-hidden bg-black pt-[var(--flowent-safe-area-top)] pr-[var(--flowent-safe-area-right)] pb-[var(--flowent-safe-area-bottom)] pl-[var(--flowent-safe-area-left)] text-white transition-[grid-template-columns] ease-out max-[900px]:grid-cols-1 max-[900px]:grid-rows-[auto_minmax(0,1fr)]",
        shouldReduceMotion ? "duration-0" : "duration-200",
        isSidebarCollapsed
          ? "grid-cols-[64px_minmax(0,1fr)]"
          : "grid-cols-[232px_minmax(0,1fr)]",
      )}
    >
      <aside
        className={cn(
          "relative flex min-h-0 flex-col border-r border-white/10 bg-black py-3 transition-[padding] ease-out max-[900px]:min-h-auto max-[900px]:border-r-0 max-[900px]:border-b max-[900px]:px-3 max-[900px]:py-3",
          shouldReduceMotion ? "duration-0" : "duration-200",
          isSidebarCollapsed ? "px-2" : "px-3",
        )}
      >
        <div
          className={cn(
            "flex min-h-10 items-center bg-black px-1 max-[560px]:min-h-10",
            isSidebarCollapsed
              ? "flex-col justify-center gap-2 max-[900px]:flex-row max-[900px]:justify-start"
              : "gap-2.5",
          )}
        >
          <div className="grid size-8 place-items-center overflow-hidden rounded-md border border-white/10 bg-input/30">
            <img alt="" className="size-full object-cover" src="/flowent.png" />
          </div>
          <SidebarText
            className="min-w-0 flex-1 self-center"
            isVisible={!isSidebarCollapsed}
            shouldReduceMotion={shouldReduceMotion}
          >
            <div className="flowent-sidebar-brand truncate">Flowent</div>
          </SidebarText>
          {!isSidebarCollapsed ? (
            <Button
              aria-label="Collapse sidebar"
              className="flowent-sidebar-chrome-button size-10 cursor-pointer rounded-xl border border-transparent bg-transparent p-0 shadow-none hover:bg-white/[0.08] max-[900px]:hidden"
              onClick={toggleSidebar}
              size="icon"
              title="Collapse sidebar"
              type="button"
              variant="ghost"
            >
              <ChevronsLeft aria-hidden="true" />
            </Button>
          ) : null}
        </div>

        <nav aria-label="Primary navigation">
          <TabsList
            className={cn(
              "mt-4 flex w-auto flex-none flex-col items-stretch gap-0 p-0 max-[900px]:mt-3 max-[900px]:mx-0 max-[900px]:flex-row max-[560px]:justify-start max-[560px]:overflow-x-auto",
              isSidebarCollapsed ? "mx-0" : "-mx-1",
            )}
            variant="line"
          >
            <NavigationTrigger
              isSidebarCollapsed={isSidebarCollapsed}
              item={workspaceNavigationItem}
              shouldReduceMotion={shouldReduceMotion}
            />
            <NavigationTrigger
              isSidebarCollapsed={isSidebarCollapsed}
              item={workflowsNavigationItem}
              onClick={
                activeView === "workflows" && activeWorkflowId
                  ? onNewWorkflow
                  : undefined
              }
              shouldReduceMotion={shouldReduceMotion}
              suppressActiveStyle={
                activeView === "workflows" && Boolean(activeWorkflowId)
              }
            />
            {navigationGroups.map((group) => (
              <Fragment key={group.label}>
                {!isSidebarCollapsed ? (
                  <div
                    aria-hidden="true"
                    className="flowent-sidebar-section-label mt-4 mb-1 px-2 max-[900px]:hidden"
                  >
                    {group.label}
                  </div>
                ) : null}
                {group.items.map((item) => (
                  <NavigationTrigger
                    isSidebarCollapsed={isSidebarCollapsed}
                    key={item.id}
                    item={item}
                    shouldReduceMotion={shouldReduceMotion}
                  />
                ))}
              </Fragment>
            ))}
            {!isSidebarCollapsed ? (
              <WorkflowsNavigationSection
                activeView={activeView}
                activeWorkflowId={activeWorkflowId}
                isOpen={isWorkflowSectionOpen}
                onOpenChange={setIsWorkflowSectionOpen}
                onWorkflowSelect={onWorkflowSelect}
                shouldReduceMotion={shouldReduceMotion}
                workflows={workflows}
              />
            ) : null}
          </TabsList>
        </nav>

        <div className="mt-auto flex flex-col gap-2 max-[900px]:hidden">
          {isSidebarCollapsed ? (
            <Button
              aria-label="Expand sidebar"
              className="flowent-sidebar-chrome-button size-10 cursor-pointer rounded-xl border border-transparent bg-transparent p-0 shadow-none hover:bg-white/[0.08]"
              onClick={toggleSidebar}
              size="icon"
              title="Expand sidebar"
              type="button"
              variant="ghost"
            >
              <ChevronsRight aria-hidden="true" />
            </Button>
          ) : null}
          <div
            className={cn(
              "flowent-sidebar-status flex h-8 items-center gap-2",
              isSidebarCollapsed ? "justify-center px-0" : "-mx-1 px-2",
            )}
            title={activeProviderName ?? "No provider"}
          >
            <div
              className="size-1.5 rounded-full bg-[#7ddf89]"
              aria-hidden="true"
            />
            <SidebarText
              isVisible={!isSidebarCollapsed}
              shouldReduceMotion={shouldReduceMotion}
            >
              <span>{activeProviderName ?? "No provider"}</span>
            </SidebarText>
          </div>
        </div>
        <div
          aria-hidden="true"
          className="absolute top-0 right-[-4px] z-10 hidden h-full w-2 cursor-ew-resize outline-none transition-colors hover:bg-white/10 focus-visible:bg-white/10 max-[900px]:hidden sm:block"
          onDoubleClick={toggleSidebar}
          title="Double-click to toggle sidebar"
        />
      </aside>

      <main className="min-h-0 min-w-0 overflow-hidden bg-black">
        {children}
      </main>
    </Tabs>
  );
}

function SidebarText({
  children,
  className,
  isVisible,
  shouldReduceMotion,
}: {
  children: ReactNode;
  className?: string;
  isVisible: boolean;
  shouldReduceMotion: boolean;
}) {
  return (
    <AnimatePresence initial={false}>
      {isVisible ? (
        <motion.span
          animate={{ opacity: 1, width: "auto" }}
          className={cn("min-w-0 overflow-hidden", className)}
          exit={shouldReduceMotion ? { opacity: 1 } : { opacity: 0, width: 0 }}
          initial={shouldReduceMotion ? false : { opacity: 0, width: 0 }}
          key="sidebar-text"
          transition={
            shouldReduceMotion
              ? { duration: 0 }
              : { duration: 0.16, ease: [0.32, 0.72, 0, 1] }
          }
        >
          {children}
        </motion.span>
      ) : null}
    </AnimatePresence>
  );
}

function WorkflowsNavigationSection({
  activeView,
  activeWorkflowId,
  isOpen,
  onOpenChange,
  onWorkflowSelect,
  shouldReduceMotion,
  workflows,
}: {
  activeView: ViewId;
  activeWorkflowId?: string;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onWorkflowSelect: (workflowId: string) => void;
  shouldReduceMotion: boolean;
  workflows: Workflow[];
}) {
  const hasActiveWorkflow =
    activeView === "workflows" && Boolean(activeWorkflowId);

  return (
    <Collapsible
      className="max-[900px]:hidden"
      open={isOpen}
      onOpenChange={onOpenChange}
    >
      <CollapsibleTrigger asChild>
        <Button
          aria-label="Workflows"
          className={cn(
            "flowent-workflow-history-trigger mt-4 h-7 w-full cursor-pointer justify-between rounded-md border border-transparent bg-transparent px-2 py-0 text-[11px] leading-4 font-medium text-white/45 shadow-none transition-colors duration-100 hover:bg-transparent hover:text-white/70 aria-expanded:bg-transparent aria-expanded:text-white/45 dark:aria-expanded:bg-transparent dark:aria-expanded:text-white/45 max-[900px]:hidden",
            navigationLabelClassName,
            hasActiveWorkflow &&
              !isOpen &&
              "flowent-workflow-history-item-active",
          )}
          type="button"
          variant="ghost"
        >
          <span className="flowent-navigation-text min-w-0 truncate">
            Workflows
          </span>
          <ChevronRight
            aria-hidden="true"
            className={cn(
              "size-3 shrink-0 text-white/35 transition-transform",
              isOpen && "rotate-90",
            )}
          />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent forceMount>
        <AnimatePresence initial={false}>
          {isOpen ? (
            <motion.div
              animate={
                shouldReduceMotion
                  ? { opacity: 1 }
                  : { height: "auto", opacity: 1 }
              }
              className="overflow-hidden"
              exit={
                shouldReduceMotion ? { opacity: 1 } : { height: 0, opacity: 0 }
              }
              initial={shouldReduceMotion ? false : { height: 0, opacity: 0 }}
              key="workflow-history"
              transition={
                shouldReduceMotion
                  ? { duration: 0 }
                  : { duration: 0.18, ease: [0.32, 0.72, 0, 1] }
              }
            >
              {workflows.length === 0 ? (
                <div className="flowent-sidebar-section-label flex h-8 w-full items-center px-2 max-[900px]:hidden">
                  <span>No workflow yet.</span>
                </div>
              ) : (
                workflows.map((workflow) => (
                  <WorkflowNavigationItem
                    isActive={
                      activeView === "workflows" &&
                      activeWorkflowId === workflow.id
                    }
                    key={workflow.id}
                    onSelect={onWorkflowSelect}
                    workflow={workflow}
                  />
                ))
              )}
            </motion.div>
          ) : null}
        </AnimatePresence>
      </CollapsibleContent>
    </Collapsible>
  );
}
