import { Plus, RefreshCw } from "lucide-react";
import { PageScaffold, PageTitleBar } from "@/components/layout/PageScaffold";
import { PageLoadingState } from "@/components/layout/PageLoadingState";
import { Button } from "@/components/ui/button";
import { useOptionalAgentUI } from "@/context/AgentContext";
import { cn } from "@/lib/utils";
import { RoleDeleteDialog } from "@/pages/roles/RoleDeleteDialog";
import { RoleDetailPanel } from "@/pages/roles/RoleDetailPanel";
import { RoleList } from "@/pages/roles/RoleList";
import { useRolesPageState } from "@/pages/roles/useRolesPageState";
import { getRoutePathForPage, pushBrowserPath } from "@/lib/urlNavigation";

export function RolesPage() {
  const agentUI = useOptionalAgentUI();
  const {
    activeRole,
    availableActiveProviderModelOptions,
    canSave,
    configurableTools,
    draft,
    getToolState,
    isPanelOpen,
    isReadOnly,
    loading,
    panelBadgeLabel,
    panelMode,
    panelTitle,
    providers,
    providersById,
    refreshRoles,
    roleToDelete,
    roles,
    saving,
    shouldLockIdentityFields,
    actions,
  } = useRolesPageState();
  const roleActions = {
    ...actions,
    openProvidersPage: () => {
      agentUI?.navigateToPage("providers");
      if (!agentUI) {
        pushBrowserPath(getRoutePathForPage("providers"));
      }
    },
  };

  if (loading && !isPanelOpen) {
    return <PageLoadingState label="Loading roles..." />;
  }

  return (
    <PageScaffold className="px-4 pt-6 sm:px-5">
      <div className="flex h-full min-h-0 flex-col">
        <PageTitleBar
          title="Roles"
          actions={
            <>
              <Button
                type="button"
                variant="outline"
                size="icon-sm"
                onClick={() => void refreshRoles()}
                disabled={loading}
                className="bg-accent/20 text-muted-foreground hover:bg-accent/45 hover:text-foreground"
              >
                <RefreshCw
                  className={cn("size-4", loading && "animate-spin")}
                />
              </Button>
              {isPanelOpen ? null : (
                <Button type="button" size="sm" onClick={actions.openCreate}>
                  <Plus className="size-4" />
                  New Role
                </Button>
              )}
            </>
          }
        />
        <div className="mt-6 min-h-0 flex-1">
          {isPanelOpen ? (
            <RoleDetailPanel
              activeRole={activeRole}
              availableProviderModels={availableActiveProviderModelOptions}
              canSave={canSave}
              configurableTools={configurableTools}
              draft={draft}
              getToolState={getToolState}
              isReadOnly={isReadOnly}
              onClosePanel={actions.closePanel}
              onEditRole={actions.openEdit}
              onModelModeChange={actions.handleModelModeChange}
              onModelParamsModeChange={actions.handleModelParamsModeChange}
              onOpenProvidersPage={roleActions.openProvidersPage}
              onProviderChange={actions.handleProviderChange}
              onSaveRole={actions.handleSave}
              onToolStateCycle={actions.cycleRoleToolState}
              onUpdateDraft={actions.updateDraft}
              panelBadgeLabel={panelBadgeLabel}
              panelMode={panelMode}
              panelTitle={panelTitle}
              providers={providers}
              saving={saving}
              shouldLockIdentityFields={shouldLockIdentityFields}
            />
          ) : (
            <RoleList
              activeRole={activeRole}
              onCreateRole={actions.openCreate}
              onDeleteRole={actions.requestDeleteRole}
              onEditRole={actions.openEdit}
              onViewRole={actions.openView}
              providersById={providersById}
              roles={roles}
            />
          )}
        </div>
      </div>
      <RoleDeleteDialog
        roleToDelete={roleToDelete}
        onConfirmDelete={actions.handleDelete}
        onOpenChange={(open) => {
          if (!open) {
            actions.clearRoleToDelete();
          }
        }}
      />
    </PageScaffold>
  );
}
