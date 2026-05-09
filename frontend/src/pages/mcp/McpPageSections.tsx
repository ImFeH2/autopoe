import { Search, Unplug, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  FilterPill,
  ReadonlyBlock,
  SummaryCard,
} from "@/components/mcp/McpPrimitives";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { SoftPanel } from "@/components/layout/PageScaffold";
import {
  CodeBlock,
  PageState,
  PanelCard,
  StatusChip,
  mutedLabelClass,
} from "@/components/ui/surface";
import { WorkspaceDialogField } from "@/components/WorkspaceCommandDialog";
import { cn } from "@/lib/utils";
import type { MCPActivityRecord, MCPServerRecord } from "@/types";
import {
  ACTIVITY_FILTER_OPTIONS,
  CAPABILITY_TABS,
  DETAIL_TABS,
  SERVER_FILTER_OPTIONS,
  activityCategoryLabel,
  authActionDisabled,
  authActionLabel,
  capabilitySummary,
  formatAuthStatus,
  formatSentenceCase,
  formatTimestamp,
  formatTimestampShort,
  globalAvailabilityLabel,
  parsedLauncherSummary,
  readonlyList,
  readonlyMapKeys,
  readonlyText,
  renderValueOrFallback,
  resultClassName,
  statusClassName,
  statusLabel,
  toolFilterSummary,
  type ActivityFilter,
  type CapabilityTab,
  type DetailTab,
  type QuickAddState,
  type ServerStatusFilter,
  type ServerSummaryCounts,
  type McpServerActions,
  type McpServerDialogState,
  type PromptPreviewState,
} from "@/pages/mcp/lib";

const mcpPanelClass = "bg-card/20";
const mcpPanelTextClass = "text-[13px] text-muted-foreground";
const mcpEyebrowClass = mutedLabelClass;
export const mcpOutlineButtonClass =
  "border-border/70 bg-background/45 hover:border-ring/35 hover:bg-accent/65";
const mcpDestructiveButtonClass =
  "border-graph-status-error/35 bg-graph-status-error/10 text-graph-status-error hover:bg-graph-status-error/18";
const mcpCodeBlockClass =
  "mt-4 max-h-48 bg-background/55 p-3 text-foreground/70";
const mcpDescriptionLineClass =
  "mt-2 line-clamp-1 text-[13px] leading-6 text-muted-foreground";

interface McpQuickAddPanelProps {
  dialog: McpServerDialogState;
  quickAdd: QuickAddState;
}

interface McpServerListProps {
  actions: McpServerActions;
  dialog: McpServerDialogState;
  filteredServers: MCPServerRecord[];
  onSelectServer: (serverName: string) => void;
  selectedServer: MCPServerRecord | null;
}

interface McpServerDetailsProps {
  actions: McpServerActions;
  activityFilter: ActivityFilter;
  capabilityTab: CapabilityTab;
  dialog: McpServerDialogState;
  detailTab: DetailTab;
  filteredActivity: MCPActivityRecord[];
  onActivityFilterChange: (filter: ActivityFilter) => void;
  onCapabilityTabChange: (tab: CapabilityTab) => void;
  onDetailTabChange: (tab: DetailTab) => void;
  onFocusQuickAdd: () => void;
  promptPreviewState: PromptPreviewState;
  selectedServer: MCPServerRecord | null;
}

interface McpServerDashboardProps extends McpServerListProps {
  activityFilter: ActivityFilter;
  capabilityTab: CapabilityTab;
  clearServerFilters: () => void;
  detailTab: DetailTab;
  filteredActivity: MCPActivityRecord[];
  onActivityFilterChange: (filter: ActivityFilter) => void;
  onCapabilityTabChange: (tab: CapabilityTab) => void;
  onDetailTabChange: (tab: DetailTab) => void;
  onFocusQuickAdd: () => void;
  onServerStatusFilterChange: (filter: ServerStatusFilter) => void;
  promptPreviewState: PromptPreviewState;
  quickAdd: QuickAddState;
  serverStatusFilter: ServerStatusFilter;
  summaryCounts: ServerSummaryCounts;
}

export function McpLoadingState() {
  return (
    <div className="grid h-full gap-5 lg:grid-cols-[320px_minmax(0,1fr)]">
      <div className="space-y-3">
        {Array.from({ length: 5 }).map((_, index) => (
          <div
            key={index}
            className="h-24 rounded-xl border border-border bg-card/20 skeleton-shimmer"
          />
        ))}
        <p className="px-2 text-[13px] text-muted-foreground">
          Loading MCP servers...
        </p>
      </div>
      <div className="rounded-xl border border-border bg-card/20 skeleton-shimmer" />
    </div>
  );
}

export function McpLoadErrorState() {
  return (
    <SoftPanel className="flex h-full items-center justify-center text-center text-muted-foreground">
      Failed to load MCP state.
    </SoftPanel>
  );
}

export function McpEmptyState({ quickAdd, dialog }: McpQuickAddPanelProps) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <McpQuickAddPanel quickAdd={quickAdd} dialog={dialog} />
      <PageState
        icon={Unplug}
        title="No MCP servers"
        minHeightClassName="h-full"
        className="mt-4"
      />
    </div>
  );
}

export function McpQuickAddPanel({ dialog, quickAdd }: McpQuickAddPanelProps) {
  return (
    <SoftPanel className={cn("mt-4", mcpPanelClass)}>
      <div className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className={mcpEyebrowClass}>Quick Add</p>
          </div>
          {quickAdd.parse.draft ? (
            <StatusChip
              className={cn(
                statusClassName(
                  quickAdd.parse.draft.transport === "streamable_http"
                    ? "connected"
                    : "connecting",
                ),
              )}
            >
              {quickAdd.parse.draft.transport === "streamable_http"
                ? "URL"
                : "Launcher"}
            </StatusChip>
          ) : null}
        </div>
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(260px,0.6fr)]">
          <WorkspaceDialogField label="Launcher or URL">
            <Input
              id="mcp-quick-add-input"
              value={quickAdd.input}
              onChange={(event) => quickAdd.setInput(event.target.value)}
              placeholder="npx @playwright/mcp@latest"
            />
          </WorkspaceDialogField>
          <WorkspaceDialogField label="Name">
            <Input
              value={quickAdd.nameValue}
              onChange={(event) => quickAdd.setName(event.target.value)}
              placeholder="playwright-mcp"
            />
          </WorkspaceDialogField>
        </div>
        {quickAdd.parse.draft ? (
          <div className="grid gap-3 xl:grid-cols-3">
            <SoftPanel className={mcpPanelClass}>
              <p className={mcpEyebrowClass}>Transport</p>
              <p className="mt-2 text-[14px] font-medium text-foreground">
                {quickAdd.parse.draft.transport}
              </p>
            </SoftPanel>
            <SoftPanel className={mcpPanelClass}>
              <p className={mcpEyebrowClass}>Parsed Name</p>
              <p className="mt-2 text-[14px] font-medium text-foreground">
                {quickAdd.parse.draft.name}
              </p>
            </SoftPanel>
            <SoftPanel className={cn("xl:col-span-1", mcpPanelClass)}>
              <p className={mcpEyebrowClass}>Parsed Result</p>
              <p className="mt-2 break-all font-mono text-[12px] text-foreground/80">
                {quickAdd.parse.draft.transport === "streamable_http"
                  ? quickAdd.parse.draft.url
                  : [
                      quickAdd.parse.draft.command,
                      ...quickAdd.parse.draft.args,
                    ].join(" ")}
              </p>
            </SoftPanel>
          </div>
        ) : null}
        {quickAdd.error || (quickAdd.input.trim() && quickAdd.parse.error) ? (
          <p className="text-[13px] text-destructive">
            {quickAdd.error ?? quickAdd.parse.error}
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            disabled={quickAdd.pending || quickAdd.parse.draft === null}
            onClick={() => void quickAdd.submit()}
          >
            {quickAdd.pending ? "Adding..." : "Quick Add"}
          </Button>
          <Button
            type="button"
            variant="outline"
            className={mcpOutlineButtonClass}
            onClick={dialog.openCreateDialog}
          >
            Advanced Add
          </Button>
        </div>
      </div>
    </SoftPanel>
  );
}

export function McpServerDashboard(props: McpServerDashboardProps) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <McpServerSummary summaryCounts={props.summaryCounts} />
      <McpQuickAddPanel quickAdd={props.quickAdd} dialog={props.dialog} />
      <McpServerStatusFilters
        serverStatusFilter={props.serverStatusFilter}
        onServerStatusFilterChange={props.onServerStatusFilterChange}
      />
      <div className="mt-4 min-h-0 flex-1 overflow-hidden">
        {props.filteredServers.length === 0 ? (
          <PageState
            icon={Search}
            title="No matching MCP servers"
            minHeightClassName="h-full"
            action={
              <Button
                type="button"
                variant="outline"
                className={mcpOutlineButtonClass}
                onClick={props.clearServerFilters}
              >
                <X className="mr-2 size-4" />
                Show All Servers
              </Button>
            }
          />
        ) : (
          <div className="grid h-full gap-5 xl:grid-cols-[360px_minmax(0,1fr)]">
            <McpServerList
              actions={props.actions}
              dialog={props.dialog}
              filteredServers={props.filteredServers}
              onSelectServer={props.onSelectServer}
              selectedServer={props.selectedServer}
            />
            <McpServerDetails
              actions={props.actions}
              activityFilter={props.activityFilter}
              capabilityTab={props.capabilityTab}
              dialog={props.dialog}
              detailTab={props.detailTab}
              filteredActivity={props.filteredActivity}
              onActivityFilterChange={props.onActivityFilterChange}
              onCapabilityTabChange={props.onCapabilityTabChange}
              onDetailTabChange={props.onDetailTabChange}
              onFocusQuickAdd={props.onFocusQuickAdd}
              promptPreviewState={props.promptPreviewState}
              selectedServer={props.selectedServer}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function McpServerSummary({
  summaryCounts,
}: {
  summaryCounts: ServerSummaryCounts;
}) {
  return (
    <SoftPanel>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard label="Configured" value={summaryCounts.configured} />
        <SummaryCard label="Connected" value={summaryCounts.connected} />
        <SummaryCard label="Auth Required" value={summaryCounts.authRequired} />
        <SummaryCard label="Error" value={summaryCounts.error} />
      </div>
    </SoftPanel>
  );
}

function McpServerStatusFilters({
  onServerStatusFilterChange,
  serverStatusFilter,
}: {
  onServerStatusFilterChange: (filter: ServerStatusFilter) => void;
  serverStatusFilter: ServerStatusFilter;
}) {
  return (
    <SoftPanel className="mt-4">
      <div className="flex flex-wrap gap-2">
        {SERVER_FILTER_OPTIONS.map((option) => (
          <FilterPill
            key={option.value}
            active={serverStatusFilter === option.value}
            label={option.label}
            onClick={() => onServerStatusFilterChange(option.value)}
          />
        ))}
      </div>
    </SoftPanel>
  );
}

function McpServerList({
  actions,
  dialog,
  filteredServers,
  onSelectServer,
  selectedServer,
}: McpServerListProps) {
  return (
    <div className="min-h-0 overflow-y-auto pr-1 scrollbar-none">
      <div className="space-y-3">
        {filteredServers.map((serverRecord) => (
          <McpServerListItem
            key={serverRecord.config.name}
            actions={actions}
            dialog={dialog}
            isSelected={
              selectedServer?.config.name === serverRecord.config.name
            }
            onSelectServer={onSelectServer}
            serverRecord={serverRecord}
          />
        ))}
      </div>
    </div>
  );
}

function McpServerListItem({
  actions,
  dialog,
  isSelected,
  onSelectServer,
  serverRecord,
}: {
  actions: McpServerActions;
  dialog: McpServerDialogState;
  isSelected: boolean;
  onSelectServer: (serverName: string) => void;
  serverRecord: MCPServerRecord;
}) {
  const visibility = globalAvailabilityLabel(serverRecord);

  return (
    <PanelCard
      as="div"
      padding="sm"
      className={cn(
        "p-4 transition-colors",
        isSelected ? "bg-accent/20" : "bg-card/20 hover:bg-accent/20",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <Button
          type="button"
          variant="ghost"
          onClick={() => onSelectServer(serverRecord.config.name)}
          className="h-auto min-w-0 flex-1 justify-start p-0 text-left hover:bg-transparent hover:text-inherit"
        >
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-[14px] font-medium text-foreground">
              {serverRecord.config.name}
            </p>
            {serverRecord.config.required ? (
              <StatusChip tone="idle" className="px-2 py-0.5">
                required
              </StatusChip>
            ) : null}
            {visibility ? (
              <StatusChip tone="primary" className="px-2 py-0.5">
                {visibility}
              </StatusChip>
            ) : null}
          </div>
          <div className="mt-3 grid gap-1.5 text-[12px] text-muted-foreground">
            <p>Transport {serverRecord.config.transport}</p>
            <p>Status {statusLabel(serverRecord.snapshot.status)}</p>
            <p>Auth {formatAuthStatus(serverRecord.snapshot.auth_status)}</p>
            <p>{capabilitySummary(serverRecord)}</p>
          </div>
          {serverRecord.snapshot.last_error ? (
            <p className="mt-3 line-clamp-2 text-[12px] leading-5 text-destructive">
              {serverRecord.snapshot.last_error}
            </p>
          ) : null}
        </Button>
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <StatusChip
            className={cn(statusClassName(serverRecord.snapshot.status))}
          >
            {statusLabel(serverRecord.snapshot.status)}
          </StatusChip>
          <McpServerActionButtons
            actions={actions}
            buttonClassName="h-7 px-2 text-[11px]"
            dialog={dialog}
            serverRecord={serverRecord}
          />
        </div>
      </div>
    </PanelCard>
  );
}

function McpServerDetails({
  actions,
  activityFilter,
  capabilityTab,
  dialog,
  detailTab,
  filteredActivity,
  onActivityFilterChange,
  onCapabilityTabChange,
  onDetailTabChange,
  onFocusQuickAdd,
  promptPreviewState,
  selectedServer,
}: McpServerDetailsProps) {
  if (!selectedServer) {
    return (
      <div className="min-h-0 overflow-hidden">
        <PageState
          title="Select an MCP server"
          action={
            <Button type="button" size="sm" onClick={onFocusQuickAdd}>
              Quick Add
            </Button>
          }
          minHeightClassName="h-full"
        />
      </div>
    );
  }

  return (
    <div className="min-h-0 overflow-hidden">
      <SoftPanel className="flex h-full min-h-0 flex-col">
        <McpServerDetailsHeader
          actions={actions}
          dialog={dialog}
          selectedServer={selectedServer}
        />
        <div className="mt-4 flex flex-wrap gap-4 border-b border-border">
          {DETAIL_TABS.map((tab) => (
            <FilterPill
              key={tab}
              active={detailTab === tab}
              label={formatSentenceCase(tab)}
              onClick={() => onDetailTabChange(tab)}
              variant="tab"
            />
          ))}
        </div>
        <div className="mt-5 min-h-0 flex-1 overflow-y-auto pr-1 scrollbar-none">
          {detailTab === "overview" ? (
            <McpServerOverview selectedServer={selectedServer} />
          ) : null}
          {detailTab === "capabilities" ? (
            <McpServerCapabilities
              capabilityTab={capabilityTab}
              onCapabilityTabChange={onCapabilityTabChange}
              promptPreviewState={promptPreviewState}
              selectedServer={selectedServer}
            />
          ) : null}
          {detailTab === "activity" ? (
            <McpServerActivity
              activityFilter={activityFilter}
              filteredActivity={filteredActivity}
              onActivityFilterChange={onActivityFilterChange}
              selectedServer={selectedServer}
            />
          ) : null}
        </div>
      </SoftPanel>
    </div>
  );
}

function McpServerDetailsHeader({
  actions,
  dialog,
  selectedServer,
}: {
  actions: McpServerActions;
  dialog: McpServerDialogState;
  selectedServer: MCPServerRecord;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border pb-4">
      <div>
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-[18px] font-medium text-foreground">
            {selectedServer.config.name}
          </h2>
          <StatusChip
            uppercase
            className={cn(statusClassName(selectedServer.snapshot.status))}
          >
            {statusLabel(selectedServer.snapshot.status)}
          </StatusChip>
          {globalAvailabilityLabel(selectedServer) ? (
            <StatusChip tone="primary">
              {globalAvailabilityLabel(selectedServer)}
            </StatusChip>
          ) : null}
        </div>
        <p className="mt-2 text-[13px] text-muted-foreground">
          {selectedServer.config.transport} · Auth{" "}
          {formatAuthStatus(selectedServer.snapshot.auth_status)}
        </p>
        {selectedServer.snapshot.last_error ? (
          <p className="mt-2 max-w-3xl text-[13px] leading-6 text-destructive">
            {selectedServer.snapshot.last_error}
          </p>
        ) : null}
      </div>
      <McpServerActionButtons
        actions={actions}
        dialog={dialog}
        serverRecord={selectedServer}
      />
    </div>
  );
}

function McpServerActionButtons({
  actions,
  buttonClassName,
  dialog,
  serverRecord,
}: {
  actions: McpServerActions;
  buttonClassName?: string;
  dialog: McpServerDialogState;
  serverRecord: MCPServerRecord;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        type="button"
        variant="outline"
        className={cn(mcpOutlineButtonClass, buttonClassName)}
        onClick={() => actions.toggleEnabled(serverRecord)}
      >
        {serverRecord.config.enabled ? "Disable" : "Enable"}
      </Button>
      <Button
        type="button"
        variant="outline"
        disabled={authActionDisabled(serverRecord)}
        className={cn(mcpOutlineButtonClass, buttonClassName)}
        onClick={() =>
          serverRecord.snapshot.auth_status === "connected"
            ? actions.logout(serverRecord.config.name)
            : actions.login(serverRecord.config.name)
        }
      >
        {authActionLabel(serverRecord)}
      </Button>
      <Button
        type="button"
        variant="outline"
        className={cn(mcpOutlineButtonClass, buttonClassName)}
        onClick={() => dialog.openEditDialog(serverRecord)}
      >
        Edit
      </Button>
      <Button
        type="button"
        variant="outline"
        className={cn(mcpOutlineButtonClass, buttonClassName)}
        onClick={() => actions.refreshServer(serverRecord.config.name)}
      >
        Refresh
      </Button>
      <Button
        type="button"
        variant="outline"
        className={cn(mcpDestructiveButtonClass, buttonClassName)}
        onClick={() => actions.deleteServer(serverRecord.config.name)}
      >
        Remove
      </Button>
    </div>
  );
}

function McpServerOverview({
  selectedServer,
}: {
  selectedServer: MCPServerRecord;
}) {
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <SoftPanel className={mcpPanelClass}>
        <p className={mcpEyebrowClass}>Status</p>
        <p className="mt-3 text-[22px] font-medium text-foreground">
          {statusLabel(selectedServer.snapshot.status)}
        </p>
        <p className="mt-2 text-[13px] text-muted-foreground">
          Auth {formatAuthStatus(selectedServer.snapshot.auth_status)}
        </p>
      </SoftPanel>
      <SoftPanel className={mcpPanelClass}>
        <p className={mcpEyebrowClass}>Visibility</p>
        <p className="mt-3 text-[22px] font-medium text-foreground">
          {globalAvailabilityLabel(selectedServer) ?? "Pending"}
        </p>
      </SoftPanel>
      <SoftPanel className={mcpPanelClass}>
        <p className={mcpEyebrowClass}>Last Refresh</p>
        <p className="mt-3 text-[15px] font-medium text-foreground">
          {formatTimestamp(selectedServer.snapshot.last_refresh_at)}
        </p>
        <p className="mt-2 text-[13px] text-muted-foreground">
          Result{" "}
          {formatSentenceCase(selectedServer.snapshot.last_refresh_result)}
        </p>
      </SoftPanel>
      <SoftPanel className={mcpPanelClass}>
        <p className={mcpEyebrowClass}>Timeouts</p>
        <p className="mt-3 text-[15px] font-medium text-foreground">
          Startup {selectedServer.config.startup_timeout_sec}s
        </p>
        <p className="mt-2 text-[13px] text-muted-foreground">
          Tool {selectedServer.config.tool_timeout_sec}s
        </p>
      </SoftPanel>
      <SoftPanel className={mcpPanelClass}>
        <p className={mcpEyebrowClass}>Tool Filters</p>
        <p className="mt-3 text-[15px] font-medium text-foreground">
          {toolFilterSummary(selectedServer)}
        </p>
        <p className="mt-2 text-[13px] text-muted-foreground">
          Enabled {selectedServer.config.enabled_tools.length}
          {" · "}Disabled {selectedServer.config.disabled_tools.length}
        </p>
      </SoftPanel>
      <SoftPanel className={cn("xl:col-span-2", mcpPanelClass)}>
        <p className={mcpEyebrowClass}>Capability Summary</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {Object.entries(selectedServer.snapshot.capability_counts).map(
            ([capabilityName, value]) => (
              <PanelCard
                as="div"
                padding="sm"
                key={capabilityName}
                className="bg-card/20"
              >
                <p className={mcpEyebrowClass}>
                  {capabilityName.replaceAll("_", " ")}
                </p>
                <p className="mt-2 text-xl font-medium text-foreground">
                  {value}
                </p>
              </PanelCard>
            ),
          )}
        </div>
      </SoftPanel>
      {selectedServer.config.launcher ? (
        <SoftPanel className={cn("xl:col-span-2", mcpPanelClass)}>
          <div className="grid gap-4 xl:grid-cols-2">
            <ReadonlyBlock
              label="Original Launcher"
              value={readonlyText(selectedServer.config.launcher)}
              mono
            />
            <ReadonlyBlock
              label="Parsed Result"
              value={parsedLauncherSummary(selectedServer)}
              mono
            />
          </div>
        </SoftPanel>
      ) : null}
      {selectedServer.config.transport === "stdio" ? (
        <McpStdioServerConfig selectedServer={selectedServer} />
      ) : (
        <McpHttpServerConfig selectedServer={selectedServer} />
      )}
    </div>
  );
}

function McpStdioServerConfig({
  selectedServer,
}: {
  selectedServer: MCPServerRecord;
}) {
  return (
    <SoftPanel className={cn("xl:col-span-2", mcpPanelClass)}>
      <div className="grid gap-4 xl:grid-cols-2">
        <ReadonlyBlock
          label="Command"
          value={readonlyText(selectedServer.config.command)}
          mono
        />
        <ReadonlyBlock
          label="Cwd"
          value={readonlyText(selectedServer.config.cwd)}
          mono
        />
        <ReadonlyBlock
          label="Args"
          value={readonlyList(selectedServer.config.args)}
          mono
        />
        <ReadonlyBlock
          label="Env Vars"
          value={readonlyList(selectedServer.config.env_vars)}
          mono
        />
      </div>
    </SoftPanel>
  );
}

function McpHttpServerConfig({
  selectedServer,
}: {
  selectedServer: MCPServerRecord;
}) {
  return (
    <SoftPanel className={cn("xl:col-span-2", mcpPanelClass)}>
      <div className="grid gap-4 xl:grid-cols-2">
        <ReadonlyBlock
          label="URL"
          value={readonlyText(selectedServer.config.url)}
          mono
        />
        <ReadonlyBlock
          label="OAuth Resource"
          value={readonlyText(selectedServer.config.oauth_resource)}
          mono
        />
        <ReadonlyBlock
          label="Bearer Token Env Var"
          value={readonlyText(selectedServer.config.bearer_token_env_var)}
          mono
        />
        <ReadonlyBlock
          label="Scopes"
          value={readonlyList(selectedServer.config.scopes)}
          mono
        />
        <ReadonlyBlock
          label="HTTP Headers"
          value={readonlyMapKeys(selectedServer.config.http_headers)}
          mono
        />
        <ReadonlyBlock
          label="Env HTTP Headers"
          value={readonlyList(selectedServer.config.env_http_headers)}
          mono
        />
      </div>
      <PanelCard as="div" padding="sm" className="mt-4 bg-card/20">
        <p className={mcpEyebrowClass}>Recent Auth Result</p>
        <p className="mt-2 text-[14px] font-medium text-foreground">
          {renderValueOrFallback(
            selectedServer.snapshot.last_auth_result ?? "",
            "No login action yet",
          )}
        </p>
        <p className="mt-2 text-[13px] text-muted-foreground">
          Current auth status{" "}
          {formatAuthStatus(selectedServer.snapshot.auth_status)}
        </p>
      </PanelCard>
    </SoftPanel>
  );
}

function McpServerCapabilities({
  capabilityTab,
  onCapabilityTabChange,
  promptPreviewState,
  selectedServer,
}: {
  capabilityTab: CapabilityTab;
  onCapabilityTabChange: (tab: CapabilityTab) => void;
  promptPreviewState: PromptPreviewState;
  selectedServer: MCPServerRecord;
}) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-4 border-b border-border">
        {CAPABILITY_TABS.map((tab) => (
          <FilterPill
            key={tab}
            active={capabilityTab === tab}
            label={
              tab === "resource_templates"
                ? "Resource Templates"
                : formatSentenceCase(tab)
            }
            onClick={() => onCapabilityTabChange(tab)}
            variant="tab"
          />
        ))}
      </div>
      {capabilityTab === "tools" ? (
        <McpToolList selectedServer={selectedServer} />
      ) : null}
      {capabilityTab === "resources" ? (
        <McpResourceList selectedServer={selectedServer} />
      ) : null}
      {capabilityTab === "resource_templates" ? (
        <McpResourceTemplateList selectedServer={selectedServer} />
      ) : null}
      {capabilityTab === "prompts" ? (
        <McpPromptExplorer
          promptPreviewState={promptPreviewState}
          selectedServer={selectedServer}
        />
      ) : null}
    </div>
  );
}

function McpToolList({ selectedServer }: { selectedServer: MCPServerRecord }) {
  if (selectedServer.snapshot.tools.length === 0) {
    return (
      <SoftPanel className={cn(mcpPanelClass, mcpPanelTextClass)}>
        No tools discovered.
      </SoftPanel>
    );
  }

  return (
    <div className="space-y-3">
      {selectedServer.snapshot.tools.map((tool) => (
        <SoftPanel key={tool.fully_qualified_id} className={mcpPanelClass}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="font-mono text-[13px] text-foreground">
                {tool.tool_name}
              </p>
              {tool.title ? (
                <p className="mt-2 text-[13px] text-foreground/70">
                  {tool.title}
                </p>
              ) : null}
              <p className="mt-1 text-[12px] text-muted-foreground">
                {tool.fully_qualified_id}
              </p>
            </div>
            <div className="flex flex-wrap gap-2 text-[10px]">
              {tool.read_only_hint ? (
                <StatusChip tone="primary">readOnly</StatusChip>
              ) : null}
              {tool.destructive_hint ? (
                <StatusChip tone="danger">destructive</StatusChip>
              ) : null}
              {tool.open_world_hint ? (
                <StatusChip tone="idle">openWorld</StatusChip>
              ) : null}
            </div>
          </div>
          {tool.description ? (
            <p className={mcpDescriptionLineClass}>{tool.description}</p>
          ) : null}
          <CodeBlock className={mcpCodeBlockClass}>
            {JSON.stringify(tool.parameters ?? {}, null, 2)}
          </CodeBlock>
        </SoftPanel>
      ))}
    </div>
  );
}

function McpResourceList({
  selectedServer,
}: {
  selectedServer: MCPServerRecord;
}) {
  if (selectedServer.snapshot.resources.length === 0) {
    return (
      <SoftPanel className={cn(mcpPanelClass, mcpPanelTextClass)}>
        No resources discovered.
      </SoftPanel>
    );
  }

  return (
    <div className="space-y-3">
      {selectedServer.snapshot.resources.map((resource) => (
        <SoftPanel key={resource.uri} className={mcpPanelClass}>
          <p className="text-[14px] font-medium text-foreground">
            {resource.name}
          </p>
          <p className="mt-1 font-mono text-[12px] text-muted-foreground">
            {resource.uri}
          </p>
          <p className="mt-3 text-[13px] text-foreground/70">
            {resource.mime_type ?? "Unknown MIME"}
          </p>
          {resource.description ? (
            <p className={mcpDescriptionLineClass}>{resource.description}</p>
          ) : null}
        </SoftPanel>
      ))}
    </div>
  );
}

function McpResourceTemplateList({
  selectedServer,
}: {
  selectedServer: MCPServerRecord;
}) {
  if (selectedServer.snapshot.resource_templates.length === 0) {
    return (
      <SoftPanel className={cn(mcpPanelClass, mcpPanelTextClass)}>
        No resource templates discovered.
      </SoftPanel>
    );
  }

  return (
    <div className="space-y-3">
      {selectedServer.snapshot.resource_templates.map((template) => (
        <SoftPanel key={template.uri_template} className={mcpPanelClass}>
          <p className="text-[14px] font-medium text-foreground">
            {template.name}
          </p>
          <p className="mt-1 font-mono text-[12px] text-muted-foreground">
            {template.uri_template}
          </p>
          {template.description ? (
            <p className={mcpDescriptionLineClass}>{template.description}</p>
          ) : null}
        </SoftPanel>
      ))}
    </div>
  );
}

function McpPromptExplorer({
  promptPreviewState,
  selectedServer,
}: {
  promptPreviewState: PromptPreviewState;
  selectedServer: MCPServerRecord;
}) {
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
      <div className="space-y-3">
        {selectedServer.snapshot.prompts.length === 0 ? (
          <SoftPanel className={cn(mcpPanelClass, mcpPanelTextClass)}>
            No prompts discovered.
          </SoftPanel>
        ) : (
          selectedServer.snapshot.prompts.map((prompt) => (
            <Button
              key={prompt.name}
              type="button"
              variant="ghost"
              onClick={() =>
                promptPreviewState.selectPrompt(
                  selectedServer.config.name,
                  prompt.name,
                )
              }
              className={cn(
                "h-auto w-full flex-col items-stretch rounded-xl border border-border bg-card/20 p-5 text-left transition-colors hover:text-inherit",
                promptPreviewState.selectedPromptName === prompt.name
                  ? "border-border bg-accent/20"
                  : "hover:bg-accent/20",
              )}
            >
              <p className="text-[14px] font-medium text-foreground">
                {prompt.name}
              </p>
              {prompt.description ? (
                <p className={mcpDescriptionLineClass}>{prompt.description}</p>
              ) : null}
              <CodeBlock className={mcpCodeBlockClass}>
                {JSON.stringify(prompt.arguments ?? [], null, 2)}
              </CodeBlock>
            </Button>
          ))
        )}
      </div>
      <SoftPanel className={mcpPanelClass}>
        <p className={mcpEyebrowClass}>Prompt Preview</p>
        {promptPreviewState.selectedPromptName ? (
          <>
            <p className="mt-3 text-[15px] font-medium text-foreground">
              {promptPreviewState.selectedPromptName}
            </p>
            <p className="mt-4 text-[11px] text-muted-foreground/80">
              Arguments
            </p>
            <Textarea
              value={promptPreviewState.argumentsText}
              onChange={(event) =>
                promptPreviewState.setArgumentsText(event.target.value)
              }
              className="mt-2 min-h-[120px] bg-background/50 font-mono text-[11px] text-foreground/80"
            />
            <div className="mt-3 flex items-center justify-between gap-3">
              <p className="text-[12px] text-muted-foreground">
                Edit argument JSON, then refresh the preview.
              </p>
              <Button
                type="button"
                variant="outline"
                className={mcpOutlineButtonClass}
                onClick={promptPreviewState.previewCurrent}
              >
                Preview
              </Button>
            </div>
            {promptPreviewState.selectedPrompt?.arguments?.length ? (
              <CodeBlock className={cn(mcpCodeBlockClass, "max-h-40")}>
                {JSON.stringify(
                  promptPreviewState.selectedPrompt.arguments,
                  null,
                  2,
                )}
              </CodeBlock>
            ) : null}
            <CodeBlock className={cn(mcpCodeBlockClass, "max-h-[420px]")}>
              {promptPreviewState.loading
                ? "Loading preview..."
                : JSON.stringify(promptPreviewState.preview ?? {}, null, 2)}
            </CodeBlock>
          </>
        ) : (
          <p className="mt-4 text-[13px] text-muted-foreground">
            Select a prompt to preview it.
          </p>
        )}
      </SoftPanel>
    </div>
  );
}

function McpServerActivity({
  activityFilter,
  filteredActivity,
  onActivityFilterChange,
  selectedServer,
}: {
  activityFilter: ActivityFilter;
  filteredActivity: MCPActivityRecord[];
  onActivityFilterChange: (filter: ActivityFilter) => void;
  selectedServer: MCPServerRecord;
}) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {ACTIVITY_FILTER_OPTIONS.map((option) => (
          <FilterPill
            key={option.value}
            active={activityFilter === option.value}
            label={option.label}
            onClick={() => onActivityFilterChange(option.value)}
          />
        ))}
      </div>
      {filteredActivity.length === 0 ? (
        <SoftPanel className={cn(mcpPanelClass, mcpPanelTextClass)}>
          {selectedServer.activity.length === 0
            ? "No recent MCP activity."
            : "No activity matches the current filter."}
        </SoftPanel>
      ) : (
        filteredActivity.map((activityRecord) => (
          <McpActivityCard
            key={activityRecord.id}
            activityRecord={activityRecord}
          />
        ))
      )}
    </div>
  );
}

function McpActivityCard({
  activityRecord,
}: {
  activityRecord: MCPActivityRecord;
}) {
  return (
    <SoftPanel className={mcpPanelClass}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <StatusChip tone="neutral">
              {activityCategoryLabel(activityRecord)}
            </StatusChip>
            <p className="text-[14px] font-medium text-foreground">
              {formatSentenceCase(activityRecord.action)}
            </p>
          </div>
          <p className="mt-2 text-[12px] text-muted-foreground">
            {formatTimestamp(activityRecord.started_at)}
          </p>
        </div>
        <StatusChip
          uppercase
          className={cn(resultClassName(activityRecord.result))}
        >
          {activityRecord.result}
        </StatusChip>
      </div>
      <p className="mt-3 text-[13px] leading-6 text-muted-foreground">
        {activityRecord.summary}
      </p>
      <div className="mt-3 flex flex-wrap gap-4 text-[12px] text-muted-foreground">
        {activityRecord.actor_node_id ? (
          <span>Node {activityRecord.actor_node_id.slice(0, 8)}</span>
        ) : null}
        {activityRecord.tab_id ? (
          <span>Workflow {activityRecord.tab_id.slice(0, 8)}</span>
        ) : null}
        {activityRecord.tool_name ? (
          <span>Tool {activityRecord.tool_name}</span>
        ) : null}
        {activityRecord.target ? (
          <span>Target {activityRecord.target}</span>
        ) : null}
        <span>{Math.round(activityRecord.duration_ms)} ms</span>
        <span>{formatTimestampShort(activityRecord.ended_at)}</span>
      </div>
    </SoftPanel>
  );
}
