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
  Ellipsis,
  ExternalLink,
  KeyRound,
  MessageSquare,
  Pencil,
  Pin,
  PinOff,
  Plug,
  PlusCircle,
  Radio,
  ShieldCheck,
  Settings,
  Sparkles,
  Trash2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  fieldInputClassName,
  navigationLabelClassName,
} from "@/components/flowent/styles";
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

const sidebarTransitionClassName =
  "[transition-timing-function:cubic-bezier(0.22,1,0.36,1)]";
const sidebarMotionEase = [0.22, 1, 0.36, 1] as const;
const sidebarMotionTransition = {
  duration: 0.28,
  ease: sidebarMotionEase,
};
const pinnedWorkflowStorageKey = "flowent:pinned-workflows";

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
        "flowent-navigation-item cursor-pointer justify-start gap-2 rounded-lg border border-transparent bg-transparent px-2 py-1 shadow-none transition-[width,height,padding,color,background-color] duration-300 hover:bg-[#151515] data-[state=active]:bg-[#202020] max-[900px]:justify-center max-[560px]:min-w-fit max-[560px]:flex-none max-[560px]:px-2 max-[560px]:[&_svg]:hidden",
        navigationLabelClassName,
        sidebarTransitionClassName,
        isSidebarCollapsed &&
          "flowent-sidebar-rail-item !w-10 !flex-none pl-[11px] pr-0 group-data-vertical/tabs:!w-10",
        "dark:hover:bg-[#151515] dark:data-[state=active]:border-transparent dark:data-[state=active]:bg-[#202020]",
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
  isPinned,
  isRenaming,
  onDelete,
  onOpenNewTab,
  onRenameCancel,
  onRenameCommit,
  onRenameStart,
  onSelect,
  onTogglePin,
  workflow,
}: {
  isActive: boolean;
  isPinned: boolean;
  isRenaming: boolean;
  onDelete: (workflowId: string) => void;
  onOpenNewTab: (workflowId: string) => void;
  onRenameCancel: () => void;
  onRenameCommit: (workflowId: string, nextName: string) => void;
  onRenameStart: (workflowId: string) => void;
  onSelect: (workflowId: string) => void;
  onTogglePin: (workflowId: string) => void;
  workflow: Workflow;
}) {
  const [draftName, setDraftName] = useState(workflow.name);
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  useEffect(() => {
    if (isRenaming) {
      setDraftName(workflow.name);
    }
  }, [isRenaming, workflow.name]);

  const commitRename = () => {
    onRenameCommit(workflow.id, draftName);
  };

  if (isRenaming) {
    return (
      <div className="h-8 px-1 py-0.5">
        <Input
          aria-label={`Rename ${workflow.name}`}
          autoFocus
          className={cn(
            fieldInputClassName,
            "h-7 w-full rounded-lg px-2 text-sm leading-[21px]",
          )}
          onBlur={commitRename}
          onChange={(event) => setDraftName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.currentTarget.blur();
            }
            if (event.key === "Escape") {
              event.preventDefault();
              onRenameCancel();
            }
          }}
          value={draftName}
        />
      </div>
    );
  }

  return (
    <div
      className="group/workflow-menu-item relative h-8"
      onContextMenu={(event) => {
        event.preventDefault();
        setIsMenuOpen(true);
      }}
    >
      <Button
        className={cn(
          "flowent-workflow-history-item h-8 w-full cursor-pointer justify-start rounded-lg border border-transparent bg-transparent px-2 py-1 pr-8 text-left shadow-none transition-[width,height,padding,color,background-color] duration-300 hover:bg-[#151515] max-[900px]:justify-center max-[560px]:min-w-fit max-[560px]:flex-none max-[560px]:px-2",
          navigationLabelClassName,
          sidebarTransitionClassName,
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
      <DropdownMenu open={isMenuOpen} onOpenChange={setIsMenuOpen}>
        <DropdownMenuTrigger asChild>
          <Button
            aria-label="Options"
            className="absolute top-1 right-1 hidden size-6 cursor-pointer rounded-md border border-transparent bg-transparent p-0 text-white shadow-none hover:bg-white/[0.08] focus-visible:flex data-[state=open]:flex data-[state=open]:bg-white/[0.08] group-hover/workflow-menu-item:flex group-focus-within/workflow-menu-item:flex"
            onClick={(event) => event.stopPropagation()}
            size="icon"
            title="Options"
            type="button"
            variant="ghost"
          >
            <Ellipsis className="size-4" aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" alignOffset={-84} sideOffset={2}>
          <DropdownMenuItem onSelect={() => onOpenNewTab(workflow.id)}>
            <ExternalLink className="size-4 shrink-0" aria-hidden="true" />
            Open new tab
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onRenameStart(workflow.id)}>
            <Pencil className="size-4 shrink-0" aria-hidden="true" />
            Rename
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onTogglePin(workflow.id)}>
            {isPinned ? (
              <PinOff className="size-4 shrink-0" aria-hidden="true" />
            ) : (
              <Pin className="size-4 shrink-0" aria-hidden="true" />
            )}
            {isPinned ? "Unpin" : "Pin"}
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => onDelete(workflow.id)}
            variant="destructive"
          >
            <Trash2 className="size-4 shrink-0" aria-hidden="true" />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

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
        "grid h-[var(--flowent-viewport-height)] min-h-0 gap-0 overflow-hidden bg-black pt-[var(--flowent-safe-area-top)] pr-[var(--flowent-safe-area-right)] pb-[var(--flowent-safe-area-bottom)] pl-[var(--flowent-safe-area-left)] text-white transition-[grid-template-columns] max-[900px]:grid-cols-1 max-[900px]:grid-rows-[auto_minmax(0,1fr)]",
        shouldReduceMotion
          ? "duration-0"
          : cn("duration-300", sidebarTransitionClassName),
        isSidebarCollapsed
          ? "grid-cols-[64px_minmax(0,1fr)]"
          : "grid-cols-[232px_minmax(0,1fr)]",
      )}
    >
      <aside
        className={cn(
          "relative flex min-h-0 flex-col border-r border-white/10 bg-black px-3 py-3 max-[900px]:min-h-auto max-[900px]:border-r-0 max-[900px]:border-b max-[900px]:px-3 max-[900px]:py-3",
          shouldReduceMotion
            ? "duration-0"
            : cn("duration-300", sidebarTransitionClassName),
        )}
      >
        <div
          className={cn(
            "flex h-10 min-h-10 items-center bg-black px-1 transition-[gap] max-[560px]:min-h-10",
            shouldReduceMotion
              ? "duration-0"
              : cn("duration-300", sidebarTransitionClassName),
            "gap-2.5",
          )}
        >
          <div
            className={cn(
              "grid size-8 shrink-0 place-items-center overflow-hidden rounded-md border border-white/10 bg-input/30 transition-transform",
              shouldReduceMotion
                ? "duration-0"
                : cn("duration-300", sidebarTransitionClassName),
              isSidebarCollapsed && "flowent-sidebar-rail-logo -translate-x-1",
            )}
          >
            <img alt="" className="size-full object-cover" src="/flowent.png" />
          </div>
          <SidebarText
            className="min-w-0 flex-1 self-center"
            isVisible={!isSidebarCollapsed}
            shouldReduceMotion={shouldReduceMotion}
          >
            <div className="flowent-sidebar-brand truncate">Flowent</div>
          </SidebarText>
          <AnimatePresence initial={false}>
            {!isSidebarCollapsed ? (
              <motion.div
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                initial={shouldReduceMotion ? false : { opacity: 0 }}
                key="collapse-sidebar-button"
                transition={
                  shouldReduceMotion ? { duration: 0 } : sidebarMotionTransition
                }
              >
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
              </motion.div>
            ) : null}
          </AnimatePresence>
        </div>

        <nav aria-label="Primary navigation">
          <TabsList
            className={cn(
              "mt-4 flex w-auto flex-none flex-col items-stretch gap-0 p-0 max-[900px]:mt-3 max-[900px]:mx-0 max-[900px]:flex-row max-[560px]:justify-start max-[560px]:overflow-x-auto",
              "-mx-1",
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
                <SidebarBlock
                  className="flowent-sidebar-section-label px-2 pt-4 pb-1"
                  isDecorative
                  isVisible={!isSidebarCollapsed}
                  shouldReduceMotion={shouldReduceMotion}
                  wrapperClassName="max-[900px]:hidden"
                >
                  {group.label}
                </SidebarBlock>
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
            <SidebarBlock
              className="pt-4"
              isVisible={!isSidebarCollapsed}
              shouldReduceMotion={shouldReduceMotion}
              wrapperClassName="max-[900px]:hidden"
            >
              <WorkflowsNavigationSection
                activeView={activeView}
                activeWorkflowId={activeWorkflowId}
                isOpen={isWorkflowSectionOpen}
                onOpenChange={setIsWorkflowSectionOpen}
                onWorkflowDelete={onWorkflowDelete}
                onWorkflowRename={onWorkflowRename}
                onWorkflowSelect={onWorkflowSelect}
                shouldReduceMotion={shouldReduceMotion}
                workflows={workflows}
              />
            </SidebarBlock>
          </TabsList>
        </nav>

        <div className="mt-auto flex flex-col gap-2 max-[900px]:hidden">
          <AnimatePresence initial={false}>
            {isSidebarCollapsed ? (
              <motion.div
                animate={{ opacity: 1 }}
                className="-mx-1"
                exit={{ opacity: 0 }}
                initial={shouldReduceMotion ? false : { opacity: 0 }}
                key="expand-sidebar-button"
                transition={
                  shouldReduceMotion
                    ? { duration: 0 }
                    : {
                        ...sidebarMotionTransition,
                        delay: 0.08,
                      }
                }
              >
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
              </motion.div>
            ) : null}
          </AnimatePresence>
          <div
            className={cn(
              "flowent-sidebar-status -mx-1 flex h-8 items-center gap-2 px-2 transition-[padding,color]",
              shouldReduceMotion
                ? "duration-0"
                : cn("duration-300", sidebarTransitionClassName),
              isSidebarCollapsed &&
                "flowent-sidebar-rail-status pl-[17px] pr-0",
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
        <Button
          aria-label="Toggle sidebar from boundary"
          className="absolute top-0 right-[-4px] z-10 hidden h-full w-2 cursor-ew-resize rounded-none border-0 bg-transparent p-0 shadow-none transition-colors hover:bg-transparent focus-visible:bg-transparent active:bg-transparent active:not-aria-[haspopup]:translate-y-0 dark:hover:bg-transparent dark:focus-visible:bg-transparent max-[900px]:hidden sm:block"
          onClick={toggleSidebar}
          tabIndex={-1}
          title="Toggle sidebar"
          type="button"
          variant="ghost"
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
          animate={{ opacity: 1 }}
          className={cn("min-w-0 overflow-hidden", className)}
          exit={shouldReduceMotion ? { opacity: 1 } : { opacity: 0 }}
          initial={shouldReduceMotion ? false : { opacity: 0 }}
          key="sidebar-text"
          transition={
            shouldReduceMotion
              ? { duration: 0 }
              : {
                  ...sidebarMotionTransition,
                  duration: sidebarMotionTransition.duration,
                }
          }
        >
          {children}
        </motion.span>
      ) : null}
    </AnimatePresence>
  );
}

function SidebarBlock({
  children,
  className,
  isDecorative = false,
  isVisible,
  shouldReduceMotion,
  wrapperClassName,
}: {
  children: ReactNode;
  className?: string;
  isDecorative?: boolean;
  isVisible: boolean;
  shouldReduceMotion: boolean;
  wrapperClassName?: string;
}) {
  return (
    <AnimatePresence initial={false}>
      {isVisible ? (
        <motion.div
          animate={{ height: "auto", opacity: 1 }}
          aria-hidden={isDecorative ? true : undefined}
          className={cn("min-w-0 overflow-hidden", wrapperClassName)}
          exit={shouldReduceMotion ? { opacity: 1 } : { height: 0, opacity: 0 }}
          initial={shouldReduceMotion ? false : { height: 0, opacity: 0 }}
          key="sidebar-block"
          transition={
            shouldReduceMotion
              ? { duration: 0 }
              : {
                  ...sidebarMotionTransition,
                  duration: sidebarMotionTransition.duration,
                }
          }
        >
          <div className={className}>{children}</div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

function WorkflowsNavigationSection({
  activeView,
  activeWorkflowId,
  isOpen,
  onOpenChange,
  onWorkflowDelete,
  onWorkflowRename,
  onWorkflowSelect,
  shouldReduceMotion,
  workflows,
}: {
  activeView: ViewId;
  activeWorkflowId?: string;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onWorkflowDelete: (workflowId: string) => void;
  onWorkflowRename: (workflowId: string, nextName: string) => void;
  onWorkflowSelect: (workflowId: string) => void;
  shouldReduceMotion: boolean;
  workflows: Workflow[];
}) {
  const [pinnedWorkflowIds, setPinnedWorkflowIds] = useState<string[]>(() =>
    readPinnedWorkflowIds(),
  );
  const [renamingWorkflowId, setRenamingWorkflowId] = useState("");
  const hasActiveWorkflow =
    activeView === "workflows" && Boolean(activeWorkflowId);
  const workflowIds = new Set(workflows.map((workflow) => workflow.id));
  const cleanPinnedWorkflowIds = pinnedWorkflowIds.filter((workflowId) =>
    workflowIds.has(workflowId),
  );
  const pinnedWorkflowIdSet = new Set(cleanPinnedWorkflowIds);
  const sortedWorkflows = [
    ...workflows.filter((workflow) => pinnedWorkflowIdSet.has(workflow.id)),
    ...workflows.filter((workflow) => !pinnedWorkflowIdSet.has(workflow.id)),
  ].sort((firstWorkflow, secondWorkflow) => {
    const firstIndex = cleanPinnedWorkflowIds.indexOf(firstWorkflow.id);
    const secondIndex = cleanPinnedWorkflowIds.indexOf(secondWorkflow.id);
    if (firstIndex >= 0 && secondIndex >= 0) {
      return firstIndex - secondIndex;
    }
    return 0;
  });

  useEffect(() => {
    if (cleanPinnedWorkflowIds.length !== pinnedWorkflowIds.length) {
      setPinnedWorkflowIds(cleanPinnedWorkflowIds);
      writePinnedWorkflowIds(cleanPinnedWorkflowIds);
    }
  }, [cleanPinnedWorkflowIds, pinnedWorkflowIds.length]);

  const setPinnedIds = (nextPinnedWorkflowIds: string[]) => {
    setPinnedWorkflowIds(nextPinnedWorkflowIds);
    writePinnedWorkflowIds(nextPinnedWorkflowIds);
  };

  const togglePin = (workflowId: string) => {
    if (pinnedWorkflowIdSet.has(workflowId)) {
      setPinnedIds(
        cleanPinnedWorkflowIds.filter(
          (pinnedWorkflowId) => pinnedWorkflowId !== workflowId,
        ),
      );
      return;
    }
    setPinnedIds([workflowId, ...cleanPinnedWorkflowIds]);
  };

  const commitRename = (workflowId: string, nextName: string) => {
    setRenamingWorkflowId("");
    const trimmedName = nextName.trim();
    const workflow = workflows.find(
      (currentWorkflow) => currentWorkflow.id === workflowId,
    );
    if (!workflow || !trimmedName || trimmedName === workflow.name) {
      return;
    }
    onWorkflowRename(workflowId, trimmedName);
  };

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
            "flowent-workflow-history-trigger h-7 w-full cursor-pointer justify-between rounded-md border border-transparent bg-transparent px-2 py-0 text-[11px] leading-4 font-medium text-white/45 shadow-none transition-colors duration-100 hover:bg-transparent hover:text-white/70 aria-expanded:bg-transparent aria-expanded:text-white/45 dark:aria-expanded:bg-transparent dark:aria-expanded:text-white/45 max-[900px]:hidden",
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
                  : {
                      ...sidebarMotionTransition,
                      duration: sidebarMotionTransition.duration,
                    }
              }
            >
              {workflows.length === 0 ? (
                <div className="flowent-sidebar-section-label flex h-8 w-full items-center px-2 max-[900px]:hidden">
                  <span>No workflow yet.</span>
                </div>
              ) : (
                sortedWorkflows.map((workflow) => (
                  <WorkflowNavigationItem
                    isActive={
                      activeView === "workflows" &&
                      activeWorkflowId === workflow.id
                    }
                    isPinned={pinnedWorkflowIdSet.has(workflow.id)}
                    isRenaming={renamingWorkflowId === workflow.id}
                    key={workflow.id}
                    onDelete={onWorkflowDelete}
                    onOpenNewTab={(workflowId) => {
                      window.open(
                        `/workflows/${encodeURIComponent(workflowId)}`,
                        "_blank",
                        "noopener,noreferrer",
                      );
                    }}
                    onRenameCancel={() => setRenamingWorkflowId("")}
                    onRenameCommit={commitRename}
                    onRenameStart={setRenamingWorkflowId}
                    onSelect={onWorkflowSelect}
                    onTogglePin={togglePin}
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

function readPinnedWorkflowIds() {
  if (typeof window === "undefined") {
    return [];
  }
  try {
    const value = window.localStorage.getItem(pinnedWorkflowStorageKey);
    if (!value) {
      return [];
    }
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter(
      (workflowId): workflowId is string => typeof workflowId === "string",
    );
  } catch {
    return [];
  }
}

function writePinnedWorkflowIds(workflowIds: string[]) {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(
    pinnedWorkflowStorageKey,
    JSON.stringify(workflowIds),
  );
}
