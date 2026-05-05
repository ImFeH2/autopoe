import { motion } from "motion/react";
import { Edit2, Eye, Plus, RefreshCw, Trash2, Users, X } from "lucide-react";
import { ModelParamsFields } from "@/components/ModelParamsFields";
import {
  FormSection,
  PageScaffold,
  PageTitleBar,
  SettingsRow,
} from "@/components/layout/PageScaffold";
import { PageLoadingState } from "@/components/layout/PageLoadingState";
import { PanelCard, PageState, StatusChip } from "@/components/ui/surface";
import {
  FormIconButton,
  FormInput,
  FormTextarea,
  formReadOnlyClass,
  formSelectTriggerClass,
} from "@/components/form/FormControls";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cloneModelParams, isEmptyModelParams } from "@/lib/modelParams";
import { cn } from "@/lib/utils";
import { useRolesPageState } from "@/pages/roles/useRolesPageState";

export function RolesPage() {
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
    lockBuiltinFields,
    panelEyebrow,
    panelMode,
    panelTitle,
    providers,
    providersById,
    refreshRoles,
    roleToDelete,
    roles,
    saving,
    actions,
  } = useRolesPageState();

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
              <Button
                type="button"
                size="sm"
                onClick={actions.openCreate}
                disabled={isPanelOpen}
              >
                <Plus className="size-4" />
                New Role
              </Button>
            </>
          }
        />
        <div className="mt-6 min-h-0 flex-1">
          {isPanelOpen ? (
            <div className="h-full min-h-0 overflow-y-auto pr-2 scrollbar-none">
              <div className="mx-auto max-w-3xl pb-10">
                <PanelCard
                  as="div"
                  padding="sm"
                  className="mb-8 flex items-center justify-between px-5 py-4"
                >
                  <div className="flex items-center gap-3">
                    <StatusChip tone="neutral" className="py-0.5 text-[11px]">
                      {panelEyebrow}
                    </StatusChip>
                    <h2 className="text-[15px] font-medium text-foreground">
                      {panelTitle}
                    </h2>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    onClick={actions.closePanel}
                    className="text-muted-foreground hover:bg-accent/45 hover:text-foreground"
                  >
                    <X className="size-3.5" />
                  </Button>
                </PanelCard>

                <FormSection
                  title="Identity"
                  className="mb-10"
                  contentClassName="rounded-lg border-dashed bg-card/30"
                >
                  <SettingsRow label="Role Name">
                    <FormInput
                      value={draft.name}
                      onChange={(event) =>
                        actions.updateDraft((current) => ({
                          ...current,
                          name: event.target.value,
                        }))
                      }
                      readOnly={isReadOnly || lockBuiltinFields}
                      placeholder="e.g., Code Reviewer"
                      className={cn(
                        isReadOnly || lockBuiltinFields
                          ? formReadOnlyClass
                          : "",
                      )}
                    />
                  </SettingsRow>

                  <SettingsRow label="Description">
                    <FormTextarea
                      value={draft.description}
                      onChange={(event) =>
                        actions.updateDraft((current) => ({
                          ...current,
                          description: event.target.value,
                        }))
                      }
                      readOnly={isReadOnly || lockBuiltinFields}
                      placeholder="Briefly explain what this role is best suited for"
                      rows={3}
                      className={cn(
                        "resize-y",
                        isReadOnly || lockBuiltinFields
                          ? formReadOnlyClass
                          : "",
                      )}
                    />
                  </SettingsRow>

                  <SettingsRow label="System Prompt">
                    <div className="space-y-2">
                      <FormTextarea
                        value={draft.system_prompt}
                        onChange={(event) =>
                          actions.updateDraft((current) => ({
                            ...current,
                            system_prompt: event.target.value,
                          }))
                        }
                        readOnly={isReadOnly || lockBuiltinFields}
                        placeholder="You are a helpful assistant that..."
                        rows={12}
                        className={cn(
                          "resize-y",
                          isReadOnly || lockBuiltinFields
                            ? formReadOnlyClass
                            : "",
                        )}
                        mono
                      />
                      <p className="text-[11px] text-muted-foreground">
                        {isReadOnly
                          ? activeRole?.is_builtin
                            ? "This built-in role can be inspected. Use Edit to adjust only its model configuration."
                            : "This role is in read-only view. Use Edit to modify it."
                          : lockBuiltinFields
                            ? "Built-in role prompt and tool configuration are fixed. Only model configuration can be changed."
                            : "This prompt defines how agents with this role will behave."}
                      </p>
                    </div>
                  </SettingsRow>
                </FormSection>

                <FormSection
                  title="Model Configuration"
                  className="mb-10"
                  separated
                  contentClassName="border-transparent bg-transparent p-0 shadow-none"
                >
                  <div className="space-y-6">
                    <div className="flex flex-wrap gap-3">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={isReadOnly}
                        onClick={() => actions.handleModelModeChange(false)}
                        className={cn(
                          "h-8 rounded-md border px-3 text-[13px] font-medium transition-colors",
                          draft.model === null
                            ? "border-border bg-accent/45 text-foreground"
                            : "border-transparent bg-card/20 text-muted-foreground hover:bg-accent/25",
                          isReadOnly && "cursor-default",
                        )}
                      >
                        Use Settings Default
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={isReadOnly}
                        onClick={() => actions.handleModelModeChange(true)}
                        className={cn(
                          "h-8 rounded-md border px-3 text-[13px] font-medium transition-colors",
                          draft.model !== null
                            ? "border-border bg-accent/45 text-foreground"
                            : "border-transparent bg-card/20 text-muted-foreground hover:bg-accent/25",
                          isReadOnly && "cursor-default",
                        )}
                      >
                        Set Role Override
                      </Button>
                    </div>

                    {draft.model ? (
                      <PanelCard>
                        <div className="grid gap-6 md:grid-cols-2">
                          <div className="space-y-2">
                            <label className="text-[13px] font-medium text-foreground/80">
                              Provider
                            </label>
                            <Select
                              value={draft.model.provider_id || undefined}
                              onValueChange={actions.handleProviderChange}
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

                          <div className="space-y-2">
                            <label className="text-[13px] font-medium text-foreground/80">
                              Provider Models
                            </label>
                            <Select
                              value={
                                availableActiveProviderModelOptions.some(
                                  (option) =>
                                    option.model === draft.model?.model,
                                )
                                  ? draft.model?.model
                                  : undefined
                              }
                              onValueChange={(value) =>
                                actions.updateDraft((current) => ({
                                  ...current,
                                  model: current.model
                                    ? { ...current.model, model: value }
                                    : null,
                                }))
                              }
                              disabled={
                                isReadOnly ||
                                !draft.model.provider_id ||
                                availableActiveProviderModelOptions.length === 0
                              }
                            >
                              <SelectTrigger className={formSelectTriggerClass}>
                                <SelectValue
                                  placeholder={
                                    availableActiveProviderModelOptions.length >
                                    0
                                      ? "Pick a provider model"
                                      : "No saved provider models"
                                  }
                                />
                              </SelectTrigger>
                              <SelectContent className="max-h-[300px] rounded-xl border-border bg-popover">
                                {availableActiveProviderModelOptions.map(
                                  (option) => (
                                    <SelectItem
                                      key={option.model}
                                      value={option.model}
                                      className="text-[13px]"
                                    >
                                      {option.model}
                                    </SelectItem>
                                  ),
                                )}
                              </SelectContent>
                            </Select>
                            {availableActiveProviderModelOptions.length ===
                            0 ? (
                              <p className="text-[11px] leading-relaxed text-muted-foreground">
                                No saved provider models. Manage this provider
                                catalog in Providers.
                              </p>
                            ) : null}
                          </div>

                          <div className="space-y-2 md:col-span-2">
                            <label className="text-[13px] font-medium text-foreground/80">
                              Model ID
                            </label>
                            <FormInput
                              value={draft.model.model}
                              onChange={(event) =>
                                actions.updateDraft((current) => ({
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
                              className={cn(
                                isReadOnly ? formReadOnlyClass : "",
                              )}
                              mono
                            />
                            <p className="text-[11px] text-muted-foreground">
                              Catalog or manual ID
                            </p>
                          </div>
                        </div>
                      </PanelCard>
                    ) : (
                      <p className="text-[13px] text-muted-foreground">
                        This role follows the default provider and model from
                        Settings.
                      </p>
                    )}
                  </div>
                </FormSection>

                <FormSection
                  title="Model Parameters"
                  className="mb-10"
                  separated
                  contentClassName="border-transparent bg-transparent p-0 shadow-none"
                >
                  <div className="space-y-6">
                    <div className="flex flex-wrap gap-3">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={isReadOnly}
                        onClick={() =>
                          actions.handleModelParamsModeChange(false)
                        }
                        className={cn(
                          "h-8 rounded-md border px-3 text-[13px] font-medium transition-colors",
                          isEmptyModelParams(draft.model_params)
                            ? "border-border bg-accent/45 text-foreground"
                            : "border-transparent bg-card/20 text-muted-foreground hover:bg-accent/25",
                          isReadOnly && "cursor-default",
                        )}
                      >
                        Use Settings Default
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={isReadOnly}
                        onClick={() =>
                          actions.handleModelParamsModeChange(true)
                        }
                        className={cn(
                          "h-8 rounded-md border px-3 text-[13px] font-medium transition-colors",
                          !isEmptyModelParams(draft.model_params)
                            ? "border-border bg-accent/45 text-foreground"
                            : "border-transparent bg-card/20 text-muted-foreground hover:bg-accent/25",
                          isReadOnly && "cursor-default",
                        )}
                      >
                        Set Parameter Overrides
                      </Button>
                    </div>

                    {!isEmptyModelParams(draft.model_params) ? (
                      <PanelCard>
                        <ModelParamsFields
                          value={cloneModelParams(draft.model_params)}
                          onChange={(params) =>
                            actions.updateDraft((current) => ({
                              ...current,
                              model_params: params,
                            }))
                          }
                          disabled={isReadOnly}
                          emptyLabel="Inherit settings default"
                          numberPlaceholder="Inherit settings default"
                          reasoningDisableLabel="Disable"
                          helperText="These canonical parameters override Settings only for this role. Unsupported fields are ignored by the resolved provider."
                        />
                      </PanelCard>
                    ) : (
                      <p className="text-[13px] text-muted-foreground">
                        This role inherits the default model parameters from
                        Settings.
                      </p>
                    )}
                  </div>
                </FormSection>

                <FormSection
                  title="Tool Configuration"
                  className="mb-10"
                  separated
                  contentClassName="bg-card/30"
                >
                  {configurableTools.map((tool) => {
                    const state = getToolState(tool.name);
                    return (
                      <div
                        key={tool.name}
                        className="flex items-center justify-between gap-4 border-b border-border px-5 py-4 last:border-b-0"
                      >
                        <div
                          className="min-w-0 flex-1"
                          title={tool.description}
                        >
                          <p className="font-mono text-[13px] text-foreground/80">
                            {tool.name}
                          </p>
                          <p className="mt-1 truncate text-[12px] text-muted-foreground">
                            {tool.description}
                          </p>
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="xs"
                          onClick={() => actions.cycleRoleToolState(tool.name)}
                          disabled={isReadOnly || lockBuiltinFields}
                          className={cn(
                            "shrink-0 rounded-full px-3 py-1 text-xs font-medium transition-colors",
                            state === "included" &&
                              "bg-accent/50 text-foreground",
                            state === "excluded" &&
                              "bg-transparent text-muted-foreground line-through",
                            state === "allowed" &&
                              "bg-accent/20 text-muted-foreground hover:bg-accent/35",
                            (isReadOnly || lockBuiltinFields) &&
                              "cursor-default hover:bg-inherit opacity-60",
                          )}
                        >
                          {state === "allowed"
                            ? "Allowed"
                            : state === "included"
                              ? "Included"
                              : "Excluded"}
                        </Button>
                      </div>
                    );
                  })}
                </FormSection>

                <div className="flex items-center justify-end gap-3 border-t border-border pt-6">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={actions.closePanel}
                    disabled={saving}
                  >
                    Cancel
                  </Button>
                  {!isReadOnly ? (
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => void actions.handleSave()}
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
                      onClick={() => actions.openEdit(activeRole)}
                    >
                      Edit Role
                    </Button>
                  ) : null}
                </div>
              </div>
            </div>
          ) : roles.length === 0 ? (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex h-full flex-col items-center justify-center text-center"
            >
              <PageState
                icon={Users}
                title="No Roles Created"
                description="Roles define agent behavior. Create your first role to get started."
                className="border-transparent bg-transparent"
              />
            </motion.div>
          ) : (
            <div className="h-full min-h-0 overflow-y-auto pr-2 scrollbar-none">
              <div className="mx-auto w-full max-w-5xl">
                <div className="mb-2 grid grid-cols-[260px_1fr_120px_100px] gap-4 px-4 pb-3">
                  <span className="text-[11px] font-medium text-muted-foreground">
                    Name
                  </span>
                  <span className="text-[11px] font-medium text-muted-foreground">
                    Model
                  </span>
                  <span className="text-[11px] font-medium text-muted-foreground">
                    Tools
                  </span>
                  <span />
                </div>

                <div className="space-y-1">
                  {roles.map((role, index) => {
                    const providerName = role.model
                      ? (providersById[role.model.provider_id]?.name ??
                        role.model.provider_id)
                      : null;
                    const includedCount = role.included_tools.length;
                    const excludedCount = role.excluded_tools.length;
                    const toolSummary =
                      includedCount === 0 && excludedCount === 0
                        ? "Default"
                        : `${includedCount > 0 ? `+${includedCount}` : ""}${includedCount > 0 && excludedCount > 0 ? " " : ""}${excludedCount > 0 ? `-${excludedCount}` : ""}`;

                    return (
                      <motion.div
                        key={role.name}
                        initial={{ opacity: 0, y: 4 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: index * 0.03 }}
                        className={cn(
                          "group grid grid-cols-[220px_1fr_100px_80px] items-center gap-4 rounded-xl px-4 py-3.5 transition-colors",
                          activeRole?.name === role.name
                            ? "bg-accent/25"
                            : "hover:bg-accent/15",
                        )}
                      >
                        <div className="min-w-0 pr-2">
                          <div className="flex items-center gap-2">
                            <span className="truncate text-[13px] font-medium text-foreground">
                              {role.name}
                            </span>
                            {role.is_builtin ? (
                              <StatusChip
                                tone="muted"
                                className="px-1.5 py-0.5 text-[9px]"
                              >
                                Built-in
                              </StatusChip>
                            ) : null}
                          </div>
                          <p className="mt-1 line-clamp-2 text-[12px] leading-relaxed text-muted-foreground">
                            {role.description}
                          </p>
                        </div>

                        <div className="min-w-0 pr-2">
                          <span className="block truncate text-[13px] text-muted-foreground">
                            {role.model
                              ? `${providerName} / ${role.model.model}`
                              : "Settings default"}
                          </span>
                        </div>

                        <div className="pr-2">
                          <span className="text-[13px] font-mono text-muted-foreground">
                            {toolSummary}
                          </span>
                        </div>

                        <div className="flex items-center justify-end gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                          <FormIconButton
                            onClick={() => actions.openView(role)}
                            aria-label={`View ${role.name}`}
                            title={`View ${role.name}`}
                            className="size-7"
                          >
                            <Eye className="size-3.5" />
                          </FormIconButton>
                          <FormIconButton
                            onClick={() => actions.openEdit(role)}
                            aria-label={`Edit ${role.name}`}
                            title={`Edit ${role.name}`}
                            className="size-7"
                          >
                            <Edit2 className="size-3.5" />
                          </FormIconButton>
                          {!role.is_builtin ? (
                            <FormIconButton
                              onClick={() => actions.requestDeleteRole(role)}
                              aria-label={`Delete ${role.name}`}
                              title={`Delete ${role.name}`}
                              className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                            >
                              <Trash2 className="size-3.5" />
                            </FormIconButton>
                          ) : null}
                        </div>
                      </motion.div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
      <AlertDialog
        open={roleToDelete !== null}
        onOpenChange={(open) => {
          if (!open) {
            actions.clearRoleToDelete();
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete role?</AlertDialogTitle>
            <AlertDialogDescription>
              {roleToDelete
                ? `This will permanently remove ${roleToDelete.name}.`
                : "This will permanently remove the selected role."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel asChild>
              <Button variant="ghost">Cancel</Button>
            </AlertDialogCancel>
            <AlertDialogAction asChild>
              <Button
                variant="destructive"
                onClick={() => void actions.handleDelete()}
              >
                Delete
              </Button>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PageScaffold>
  );
}
