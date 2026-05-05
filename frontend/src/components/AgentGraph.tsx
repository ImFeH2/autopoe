import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import {
  Background,
  ConnectionMode,
  ReactFlow,
  type EdgeTypes,
  type NodeTypes,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Network } from "lucide-react";
import { AgentEdge } from "@/components/AgentEdge";
import { AgentNode } from "@/components/AgentNode";
import {
  getQuickCreateTitle,
  graphChromePillClass,
  quickCreateButtonClass,
  quickCreateInputClass,
  quickCreateListClass,
  VIEWPORT_MAX_ZOOM,
  VIEWPORT_MIN_ZOOM,
  type AgentGraphHandle,
  type AgentGraphProps,
} from "@/components/agent-graph/lib";
import { useAgentGraphController } from "@/components/agent-graph/useAgentGraphController";
import { AgentTooltip } from "@/components/AgentTooltip";
import { ContextMenu } from "@/components/ContextMenu";
import { ViewportPortal } from "@/components/ViewportPortal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn, formatZoomPercentage } from "@/lib/utils";
import type { Role } from "@/types";

export type { AgentGraphHandle } from "@/components/agent-graph/lib";

const nodeTypes: NodeTypes = {
  agent: AgentNode,
};

const edgeTypes: EdgeTypes = {
  animated: AgentEdge,
};

export const AgentGraph = forwardRef<AgentGraphHandle, AgentGraphProps>(
  function AgentGraph(props, ref) {
    const {
      activeTabId,
      animatedEdges,
      animatedNodes,
      availableRoles,
      closeContextMenu,
      closeQuickCreate,
      connectHintLabel,
      containerRef,
      contextMenu,
      contextMenuItems,
      emptyState,
      enterConnectMode,
      handleFlowInit,
      handleViewportMove,
      isValidConnection,
      loadingRoles,
      onConnect,
      onConnectEnd,
      onConnectStart,
      onEdgeClick,
      onEdgeContextMenu,
      onNodeClick,
      onNodeContextMenu,
      onNodeMouseEnter,
      onNodeMouseLeave,
      onNodeMouseMove,
      onPaneClick,
      onPaneContextMenu,
      quickCreate,
      quickCreateName,
      quickCreateRoleName,
      readOnly,
      setQuickCreateName,
      setQuickCreateRoleName,
      submitQuickCreate,
      submittingQuickCreate,
      tooltip,
      tooltipAgent,
      tooltipRef,
      tooltipStyle,
      tooltipToolCall,
      viewportZoom,
    } = useAgentGraphController(props);

    useImperativeHandle(
      ref,
      () => ({
        enterConnectMode,
      }),
      [enterConnectMode],
    );

    return (
      <div ref={containerRef} className="relative flex h-full flex-col">
        <div className="relative flex-1 overflow-hidden">
          {animatedNodes.length === 0 ? (
            <div className="flex h-full items-center justify-center px-5 py-8">
              <div className="w-full max-w-[22rem] rounded-xl border border-border bg-surface-overlay/60 px-5 py-5 text-center shadow-md backdrop-blur-sm">
                <div className="mx-auto flex size-10 items-center justify-center rounded-lg border border-border bg-accent/35 text-muted-foreground">
                  <Network className="size-4.5" />
                </div>
                <p className="mt-3.5 text-[18px] font-semibold leading-tight text-foreground">
                  {emptyState.title}
                </p>
              </div>
            </div>
          ) : (
            <ReactFlow
              nodes={animatedNodes}
              edges={animatedEdges}
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
              colorMode="dark"
              onInit={handleFlowInit}
              onNodeClick={onNodeClick}
              onNodeMouseEnter={onNodeMouseEnter}
              onNodeMouseMove={onNodeMouseMove}
              onNodeMouseLeave={onNodeMouseLeave}
              onPaneClick={onPaneClick}
              onPaneContextMenu={onPaneContextMenu}
              onNodeContextMenu={onNodeContextMenu}
              onEdgeClick={onEdgeClick}
              onEdgeContextMenu={onEdgeContextMenu}
              onConnect={onConnect}
              onConnectStart={onConnectStart}
              onConnectEnd={onConnectEnd}
              onMove={handleViewportMove}
              isValidConnection={isValidConnection}
              connectionMode={ConnectionMode.Strict}
              connectOnClick={false}
              proOptions={{ hideAttribution: true }}
              nodesDraggable={false}
              nodesConnectable={Boolean(activeTabId) && !readOnly}
              panOnDrag
              zoomOnScroll
              zoomOnPinch
              minZoom={VIEWPORT_MIN_ZOOM}
              maxZoom={VIEWPORT_MAX_ZOOM}
              className="bg-graph-bg"
            >
              <Background color="var(--graph-grid)" gap={28} size={0.72} />
              <svg aria-hidden="true" focusable="false">
                <defs>
                  <linearGradient
                    id="agent-graph-edge-flow"
                    x1="0"
                    y1="0"
                    x2="1"
                    y2="0"
                  >
                    <stop
                      offset="0%"
                      stopColor="var(--graph-edge)"
                      stopOpacity="0.2"
                    />
                    <stop
                      offset="50%"
                      stopColor="var(--graph-edge-active)"
                      stopOpacity="0.94"
                    />
                    <stop
                      offset="100%"
                      stopColor="var(--graph-edge)"
                      stopOpacity="0.2"
                    />
                  </linearGradient>
                  <radialGradient
                    id="agent-graph-edge-pulse"
                    cx="50%"
                    cy="50%"
                    r="50%"
                  >
                    <stop
                      offset="0%"
                      stopColor="var(--graph-edge-active)"
                      stopOpacity="1"
                    />
                    <stop
                      offset="100%"
                      stopColor="var(--graph-edge-active)"
                      stopOpacity="0.2"
                    />
                  </radialGradient>
                  <filter
                    id="agent-graph-edge-glow"
                    x="-50%"
                    y="-50%"
                    width="200%"
                    height="200%"
                  >
                    <feGaussianBlur stdDeviation="2.6" />
                  </filter>
                </defs>
              </svg>
            </ReactFlow>
          )}
        </div>

        {animatedNodes.length > 0 ? (
          <div className="pointer-events-none absolute bottom-4 left-4 z-30">
            <div
              className={graphChromePillClass}
              data-testid="agent-graph-zoom-indicator"
            >
              {formatZoomPercentage(viewportZoom)}
            </div>
          </div>
        ) : null}

        {connectHintLabel ? (
          <div className="pointer-events-none absolute right-4 top-4 z-30">
            <div className={graphChromePillClass}>{connectHintLabel}</div>
          </div>
        ) : null}

        <AgentTooltip
          agent={tooltipAgent}
          agentId={tooltip?.agentId ?? null}
          activeToolCall={tooltipToolCall}
          style={tooltipStyle}
          tooltipRef={tooltipRef}
        />

        {contextMenu ? (
          <ContextMenu
            x={contextMenu.x}
            y={contextMenu.y}
            items={contextMenuItems}
            onClose={closeContextMenu}
          />
        ) : null}

        {quickCreate ? (
          <GraphQuickCreatePopover
            displayName={quickCreateName}
            roles={availableRoles}
            loadingRoles={loadingRoles}
            onClose={closeQuickCreate}
            onDisplayNameChange={setQuickCreateName}
            onSelectRole={setQuickCreateRoleName}
            onSubmit={submitQuickCreate}
            selectedRoleName={quickCreateRoleName}
            submitting={submittingQuickCreate}
            title={getQuickCreateTitle(quickCreate)}
            x={quickCreate.x}
            y={quickCreate.y}
          />
        ) : null}
      </div>
    );
  },
);

function GraphQuickCreatePopover({
  x,
  y,
  title,
  selectedRoleName,
  displayName,
  roles,
  loadingRoles,
  submitting,
  onSelectRole,
  onDisplayNameChange,
  onSubmit,
  onClose,
}: {
  x: number;
  y: number;
  title: string;
  selectedRoleName: string;
  displayName: string;
  roles: Role[];
  loadingRoles: boolean;
  submitting: boolean;
  onSelectRole: (value: string) => void;
  onDisplayNameChange: (value: string) => void;
  onSubmit: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState(() => ({ left: x, top: y }));

  useEffect(() => {
    const element = ref.current;
    if (!element) {
      return;
    }
    const raf = requestAnimationFrame(() => {
      const margin = 12;
      const rect = element.getBoundingClientRect();
      const maxLeft = window.innerWidth - margin - rect.width;
      const maxTop = window.innerHeight - margin - rect.height;
      setPos({
        left: Math.max(margin, Math.min(x, maxLeft)),
        top: Math.max(margin, Math.min(y, maxTop)),
      });
    });
    return () => cancelAnimationFrame(raf);
  }, [loadingRoles, roles.length, title, x, y]);

  useEffect(() => {
    const handleMouseDown = (event: globalThis.MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handleMouseDown, true);
    return () =>
      document.removeEventListener("mousedown", handleMouseDown, true);
  }, [onClose]);

  return (
    <ViewportPortal>
      <div
        ref={ref}
        className="fixed z-[210] w-[min(24rem,calc(100vw-1.5rem))] rounded-xl border border-border bg-popover p-4 text-popover-foreground shadow-md"
        style={{ left: pos.left, top: pos.top }}
      >
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[13px] font-medium text-foreground">{title}</p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Choose a role and optionally set a display name.
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onClose}
            className="flex h-8 items-center rounded-md px-2.5 text-[11px] text-muted-foreground transition-colors hover:bg-accent/35 hover:text-foreground"
          >
            Close
          </Button>
        </div>

        <div className="mt-4 space-y-3">
          <div className={quickCreateListClass}>
            {loadingRoles ? (
              <p className="px-2 py-3 text-[12px] text-muted-foreground">
                Loading roles...
              </p>
            ) : roles.length === 0 ? (
              <p className="px-2 py-3 text-[12px] text-muted-foreground">
                No roles available.
              </p>
            ) : (
              roles.map((role) => (
                <Button
                  key={role.name}
                  type="button"
                  variant="ghost"
                  onClick={() => onSelectRole(role.name)}
                  className={cn(
                    quickCreateButtonClass,
                    selectedRoleName === role.name
                      ? "border-border bg-accent/70"
                      : "border-transparent bg-transparent hover:border-border hover:bg-accent/45",
                  )}
                >
                  <div className="text-[13px] font-medium text-foreground">
                    {role.name}
                  </div>
                  <div className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                    {role.description}
                  </div>
                </Button>
              ))
            )}
          </div>
          <Input
            aria-label="Display Name"
            value={displayName}
            onChange={(event) => onDisplayNameChange(event.target.value)}
            placeholder="Optional display name"
            className={quickCreateInputClass}
          />
        </div>

        <div className="mt-4 flex items-center justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onClose}
            className="flex h-8 items-center rounded-md px-3 text-[12px] font-medium text-muted-foreground transition-colors hover:bg-accent/35 hover:text-foreground"
          >
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={!selectedRoleName || submitting}
            onClick={onSubmit}
            className="flex h-8 items-center rounded-md bg-primary px-3.5 text-[12px] font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? "Saving..." : title}
          </Button>
        </div>
      </div>
    </ViewportPortal>
  );
}
