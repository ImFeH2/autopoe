import {
  CircleAlert,
  FolderOpen,
  LoaderCircle,
  MessageSquare,
  Plus,
  Settings,
} from "lucide-react";
import type { SettingsPage } from "@/components/SettingsHeader";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar";
import type {
  AgentInfo,
  ChatInfo,
  ProjectInfo,
  RuntimeState,
} from "@/lib/runtime";

interface AppSidebarProps {
  activePage: "chat" | SettingsPage;
  agents: AgentInfo[];
  chat: ChatInfo | null;
  connection: RuntimeState["connection"];
  onInspect: (agentId: string) => void;
  onPageChange: (page: "chat" | SettingsPage) => void;
  project: ProjectInfo | null;
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
  activePage,
  agents,
  chat,
  connection,
  onInspect,
  onPageChange,
  project,
}: AppSidebarProps) {
  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              onClick={() => onPageChange("chat")}
              size="lg"
              tooltip="Flowent"
            >
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
                <SidebarMenuButton
                  isActive={activePage === "chat"}
                  onClick={() => onPageChange("chat")}
                  tooltip={chat?.title ?? "General"}
                >
                  <MessageSquare />
                  <span>{chat?.title ?? "General"}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>Agents</SidebarGroupLabel>
          <SidebarGroupAction
            aria-label="Manage agents"
            onClick={() => onPageChange("agents")}
          >
            <Plus />
          </SidebarGroupAction>
          <SidebarGroupContent>
            <SidebarMenu>
              {agents.length ? (
                agents.map((agent) => (
                  <SidebarMenuItem key={agent.id}>
                    <SidebarMenuButton
                      onClick={() => onInspect(agent.id)}
                      size="lg"
                      tooltip={agent.name}
                    >
                      <Avatar size="sm">
                        <AvatarImage alt="" src="/flowent.png" />
                        <AvatarFallback>
                          {agent.name.charAt(0).toUpperCase()}
                        </AvatarFallback>
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
                  </SidebarMenuItem>
                ))
              ) : (
                <SidebarMenuItem>
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
                </SidebarMenuItem>
              )}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              isActive={activePage !== "chat"}
              onClick={() => onPageChange("model")}
              tooltip="Settings"
            >
              <Settings />
              <span>Settings</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          {project ? (
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
          ) : null}
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
