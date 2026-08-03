import {
  CircleAlert,
  FolderOpen,
  LoaderCircle,
  MessageSquare,
} from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar";
import type { AgentInfo, ProjectInfo, RuntimeState } from "@/lib/runtime";

interface AppSidebarProps {
  agent: AgentInfo | null;
  connection: RuntimeState["connection"];
  onInspect: () => void;
  project: ProjectInfo;
}

const connectionLabel = {
  connecting: "Connecting",
  ready: "Ready",
  error: "Unavailable",
} as const;

function capitalize(value: string) {
  return value[0]?.toUpperCase() + value.slice(1);
}

export function AppSidebar({
  agent,
  connection,
  onInspect,
  project,
}: AppSidebarProps) {
  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" tooltip="Flowent">
              <Avatar size="sm">
                <AvatarImage alt="" src="/flowent.png" />
                <AvatarFallback>F</AvatarFallback>
              </Avatar>
              <span className="font-medium">Flowent</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Chats</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton isActive tooltip="General">
                  <MessageSquare />
                  <span>General</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>Agents</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                {agent ? (
                  <>
                    <SidebarMenuButton
                      onClick={onInspect}
                      size="lg"
                      tooltip={agent.name}
                    >
                      <Avatar size="sm">
                        <AvatarImage alt="" src="/flowent.png" />
                        <AvatarFallback>L</AvatarFallback>
                      </Avatar>
                      <span className="grid flex-1 text-left leading-tight">
                        <span className="truncate font-medium">
                          {agent.name}
                        </span>
                        <span className="truncate text-xs text-muted-foreground">
                          {agent.role}
                        </span>
                      </span>
                    </SidebarMenuButton>
                    <SidebarMenuBadge>
                      {capitalize(agent.status)}
                    </SidebarMenuBadge>
                  </>
                ) : (
                  <SidebarMenuButton
                    disabled
                    tooltip={connectionLabel[connection]}
                  >
                    {connection === "error" ? (
                      <CircleAlert />
                    ) : (
                      <LoaderCircle className="animate-spin" />
                    )}
                    <span>{connectionLabel[connection]}</span>
                  </SidebarMenuButton>
                )}
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" tooltip={project.workspace}>
              <Avatar size="sm">
                <AvatarFallback>
                  <FolderOpen />
                </AvatarFallback>
              </Avatar>
              <span className="grid flex-1 text-left leading-tight">
                <span className="truncate font-medium">{project.name}</span>
                <span className="truncate text-xs text-muted-foreground">
                  {project.workspace}
                </span>
              </span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
