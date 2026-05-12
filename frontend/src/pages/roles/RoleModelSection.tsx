import {
  FormInput,
  formReadOnlyClass,
  formSelectTriggerClass,
} from "@/components/form/FormControls";
import { FormSection } from "@/components/layout/PageScaffold";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { PanelCard, StatusChip } from "@/components/surface";
import { cn } from "@/lib/utils";
import type { RoleDraft } from "@/pages/roles/lib";
import { RoleModeSwitch } from "@/pages/roles/RoleModeSwitch";
import type { Provider, ProviderModelCatalogEntry } from "@/types";

interface RoleModelSectionProps {
  availableProviderModels: ProviderModelCatalogEntry[];
  draft: RoleDraft;
  isReadOnly: boolean;
  onModelModeChange: (enabled: boolean) => void;
  onOpenProvidersPage: () => void;
  onProviderChange: (providerId: string) => void;
  onUpdateDraft: (updater: (current: RoleDraft) => RoleDraft) => void;
  providers: Provider[];
}

export function RoleModelSection({
  availableProviderModels,
  draft,
  isReadOnly,
  onModelModeChange,
  onOpenProvidersPage,
  onProviderChange,
  onUpdateDraft,
  providers,
}: RoleModelSectionProps) {
  return (
    <FormSection
      title="Model Configuration"
      className="mb-10"
      separated
      contentClassName="border-transparent bg-transparent p-0 shadow-none"
    >
      <div className="space-y-6">
        <RoleModeSwitch
          disabled={isReadOnly}
          isDefaultSelected={draft.model === null}
          onSelectDefault={() => onModelModeChange(false)}
          onSelectOverride={() => onModelModeChange(true)}
          overrideLabel="Set Role Override"
        />

        {draft.model ? (
          <PanelCard>
            <div className="grid gap-6 md:grid-cols-2">
              <div className="space-y-2">
                <label className="text-[13px] font-medium text-foreground/80">
                  Provider
                </label>
                <Select
                  value={draft.model.provider_id || undefined}
                  onValueChange={onProviderChange}
                  disabled={isReadOnly}
                >
                  <SelectTrigger className={formSelectTriggerClass}>
                    <SelectValue placeholder="Select a provider" />
                  </SelectTrigger>
                  <SelectContent className="rounded-xl border-border bg-popover">
                    {providers.map((provider) => (
                      <SelectItem
                        key={provider.id}
                        value={provider.id}
                        className="text-[13px]"
                      >
                        {provider.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <RoleProviderModelPicker
                availableProviderModels={availableProviderModels}
                draft={draft}
                isReadOnly={isReadOnly}
                onOpenProvidersPage={onOpenProvidersPage}
                onUpdateDraft={onUpdateDraft}
              />

              <div className="space-y-2 md:col-span-2">
                <label className="text-[13px] font-medium text-foreground/80">
                  Model ID
                </label>
                <FormInput
                  value={draft.model.model}
                  onChange={(event) =>
                    onUpdateDraft((current) => ({
                      ...current,
                      model: current.model
                        ? {
                            ...current.model,
                            model: event.target.value,
                          }
                        : null,
                    }))
                  }
                  readOnly={isReadOnly}
                  placeholder="e.g., gpt-4o-mini"
                  className={cn(isReadOnly ? formReadOnlyClass : "")}
                  mono
                />
                <p className="text-[11px] text-muted-foreground">
                  Catalog or manual ID
                </p>
              </div>
            </div>
          </PanelCard>
        ) : (
          <StatusChip tone="muted">Settings default</StatusChip>
        )}
      </div>
    </FormSection>
  );
}

interface RoleProviderModelPickerProps {
  availableProviderModels: ProviderModelCatalogEntry[];
  draft: RoleDraft;
  isReadOnly: boolean;
  onOpenProvidersPage: () => void;
  onUpdateDraft: (updater: (current: RoleDraft) => RoleDraft) => void;
}

function RoleProviderModelPicker({
  availableProviderModels,
  draft,
  isReadOnly,
  onOpenProvidersPage,
  onUpdateDraft,
}: RoleProviderModelPickerProps) {
  const selectedCatalogModel = availableProviderModels.some(
    (option) => option.model === draft.model?.model,
  )
    ? draft.model?.model
    : undefined;

  return (
    <div className="space-y-2">
      <label className="text-[13px] font-medium text-foreground/80">
        Provider Models
      </label>
      <Select
        value={selectedCatalogModel}
        onValueChange={(value) =>
          onUpdateDraft((current) => ({
            ...current,
            model: current.model ? { ...current.model, model: value } : null,
          }))
        }
        disabled={
          isReadOnly ||
          !draft.model?.provider_id ||
          availableProviderModels.length === 0
        }
      >
        <SelectTrigger className={formSelectTriggerClass}>
          <SelectValue
            placeholder={
              availableProviderModels.length > 0
                ? "Pick a provider model"
                : "No saved provider models"
            }
          />
        </SelectTrigger>
        <SelectContent className="max-h-[300px] rounded-xl border-border bg-popover">
          {availableProviderModels.map((option) => (
            <SelectItem
              key={option.model}
              value={option.model}
              className="text-[13px]"
            >
              {option.model}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {availableProviderModels.length === 0 ? (
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
          <span>No saved provider models.</span>
          <Button
            type="button"
            variant="outline"
            size="xs"
            onClick={onOpenProvidersPage}
          >
            Open Providers
          </Button>
        </div>
      ) : null}
    </div>
  );
}
