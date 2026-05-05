import { forwardRef, useImperativeHandle } from "react";
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
  VIEWPORT_MAX_ZOOM,
  VIEWPORT_MIN_ZOOM,
  type AgentGraphHandle,
  type AgentGraphProps,
} from "@/components/agent-graph/lib";
import { useAgentGraphController } from "@/components/agent-graph/useAgentGraphController";
import { AgentTooltip } from "@/components/AgentTooltip";
import { ContextMenu } from "@/components/ContextMenu";
import {
  WorkspaceCommandDialog,
  WorkspaceDialogField,
  WorkspaceDialogMeta,
} from "@/components/WorkspaceCommandDialog";
import { RoleSearchPicker } from "@/components/workspace/RoleSearchPicker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatZoomPercentage } from "@/lib/utils";
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
          {emptyState ? (
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
          <GraphQuickCreateDialog
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
          />
        ) : null}
      </div>
    );
  },
);

function GraphQuickCreateDialog({
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
  return (
    <WorkspaceCommandDialog
      open
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
      title={title}
      className="max-w-[44rem]"
      footer={
        <>
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button
            type="button"
            disabled={!selectedRoleName || submitting}
            onClick={onSubmit}
          >
            {submitting ? "Saving..." : title}
          </Button>
        </>
      }
    >
      <WorkspaceDialogMeta>
        Choose a role and set how this agent appears in the workflow.
      </WorkspaceDialogMeta>
      <div className="space-y-1.5">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-sm font-medium text-foreground/80">Role</span>
          <span className="text-xs text-muted-foreground">Required</span>
        </div>
        <RoleSearchPicker
          roles={roles}
          loadingRoles={loadingRoles}
          selectedRoleName={selectedRoleName}
          onRoleNameChange={onSelectRole}
        />
      </div>
      <WorkspaceDialogField label="Display Name" hint="Optional">
        <Input
          aria-label="Display Name"
          value={displayName}
          onChange={(event) => onDisplayNameChange(event.target.value)}
          placeholder="Optional display name"
          className="h-10 rounded-md bg-background/40 text-foreground shadow-xs placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50"
        />
      </WorkspaceDialogField>
    </WorkspaceCommandDialog>
  );
}
