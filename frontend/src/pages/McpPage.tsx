import { Plus, RefreshCw, Search, Unplug, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { McpServerDialog } from "@/components/mcp/McpServerDialog";
import {
  FilterPill,
  ReadonlyBlock,
  SummaryCard,
} from "@/components/mcp/McpPrimitives";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  PageScaffold,
  PageTitleBar,
  SoftPanel,
} from "@/components/layout/PageScaffold";
import {
  CodeBlock,
  PageState,
  PanelCard,
  StatusChip,
  mutedLabelClass,
} from "@/components/ui/surface";
import { WorkspaceDialogField } from "@/components/WorkspaceCommandDialog";
import { cn } from "@/lib/utils";
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
} from "@/pages/mcp/lib";
import { useMcpPageState } from "@/pages/mcp/useMcpPageState";

const mcpPanelClass = "bg-card/20";
const mcpPanelTextClass = "text-[13px] text-muted-foreground";
const mcpEyebrowClass = mutedLabelClass;
const mcpOutlineButtonClass =
  "border-border bg-accent/20 text-foreground hover:bg-accent/35";
const mcpDestructiveButtonClass =
  "border-destructive/30 bg-destructive/10 text-destructive hover:bg-destructive/18";
const mcpCodeBlockClass =
  "mt-4 max-h-48 bg-background/55 p-3 text-foreground/70";

export function McpPage() {
  const {
    actions,
    activityFilter,
    capabilityTab,
    clearServerFilters,
    detailTab,
    dialog,
    error,
    filteredActivity,
    filteredServers,
    focusQuickAdd,
    isLoading,
    promptPreviewState,
    quickAdd,
    selectedServer,
    serverStatusFilter,
    servers,
    setActivityFilter,
    setCapabilityTab,
    setDetailTab,
    setSelectedServerName,
    setServerStatusFilter,
    summaryCounts,
  } = useMcpPageState();

  const quickAddPanel = (
    <SoftPanel className={cn("mt-4", mcpPanelClass)}>
      <div className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className={mcpEyebrowClass}>Quick Add</p>
            <p className="mt-2 max-w-3xl text-[13px] leading-6 text-muted-foreground">
              Paste a single-line launcher such as{" "}
              <span className="font-mono text-foreground/80">
                npx @playwright/mcp@latest
              </span>{" "}
              or a single{" "}
              <span className="font-mono text-foreground/80">
                streamable_http
              </span>{" "}
              URL. Connected servers become visible to every agent
              automatically.
            </p>
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
        ) : (
          <p className="text-[12px] text-muted-foreground">
            Package-runner launchers download and start in one path. If first
            startup is slow, the server will stay visible as Connecting until
            refresh finishes.
          </p>
        )}
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

  return (
    <PageScaffold>
      <div className="flex h-full min-h-0 flex-col px-8 py-6">
        <PageTitleBar
          title="MCP"
          actions={
            <>
              <Button
                type="button"
                variant="outline"
                className={mcpOutlineButtonClass}
                onClick={actions.refreshAll}
              >
                <RefreshCw className="mr-2 size-4" />
                Refresh
              </Button>
              <Button
                type="button"
                variant="outline"
                className={mcpOutlineButtonClass}
                onClick={focusQuickAdd}
              >
                <Plus className="mr-2 size-4" />
                Quick Add
              </Button>
              <Button type="button" onClick={dialog.openCreateDialog}>
                <Plus className="mr-2 size-4" />
                Advanced Add
              </Button>
            </>
          }
        />

        <div className="mt-6 min-h-0 flex-1 overflow-hidden">
          {isLoading ? (
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
          ) : error ? (
            <SoftPanel className="flex h-full items-center justify-center text-center text-muted-foreground">
              Failed to load MCP state.
            </SoftPanel>
          ) : servers.length === 0 ? (
            <div className="flex h-full min-h-0 flex-col">
              {quickAddPanel}
              <PageState
                icon={Unplug}
                title="No MCP servers"
                minHeightClassName="h-full"
                className="mt-4"
              />
            </div>
          ) : (
            <div className="flex h-full min-h-0 flex-col">
              <SoftPanel>
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <SummaryCard
                    label="Configured"
                    value={summaryCounts.configured}
                  />
                  <SummaryCard
                    label="Connected"
                    value={summaryCounts.connected}
                  />
                  <SummaryCard
                    label="Auth Required"
                    value={summaryCounts.authRequired}
                  />
                  <SummaryCard label="Error" value={summaryCounts.error} />
                </div>
              </SoftPanel>

              {quickAddPanel}

              <SoftPanel className="mt-4">
                <div className="flex flex-wrap gap-2">
                  {SERVER_FILTER_OPTIONS.map((option) => (
                    <FilterPill
                      key={option.value}
                      active={serverStatusFilter === option.value}
                      label={option.label}
                      onClick={() => setServerStatusFilter(option.value)}
                    />
                  ))}
                </div>
              </SoftPanel>

              <div className="mt-4 min-h-0 flex-1 overflow-hidden">
                {filteredServers.length === 0 ? (
                  <PageState
                    icon={Search}
                    title="No matching MCP servers"
                    description="Choose another status filter to see matching servers again."
                    minHeightClassName="h-full"
                    action={
                      <Button
                        type="button"
                        variant="outline"
                        className={mcpOutlineButtonClass}
                        onClick={clearServerFilters}
                      >
                        <X className="mr-2 size-4" />
                        Show All Servers
                      </Button>
                    }
                  />
                ) : (
                  <div className="grid h-full gap-5 xl:grid-cols-[360px_minmax(0,1fr)]">
                    <div className="min-h-0 overflow-y-auto pr-1 scrollbar-none">
                      <div className="space-y-3">
                        {filteredServers.map((record) => {
                          const isSelected =
                            selectedServer?.config.name === record.config.name;
                          const visibility = globalAvailabilityLabel(record);
                          return (
                            <PanelCard
                              as="div"
                              padding="sm"
                              key={record.config.name}
                              className={cn(
                                "p-4 transition-colors",
                                isSelected
                                  ? "bg-accent/20"
                                  : "bg-card/20 hover:bg-accent/20",
                              )}
                            >
                              <div className="flex items-start justify-between gap-3">
                                <Button
                                  type="button"
                                  variant="ghost"
                                  onClick={() =>
                                    setSelectedServerName(record.config.name)
                                  }
                                  className="h-auto min-w-0 flex-1 justify-start p-0 text-left hover:bg-transparent hover:text-inherit"
                                >
                                  <div className="flex flex-wrap items-center gap-2">
                                    <p className="text-[14px] font-medium text-foreground">
                                      {record.config.name}
                                    </p>
                                    {record.config.required ? (
                                      <StatusChip
                                        tone="idle"
                                        className="px-2 py-0.5"
                                      >
                                        required
                                      </StatusChip>
                                    ) : null}
                                    {visibility ? (
                                      <StatusChip
                                        tone="primary"
                                        className="px-2 py-0.5"
                                      >
                                        {visibility}
                                      </StatusChip>
                                    ) : null}
                                  </div>
                                  <div className="mt-3 grid gap-1.5 text-[12px] text-muted-foreground">
                                    <p>Transport {record.config.transport}</p>
                                    <p>
                                      Status{" "}
                                      {statusLabel(record.snapshot.status)}
                                    </p>
                                    <p>
                                      Auth{" "}
                                      {formatAuthStatus(
                                        record.snapshot.auth_status,
                                      )}
                                    </p>
                                    <p>{capabilitySummary(record)}</p>
                                    {visibility ? <p>{visibility}</p> : null}
                                  </div>
                                  {record.snapshot.last_error ? (
                                    <p className="mt-3 line-clamp-2 text-[12px] leading-5 text-destructive">
                                      {record.snapshot.last_error}
                                    </p>
                                  ) : null}
                                </Button>
                                <div className="flex shrink-0 flex-col items-end gap-1.5">
                                  <StatusChip
                                    className={cn(
                                      statusClassName(record.snapshot.status),
                                    )}
                                  >
                                    {statusLabel(record.snapshot.status)}
                                  </StatusChip>
                                  <div className="flex flex-wrap justify-end gap-1.5">
                                    <Button
                                      type="button"
                                      variant="outline"
                                      className={cn(
                                        "h-7 px-2 text-[11px]",
                                        mcpOutlineButtonClass,
                                      )}
                                      onClick={() =>
                                        actions.toggleEnabled(record)
                                      }
                                    >
                                      {record.config.enabled
                                        ? "Disable"
                                        : "Enable"}
                                    </Button>
                                    <Button
                                      type="button"
                                      variant="outline"
                                      disabled={authActionDisabled(record)}
                                      className={cn(
                                        "h-7 px-2 text-[11px]",
                                        mcpOutlineButtonClass,
                                      )}
                                      onClick={() =>
                                        record.snapshot.auth_status ===
                                        "connected"
                                          ? actions.logout(record.config.name)
                                          : actions.login(record.config.name)
                                      }
                                    >
                                      {authActionLabel(record)}
                                    </Button>
                                    <Button
                                      type="button"
                                      variant="outline"
                                      className={cn(
                                        "h-7 px-2 text-[11px]",
                                        mcpOutlineButtonClass,
                                      )}
                                      onClick={() =>
                                        dialog.openEditDialog(record)
                                      }
                                    >
                                      Edit
                                    </Button>
                                    <Button
                                      type="button"
                                      variant="outline"
                                      className={cn(
                                        "h-7 px-2 text-[11px]",
                                        mcpOutlineButtonClass,
                                      )}
                                      onClick={() =>
                                        actions.refreshServer(
                                          record.config.name,
                                        )
                                      }
                                    >
                                      Refresh
                                    </Button>
                                    <Button
                                      type="button"
                                      variant="outline"
                                      className={cn(
                                        "h-7 px-2 text-[11px]",
                                        mcpDestructiveButtonClass,
                                      )}
                                      onClick={() =>
                                        actions.deleteServer(record.config.name)
                                      }
                                    >
                                      Remove
                                    </Button>
                                  </div>
                                </div>
                              </div>
                            </PanelCard>
                          );
                        })}
                      </div>
                    </div>

                    <div className="min-h-0 overflow-hidden">
                      {selectedServer ? (
                        <SoftPanel className="flex h-full min-h-0 flex-col">
                          <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border pb-4">
                            <div>
                              <div className="flex flex-wrap items-center gap-3">
                                <h2 className="text-[18px] font-medium text-foreground">
                                  {selectedServer.config.name}
                                </h2>
                                <StatusChip
                                  uppercase
                                  className={cn(
                                    statusClassName(
                                      selectedServer.snapshot.status,
                                    ),
                                  )}
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
                                {formatAuthStatus(
                                  selectedServer.snapshot.auth_status,
                                )}
                              </p>
                              {selectedServer.snapshot.last_error ? (
                                <p className="mt-2 max-w-3xl text-[13px] leading-6 text-destructive">
                                  {selectedServer.snapshot.last_error}
                                </p>
                              ) : null}
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                              <Button
                                type="button"
                                variant="outline"
                                className={mcpOutlineButtonClass}
                                onClick={() =>
                                  actions.toggleEnabled(selectedServer)
                                }
                              >
                                {selectedServer.config.enabled
                                  ? "Disable"
                                  : "Enable"}
                              </Button>
                              <Button
                                type="button"
                                variant="outline"
                                disabled={authActionDisabled(selectedServer)}
                                className={mcpOutlineButtonClass}
                                onClick={() =>
                                  selectedServer.snapshot.auth_status ===
                                  "connected"
                                    ? actions.logout(selectedServer.config.name)
                                    : actions.login(selectedServer.config.name)
                                }
                              >
                                {authActionLabel(selectedServer)}
                              </Button>
                              <Button
                                type="button"
                                variant="outline"
                                className={mcpOutlineButtonClass}
                                onClick={() =>
                                  dialog.openEditDialog(selectedServer)
                                }
                              >
                                Edit
                              </Button>
                              <Button
                                type="button"
                                variant="outline"
                                className={mcpOutlineButtonClass}
                                onClick={() =>
                                  actions.refreshServer(
                                    selectedServer.config.name,
                                  )
                                }
                              >
                                Refresh
                              </Button>
                              <Button
                                type="button"
                                variant="outline"
                                className={mcpDestructiveButtonClass}
                                onClick={() =>
                                  actions.deleteServer(
                                    selectedServer.config.name,
                                  )
                                }
                              >
                                Remove
                              </Button>
                            </div>
                          </div>

                          <div className="mt-4 flex flex-wrap gap-4 border-b border-border">
                            {DETAIL_TABS.map((tab) => (
                              <FilterPill
                                key={tab}
                                active={detailTab === tab}
                                label={formatSentenceCase(tab)}
                                onClick={() => setDetailTab(tab)}
                                variant="tab"
                              />
                            ))}
                          </div>

                          <div className="mt-5 min-h-0 flex-1 overflow-y-auto pr-1 scrollbar-none">
                            {detailTab === "overview" ? (
                              <div className="grid gap-4 xl:grid-cols-2">
                                <SoftPanel className={mcpPanelClass}>
                                  <p className={mcpEyebrowClass}>Status</p>
                                  <p className="mt-3 text-[22px] font-medium text-foreground">
                                    {statusLabel(
                                      selectedServer.snapshot.status,
                                    )}
                                  </p>
                                  <p className="mt-2 text-[13px] text-muted-foreground">
                                    Auth{" "}
                                    {formatAuthStatus(
                                      selectedServer.snapshot.auth_status,
                                    )}
                                  </p>
                                </SoftPanel>

                                <SoftPanel className={mcpPanelClass}>
                                  <p className={mcpEyebrowClass}>Visibility</p>
                                  <p className="mt-3 text-[22px] font-medium text-foreground">
                                    {globalAvailabilityLabel(selectedServer) ??
                                      "Pending"}
                                  </p>
                                  <p className="mt-2 text-[13px] text-muted-foreground">
                                    Connected servers become available to all
                                    agents without per-tab setup.
                                  </p>
                                </SoftPanel>

                                <SoftPanel className={mcpPanelClass}>
                                  <p className={mcpEyebrowClass}>
                                    Last Refresh
                                  </p>
                                  <p className="mt-3 text-[15px] font-medium text-foreground">
                                    {formatTimestamp(
                                      selectedServer.snapshot.last_refresh_at,
                                    )}
                                  </p>
                                  <p className="mt-2 text-[13px] text-muted-foreground">
                                    Result{" "}
                                    {formatSentenceCase(
                                      selectedServer.snapshot
                                        .last_refresh_result,
                                    )}
                                  </p>
                                </SoftPanel>

                                <SoftPanel className={mcpPanelClass}>
                                  <p className={mcpEyebrowClass}>Timeouts</p>
                                  <p className="mt-3 text-[15px] font-medium text-foreground">
                                    Startup{" "}
                                    {selectedServer.config.startup_timeout_sec}s
                                  </p>
                                  <p className="mt-2 text-[13px] text-muted-foreground">
                                    Tool{" "}
                                    {selectedServer.config.tool_timeout_sec}s
                                  </p>
                                </SoftPanel>

                                <SoftPanel className={mcpPanelClass}>
                                  <p className={mcpEyebrowClass}>
                                    Tool Filters
                                  </p>
                                  <p className="mt-3 text-[15px] font-medium text-foreground">
                                    {toolFilterSummary(selectedServer)}
                                  </p>
                                  <p className="mt-2 text-[13px] text-muted-foreground">
                                    Enabled{" "}
                                    {selectedServer.config.enabled_tools.length}
                                    {" · "}Disabled{" "}
                                    {
                                      selectedServer.config.disabled_tools
                                        .length
                                    }
                                  </p>
                                </SoftPanel>

                                <SoftPanel
                                  className={cn("xl:col-span-2", mcpPanelClass)}
                                >
                                  <p className={mcpEyebrowClass}>
                                    Capability Summary
                                  </p>
                                  <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                                    {Object.entries(
                                      selectedServer.snapshot.capability_counts,
                                    ).map(([key, value]) => (
                                      <PanelCard
                                        as="div"
                                        padding="sm"
                                        key={key}
                                        className="bg-card/20"
                                      >
                                        <p className={mcpEyebrowClass}>
                                          {key.replaceAll("_", " ")}
                                        </p>
                                        <p className="mt-2 text-xl font-medium text-foreground">
                                          {value}
                                        </p>
                                      </PanelCard>
                                    ))}
                                  </div>
                                </SoftPanel>

                                {selectedServer.config.launcher ? (
                                  <SoftPanel
                                    className={cn(
                                      "xl:col-span-2",
                                      mcpPanelClass,
                                    )}
                                  >
                                    <div className="grid gap-4 xl:grid-cols-2">
                                      <ReadonlyBlock
                                        label="Original Launcher"
                                        value={readonlyText(
                                          selectedServer.config.launcher,
                                        )}
                                        mono
                                      />
                                      <ReadonlyBlock
                                        label="Parsed Result"
                                        value={parsedLauncherSummary(
                                          selectedServer,
                                        )}
                                        mono
                                      />
                                    </div>
                                  </SoftPanel>
                                ) : null}

                                {selectedServer.config.transport === "stdio" ? (
                                  <SoftPanel
                                    className={cn(
                                      "xl:col-span-2",
                                      mcpPanelClass,
                                    )}
                                  >
                                    <div className="grid gap-4 xl:grid-cols-2">
                                      <ReadonlyBlock
                                        label="Command"
                                        value={readonlyText(
                                          selectedServer.config.command,
                                        )}
                                        mono
                                      />
                                      <ReadonlyBlock
                                        label="Cwd"
                                        value={readonlyText(
                                          selectedServer.config.cwd,
                                        )}
                                        mono
                                      />
                                      <ReadonlyBlock
                                        label="Args"
                                        value={readonlyList(
                                          selectedServer.config.args,
                                        )}
                                        mono
                                      />
                                      <ReadonlyBlock
                                        label="Env Vars"
                                        value={readonlyList(
                                          selectedServer.config.env_vars,
                                        )}
                                        mono
                                      />
                                    </div>
                                  </SoftPanel>
                                ) : (
                                  <SoftPanel
                                    className={cn(
                                      "xl:col-span-2",
                                      mcpPanelClass,
                                    )}
                                  >
                                    <div className="grid gap-4 xl:grid-cols-2">
                                      <ReadonlyBlock
                                        label="URL"
                                        value={readonlyText(
                                          selectedServer.config.url,
                                        )}
                                        mono
                                      />
                                      <ReadonlyBlock
                                        label="OAuth Resource"
                                        value={readonlyText(
                                          selectedServer.config.oauth_resource,
                                        )}
                                        mono
                                      />
                                      <ReadonlyBlock
                                        label="Bearer Token Env Var"
                                        value={readonlyText(
                                          selectedServer.config
                                            .bearer_token_env_var,
                                        )}
                                        mono
                                      />
                                      <ReadonlyBlock
                                        label="Scopes"
                                        value={readonlyList(
                                          selectedServer.config.scopes,
                                        )}
                                        mono
                                      />
                                      <ReadonlyBlock
                                        label="HTTP Headers"
                                        value={readonlyMapKeys(
                                          selectedServer.config.http_headers,
                                        )}
                                        mono
                                      />
                                      <ReadonlyBlock
                                        label="Env HTTP Headers"
                                        value={readonlyList(
                                          selectedServer.config
                                            .env_http_headers,
                                        )}
                                        mono
                                      />
                                    </div>
                                    <PanelCard
                                      as="div"
                                      padding="sm"
                                      className="mt-4 bg-card/20"
                                    >
                                      <p className={mcpEyebrowClass}>
                                        Recent Auth Result
                                      </p>
                                      <p className="mt-2 text-[14px] font-medium text-foreground">
                                        {renderValueOrFallback(
                                          selectedServer.snapshot
                                            .last_auth_result ?? "",
                                          "No login action yet",
                                        )}
                                      </p>
                                      <p className="mt-2 text-[13px] text-muted-foreground">
                                        Current auth status{" "}
                                        {formatAuthStatus(
                                          selectedServer.snapshot.auth_status,
                                        )}
                                      </p>
                                    </PanelCard>
                                  </SoftPanel>
                                )}
                              </div>
                            ) : null}

                            {detailTab === "capabilities" ? (
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
                                      onClick={() => setCapabilityTab(tab)}
                                      variant="tab"
                                    />
                                  ))}
                                </div>

                                {capabilityTab === "tools" ? (
                                  <div className="space-y-3">
                                    {selectedServer.snapshot.tools.length ===
                                    0 ? (
                                      <SoftPanel
                                        className={cn(
                                          mcpPanelClass,
                                          mcpPanelTextClass,
                                        )}
                                      >
                                        No tools discovered.
                                      </SoftPanel>
                                    ) : (
                                      selectedServer.snapshot.tools.map(
                                        (tool) => (
                                          <SoftPanel
                                            key={tool.fully_qualified_id}
                                            className={mcpPanelClass}
                                          >
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
                                                  <StatusChip tone="primary">
                                                    readOnly
                                                  </StatusChip>
                                                ) : null}
                                                {tool.destructive_hint ? (
                                                  <StatusChip tone="danger">
                                                    destructive
                                                  </StatusChip>
                                                ) : null}
                                                {tool.open_world_hint ? (
                                                  <StatusChip tone="idle">
                                                    openWorld
                                                  </StatusChip>
                                                ) : null}
                                              </div>
                                            </div>
                                            {tool.description ? (
                                              <p className="mt-3 text-[13px] leading-6 text-muted-foreground">
                                                {tool.description}
                                              </p>
                                            ) : null}
                                            <CodeBlock
                                              className={mcpCodeBlockClass}
                                            >
                                              {JSON.stringify(
                                                tool.parameters ?? {},
                                                null,
                                                2,
                                              )}
                                            </CodeBlock>
                                          </SoftPanel>
                                        ),
                                      )
                                    )}
                                  </div>
                                ) : null}

                                {capabilityTab === "resources" ? (
                                  <div className="space-y-3">
                                    {selectedServer.snapshot.resources
                                      .length === 0 ? (
                                      <SoftPanel
                                        className={cn(
                                          mcpPanelClass,
                                          mcpPanelTextClass,
                                        )}
                                      >
                                        No resources discovered.
                                      </SoftPanel>
                                    ) : (
                                      selectedServer.snapshot.resources.map(
                                        (resource) => (
                                          <SoftPanel
                                            key={resource.uri}
                                            className={mcpPanelClass}
                                          >
                                            <p className="text-[14px] font-medium text-foreground">
                                              {resource.name}
                                            </p>
                                            <p className="mt-1 font-mono text-[12px] text-muted-foreground">
                                              {resource.uri}
                                            </p>
                                            <p className="mt-3 text-[13px] text-foreground/70">
                                              {resource.mime_type ??
                                                "Unknown MIME"}
                                            </p>
                                            {resource.description ? (
                                              <p className="mt-2 text-[13px] leading-6 text-muted-foreground">
                                                {resource.description}
                                              </p>
                                            ) : null}
                                          </SoftPanel>
                                        ),
                                      )
                                    )}
                                  </div>
                                ) : null}

                                {capabilityTab === "resource_templates" ? (
                                  <div className="space-y-3">
                                    {selectedServer.snapshot.resource_templates
                                      .length === 0 ? (
                                      <SoftPanel
                                        className={cn(
                                          mcpPanelClass,
                                          mcpPanelTextClass,
                                        )}
                                      >
                                        No resource templates discovered.
                                      </SoftPanel>
                                    ) : (
                                      selectedServer.snapshot.resource_templates.map(
                                        (template) => (
                                          <SoftPanel
                                            key={template.uri_template}
                                            className={mcpPanelClass}
                                          >
                                            <p className="text-[14px] font-medium text-foreground">
                                              {template.name}
                                            </p>
                                            <p className="mt-1 font-mono text-[12px] text-muted-foreground">
                                              {template.uri_template}
                                            </p>
                                            {template.description ? (
                                              <p className="mt-3 text-[13px] leading-6 text-muted-foreground">
                                                {template.description}
                                              </p>
                                            ) : null}
                                          </SoftPanel>
                                        ),
                                      )
                                    )}
                                  </div>
                                ) : null}

                                {capabilityTab === "prompts" ? (
                                  <div className="grid gap-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
                                    <div className="space-y-3">
                                      {selectedServer.snapshot.prompts
                                        .length === 0 ? (
                                        <SoftPanel
                                          className={cn(
                                            mcpPanelClass,
                                            mcpPanelTextClass,
                                          )}
                                        >
                                          No prompts discovered.
                                        </SoftPanel>
                                      ) : (
                                        selectedServer.snapshot.prompts.map(
                                          (prompt) => (
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
                                                promptPreviewState.selectedPromptName ===
                                                  prompt.name
                                                  ? "border-border bg-accent/20"
                                                  : "hover:bg-accent/20",
                                              )}
                                            >
                                              <p className="text-[14px] font-medium text-foreground">
                                                {prompt.name}
                                              </p>
                                              {prompt.description ? (
                                                <p className="mt-2 text-[13px] leading-6 text-muted-foreground">
                                                  {prompt.description}
                                                </p>
                                              ) : null}
                                              <CodeBlock
                                                className={mcpCodeBlockClass}
                                              >
                                                {JSON.stringify(
                                                  prompt.arguments ?? [],
                                                  null,
                                                  2,
                                                )}
                                              </CodeBlock>
                                            </Button>
                                          ),
                                        )
                                      )}
                                    </div>
                                    <SoftPanel className={mcpPanelClass}>
                                      <p className={mcpEyebrowClass}>
                                        Prompt Preview
                                      </p>
                                      {promptPreviewState.selectedPromptName ? (
                                        <>
                                          <p className="mt-3 text-[15px] font-medium text-foreground">
                                            {
                                              promptPreviewState.selectedPromptName
                                            }
                                          </p>
                                          <p className="mt-4 text-[11px] text-muted-foreground/80">
                                            Arguments
                                          </p>
                                          <Textarea
                                            value={
                                              promptPreviewState.argumentsText
                                            }
                                            onChange={(event) =>
                                              promptPreviewState.setArgumentsText(
                                                event.target.value,
                                              )
                                            }
                                            className="mt-2 min-h-[120px] bg-background/50 font-mono text-[11px] text-foreground/80"
                                          />
                                          <div className="mt-3 flex items-center justify-between gap-3">
                                            <p className="text-[12px] text-muted-foreground">
                                              Edit argument JSON, then refresh
                                              the preview.
                                            </p>
                                            <Button
                                              type="button"
                                              variant="outline"
                                              className={mcpOutlineButtonClass}
                                              onClick={
                                                promptPreviewState.previewCurrent
                                              }
                                            >
                                              Preview
                                            </Button>
                                          </div>
                                          {promptPreviewState.selectedPrompt
                                            ?.arguments?.length ? (
                                            <CodeBlock
                                              className={cn(
                                                mcpCodeBlockClass,
                                                "max-h-40",
                                              )}
                                            >
                                              {JSON.stringify(
                                                promptPreviewState
                                                  .selectedPrompt.arguments,
                                                null,
                                                2,
                                              )}
                                            </CodeBlock>
                                          ) : null}
                                          <CodeBlock
                                            className={cn(
                                              mcpCodeBlockClass,
                                              "max-h-[420px]",
                                            )}
                                          >
                                            {promptPreviewState.loading
                                              ? "Loading preview..."
                                              : JSON.stringify(
                                                  promptPreviewState.preview ??
                                                    {},
                                                  null,
                                                  2,
                                                )}
                                          </CodeBlock>
                                        </>
                                      ) : (
                                        <p className="mt-4 text-[13px] leading-6 text-muted-foreground">
                                          Select a prompt to preview its
                                          parameter structure and template
                                          result.
                                        </p>
                                      )}
                                    </SoftPanel>
                                  </div>
                                ) : null}
                              </div>
                            ) : null}

                            {detailTab === "activity" ? (
                              <div className="space-y-4">
                                <div className="flex flex-wrap gap-2">
                                  {ACTIVITY_FILTER_OPTIONS.map((option) => (
                                    <FilterPill
                                      key={option.value}
                                      active={activityFilter === option.value}
                                      label={option.label}
                                      onClick={() =>
                                        setActivityFilter(option.value)
                                      }
                                    />
                                  ))}
                                </div>

                                {filteredActivity.length === 0 ? (
                                  <SoftPanel
                                    className={cn(
                                      mcpPanelClass,
                                      mcpPanelTextClass,
                                    )}
                                  >
                                    {selectedServer.activity.length === 0
                                      ? "No recent MCP activity."
                                      : "No activity matches the current filter."}
                                  </SoftPanel>
                                ) : (
                                  filteredActivity.map((entry) => (
                                    <SoftPanel
                                      key={entry.id}
                                      className={mcpPanelClass}
                                    >
                                      <div className="flex flex-wrap items-start justify-between gap-3">
                                        <div>
                                          <div className="flex flex-wrap items-center gap-2">
                                            <StatusChip tone="neutral">
                                              {activityCategoryLabel(entry)}
                                            </StatusChip>
                                            <p className="text-[14px] font-medium text-foreground">
                                              {formatSentenceCase(entry.action)}
                                            </p>
                                          </div>
                                          <p className="mt-2 text-[12px] text-muted-foreground">
                                            {formatTimestamp(entry.started_at)}
                                          </p>
                                        </div>
                                        <StatusChip
                                          uppercase
                                          className={cn(
                                            resultClassName(entry.result),
                                          )}
                                        >
                                          {entry.result}
                                        </StatusChip>
                                      </div>
                                      <p className="mt-3 text-[13px] leading-6 text-muted-foreground">
                                        {entry.summary}
                                      </p>
                                      <div className="mt-3 flex flex-wrap gap-4 text-[12px] text-muted-foreground">
                                        {entry.actor_node_id ? (
                                          <span>
                                            Node{" "}
                                            {entry.actor_node_id.slice(0, 8)}
                                          </span>
                                        ) : null}
                                        {entry.tab_id ? (
                                          <span>
                                            Workflow {entry.tab_id.slice(0, 8)}
                                          </span>
                                        ) : null}
                                        {entry.tool_name ? (
                                          <span>Tool {entry.tool_name}</span>
                                        ) : null}
                                        {entry.target ? (
                                          <span>Target {entry.target}</span>
                                        ) : null}
                                        <span>
                                          {Math.round(entry.duration_ms)} ms
                                        </span>
                                        <span>
                                          {formatTimestampShort(entry.ended_at)}
                                        </span>
                                      </div>
                                    </SoftPanel>
                                  ))
                                )}
                              </div>
                            ) : null}
                          </div>
                        </SoftPanel>
                      ) : (
                        <PageState
                          title="Select an MCP server"
                          description="Choose a server from the list to inspect details."
                          minHeightClassName="h-full"
                        />
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      <McpServerDialog
        draft={dialog.draft}
        onChange={dialog.setDraft}
        open={dialog.open}
        pending={dialog.pending}
        title={
          dialog.editingServerName
            ? "Edit MCP Server"
            : "Advanced Add MCP Server"
        }
        onOpenChange={dialog.setOpen}
        onSubmit={dialog.saveServer}
      />
    </PageScaffold>
  );
}
