import { Fragment, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import {
  KeyRound,
  MessageSquare,
  Play,
  Plug,
  PlusCircle,
  Radio,
  ShieldCheck,
  Settings,
  Sparkles,
  Workflow as WorkflowIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
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
  item,
  onClick,
  suppressActiveStyle = false,
}: {
  item: NavigationItem;
  onClick?: () => void;
  suppressActiveStyle?: boolean;
}) {
  const Icon = item.icon;

  return (
    <TabsTrigger
      value={item.id}
      onClick={onClick}
      className={cn(
        "flowent-navigation-item cursor-pointer justify-start gap-1.5 rounded-[10px] border border-transparent bg-transparent px-2.5 py-1.5 text-white shadow-none transition-colors duration-100 hover:bg-[#171717] data-[state=active]:bg-[#2f2f2f] max-[900px]:justify-center max-[560px]:min-w-fit max-[560px]:flex-none max-[560px]:px-2 max-[560px]:[&_svg]:hidden [&_svg]:text-current",
        navigationLabelClassName,
        "dark:hover:bg-[#171717] dark:data-[state=active]:border-transparent dark:data-[state=active]:bg-[#2f2f2f] dark:data-[state=active]:text-white",
        suppressActiveStyle &&
          "data-[state=active]:!bg-transparent data-[state=active]:!text-white dark:data-[state=active]:!bg-transparent",
      )}
    >
      <Icon aria-hidden="true" />
      <span className="flowent-navigation-text">{item.label}</span>
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
        "flowent-navigation-item w-full cursor-pointer justify-start gap-1.5 rounded-[10px] border border-transparent bg-transparent px-2.5 py-1.5 text-white shadow-none transition-colors duration-100 hover:bg-[#171717] max-[900px]:justify-center max-[560px]:min-w-fit max-[560px]:flex-none max-[560px]:px-2 max-[560px]:[&_svg]:hidden [&_svg]:text-current",
        navigationLabelClassName,
        isActive && "bg-[#2f2f2f]",
      )}
      onClick={() => onSelect(workflow.id)}
      title={workflow.name}
      type="button"
      variant="ghost"
    >
      <Play aria-hidden="true" />
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
  return (
    <Tabs
      value={activeView}
      onValueChange={(value) => onViewChange(value as ViewId)}
      orientation="vertical"
      className="grid h-[var(--flowent-viewport-height)] min-h-0 grid-cols-[260px_minmax(0,1fr)] gap-0 overflow-hidden bg-black pt-[var(--flowent-safe-area-top)] pr-[var(--flowent-safe-area-right)] pb-[var(--flowent-safe-area-bottom)] pl-[var(--flowent-safe-area-left)] text-white max-[900px]:grid-cols-1 max-[900px]:grid-rows-[auto_minmax(0,1fr)]"
    >
      <aside className="flex min-h-0 flex-col border-r border-white/10 bg-black px-4 py-4 max-[900px]:min-h-auto max-[900px]:border-r-0 max-[900px]:border-b max-[900px]:px-3 max-[900px]:py-3">
        <div className="flex min-h-12 items-center gap-3.5 bg-black max-[560px]:min-h-12">
          <div className="grid size-10 place-items-center overflow-hidden rounded-md border border-white/10 bg-input/30">
            <img alt="" className="size-full object-cover" src="/flowent.png" />
          </div>
          <div className="min-w-0 flex-1 self-center">
            <div className="truncate text-[22px] font-medium leading-8 text-white">
              Flowent
            </div>
          </div>
        </div>

        <nav aria-label="Primary navigation">
          <TabsList
            className="mt-5 -mx-[10px] flex w-auto flex-none flex-col items-stretch gap-0 p-0 max-[900px]:mt-3 max-[900px]:mx-0 max-[900px]:flex-row max-[560px]:justify-start max-[560px]:overflow-x-auto"
            variant="line"
          >
            <NavigationTrigger item={workspaceNavigationItem} />
            <NavigationTrigger
              item={workflowsNavigationItem}
              onClick={onNewWorkflow}
              suppressActiveStyle={
                activeView === "workflows" && Boolean(activeWorkflowId)
              }
            />
            {navigationGroups.map((group) => (
              <Fragment key={group.label}>
                <div
                  aria-hidden="true"
                  className="mt-5 mb-1 px-2.5 text-[11px] leading-4 font-medium text-white/45 max-[900px]:hidden"
                >
                  {group.label}
                </div>
                {group.items.map((item) => (
                  <NavigationTrigger key={item.id} item={item} />
                ))}
              </Fragment>
            ))}
            <div
              aria-hidden="true"
              className="mt-5 mb-1 flex items-center gap-1.5 px-2.5 text-[11px] leading-4 font-medium text-white/45 max-[900px]:hidden"
            >
              <WorkflowIcon className="size-3.5" aria-hidden="true" />
              Workflow
            </div>
            {workflows.length === 0 ? (
              <div className="flowent-navigation-item flex w-full items-center px-2.5 text-[11px] leading-4 font-medium text-white/35 max-[900px]:hidden">
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
          </TabsList>
        </nav>

        <div className="mt-auto flex items-center gap-2 border-t border-white/10 pt-5 text-xs text-[#9b9b9b] max-[900px]:hidden">
          <div
            className="size-1.5 rounded-full bg-[#7ddf89]"
            aria-hidden="true"
          />
          <span>{activeProviderName ?? "No provider"}</span>
        </div>
      </aside>

      <main className="min-h-0 min-w-0 overflow-hidden bg-black">
        {children}
      </main>
    </Tabs>
  );
}
