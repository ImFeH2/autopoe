import { useEffect, useMemo, useState } from "react";
import { PanelLeftOpen } from "lucide-react";
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

export function ShellHeader({ compact, onOpenNavigation }: ShellHeaderProps) {
  const [open, setOpen] = useState(false);
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
    <>
      {compact ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Open navigation"
          onClick={onOpenNavigation}
          className="absolute left-3.5 top-3.5 z-30 size-9 shrink-0 rounded-md border border-border/70 bg-card/20 text-muted-foreground backdrop-blur-xl hover:bg-accent/35 hover:text-foreground"
        >
          <PanelLeftOpen className="size-4" />
        </Button>
      ) : null}
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
    </>
  );
}
