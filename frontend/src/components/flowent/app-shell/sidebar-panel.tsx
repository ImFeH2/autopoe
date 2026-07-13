import { Fragment, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { LucideIcon } from "lucide-react";
import {
  ChevronsLeft,
  ChevronsRight,
  KeyRound,
  MessageSquare,
  Plug,
  PlusCircle,
  Radio,
  Settings,
  ShieldCheck,
  Sparkles,
} from "lucide-react";

import type { ViewId } from "@/app/navigation/view-types";
import {
  sidebarMotionTransition,
  sidebarTransitionClassName,
} from "@/components/flowent/app-shell/sidebar-motion";
import { WorkflowsNavigationSection } from "@/components/flowent/app-shell/workflow-navigation";
import { navigationLabelClassName } from "@/components/flowent/styles";
import { Button } from "@/components/ui/button";
import { TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { Workflow } from "@/features/workflows/model/workflow-types";
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
  isMobileDrawer = false,
  isSidebarCollapsed,
  item,
  onClick,
  shouldReduceMotion,
  suppressActiveStyle = false,
}: {
  isMobileDrawer?: boolean;
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
        "flowent-navigation-item cursor-pointer justify-start gap-2 rounded-lg border border-transparent bg-transparent px-2 py-1 shadow-none transition-[width,height,padding,color,background-color] duration-300 hover:bg-[#151515] data-[state=active]:bg-[#202020]",
        navigationLabelClassName,
        sidebarTransitionClassName,
        !isMobileDrawer &&
          "max-[900px]:justify-center max-[560px]:min-w-fit max-[560px]:flex-none max-[560px]:px-2 max-[560px]:[&_svg]:hidden",
        isMobileDrawer && "w-full justify-start",
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

export function SidebarPanel({
  activeProviderName,
  activeView,
  activeWorkflowId,
  isMobileDrawer = false,
  isSidebarCollapsed,
  isWorkflowSectionOpen,
  onCloseMobileSidebar,
  onNewWorkflow,
  onWorkflowDelete,
  onWorkflowRename,
  onWorkflowSectionOpenChange,
  onWorkflowSelect,
  shouldReduceMotion,
  toggleSidebar,
  workflows,
}: {
  activeProviderName?: string;
  activeView: ViewId;
  activeWorkflowId?: string;
  isMobileDrawer?: boolean;
  isSidebarCollapsed: boolean;
  isWorkflowSectionOpen: boolean;
  onCloseMobileSidebar?: () => void;
  onNewWorkflow: () => void;
  onWorkflowDelete: (workflowId: string) => void;
  onWorkflowRename: (workflowId: string, nextName: string) => void;
  onWorkflowSectionOpenChange: (open: boolean) => void;
  onWorkflowSelect: (workflowId: string) => void;
  shouldReduceMotion: boolean;
  toggleSidebar: () => void;
  workflows: Workflow[];
}) {
  const isCollapsed = isMobileDrawer ? false : isSidebarCollapsed;
  const closeMobileSidebar = () => {
    if (isMobileDrawer) {
      onCloseMobileSidebar?.();
    }
  };
  const handleWorkflowSelect = (workflowId: string) => {
    onWorkflowSelect(workflowId);
    closeMobileSidebar();
  };
  const handleWorkflowsNavigationClick = () => {
    if (activeView === "workflows" && activeWorkflowId) {
      onNewWorkflow();
    }
    closeMobileSidebar();
  };

  return (
    <div
      className={cn(
        "flex h-full min-h-0 flex-col border-r border-white/10 bg-black px-3 py-3",
        isMobileDrawer && "w-full",
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
            isCollapsed && "flowent-sidebar-rail-logo -translate-x-1",
          )}
        >
          <img alt="" className="size-full object-cover" src="/flowent.png" />
        </div>
        <SidebarText
          className="min-w-0 flex-1 self-center"
          isVisible={!isCollapsed}
          shouldReduceMotion={shouldReduceMotion}
        >
          <div className="flowent-sidebar-brand truncate">Flowent</div>
        </SidebarText>
        {isMobileDrawer ? (
          <Button
            aria-label="Close sidebar"
            className="flowent-sidebar-chrome-button size-10 cursor-pointer rounded-xl border border-transparent bg-transparent p-0 shadow-none hover:bg-white/[0.08]"
            onClick={onCloseMobileSidebar}
            size="icon"
            title="Close sidebar"
            type="button"
            variant="ghost"
          >
            <ChevronsLeft aria-hidden="true" />
          </Button>
        ) : (
          <AnimatePresence initial={false}>
            {!isCollapsed ? (
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
                  className="flowent-sidebar-chrome-button size-10 cursor-pointer rounded-xl border border-transparent bg-transparent p-0 shadow-none hover:bg-white/[0.08]"
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
        )}
      </div>

      <nav
        aria-label={isMobileDrawer ? "Mobile navigation" : "Primary navigation"}
      >
        <TabsList
          className={cn(
            "mt-4 flex w-auto flex-none flex-col items-stretch gap-0 p-0",
            "-mx-1",
            !isMobileDrawer &&
              "max-[900px]:mt-3 max-[900px]:mx-0 max-[900px]:flex-row max-[560px]:justify-start max-[560px]:overflow-x-auto",
          )}
          variant="line"
        >
          <NavigationTrigger
            isMobileDrawer={isMobileDrawer}
            isSidebarCollapsed={isCollapsed}
            item={workspaceNavigationItem}
            onClick={closeMobileSidebar}
            shouldReduceMotion={shouldReduceMotion}
          />
          <NavigationTrigger
            isMobileDrawer={isMobileDrawer}
            isSidebarCollapsed={isCollapsed}
            item={workflowsNavigationItem}
            onClick={
              isMobileDrawer || (activeView === "workflows" && activeWorkflowId)
                ? handleWorkflowsNavigationClick
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
                isVisible={!isCollapsed}
                shouldReduceMotion={shouldReduceMotion}
                wrapperClassName={cn(!isMobileDrawer && "max-[900px]:hidden")}
              >
                {group.label}
              </SidebarBlock>
              {group.items.map((item) => (
                <NavigationTrigger
                  isMobileDrawer={isMobileDrawer}
                  isSidebarCollapsed={isCollapsed}
                  key={item.id}
                  item={item}
                  onClick={closeMobileSidebar}
                  shouldReduceMotion={shouldReduceMotion}
                />
              ))}
            </Fragment>
          ))}
          <SidebarBlock
            className="pt-4"
            isVisible={!isCollapsed}
            shouldReduceMotion={shouldReduceMotion}
            wrapperClassName={cn(!isMobileDrawer && "max-[900px]:hidden")}
          >
            <WorkflowsNavigationSection
              activeView={activeView}
              activeWorkflowId={activeWorkflowId}
              isMobileDrawer={isMobileDrawer}
              isOpen={isWorkflowSectionOpen}
              onOpenChange={onWorkflowSectionOpenChange}
              onWorkflowDelete={onWorkflowDelete}
              onWorkflowRename={onWorkflowRename}
              onWorkflowSelect={handleWorkflowSelect}
              shouldReduceMotion={shouldReduceMotion}
              workflows={workflows}
            />
          </SidebarBlock>
        </TabsList>
      </nav>

      <div
        className={cn(
          "mt-auto flex flex-col gap-2",
          !isMobileDrawer && "max-[900px]:hidden",
        )}
      >
        {!isMobileDrawer ? (
          <AnimatePresence initial={false}>
            {isCollapsed ? (
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
        ) : null}
        <div
          className={cn(
            "flowent-sidebar-status -mx-1 flex h-8 items-center gap-2 px-2 transition-[padding,color]",
            shouldReduceMotion
              ? "duration-0"
              : cn("duration-300", sidebarTransitionClassName),
            isCollapsed && "flowent-sidebar-rail-status pl-[17px] pr-0",
          )}
          title={activeProviderName ?? "No provider"}
        >
          <div
            className="size-1.5 rounded-full bg-[#7ddf89]"
            aria-hidden="true"
          />
          <SidebarText
            isVisible={!isCollapsed}
            shouldReduceMotion={shouldReduceMotion}
          >
            <span>{activeProviderName ?? "No provider"}</span>
          </SidebarText>
        </div>
      </div>
    </div>
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
