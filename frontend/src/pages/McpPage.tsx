import { Plus, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { McpServerDialog } from "@/components/mcp/McpServerDialog";
import { PageScaffold, PageTitleBar } from "@/components/layout/PageScaffold";
import { useMcpPageState } from "@/pages/mcp/useMcpPageState";
import {
  McpEmptyState,
  McpLoadErrorState,
  McpLoadingState,
  McpServerDashboard,
  mcpOutlineButtonClass,
} from "@/pages/mcp/McpPageSections";

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
                onClick={() => void actions.refreshAll()}
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
            <McpLoadingState />
          ) : error ? (
            <McpLoadErrorState />
          ) : servers.length === 0 ? (
            <McpEmptyState quickAdd={quickAdd} dialog={dialog} />
          ) : (
            <McpServerDashboard
              actions={actions}
              activityFilter={activityFilter}
              capabilityTab={capabilityTab}
              clearServerFilters={clearServerFilters}
              detailTab={detailTab}
              dialog={dialog}
              filteredActivity={filteredActivity}
              filteredServers={filteredServers}
              onActivityFilterChange={setActivityFilter}
              onCapabilityTabChange={setCapabilityTab}
              onDetailTabChange={setDetailTab}
              onFocusQuickAdd={focusQuickAdd}
              onSelectServer={setSelectedServerName}
              onServerStatusFilterChange={setServerStatusFilter}
              promptPreviewState={promptPreviewState}
              quickAdd={quickAdd}
              selectedServer={selectedServer}
              serverStatusFilter={serverStatusFilter}
              summaryCounts={summaryCounts}
            />
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
        onSubmit={() => void dialog.saveServer()}
      />
    </PageScaffold>
  );
}
