import type { LucideIcon } from "lucide-react";
import {
  Shield,
  LayoutDashboard,
  MessageSquareQuote,
  PlugZap,
  Radio,
  Server,
  Settings,
  Users,
  Wrench,
} from "lucide-react";
import type { PageId } from "@/context/AgentContext";

export interface PageNavigationItem {
  id: PageId;
  label: string;
  icon: LucideIcon;
}

export interface PageNavigationGroup {
  label: string;
  items: PageNavigationItem[];
}

export const PAGE_NAVIGATION_GROUPS: PageNavigationGroup[] = [
  {
    label: "Core",
    items: [
      { id: "assistant", label: "Assistant", icon: Shield },
      { id: "workspace", label: "Workspace", icon: LayoutDashboard },
    ],
  },
  {
    label: "Configuration",
    items: [
      { id: "providers", label: "Providers", icon: Server },
      { id: "roles", label: "Roles", icon: Users },
      { id: "prompts", label: "Prompts", icon: MessageSquareQuote },
      { id: "tools", label: "Tools", icon: Wrench },
    ],
  },
  {
    label: "Integrations & System",
    items: [
      { id: "mcp", label: "MCP", icon: PlugZap },
      { id: "channels", label: "Channels", icon: Radio },
      { id: "settings", label: "Settings", icon: Settings },
    ],
  },
];

export const PAGE_NAVIGATION_ITEMS: PageNavigationItem[] =
  PAGE_NAVIGATION_GROUPS.flatMap((group) => group.items);

export function getPageNavigationLabel(pageId: PageId): string {
  return (
    PAGE_NAVIGATION_ITEMS.find((item) => item.id === pageId)?.label ?? pageId
  );
}
