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
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { LogOut } from "lucide-react";
import { motion } from "motion/react";
import { PAGE_NAVIGATION_GROUPS } from "@/lib/pageNavigation";

interface SidebarProps {
  autoHide?: boolean;
  className?: string;
  expandedWidth?: number;
  iconRail?: boolean;
  onNavigate?: () => void;
  onToggleMode?: () => void;
  width: number;
  onWidthChange: (w: number) => void;
}

export function Sidebar({
  autoHide = false,
  className,
  expandedWidth,
  iconRail = false,
  onNavigate,
  onToggleMode,
  width,
  onWidthChange,
}: SidebarProps) {
  const { connected } = useAgentConnectionRuntime();
  const { currentPage, navigateToPage } = useAgentUI();
  const { logout } = useAccess();

  const { isDragging, startDrag } = usePanelDrag(
    expandedWidth ?? width,
    onWidthChange,
    "right",
  );
  const widthProgress = Math.max(0, Math.min(1, (width - 180) / 220));
  const headerPaddingY = 16 + widthProgress * 4;
  const titleFontSizeRem = 1.05 + widthProgress * 0.1;

  const navigate = (page: PageId) => {
    navigateToPage(page);
    onNavigate?.();
  };

  return (
    <motion.aside
      animate={{ width }}
      transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
      style={{ width: `${width}px` }}
      className={cn(
        "text-sidebar-foreground relative isolate z-40 flex flex-col overflow-visible border-r border-sidebar-border bg-sidebar shadow-[18px_0_44px_rgba(0,0,0,0.18)] transition-colors",
        autoHide ? "h-full" : "fixed inset-y-0 left-0 h-auto",
        className,
      )}
    >
      <div
        className="pointer-events-none absolute inset-0 opacity-20"
        style={{ background: "var(--shell-surface-sweep)" }}
      />
      <div className="flex h-full flex-col overflow-hidden">
        {iconRail ? (
          <div className="flex shrink-0 justify-center px-2 py-4">
            <div className="relative flex size-10 items-center justify-center rounded-md border border-sidebar-border bg-sidebar-accent/45 text-sm font-semibold text-sidebar-foreground">
              F
              <span
                className={cn(
                  "absolute -right-0.5 -top-0.5 size-2 rounded-full ring-2 ring-sidebar",
                  connected
                    ? "bg-graph-status-running"
                    : "bg-graph-status-idle",
                )}
              />
            </div>
          </div>
        ) : (
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
        )}

        <div className="relative flex min-h-0 flex-1 flex-col overflow-y-auto scrollbar-none">
          <div className={cn("flex flex-col gap-2 p-2", iconRail && "px-2")}>
            {PAGE_NAVIGATION_GROUPS.map((group, index) => (
              <div
                key={group.label}
                className={cn(
                  "relative flex w-full min-w-0 flex-col py-0",
                  iconRail
                    ? index > 0 && "border-t border-sidebar-border/70 pt-2"
                    : index > 0 && "pt-4",
                )}
              >
                {!iconRail && group.showLabel !== false ? (
                  <div className="ring-sidebar-ring flex h-8 shrink-0 items-center rounded-md px-2 outline-hidden transition-[margin,opacity] duration-200 ease-linear focus-visible:ring-2 text-xs font-normal text-sidebar-foreground/62">
                    {group.label}
                  </div>
                ) : null}
                <div className={cn("w-full text-sm py-1", iconRail && "py-0")}>
                  <ul className="flex w-full min-w-0 flex-col gap-1">
                    {group.items.map(({ id, label, icon: Icon }) => {
                      const isActive = currentPage === id;
                      const button = (
                        <Button
                          type="button"
                          variant="ghost"
                          aria-label={iconRail ? label : undefined}
                          onClick={() => navigate(id)}
                          data-active={isActive}
                          className={cn(
                            "outline-hidden ring-sidebar-ring transition-[width,height,padding,background-color,border-color,color] focus-visible:ring-2 active:bg-sidebar-accent active:text-sidebar-accent-foreground disabled:pointer-events-none disabled:opacity-50 data-[active=true]:font-bold data-[active=true]:bg-sidebar-accent/60 data-[active=true]:text-sidebar-primary hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                            iconRail
                              ? "mx-auto flex size-10 items-center justify-center rounded-md border border-transparent p-0 text-sidebar-foreground/74 data-[active=true]:border-sidebar-ring/35 data-[active=true]:shadow-[inset_3px_0_0_var(--sidebar-ring)]"
                              : "flex h-8 w-full items-center gap-2 overflow-hidden rounded-md p-2 text-left text-sm",
                            !isActive && "text-sidebar-foreground/82",
                          )}
                        >
                          <Icon
                            className={cn(
                              "size-4 shrink-0 transition-colors duration-200",
                              isActive
                                ? "text-sidebar-primary"
                                : "text-sidebar-foreground/66 group-hover/menu-item:text-sidebar-accent-foreground",
                            )}
                          />
                          {iconRail ? null : (
                            <span className="block truncate flex-1">
                              {label}
                            </span>
                          )}
                        </Button>
                      );

                      return (
                        <li key={id} className="group/menu-item relative">
                          {iconRail ? (
                            <Tooltip>
                              <TooltipTrigger asChild>{button}</TooltipTrigger>
                              <TooltipContent side="right" sideOffset={12}>
                                {label}
                              </TooltipContent>
                            </Tooltip>
                          ) : (
                            button
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div
          className={cn(
            "shrink-0 border-t border-sidebar-border bg-sidebar/80 px-3 py-3",
            iconRail && "px-2",
          )}
        >
          {iconRail ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  aria-label="Logout"
                  onClick={() => {
                    void logout();
                  }}
                  className="mx-auto flex size-10 items-center justify-center rounded-md border border-sidebar-border bg-sidebar-accent/25 p-0 text-sidebar-foreground/84 transition-colors hover:bg-sidebar-accent/45 hover:text-sidebar-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                >
                  <LogOut className="size-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right" sideOffset={12}>
                Logout
              </TooltipContent>
            </Tooltip>
          ) : (
            <>
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
            </>
          )}
        </div>
      </div>
      <PanelResizer
        position="right"
        isDragging={isDragging}
        onMouseDown={startDrag}
        onToggle={onToggleMode}
        toggleLabel={iconRail ? "Show full navigation" : "Show icon navigation"}
        togglePressed={iconRail}
        className="w-4 -mx-2"
      />
    </motion.aside>
  );
}
