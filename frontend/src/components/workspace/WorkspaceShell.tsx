import { AgentGraph, type AgentGraphHandle } from "@/components/AgentGraph";
import { PanelResizer } from "@/components/PanelResizer";
import { Button } from "@/components/ui/button";
import {
  AgentDetailPanel,
  BadgeChip,
  LeaderChatPanel,
  PanelToggleButton,
  ToolbarButton,
  ToolbarDivider,
  WorkspacePanelEmptyState,
} from "@/components/workspace/WorkspacePanels";
import { cn } from "@/lib/utils";
import type { Node, Role, TaskTab, WorkflowNodeType } from "@/types";
import type {
  WorkspaceEditorMode,
  WorkspacePendingAction,
} from "@/pages/home/useHomePageState";
import type {
  WorkspaceNodeOption,
  WorkspacePortOption,
} from "@/components/workspace/WorkspaceDialogs";
import { AnimatePresence, motion } from "motion/react";
import {
  Copy,
  FileJson2,
  GitGraph,
  Link2,
  Plus,
  Power,
  Radio,
  Redo2,
  Save,
  Undo2,
  X,
} from "lucide-react";
import type { MouseEvent, RefObject } from "react";

interface WorkspaceGraphHistory {
  canRedo: (tabId: string | null) => boolean;
  canUndo: (tabId: string | null) => boolean;
  createConnection: (
    tabId: string,
    sourceNodeId: string,
    targetNodeId: string,
    sourcePortKey?: string,
    targetPortKey?: string,
  ) => Promise<void>;
  createLinkedAgent: (input: {
    tabId: string;
    anchorNodeId: string;
    roleName: string;
    name?: string;
  }) => Promise<unknown>;
  createStandaloneAgent: (input: {
    tabId: string;
    roleName: string;
    name?: string;
  }) => Promise<unknown>;
  createStandaloneNode?: (input: {
    tabId: string;
    nodeType?: WorkflowNodeType;
    roleName?: string;
    name?: string;
  }) => Promise<unknown>;
  deleteAgent: (input: {
    tabId: string;
    node: Node;
    tabAgents: Node[];
  }) => Promise<void>;
  deleteConnection: (
    tabId: string,
    sourceNodeId: string,
    targetNodeId: string,
    sourcePortKey?: string,
    targetPortKey?: string,
  ) => Promise<void>;
  insertAgentBetween: (input: {
    tabId: string;
    sourceNodeId: string;
    targetNodeId: string;
    roleName: string;
    name?: string;
  }) => Promise<unknown>;
  redo: (tabId: string | null) => Promise<boolean>;
  undo: (tabId: string | null) => Promise<boolean>;
}

interface WorkspaceShellProps {
  activeTabId: string | null;
  connected: boolean;
  definitionDraft: string;
  editorMode: WorkspaceEditorMode;
  graphConnectMode: boolean;
  graphHistory: WorkspaceGraphHistory;
  graphRef: RefObject<AgentGraphHandle | null>;
  isCompactWorkspace: boolean;
  isDragging: boolean;
  leaderDetailVisible: boolean;
  leaderNode: Node | null;
  leaderPanelRunning: boolean;
  loadingRoles: boolean;
  onCloseLeaderDetails: () => void;
  onConnectModeChange: (active: boolean) => void;
  onCreateNode: () => void;
  onCreateTab: () => void;
  onDefinitionDraftChange: (nextValue: string) => void;
  onDeleteTab: (tabId: string, title: string, nodeCount?: number) => void;
  onDuplicateTab: () => void;
  onEditorModeChange: (nextValue: WorkspaceEditorMode) => void;
  onOpenLeaderDetails: () => void;
  onOpenConnectDialog: () => void;
  onSaveDefinition: () => void;
  onToggleActivation: () => void;
  panelVisible: boolean;
  pendingAction: WorkspacePendingAction;
  regularTabAgents: Node[];
  resolvedPanelWidth: number;
  roles: Role[];
  selectAgent: (id: string | null) => void;
  selectedAgent: Node | null;
  setActiveTabId: (id: string | null) => void;
  startDrag: (event: MouseEvent) => void;
  tabs: Map<string, TaskTab>;
  togglePanel: () => void;
  workflowNodeOptions: WorkspaceNodeOption[];
  sourcePortOptions: WorkspacePortOption[];
  targetPortOptions: WorkspacePortOption[];
  workspaceRef: RefObject<HTMLDivElement | null>;
  workflowLocked: boolean;
}

export function WorkspaceShell({
  activeTabId,
  connected,
  definitionDraft,
  editorMode,
  graphConnectMode,
  graphHistory,
  graphRef,
  isCompactWorkspace,
  isDragging,
  leaderDetailVisible,
  leaderNode,
  leaderPanelRunning,
  loadingRoles,
  onCloseLeaderDetails,
  onConnectModeChange,
  onCreateNode,
  onCreateTab,
  onDefinitionDraftChange,
  onDeleteTab,
  onDuplicateTab,
  onEditorModeChange,
  onOpenLeaderDetails,
  onOpenConnectDialog,
  onSaveDefinition,
  onToggleActivation,
  panelVisible,
  pendingAction,
  resolvedPanelWidth,
  roles,
  selectAgent,
  selectedAgent,
  setActiveTabId,
  startDrag,
  tabs,
  togglePanel,
  workflowNodeOptions,
  workspaceRef,
  workflowLocked,
}: WorkspaceShellProps) {
  const renderPrimaryPanel = () => {
    if (leaderDetailVisible && leaderNode) {
      return (
        <AgentDetailPanel agent={leaderNode} onClose={onCloseLeaderDetails} />
      );
    }

    if (!activeTabId) {
      return <WorkspacePanelEmptyState />;
    }

    return <LeaderChatPanel onOpenDetails={onOpenLeaderDetails} />;
  };

  const activeTab = activeTabId ? (tabs.get(activeTabId) ?? null) : null;

  return (
    <div
      ref={workspaceRef}
      className="relative isolate flex h-full overflow-hidden rounded-xl border border-border bg-surface-overlay shadow-md [contain:paint]"
    >
      <div
        className="pointer-events-none absolute inset-0"
        style={{ background: "var(--shell-surface-sweep)" }}
      />
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-px"
        style={{ background: "var(--shell-hairline)" }}
      />
      <div className="relative flex min-w-0 flex-1 flex-col">
        <div className="relative z-30 border-b border-border bg-background/45 backdrop-blur-md">
          <div className="pointer-events-auto relative z-10 flex items-center gap-1.5 overflow-x-auto px-3 py-2.5 pr-14 scrollbar-none">
            {Array.from(tabs.values()).map((tab) => (
              <div
                key={tab.id}
                className="group relative min-w-[120px] max-w-[220px] shrink-0"
              >
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setActiveTabId(tab.id)}
                  onAuxClick={(event) => {
                    if (event.button !== 1) {
                      return;
                    }
                    event.preventDefault();
                    onDeleteTab(tab.id, tab.title, tab.node_count);
                  }}
                  className={cn(
                    "relative h-8 w-full justify-start rounded-md border-b-2 px-3 pr-12 text-left text-[13px] font-medium transition-[color,border-color,background-color] duration-200",
                    activeTabId === tab.id
                      ? "border-primary text-foreground"
                      : "border-transparent text-muted-foreground hover:bg-accent/25 hover:text-foreground",
                  )}
                >
                  <div className="truncate leading-tight">{tab.title}</div>
                </Button>
                {activeTabId === tab.id ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    title="Duplicate workflow"
                    aria-label={`Duplicate ${tab.title}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      onDuplicateTab();
                    }}
                    className="absolute right-6 top-1/2 z-20 size-5 -translate-y-1/2 rounded-sm p-1 text-foreground/70 transition-all duration-200 hover:bg-accent/45 hover:text-foreground"
                  >
                    <Copy className="size-3" />
                  </Button>
                ) : null}
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  title="Delete workflow"
                  aria-label={`Delete ${tab.title}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    onDeleteTab(tab.id, tab.title, tab.node_count);
                  }}
                  className={cn(
                    "absolute right-1.5 top-1/2 z-20 size-5 -translate-y-1/2 rounded-sm p-1 transition-all duration-200 hover:bg-accent/45 hover:text-foreground",
                    activeTabId === tab.id
                      ? "text-foreground/70 opacity-100"
                      : "text-muted-foreground/60 opacity-0 group-hover:opacity-100",
                  )}
                >
                  <X className="size-3" />
                </Button>
              </div>
            ))}
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Create workflow"
              onClick={onCreateTab}
              className="shrink-0 rounded-md text-muted-foreground transition-all duration-200 hover:bg-accent/45 hover:text-foreground"
            >
              <Plus className="size-4" />
            </Button>
          </div>
        </div>

        <div
          className="pointer-events-none absolute inset-0 z-0"
          style={{
            background:
              "radial-gradient(circle at 14% 10%, var(--shell-spotlight-primary), transparent 24%), linear-gradient(180deg, color-mix(in srgb, var(--foreground) 1%, transparent), transparent 22%)",
          }}
        />
        <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-12 bg-gradient-to-l from-background/28 to-transparent" />

        <div className="relative flex-1">
          {editorMode === "graph" ? (
            <AgentGraph
              ref={graphRef}
              loadingRoles={loadingRoles}
              onConnectModeChange={onConnectModeChange}
              onCreateConnection={graphHistory.createConnection}
              onCreateLinkedAgent={graphHistory.createLinkedAgent}
              onCreateStandaloneAgent={graphHistory.createStandaloneAgent}
              onDeleteAgent={graphHistory.deleteAgent}
              onDeleteConnection={graphHistory.deleteConnection}
              onInsertAgentBetween={graphHistory.insertAgentBetween}
              onOpenConnectDialog={onOpenConnectDialog}
              readOnly={workflowLocked}
              roles={roles}
            />
          ) : (
            <div className="flex h-full flex-col p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <p className="text-[11px] font-semibold text-muted-foreground">
                    Workflow JSON
                  </p>
                  <p className="mt-1 text-[13px] text-muted-foreground">
                    Review the graph structure and saved node settings.
                  </p>
                </div>
                <Button
                  onClick={onSaveDefinition}
                  disabled={
                    !activeTabId ||
                    workflowLocked ||
                    pendingAction === "save-definition"
                  }
                >
                  <Save className="mr-1 size-4" />
                  {pendingAction === "save-definition"
                    ? "Saving..."
                    : "Save JSON"}
                </Button>
              </div>
              <textarea
                value={definitionDraft}
                onChange={(event) =>
                  onDefinitionDraftChange(event.target.value)
                }
                readOnly={workflowLocked}
                className="h-full min-h-0 w-full resize-none rounded-xl border border-border bg-background/40 p-4 font-mono text-[12px] leading-6 text-foreground outline-none transition-[border-color,box-shadow] focus:border-ring focus:ring-[3px] focus:ring-ring/50"
                spellCheck={false}
              />
            </div>
          )}
          <div
            className={cn(
              "absolute top-4 z-40 flex max-w-[calc(100%-2.5rem)] flex-wrap items-center gap-1.5",
              isCompactWorkspace ? "left-14" : "left-4",
            )}
          >
            <BadgeChip tone="primary">
              <Radio
                className={cn(
                  "size-3.5 shrink-0",
                  connected
                    ? "text-graph-status-idle/88"
                    : "text-graph-status-initializing/38",
                )}
              />
              <span className="whitespace-nowrap">
                {connected ? "Live" : "Reconnecting"}
              </span>
            </BadgeChip>
            {activeTab ? (
              <BadgeChip>
                {activeTab.node_count ?? activeTab.definition.nodes.length}{" "}
                nodes
              </BadgeChip>
            ) : null}
          </div>

          <div className="pointer-events-none absolute inset-x-3 bottom-4 z-40 flex justify-center">
            <div
              data-testid="workspace-toolbar"
              className="pointer-events-auto inline-flex max-w-full items-center overflow-x-auto rounded-xl border border-border bg-surface-overlay/92 p-0.5 shadow-sm scrollbar-none"
            >
              <ToolbarButton
                disabled={
                  !activeTabId ||
                  workflowLocked ||
                  !graphHistory.canUndo(activeTabId)
                }
                onClick={() => {
                  void graphHistory.undo(activeTabId);
                }}
              >
                <Undo2 className="size-4 opacity-70" />
                Undo
              </ToolbarButton>
              <ToolbarDivider />
              <ToolbarButton
                disabled={
                  !activeTabId ||
                  workflowLocked ||
                  !graphHistory.canRedo(activeTabId)
                }
                onClick={() => {
                  void graphHistory.redo(activeTabId);
                }}
              >
                <Redo2 className="size-4 opacity-70" />
                Redo
              </ToolbarButton>
              <ToolbarDivider />
              <ToolbarButton
                disabled={
                  !activeTabId ||
                  pendingAction === "activate-workflow" ||
                  pendingAction === "deactivate-workflow"
                }
                active={workflowLocked}
                onClick={onToggleActivation}
              >
                <Power className="size-4 opacity-70" />
                {workflowLocked ? "Deactivate" : "Activate"}
              </ToolbarButton>
              <ToolbarDivider />
              <ToolbarButton
                disabled={!activeTabId}
                active={editorMode === "graph"}
                onClick={() => onEditorModeChange("graph")}
              >
                <GitGraph className="size-4 opacity-70" />
                Graph
              </ToolbarButton>
              <ToolbarDivider />
              <ToolbarButton
                disabled={!activeTabId}
                active={editorMode === "json"}
                onClick={() => onEditorModeChange("json")}
              >
                <FileJson2 className="size-4 opacity-70" />
                JSON
              </ToolbarButton>
              <ToolbarDivider />
              <ToolbarButton
                disabled={!activeTabId || workflowLocked}
                onClick={onCreateNode}
              >
                <Plus className="size-4 opacity-70" />
                Add Node
              </ToolbarButton>
              <ToolbarDivider />
              <ToolbarButton
                disabled={
                  !activeTabId ||
                  workflowLocked ||
                  workflowNodeOptions.length < 2
                }
                active={graphConnectMode}
                onClick={onOpenConnectDialog}
              >
                <Link2 className="size-4 opacity-70" />
                Connect Ports
              </ToolbarButton>
              <ToolbarDivider />
              <ToolbarButton disabled={!activeTabId} onClick={onDuplicateTab}>
                <Copy className="size-4 opacity-70" />
                Duplicate
              </ToolbarButton>
            </div>
          </div>
        </div>

        <div className="absolute bottom-4 right-4 z-30 sm:bottom-5 sm:right-5">
          <PanelToggleButton expanded={panelVisible} onClick={togglePanel} />
        </div>
      </div>

      <AnimatePresence initial={false}>
        {panelVisible ? (
          isCompactWorkspace ? (
            [
              <motion.button
                key="workspace-panel-backdrop"
                type="button"
                aria-label="Close workspace panel"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.18 }}
                className="absolute inset-0 z-10 bg-background/40 backdrop-blur-[1px]"
                onClick={togglePanel}
              />,
              <motion.aside
                key="workspace-panel-sheet"
                initial={{ opacity: 0, x: 18 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 18 }}
                transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
                className="absolute inset-y-2.5 right-2.5 z-20 shrink-0 overflow-hidden rounded-xl border border-border bg-surface-overlay shadow-md"
                style={{ width: `${resolvedPanelWidth}px` }}
              >
                <div
                  aria-hidden="true"
                  className={cn(
                    "pointer-events-none absolute inset-0 z-20 border transition-[opacity,border-color,box-shadow] duration-300",
                    !selectedAgent && leaderPanelRunning
                      ? "animate-pulse border-ring/25 opacity-100 shadow-lg shadow-ring/10"
                      : "border-transparent opacity-0",
                  )}
                />
                <div
                  className="pointer-events-none absolute inset-0"
                  style={{ background: "var(--shell-surface-sweep)" }}
                />
                <div
                  className="pointer-events-none absolute inset-x-0 top-0 h-px"
                  style={{ background: "var(--shell-hairline)" }}
                />
                <div className="flex h-full flex-col overflow-hidden">
                  <div className="relative flex-1 overflow-hidden">
                    <motion.div
                      animate={{
                        opacity: selectedAgent ? 0 : 1,
                        x: selectedAgent ? -8 : 0,
                      }}
                      transition={{ duration: 0.15 }}
                      className={cn(
                        "absolute inset-0 flex h-full flex-col",
                        selectedAgent && "pointer-events-none",
                      )}
                      aria-hidden={selectedAgent ? true : undefined}
                    >
                      {renderPrimaryPanel()}
                    </motion.div>

                    <AnimatePresence>
                      {selectedAgent ? (
                        <motion.div
                          key={selectedAgent.id}
                          initial={{ opacity: 0, x: 10 }}
                          animate={{ opacity: 1, x: 0 }}
                          exit={{ opacity: 0, x: 10 }}
                          transition={{ duration: 0.15 }}
                          className="absolute inset-0 flex h-full flex-col bg-background/42"
                        >
                          <AgentDetailPanel
                            agent={selectedAgent}
                            onClose={() => selectAgent(null)}
                          />
                        </motion.div>
                      ) : null}
                    </AnimatePresence>
                  </div>
                </div>
              </motion.aside>,
            ]
          ) : (
            <motion.aside
              key="workspace-panel-docked"
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: resolvedPanelWidth, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
              className="relative z-20 shrink-0 border-l border-border bg-surface-overlay shadow-md"
            >
              <div
                aria-hidden="true"
                className={cn(
                  "pointer-events-none absolute inset-0 z-20 border transition-[opacity,border-color,box-shadow] duration-300",
                  !selectedAgent && leaderPanelRunning
                    ? "animate-pulse border-ring/25 opacity-100 shadow-lg shadow-ring/10"
                    : "border-transparent opacity-0",
                )}
              />
              <div
                className="pointer-events-none absolute inset-0"
                style={{ background: "var(--shell-surface-sweep)" }}
              />
              <div
                className="pointer-events-none absolute inset-x-0 top-0 h-px"
                style={{ background: "var(--shell-hairline)" }}
              />
              <PanelResizer
                position="left"
                isDragging={isDragging}
                onMouseDown={startDrag}
              />
              <div
                className="flex h-full flex-col overflow-hidden"
                style={{ width: `${resolvedPanelWidth}px` }}
              >
                <div className="relative flex-1 overflow-hidden">
                  <motion.div
                    animate={{
                      opacity: selectedAgent ? 0 : 1,
                      x: selectedAgent ? -8 : 0,
                    }}
                    transition={{ duration: 0.15 }}
                    className={cn(
                      "absolute inset-0 flex h-full flex-col",
                      selectedAgent && "pointer-events-none",
                    )}
                    aria-hidden={selectedAgent ? true : undefined}
                  >
                    {renderPrimaryPanel()}
                  </motion.div>

                  <AnimatePresence>
                    {selectedAgent ? (
                      <motion.div
                        key={selectedAgent.id}
                        initial={{ opacity: 0, x: 10 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: 10 }}
                        transition={{ duration: 0.15 }}
                        className="absolute inset-0 flex h-full flex-col bg-background/42"
                      >
                        <AgentDetailPanel
                          agent={selectedAgent}
                          onClose={() => selectAgent(null)}
                        />
                      </motion.div>
                    ) : null}
                  </AnimatePresence>
                </div>
              </div>
            </motion.aside>
          )
        ) : null}
      </AnimatePresence>
    </div>
  );
}
