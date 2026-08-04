import { Settings } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";

export type SettingsPage = "model" | "providers";

interface SettingsHeaderProps {
  activePage: SettingsPage;
  onNavigate: (page: SettingsPage) => void;
}

export function SettingsHeader({
  activePage,
  onNavigate,
}: SettingsHeaderProps) {
  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
      <SidebarTrigger />
      <Separator className="h-4" orientation="vertical" />
      <Settings className="size-4" />
      <span className="text-sm font-medium">Settings</span>
      <div className="ml-auto flex items-center gap-1">
        <Button
          aria-current={activePage === "model" ? "page" : undefined}
          onClick={() => onNavigate("model")}
          size="sm"
          variant={activePage === "model" ? "secondary" : "ghost"}
        >
          Model
        </Button>
        <Button
          aria-current={activePage === "providers" ? "page" : undefined}
          onClick={() => onNavigate("providers")}
          size="sm"
          variant={activePage === "providers" ? "secondary" : "ghost"}
        >
          Providers
        </Button>
      </div>
    </header>
  );
}
