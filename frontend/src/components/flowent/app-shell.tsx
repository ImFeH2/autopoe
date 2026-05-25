import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import {
  KeyRound,
  MessageSquare,
  Plug,
  Radio,
  ShieldCheck,
  Settings,
  Sparkles,
} from "lucide-react";

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { navigationLabelClassName } from "@/components/flowent/styles";
import type { ViewId } from "@/components/flowent/types";
import { cn } from "@/lib/utils";

const navigationItems = [
  { id: "workspace", label: "Workspace", icon: MessageSquare },
  { id: "providers", label: "Providers", icon: KeyRound },
  { id: "mcp", label: "MCP", icon: Plug },
  { id: "skills", label: "Skills", icon: Sparkles },
  { id: "channels", label: "Channels", icon: Radio },
  { id: "permissions", label: "Permissions", icon: ShieldCheck },
  { id: "settings", label: "Settings", icon: Settings },
] satisfies Array<{ id: ViewId; label: string; icon: LucideIcon }>;

export function AppShell({
  activeProviderName,
  activeView,
  children,
  onViewChange,
}: {
  activeProviderName?: string;
  activeView: ViewId;
  children: ReactNode;
  onViewChange: (value: ViewId) => void;
}) {
  return (
    <Tabs
      value={activeView}
      onValueChange={(value) => onViewChange(value as ViewId)}
      orientation="vertical"
      className="grid h-screen min-h-0 grid-cols-[260px_minmax(0,1fr)] gap-0 overflow-hidden bg-black text-white max-[900px]:grid-cols-1 max-[900px]:overflow-auto"
    >
      <aside className="flex min-h-0 flex-col border-r border-white/10 bg-black px-5 py-6 max-[900px]:min-h-auto max-[900px]:border-r-0 max-[900px]:border-b max-[900px]:px-3 max-[900px]:py-3">
        <div className="flex min-h-10 items-center gap-3 bg-black max-[560px]:min-h-10">
          <div className="grid size-8 place-items-center overflow-hidden rounded-md border border-white/10 bg-input/30">
            <img alt="" className="size-full object-cover" src="/flowent.png" />
          </div>
          <div className="min-w-0 flex-1 self-center">
            <div className="truncate text-[15px] font-medium leading-5 text-white">
              Flowent
            </div>
          </div>
        </div>

        <nav aria-label="Primary navigation">
          <TabsList
            className="mt-6 -mx-[14px] flex w-auto flex-none flex-col items-stretch gap-0 p-0 max-[900px]:mt-3 max-[900px]:mx-0 max-[900px]:flex-row"
            variant="line"
          >
            {navigationItems.map((item) => {
              const Icon = item.icon;
              return (
                <TabsTrigger
                  key={item.id}
                  value={item.id}
                  className={cn(
                    "flowent-navigation-item cursor-pointer justify-start gap-1.5 rounded-[10px] border border-transparent bg-transparent px-2.5 py-1.5 text-white shadow-none transition-colors duration-100 hover:bg-[#171717] data-[state=active]:bg-[#2f2f2f] max-[900px]:justify-center max-[560px]:min-w-0 max-[560px]:flex-1 max-[560px]:px-1.5 max-[560px]:[&_svg]:hidden [&_svg]:text-current",
                    navigationLabelClassName,
                    "dark:hover:bg-[#171717] dark:data-[state=active]:border-transparent dark:data-[state=active]:bg-[#2f2f2f] dark:data-[state=active]:text-white",
                  )}
                >
                  <Icon aria-hidden="true" />
                  <span className="flowent-navigation-text">{item.label}</span>
                </TabsTrigger>
              );
            })}
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

      <main className="min-h-0 min-w-0 bg-black">{children}</main>
    </Tabs>
  );
}
