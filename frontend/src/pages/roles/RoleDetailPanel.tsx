import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PanelCard, StatusChip } from "@/components/ui/surface";
import type { ToolInfo } from "@/lib/api/meta";
import type { RoleDraft, RolePanelMode, ToolState } from "@/pages/roles/lib";
import { RoleIdentitySection } from "@/pages/roles/RoleIdentitySection";
import { RoleModelParametersSection } from "@/pages/roles/RoleModelParametersSection";
import { RoleModelSection } from "@/pages/roles/RoleModelSection";
import { RoleToolsSection } from "@/pages/roles/RoleToolsSection";
import type { Provider, ProviderModelCatalogEntry, Role } from "@/types";

interface RoleDetailPanelProps {
  activeRole: Role | null;
  availableProviderModels: ProviderModelCatalogEntry[];
  canSave: boolean;
  configurableTools: ToolInfo[];
  draft: RoleDraft;
  getToolState: (toolName: string) => ToolState;
  isReadOnly: boolean;
  onClosePanel: () => void;
  onEditRole: (role: Role) => void;
  onModelModeChange: (enabled: boolean) => void;
  onModelParamsModeChange: (enabled: boolean) => void;
  onOpenProvidersPage: () => void;
  onProviderChange: (providerId: string) => void;
  onSaveRole: () => void;
  onToolStateCycle: (toolName: string) => void;
  onUpdateDraft: (updater: (current: RoleDraft) => RoleDraft) => void;
  panelBadgeLabel: string;
  panelMode: RolePanelMode | null;
  panelTitle: string;
  providers: Provider[];
  saving: boolean;
  shouldLockIdentityFields: boolean;
}

export function RoleDetailPanel({
  activeRole,
  availableProviderModels,
  canSave,
  configurableTools,
  draft,
  getToolState,
  isReadOnly,
  onClosePanel,
  onEditRole,
  onModelModeChange,
  onModelParamsModeChange,
  onOpenProvidersPage,
  onProviderChange,
  onSaveRole,
  onToolStateCycle,
  onUpdateDraft,
  panelBadgeLabel,
  panelMode,
  panelTitle,
  providers,
  saving,
  shouldLockIdentityFields,
}: RoleDetailPanelProps) {
  return (
    <div className="h-full min-h-0 overflow-y-auto pr-2 scrollbar-none">
      <div className="mx-auto max-w-3xl pb-10">
        <RoleDetailHeader
          badgeLabel={panelBadgeLabel}
          onClosePanel={onClosePanel}
          title={panelTitle}
        />

        <RoleIdentitySection
          activeRole={activeRole}
          draft={draft}
          isReadOnly={isReadOnly}
          onUpdateDraft={onUpdateDraft}
          shouldLockIdentityFields={shouldLockIdentityFields}
        />

        <RoleModelSection
          availableProviderModels={availableProviderModels}
          draft={draft}
          isReadOnly={isReadOnly}
          onModelModeChange={onModelModeChange}
          onOpenProvidersPage={onOpenProvidersPage}
          onProviderChange={onProviderChange}
          onUpdateDraft={onUpdateDraft}
          providers={providers}
        />

        <RoleModelParametersSection
          draft={draft}
          isReadOnly={isReadOnly}
          onModelParamsModeChange={onModelParamsModeChange}
          onUpdateDraft={onUpdateDraft}
        />

        <RoleToolsSection
          configurableTools={configurableTools}
          getToolState={getToolState}
          isReadOnly={isReadOnly}
          onToolStateCycle={onToolStateCycle}
          shouldLockIdentityFields={shouldLockIdentityFields}
        />

        <RoleDetailFooter
          activeRole={activeRole}
          canSave={canSave}
          isReadOnly={isReadOnly}
          onClosePanel={onClosePanel}
          onEditRole={onEditRole}
          onSaveRole={onSaveRole}
          panelMode={panelMode}
          saving={saving}
        />
      </div>
    </div>
  );
}

interface RoleDetailHeaderProps {
  badgeLabel: string;
  onClosePanel: () => void;
  title: string;
}

function RoleDetailHeader({
  badgeLabel,
  onClosePanel,
  title,
}: RoleDetailHeaderProps) {
  return (
    <PanelCard
      as="div"
      padding="sm"
      className="mb-8 flex items-center justify-between px-5 py-4"
    >
      <div className="flex items-center gap-3">
        <StatusChip tone="neutral" className="py-0.5 text-[11px]">
          {badgeLabel}
        </StatusChip>
        <h2 className="text-[15px] font-medium text-foreground">{title}</h2>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        onClick={onClosePanel}
        className="text-muted-foreground hover:bg-accent/45 hover:text-foreground"
      >
        <X className="size-3.5" />
      </Button>
    </PanelCard>
  );
}

interface RoleDetailFooterProps {
  activeRole: Role | null;
  canSave: boolean;
  isReadOnly: boolean;
  onClosePanel: () => void;
  onEditRole: (role: Role) => void;
  onSaveRole: () => void;
  panelMode: RolePanelMode | null;
  saving: boolean;
}

function RoleDetailFooter({
  activeRole,
  canSave,
  isReadOnly,
  onClosePanel,
  onEditRole,
  onSaveRole,
  panelMode,
  saving,
}: RoleDetailFooterProps) {
  return (
    <div className="flex items-center justify-end gap-3 border-t border-border pt-6">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={onClosePanel}
        disabled={saving}
      >
        Cancel
      </Button>
      {!isReadOnly ? (
        <Button
          type="button"
          size="sm"
          onClick={() => void onSaveRole()}
          disabled={!canSave}
        >
          {saving
            ? "Saving..."
            : panelMode === "create"
              ? "Create Role"
              : "Save Changes"}
        </Button>
      ) : null}
      {isReadOnly && activeRole && !activeRole.is_builtin ? (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => onEditRole(activeRole)}
        >
          Edit Role
        </Button>
      ) : null}
    </div>
  );
}
