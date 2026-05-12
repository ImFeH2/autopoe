import { type ReactNode, useState } from "react";
import { PanelRightClose, PanelRightOpen, X } from "lucide-react";
import { toast } from "sonner";
import {
  AssistantChatComposer,
  AssistantChatMessages,
} from "@/components/AssistantChatContent";
import { HistoryView } from "@/components/HistoryView";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DetailSection } from "@/components/surface";
import {
  useAgentNodesRuntime,
  useAgentTabsRuntime,
} from "@/context/AgentContext";
import { useAgentDetail } from "@/hooks/useAgentDetail";
import { useLeaderChat } from "@/hooks/useLeaderChat";
import { useMeasuredHeight } from "@/hooks/useMeasuredHeight";
import { interruptNode } from "@/lib/api";
import { getNodeLabel, nodeTypeIcon } from "@/lib/constants";
import { cn } from "@/lib/utils";
import type { AgentState, ContactEntry, ContactPath, Node } from "@/types";

const workspaceSelectionBadgeClass =
  "rounded-md bg-accent/45 px-2 py-1 text-xs text-foreground";
const workspaceStateBadgeClass: Record<AgentState, string> = {
  running:
    "border-graph-status-running/18 bg-graph-status-running/[0.12] text-graph-status-running",
  idle: "border-graph-status-idle/12 bg-graph-status-idle/[0.06] text-graph-status-idle/78",
  sleeping:
    "border-graph-status-sleeping/18 bg-graph-status-sleeping/[0.12] text-graph-status-sleeping",
  initializing:
    "border-graph-status-initializing/16 bg-graph-status-initializing/[0.08] text-graph-status-initializing/84",
  error:
    "border-graph-status-error/20 bg-graph-status-error/[0.09] text-graph-status-error",
  terminated: "border-border bg-accent/35 text-muted-foreground",
};

export function ToolbarButton({
  children,
  disabled = false,
  active = false,
  onClick,
}: {
  children: ReactNode;
  disabled?: boolean;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="xs"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border border-transparent bg-transparent px-3 py-1.75 text-[11px] font-medium text-muted-foreground transition-[background-color,border-color,color] duration-150 hover:border-border hover:bg-accent/45 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:border-transparent disabled:text-muted-foreground/50 disabled:hover:bg-transparent",
        active && "border-border bg-accent/70 text-foreground",
      )}
    >
      {children}
    </Button>
  );
}

export function ToolbarDivider() {
  return <div aria-hidden="true" className="h-4 w-px shrink-0 bg-border" />;
}

export function BadgeChip({
  children,
  tone = "default",
}: {
  children: ReactNode;
  tone?: "default" | "primary";
}) {
  return (
    <div
      className={cn(
        "pointer-events-auto relative isolate flex items-center gap-1.5 rounded-full border border-border bg-surface-overlay/80 px-2.5 py-1 text-[11px] font-medium text-muted-foreground backdrop-blur-sm",
        tone === "primary" ? "border-border bg-accent/60 text-foreground" : "",
      )}
    >
      {children}
    </div>
  );
}

export function AgentDetailPanel({
  agent,
  onClose,
}: {
  agent: Node;
  onClose: () => void;
}) {
  const [interrupting, setInterrupting] = useState(false);
  const { agents } = useAgentNodesRuntime();
  const { tabs } = useAgentTabsRuntime();
  const isWorkflowStep =
    agent.node_type !== "assistant" && agent.node_type !== "agent";
  const { detail, error, loading } = useAgentDetail(
    isWorkflowStep ? null : agent.id,
    agent.node_type === "assistant",
  );
  const detailState = detail?.state ?? agent.state;
  const detailIsLeader = detail?.is_leader ?? agent.is_leader;
  const detailContacts = detail?.contacts ?? [];
  const detailConnections = detail?.connections ?? agent.connections;
  const detailTodos = detail?.todos ?? agent.todos;
  const detailHistory = detail?.history ?? [];
  const detailRoleName = detail?.role_name ?? agent.role_name;
  const detailTools = detail?.tools ?? [];
  const detailWriteDirs = detail?.write_dirs ?? [];
  const detailAllowNetwork = detail?.allow_network ?? false;
  const detailTabId = detail?.tab_id ?? agent.tab_id ?? null;
  const detailTab = detailTabId ? (tabs.get(detailTabId) ?? null) : null;
  const isAssistant = agent.node_type === "assistant";
  const workflowPermissions = detail?.workflow_permissions ?? null;
  const effectiveAllowNetwork = isAssistant
    ? detailAllowNetwork
    : (detailTab?.allow_network ??
      workflowPermissions?.allow_network ??
      detailAllowNetwork ??
      false);
  const effectiveWriteDirs = isAssistant
    ? detailWriteDirs
    : (detailTab?.write_dirs ??
      workflowPermissions?.write_dirs ??
      detailWriteDirs);
  const permissionsTitle = isAssistant ? "Permissions" : "Workflow Permissions";
  const label = getNodeLabel({
    name: agent.name,
    roleName: agent.role_name,
    nodeType: agent.node_type,
    isLeader: agent.is_leader,
  });
  const Icon = nodeTypeIcon[agent.node_type];
  const connectionItems = detailConnections.map((connectionId) => {
    const connectedAgent = agents.get(connectionId);
    return {
      id: connectionId,
      label: connectedAgent
        ? getNodeLabel({
            name: connectedAgent.name,
            roleName: connectedAgent.role_name,
            nodeType: connectedAgent.node_type,
            isLeader: connectedAgent.is_leader,
          })
        : connectionId.slice(0, 8),
    };
  });
  const pathContacts = detailContacts.filter(isContactPath);
  const entryContacts = detailContacts.filter(
    (contact): contact is Exclude<ContactEntry, ContactPath> =>
      !isContactPath(contact),
  );
  const contactItems = entryContacts.map((contact) => {
    const contactId = typeof contact === "string" ? contact : contact.id;
    const contactAgent = agents.get(contactId);
    return {
      id: contactId,
      label: getContactLabel(contact, contactAgent),
    };
  });
  const contactMetricLabel =
    pathContacts.length > 0 ? "reachable paths" : "reachable contacts";

  return (
    <>
      <div className="flex items-center justify-between border-b border-border px-3.5 py-2.5">
        <div className="flex items-center gap-3">
          <div className="flex size-7 items-center justify-center rounded-md bg-primary/8">
            <Icon className="size-3.5 text-primary" />
          </div>
          <div className="min-w-0 flex flex-wrap items-center gap-2">
            <p className="text-[13px] font-semibold">{label}</p>
            {detailIsLeader ? (
              <span className="rounded-full border border-accent bg-accent/45 px-2 py-0.5 text-[10px] font-semibold text-accent-foreground">
                Leader
              </span>
            ) : null}
            <span className="rounded-full border border-border bg-accent/35 px-2 py-0.5 font-mono text-[10px] text-muted-foreground/78">
              {agent.id.slice(0, 8)}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          {detailState === "running" || detailState === "sleeping" ? (
            <Button
              type="button"
              size="sm"
              variant="destructive"
              disabled={interrupting}
              onClick={() => {
                setInterrupting(true);
                interruptNode(agent.id)
                  .catch(() => {
                    toast.error("Failed to interrupt node");
                  })
                  .finally(() => {
                    setInterrupting(false);
                  });
              }}
            >
              {interrupting ? "Interrupting..." : "Interrupt"}
            </Button>
          ) : null}
          <PanelActionButton title="Close details" onClick={onClose}>
            <X className="size-4" />
          </PanelActionButton>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3.5">
        <div className="space-y-3.5">
          <div className="grid gap-3.5 border-b border-border pb-3.5 sm:grid-cols-3">
            <div className="min-w-0">
              <p className="text-[10px] font-semibold text-muted-foreground">
                Status
              </p>
              <div className="mt-2">
                <Badge
                  variant="outline"
                  className={workspaceStateBadgeClass[detailState]}
                >
                  {detailState.toUpperCase()}
                </Badge>
              </div>
            </div>

            <div className="min-w-0 sm:border-l sm:border-border sm:pl-3.5">
              <p className="text-[10px] font-semibold text-muted-foreground">
                Contacts
              </p>
              <p className="mt-2 select-text text-sm text-foreground">
                {detailContacts.length} {contactMetricLabel}
              </p>
            </div>

            <div className="min-w-0 sm:border-l sm:border-border sm:pl-3.5">
              <p className="text-[10px] font-semibold text-muted-foreground">
                Workflow
              </p>
              <p className="mt-2 select-text text-sm text-foreground">
                {detailTab?.title ?? detailTabId?.slice(0, 8) ?? "None"}
              </p>
            </div>
          </div>

          <DetailSection title="Workflow Context">
            {detailTabId ? (
              <div className="grid gap-3 text-sm sm:grid-cols-2">
                <div>
                  <p className="text-[10px] font-semibold text-muted-foreground">
                    ID
                  </p>
                  <p className="mt-1 select-text font-mono text-[11px] text-foreground">
                    {detailTabId ?? "None"}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] font-semibold text-muted-foreground">
                    Title
                  </p>
                  <p className="mt-1 select-text text-foreground">
                    {detailTab?.title ?? "Unknown"}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] font-semibold text-muted-foreground">
                    Role
                  </p>
                  <p className="mt-1 select-text text-foreground">
                    {detailRoleName ?? "None"}
                  </p>
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                No workflow metadata
              </p>
            )}
          </DetailSection>

          {isWorkflowStep ? (
            <>
              <DetailSection title="Workflow Permissions">
                <PermissionsContent
                  allowNetwork={effectiveAllowNetwork}
                  writeDirs={effectiveWriteDirs}
                  inherited={!isAssistant}
                />
              </DetailSection>

              <DetailSection title="Ports">
                {[...(agent.inputs ?? []), ...(agent.outputs ?? [])].length ===
                0 ? (
                  <p className="text-sm text-muted-foreground">No ports</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {[...(agent.inputs ?? []), ...(agent.outputs ?? [])].map(
                      (port) => (
                        <span
                          key={`${port.direction}-${port.key}`}
                          className={cn(
                            workspaceSelectionBadgeClass,
                            "select-text",
                          )}
                        >
                          {port.direction === "in" ? "Input" : "Output"} ·{" "}
                          {port.key} · {port.type}
                        </span>
                      ),
                    )}
                  </div>
                )}
              </DetailSection>

              <DetailSection title="Settings">
                {Object.keys(agent.config ?? {}).length === 0 ? (
                  <p className="text-sm text-muted-foreground">No settings</p>
                ) : (
                  <pre className="max-h-56 overflow-auto rounded-md border border-border bg-background/40 p-3 text-[11px] leading-5 text-foreground">
                    {JSON.stringify(agent.config, null, 2)}
                  </pre>
                )}
              </DetailSection>
            </>
          ) : (
            <>
              <DetailSection title="Contacts">
                {pathContacts.length === 0 && contactItems.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No direct contacts
                  </p>
                ) : pathContacts.length > 0 ? (
                  <div className="space-y-2">
                    {pathContacts.map((contact) => (
                      <div
                        key={contact.edge_id}
                        className="rounded-md border border-border bg-accent/25 px-3 py-2"
                      >
                        <div className="flex min-w-0 items-center justify-between gap-3">
                          <p className="min-w-0 select-text truncate text-sm font-medium text-foreground">
                            {getContactLabel(
                              contact,
                              agents.get(contact.target_id),
                            )}
                          </p>
                          <Badge
                            variant="outline"
                            className="shrink-0 border-border bg-background/40 font-mono text-[10px] text-muted-foreground"
                          >
                            {contact.port_type}
                          </Badge>
                        </div>
                        <div className="mt-2 flex min-w-0 flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                          <span className="select-text rounded-md bg-background/45 px-1.5 py-0.5 font-mono text-foreground/80">
                            {contact.from_output_port_key}
                          </span>
                          <span aria-hidden="true">to</span>
                          <span className="select-text rounded-md bg-background/45 px-1.5 py-0.5 font-mono text-foreground/80">
                            {contact.to_input_port_key}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {contactItems.map((contact) => (
                      <span
                        key={contact.id}
                        className={cn(
                          workspaceSelectionBadgeClass,
                          "select-text",
                        )}
                      >
                        {contact.label}
                      </span>
                    ))}
                  </div>
                )}
              </DetailSection>

              <DetailSection title="Workflow Graph">
                {connectionItems.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No graph edges
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {connectionItems.map((connection) => (
                      <span
                        key={connection.id}
                        className={cn(
                          workspaceSelectionBadgeClass,
                          "select-text",
                        )}
                      >
                        {connection.label}
                      </span>
                    ))}
                  </div>
                )}
              </DetailSection>

              <DetailSection title="Tools">
                {detailTools.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No tools configured
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {detailTools.map((tool) => (
                      <span
                        key={tool}
                        className={cn(
                          workspaceSelectionBadgeClass,
                          "select-text font-mono",
                        )}
                      >
                        {tool}
                      </span>
                    ))}
                  </div>
                )}
              </DetailSection>

              <DetailSection title={permissionsTitle}>
                <PermissionsContent
                  allowNetwork={effectiveAllowNetwork}
                  writeDirs={effectiveWriteDirs}
                  inherited={!isAssistant}
                />
              </DetailSection>

              <DetailSection title="Todos">
                <div className="space-y-2">
                  {detailTodos.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No todos</p>
                  ) : (
                    detailTodos.slice(0, 6).map((todo) => (
                      <div
                        key={todo.text}
                        className="flex min-w-0 items-center gap-2 text-sm text-foreground"
                      >
                        <span className="size-2 rounded-full bg-border" />
                        <span className="min-w-0 break-words [overflow-wrap:anywhere]">
                          {todo.text}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </DetailSection>

              <div className="border-t border-border pt-4">
                <div className="px-0 pb-2">
                  <p className="text-[10px] font-semibold text-muted-foreground">
                    History
                  </p>
                </div>

                {loading ? (
                  <div className="space-y-2">
                    {[...Array(4)].map((_, index) => (
                      <div
                        key={index}
                        className="h-12 rounded-md skeleton-shimmer"
                      />
                    ))}
                  </div>
                ) : error ? (
                  <div className="text-sm text-destructive">{error}</div>
                ) : detailHistory.length === 0 ? (
                  <div className="text-sm text-muted-foreground">
                    No history yet.
                  </div>
                ) : (
                  <HistoryView
                    history={detailHistory}
                    agentLabel={label}
                    nodes={agents}
                  />
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}

function isContactPath(contact: ContactEntry): contact is ContactPath {
  return (
    typeof contact === "object" &&
    contact !== null &&
    "from_output_port_key" in contact &&
    "to_input_port_key" in contact
  );
}

function getContactLabel(contact: ContactEntry, liveNode?: Node): string {
  if (liveNode) {
    return getNodeLabel({
      name: liveNode.name,
      roleName: liveNode.role_name,
      nodeType: liveNode.node_type,
      isLeader: liveNode.is_leader,
    });
  }
  if (typeof contact === "string") {
    return contact.slice(0, 8);
  }
  return getNodeLabel({
    name: contact.name,
    roleName: contact.role_name,
    nodeType: contact.node_type,
    isLeader: contact.is_leader,
  });
}

export function LeaderChatPanel({
  onOpenDetails,
}: {
  onOpenDetails: () => void;
}) {
  const { agents } = useAgentNodesRuntime();
  const [stopping, setStopping] = useState(false);
  const { height: composerHeight, ref: composerRef } =
    useMeasuredHeight<HTMLDivElement>();
  const {
    activeTab,
    addImages = async () => {},
    cancelPendingSend,
    clearChat,
    clearing = false,
    connected,
    draftImages = [],
    handleKeyDown,
    hasUploadingImages = false,
    input,
    isBrowsingInputHistory,
    leaderActivity,
    leaderNode,
    navigateInputHistory,
    onMessagesScroll,
    removeImage = () => {},
    retryMessage,
    retryingMessageId,
    scrollRef,
    sending,
    sendMessage,
    sendPendingSend,
    setInput,
    stopLeader,
    supportsInputImage = false,
    timelineItems,
  } = useLeaderChat({ bottomInset: composerHeight });

  if (!activeTab) {
    return <WorkspacePanelEmptyState />;
  }
  if (!leaderNode) {
    return <WorkspacePanelLoadingState />;
  }

  return (
    <div className="relative flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-2.5 border-b border-border px-3.5 py-2.5">
        <div className="flex min-w-[220px] flex-1 items-center gap-2">
          <p className="shrink-0 text-[14px] font-semibold leading-6">
            Workflow chat
          </p>
          {leaderNode.role_name ? (
            <span className="min-w-0 truncate rounded-full border border-border bg-accent/35 px-2 py-0.5 text-[10px] font-medium leading-4 text-muted-foreground/78">
              Role: {leaderNode.role_name}
            </span>
          ) : null}
          <span className="min-w-0 truncate rounded-full border border-border bg-accent/35 px-2 py-0.5 text-[10px] font-medium leading-4 text-muted-foreground/78">
            {activeTab.title}
          </span>
          <span
            className={cn(
              "rounded-full border px-2.5 py-0.5 text-[9px] font-medium transition-colors",
              connected
                ? "border-graph-status-running/18 bg-graph-status-running/[0.12] text-graph-status-running"
                : "border-graph-status-idle/18 bg-graph-status-idle/[0.12] text-graph-status-idle",
            )}
          >
            {connected ? "Online" : "Connecting..."}
          </span>
          <span className="rounded-full border border-border bg-accent/35 px-2 py-0.5 text-[10px] font-medium leading-4 text-muted-foreground/78">
            {activeTab.activation_state === "active" ? "Active" : "Inactive"}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={clearing}
            onClick={() => void clearChat()}
          >
            {clearing ? "Clearing..." : "Clear"}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={onOpenDetails}
          >
            Detail
          </Button>
        </div>
      </div>

      <div className="relative flex min-h-0 flex-1 flex-col">
        <AssistantChatMessages
          allowHumanMessageRetry
          bottomInset={composerHeight}
          items={timelineItems}
          nodes={agents}
          onRetryHumanMessage={(messageId) => void retryMessage(messageId)}
          onCancelPendingSend={cancelPendingSend}
          onSendPendingSend={(pendingId) => void sendPendingSend(pendingId)}
          onScroll={onMessagesScroll}
          retryImageInputEnabled={supportsInputImage}
          retryingMessageId={retryingMessageId}
          runningHint={leaderActivity.runningHint}
          scrollRef={scrollRef}
        />

        <div
          ref={composerRef}
          style={{
            paddingBottom: "calc(10px + env(safe-area-inset-bottom, 0px))",
          }}
          className="pointer-events-none absolute inset-x-0 bottom-0 z-10 bg-gradient-to-b from-transparent via-background/70 to-background/95 px-2.5 pt-8"
        >
          <AssistantChatComposer
            busy={leaderActivity.running}
            commandsEnabled
            disabled={
              (!input.trim() && draftImages.length === 0) ||
              hasUploadingImages ||
              sending
            }
            images={draftImages}
            imageInputEnabled={supportsInputImage}
            input={input}
            onAddImages={(files) => void addImages(files)}
            onChange={setInput}
            onNavigateHistory={navigateInputHistory}
            onKeyDown={handleKeyDown}
            onRemoveImage={removeImage}
            onSend={() => void sendMessage()}
            onStop={() => {
              setStopping(true);
              void stopLeader()
                .catch((error) => {
                  toast.error(
                    error instanceof Error
                      ? error.message
                      : "Failed to interrupt leader",
                  );
                })
                .finally(() => {
                  setStopping(false);
                });
            }}
            overlay
            suppressCommandNavigation={isBrowsingInputHistory}
            targetLabel="this workflow"
            stopping={stopping}
          />
        </div>
      </div>
    </div>
  );
}

export function WorkspacePanelEmptyState() {
  return (
    <div className="flex h-full items-center justify-center px-6">
      <div className="max-w-sm rounded-xl border border-border bg-accent/20 px-5 py-6 text-center">
        <p className="text-[13px] font-semibold text-foreground">
          No workflow selected
        </p>
        <p className="mt-2 text-[12px] leading-6 text-muted-foreground">
          Create a workflow or switch to an existing one to open its workflow
          chat.
        </p>
      </div>
    </div>
  );
}

function WorkspacePanelLoadingState() {
  return (
    <div className="flex h-full items-center justify-center px-6">
      <div className="max-w-sm rounded-xl border border-border bg-accent/20 px-5 py-6 text-center">
        <p className="text-[13px] font-semibold text-foreground">
          Loading workflow context
        </p>
        <p className="mt-2 text-[12px] leading-6 text-muted-foreground">
          Restoring the current workflow chat.
        </p>
      </div>
    </div>
  );
}

interface PanelActionButtonProps {
  children: ReactNode;
  onClick: () => void;
  title: string;
}

interface PanelToggleButtonProps {
  expanded: boolean;
  onClick: () => void;
  className?: string;
}

export function PanelToggleButton({
  expanded,
  onClick,
  className,
}: PanelToggleButtonProps) {
  const title = expanded ? "Hide panel" : "Show panel";

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      onClick={onClick}
      title={title}
      aria-label={title}
      className={cn(
        "pointer-events-auto relative isolate flex size-9 items-center justify-center rounded-md border border-border bg-surface-overlay/80 text-muted-foreground shadow-sm transition-[background-color,color] duration-150 hover:bg-accent/60 hover:text-foreground [contain:paint]",
        className,
      )}
    >
      <span className="flex transition-transform duration-200">
        {expanded ? (
          <PanelRightClose className="size-4" />
        ) : (
          <PanelRightOpen className="size-4" />
        )}
      </span>
    </Button>
  );
}

function PanelActionButton({
  children,
  onClick,
  title,
}: PanelActionButtonProps) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-xs"
      onClick={onClick}
      title={title}
      aria-label={title}
      className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors duration-150 hover:bg-accent/45 hover:text-foreground"
    >
      {children}
    </Button>
  );
}

function PermissionsContent({
  allowNetwork,
  inherited,
  writeDirs,
}: {
  allowNetwork: boolean;
  inherited: boolean;
  writeDirs: string[];
}) {
  return (
    <div className="space-y-3">
      {inherited ? (
        <p className="text-xs text-muted-foreground">Set by this workflow.</p>
      ) : null}

      <div>
        <p className="text-[10px] font-semibold text-muted-foreground">
          Network
        </p>
        <p className="mt-1 select-text text-sm text-foreground">
          {allowNetwork ? "Enabled" : "Disabled"}
        </p>
      </div>

      <div>
        <p className="text-[10px] font-semibold text-muted-foreground">
          Writable Folders
        </p>
        {writeDirs.length === 0 ? (
          <p className="mt-1 text-sm text-muted-foreground">No write access</p>
        ) : (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {writeDirs.map((path) => (
              <span
                key={path}
                className={cn(
                  workspaceSelectionBadgeClass,
                  "select-text font-mono text-[11px]",
                )}
              >
                {path}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
