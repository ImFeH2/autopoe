import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ChevronRight,
  Ellipsis,
  ExternalLink,
  Pencil,
  Pin,
  PinOff,
  Trash2,
} from "lucide-react";
import { useTranslation } from "react-i18next";

import type { ViewId } from "@/app/navigation/view-types";
import {
  readPinnedWorkflowIds,
  writePinnedWorkflowIds,
} from "@/components/flowent/app-shell/app-shell-storage";
import {
  sidebarMotionTransition,
  sidebarTransitionClassName,
} from "@/components/flowent/app-shell/sidebar-motion";
import {
  fieldInputClassName,
  navigationLabelClassName,
} from "@/components/flowent/styles";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import type { Workflow } from "@/features/workflows/model/workflow-types";
import { cn } from "@/lib/utils";

function WorkflowNavigationMenuItems({
  isPinned,
  Item,
  onDelete,
  onOpenNewTab,
  onRenameStart,
  onTogglePin,
  workflow,
}: {
  isPinned: boolean;
  Item: typeof ContextMenuItem | typeof DropdownMenuItem;
  onDelete: (workflowId: string) => void;
  onOpenNewTab: (workflowId: string) => void;
  onRenameStart: (workflowId: string) => void;
  onTogglePin: (workflowId: string) => void;
  workflow: Workflow;
}) {
  const { t } = useTranslation();

  return (
    <>
      <Item onSelect={() => onOpenNewTab(workflow.id)}>
        <ExternalLink className="size-4 shrink-0" aria-hidden="true" />
        {t("navigation.workflowHistory.openNewTab")}
      </Item>
      <Item onSelect={() => onRenameStart(workflow.id)}>
        <Pencil className="size-4 shrink-0" aria-hidden="true" />
        {t("navigation.workflowHistory.rename")}
      </Item>
      <Item onSelect={() => onTogglePin(workflow.id)}>
        {isPinned ? (
          <PinOff className="size-4 shrink-0" aria-hidden="true" />
        ) : (
          <Pin className="size-4 shrink-0" aria-hidden="true" />
        )}
        {isPinned
          ? t("navigation.workflowHistory.unpin")
          : t("navigation.workflowHistory.pin")}
      </Item>
      <Item onSelect={() => onDelete(workflow.id)} variant="destructive">
        <Trash2 className="size-4 shrink-0" aria-hidden="true" />
        {t("navigation.workflowHistory.delete")}
      </Item>
    </>
  );
}

function WorkflowNavigationItem({
  isActive,
  isMobileDrawer = false,
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
  isMobileDrawer?: boolean;
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
  const { t } = useTranslation();
  const [draftName, setDraftName] = useState(workflow.name);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isContextMenuOpen, setIsContextMenuOpen] = useState(false);

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
          aria-label={t("navigation.workflowHistory.renameInput", {
            name: workflow.name,
          })}
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
    <ContextMenu onOpenChange={setIsContextMenuOpen}>
      <ContextMenuTrigger asChild>
        <div className="group/workflow-menu-item relative h-8">
          <Button
            className={cn(
              "flowent-workflow-history-item h-8 w-full cursor-pointer justify-start rounded-lg border border-transparent bg-transparent px-2 py-1 pr-8 text-left shadow-none transition-[width,height,padding,color,background-color] duration-300 hover:bg-[#151515]",
              navigationLabelClassName,
              sidebarTransitionClassName,
              !isMobileDrawer &&
                "max-[900px]:justify-center max-[560px]:min-w-fit max-[560px]:flex-none max-[560px]:px-2",
              isMobileDrawer && "min-w-0 flex-none justify-start px-2",
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
            {isPinned ? (
              <Pin
                className="ml-auto size-3.5 shrink-0 text-white/60"
                aria-hidden="true"
              />
            ) : null}
          </Button>
          <DropdownMenu open={isMenuOpen} onOpenChange={setIsMenuOpen}>
            <DropdownMenuTrigger asChild>
              <Button
                aria-label={t("navigation.workflowHistory.optionsFor", {
                  name: workflow.name,
                })}
                className={cn(
                  "absolute top-1 right-1 hidden size-6 cursor-pointer rounded-md border border-transparent bg-transparent p-0 text-white shadow-none hover:bg-white/[0.08] focus-visible:flex data-[state=open]:flex data-[state=open]:bg-white/[0.08] group-hover/workflow-menu-item:flex group-focus-within/workflow-menu-item:flex",
                  isContextMenuOpen && "flex",
                )}
                onClick={(event) => event.stopPropagation()}
                size="icon"
                title={t("navigation.workflowHistory.optionsFor", {
                  name: workflow.name,
                })}
                type="button"
                variant="ghost"
              >
                <Ellipsis className="size-4" aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" alignOffset={-84} sideOffset={2}>
              <WorkflowNavigationMenuItems
                isPinned={isPinned}
                Item={DropdownMenuItem}
                onDelete={onDelete}
                onOpenNewTab={onOpenNewTab}
                onRenameStart={onRenameStart}
                onTogglePin={onTogglePin}
                workflow={workflow}
              />
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <WorkflowNavigationMenuItems
          isPinned={isPinned}
          Item={ContextMenuItem}
          onDelete={onDelete}
          onOpenNewTab={onOpenNewTab}
          onRenameStart={onRenameStart}
          onTogglePin={onTogglePin}
          workflow={workflow}
        />
      </ContextMenuContent>
    </ContextMenu>
  );
}

export function WorkflowsNavigationSection({
  activeView,
  activeWorkflowId,
  isMobileDrawer = false,
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
  isMobileDrawer?: boolean;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onWorkflowDelete: (workflowId: string) => void;
  onWorkflowRename: (workflowId: string, nextName: string) => void;
  onWorkflowSelect: (workflowId: string) => void;
  shouldReduceMotion: boolean;
  workflows: Workflow[];
}) {
  const { t } = useTranslation();
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
      className={cn(!isMobileDrawer && "max-[900px]:hidden")}
      open={isOpen}
      onOpenChange={onOpenChange}
    >
      <CollapsibleTrigger asChild>
        <Button
          aria-label={t("navigation.views.workflows")}
          className={cn(
            "flowent-workflow-history-trigger h-7 w-full cursor-pointer justify-between rounded-md border border-transparent bg-transparent px-2 py-0 text-[11px] leading-4 font-medium text-white/45 shadow-none transition-colors duration-100 hover:bg-transparent hover:text-white/70 aria-expanded:bg-transparent aria-expanded:text-white/45 dark:aria-expanded:bg-transparent dark:aria-expanded:text-white/45",
            navigationLabelClassName,
            !isMobileDrawer && "max-[900px]:hidden",
            hasActiveWorkflow &&
              !isOpen &&
              "flowent-workflow-history-item-active",
          )}
          type="button"
          variant="ghost"
        >
          <span className="flowent-navigation-text min-w-0 truncate">
            {t("navigation.views.workflows")}
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
                <div
                  className={cn(
                    "flowent-sidebar-section-label flex h-8 w-full items-center px-2",
                    !isMobileDrawer && "max-[900px]:hidden",
                  )}
                >
                  <span>{t("navigation.workflowHistory.empty")}</span>
                </div>
              ) : (
                sortedWorkflows.map((workflow) => (
                  <WorkflowNavigationItem
                    isActive={
                      activeView === "workflows" &&
                      activeWorkflowId === workflow.id
                    }
                    isMobileDrawer={isMobileDrawer}
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
