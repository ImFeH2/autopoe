import { useEffect, useMemo, useState } from "react";
import { PanelLeftOpen, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command";
import { useAgentTabsRuntime, useAgentUI } from "@/context/AgentContext";
import { PAGE_NAVIGATION_ITEMS } from "@/lib/pageNavigation";
import { cn } from "@/lib/utils";
import type { PageId } from "@/context/AgentContext";

interface ShellHeaderProps {
  compact: boolean;
  onOpenNavigation: () => void;
}

function getCommandShortcutLabel() {
  if (
    typeof navigator !== "undefined" &&
    /Mac|iPhone|iPad/.test(navigator.platform)
  ) {
    return "⌘K";
  }
  return "Ctrl K";
}

export function ShellHeader({ compact, onOpenNavigation }: ShellHeaderProps) {
  const [open, setOpen] = useState(false);
  const shortcutLabel = useMemo(() => getCommandShortcutLabel(), []);
  const { currentPage, navigateToPage, navigateToWorkspaceTab } = useAgentUI();
  const { tabs } = useAgentTabsRuntime();
  const workflowItems = useMemo(() => Array.from(tabs.values()), [tabs]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((current) => !current);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const choosePage = (page: PageId) => {
    setOpen(false);
    navigateToPage(page);
  };

  const chooseWorkflow = (workflowId: string) => {
    setOpen(false);
    navigateToWorkspaceTab(workflowId);
  };

  return (
    <div className="shrink-0 border-b border-border/70 py-3">
      <div className="flex items-center gap-3">
        {compact ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Open navigation"
            onClick={onOpenNavigation}
            className="size-9 shrink-0 rounded-md border border-border/70 bg-card/20 text-muted-foreground hover:bg-accent/35 hover:text-foreground"
          >
            <PanelLeftOpen className="size-4" />
          </Button>
        ) : null}
        <Button
          type="button"
          variant="ghost"
          aria-label="Open search"
          onClick={() => setOpen(true)}
          className="h-9 min-w-0 flex-1 justify-start gap-2 rounded-lg border border-border/70 bg-card/20 px-3 text-[13px] font-normal text-muted-foreground hover:bg-accent/35 hover:text-foreground sm:max-w-md"
        >
          <Search className="size-4" />
          <span className="min-w-0 flex-1 text-left">Do anything</span>
          <kbd className="rounded-md border border-border/70 bg-background/45 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
            {shortcutLabel}
          </kbd>
        </Button>
      </div>
      <CommandDialog
        open={open}
        onOpenChange={setOpen}
        title="Search actions"
        description="Go to a page or workflow."
      >
        <Command>
          <CommandInput placeholder="Go to a page or workflow" />
          <CommandList>
            <CommandEmpty>No matches.</CommandEmpty>
            <CommandGroup heading="Pages">
              {PAGE_NAVIGATION_ITEMS.map((item) => {
                const Icon = item.icon;
                return (
                  <CommandItem
                    key={item.id}
                    value={`page-${item.label}`}
                    onSelect={() => choosePage(item.id)}
                  >
                    <Icon className="size-4" />
                    <span>{item.label}</span>
                    {currentPage === item.id ? (
                      <CommandShortcut className="normal-case tracking-normal">
                        Current
                      </CommandShortcut>
                    ) : null}
                  </CommandItem>
                );
              })}
            </CommandGroup>
            {workflowItems.length > 0 ? (
              <CommandGroup heading="Workflows">
                {workflowItems.map((workflow) => (
                  <CommandItem
                    key={workflow.id}
                    value={`workflow-${workflow.title}-${workflow.id}`}
                    onSelect={() => chooseWorkflow(workflow.id)}
                  >
                    <span className="min-w-0 flex-1 truncate">
                      {workflow.title}
                    </span>
                    <CommandShortcut
                      className={cn(
                        "normal-case tracking-normal",
                        workflow.id.length > 8 && "font-mono",
                      )}
                    >
                      {workflow.id.slice(0, 8)}
                    </CommandShortcut>
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}
          </CommandList>
        </Command>
      </CommandDialog>
    </div>
  );
}
