import { cn } from "@/lib/utils";
import {
  useAgentConnectionRuntime,
  useAgentUI,
  type PageId,
} from "@/context/AgentContext";
import { useAccess } from "@/context/useAccess";
import { usePanelDrag } from "@/hooks/usePanelDrag";
import { PanelResizer } from "@/components/PanelResizer";
import { SidebarActivityTicker } from "@/components/SidebarActivityTicker";
import { Button } from "@/components/ui/button";
import { LogOut } from "lucide-react";
import { PAGE_NAVIGATION_GROUPS } from "@/lib/pageNavigation";

interface SidebarProps {
  autoHide?: boolean;
  className?: string;
  onNavigate?: () => void;
  width: number;
  onWidthChange: (w: number) => void;
}

export function Sidebar({
  autoHide = false,
  className,
  onNavigate,
  width,
  onWidthChange,
}: SidebarProps) {
  const { connected } = useAgentConnectionRuntime();
  const { currentPage, setCurrentPage } = useAgentUI();
  const { logout } = useAccess();

  const { isDragging, startDrag } = usePanelDrag(width, onWidthChange, "right");
  const widthProgress = Math.max(0, Math.min(1, (width - 180) / 220));
  const headerPaddingY = 16 + widthProgress * 4;
  const titleFontSizeRem = 1.05 + widthProgress * 0.1;

  const navigate = (page: PageId) => {
    setCurrentPage(page);
    onNavigate?.();
  };

  return (
    <aside
      style={{ width: `${width}px` }}
      className={cn(
        "text-sidebar-foreground relative isolate z-40 flex flex-col overflow-hidden border-r border-sidebar-border bg-sidebar transition-colors",
        autoHide ? "h-full" : "fixed inset-y-0 left-0 h-auto",
        className,
      )}
    >
      <div
        className="pointer-events-none absolute inset-0 opacity-20"
        style={{ background: "var(--shell-surface-sweep)" }}
      />
      <div className="flex h-full flex-col overflow-hidden">
        <div
          className="shrink-0 px-5"
          style={{
            paddingTop: `${headerPaddingY}px`,
            paddingBottom: `${headerPaddingY}px`,
          }}
        >
          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between">
              <h1
                className="truncate font-medium tracking-tight text-sidebar-foreground"
                style={{ fontSize: `${titleFontSizeRem.toFixed(3)}rem` }}
              >
                Flowent
              </h1>
              <div className="flex items-center gap-2 rounded-full border border-sidebar-border bg-sidebar-accent/60 px-2 py-0.5">
                <span
                  className={cn(
                    "size-1.5 rounded-full",
                    connected
                      ? "bg-graph-status-running shadow-[0_0_10px_var(--graph-status-running)]"
                      : "bg-graph-status-idle shadow-[0_0_10px_var(--graph-status-idle)]",
                  )}
                />
                <span className="text-[9px] font-medium uppercase tracking-wider text-sidebar-foreground/80">
                  {connected ? "Connected" : "Reconnecting"}
                </span>
              </div>
            </div>
            <p className="text-[11px] font-medium text-sidebar-foreground/64">
              Agent Studio
            </p>
          </div>
        </div>

        <div className="relative flex min-h-0 flex-1 flex-col overflow-y-auto scrollbar-none">
          <div className="flex flex-col gap-2 p-2">
            {PAGE_NAVIGATION_GROUPS.map((group, index) => (
              <div
                key={group.label}
                className={cn(
                  "relative flex w-full min-w-0 flex-col py-0",
                  index > 0 && "pt-4",
                )}
              >
                {group.showLabel !== false ? (
                  <div className="ring-sidebar-ring flex h-8 shrink-0 items-center rounded-md px-2 outline-hidden transition-[margin,opacity] duration-200 ease-linear focus-visible:ring-2 text-xs font-normal text-sidebar-foreground/62">
                    {group.label}
                  </div>
                ) : null}
                <div className="w-full text-sm py-1">
                  <ul className="flex w-full min-w-0 flex-col gap-1">
                    {group.items.map(({ id, label, icon: Icon }) => {
                      const isActive = currentPage === id;
                      return (
                        <li key={id} className="group/menu-item relative">
                          <Button
                            type="button"
                            variant="ghost"
                            onClick={() => navigate(id)}
                            data-active={isActive}
                            className={cn(
                              "flex w-full items-center gap-2 overflow-hidden rounded-md p-2 text-left outline-hidden ring-sidebar-ring transition-[width,height,padding] focus-visible:ring-2 active:bg-sidebar-accent active:text-sidebar-accent-foreground disabled:pointer-events-none disabled:opacity-50 data-[active=true]:font-bold data-[active=true]:text-[#6366F1] data-[active=true]:bg-sidebar-accent/50 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground h-8 text-sm",
                              !isActive && "text-sidebar-foreground/82",
                            )}
                          >
                            <Icon
                              className={cn(
                                "size-4 shrink-0 transition-colors duration-200",
                                isActive
                                  ? "text-[#6366F1]"
                                  : "text-sidebar-foreground/66 group-hover:text-sidebar-accent-foreground",
                              )}
                            />
                            <span className="block truncate flex-1">
                              {label}
                            </span>
                          </Button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="shrink-0 border-t border-sidebar-border bg-sidebar/80 px-3 py-3">
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              void logout();
            }}
            className="mb-3 flex w-full items-center justify-start gap-2.5 rounded-md border border-sidebar-border bg-sidebar-accent/25 px-3 py-2 text-left text-[12px] font-medium text-sidebar-foreground/84 transition-colors hover:bg-sidebar-accent/45 hover:text-sidebar-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            <LogOut className="size-3.5" />
            <span>Logout</span>
          </Button>
          <SidebarActivityTicker width={width} />
        </div>
      </div>
      <PanelResizer
        position="right"
        isDragging={isDragging}
        onMouseDown={startDrag}
      />
    </aside>
  );
}
