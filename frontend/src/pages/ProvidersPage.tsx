import { motion } from "motion/react";
import {
  Check,
  PencilLine,
  Play,
  Plus,
  RefreshCw,
  Server,
  Trash2,
} from "lucide-react";
import {
  FormSection,
  PageScaffold,
  PageTitleBar,
  SettingsRow,
} from "@/components/layout/PageScaffold";
import { PanelCard, PageState, StatusChip } from "@/components/ui/surface";
import {
  FormInput,
  FormTextarea,
  SecretInput,
  formSelectTriggerClass,
} from "@/components/form/FormControls";
import { providerTypeOptions } from "@/lib/providerTypes";
import { cn } from "@/lib/utils";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { buildModelSummary } from "@/pages/providers/lib";
import { ProviderModelDialog } from "@/pages/providers/ProviderModelDialog";
import { ProvidersSidebar } from "@/pages/providers/ProvidersSidebar";
import { useProvidersPageState } from "@/pages/providers/useProvidersPageState";

export function ProvidersPage() {
  const {
    cancelClearModels,
    clearModelsConfirmOpen,
    draft,
    endpointPreview,
    fetchingModels,
    handleCancel,
    handleClearModels,
    handleCreateNew,
    handleDelete,
    handleDeleteModel,
    handleFetchModels,
    handleSave,
    handleSaveModel,
    handleSelect,
    handleTestModel,
    hasChanges,
    isCreating,
    isDragging,
    loading,
    modelEditorDraft,
    modelEditorState,
    modelTestStates,
    openCreateModelDialog,
    openEditModelDialog,
    panelWidth,
    parsedHeaders,
    providerToDelete,
    providers,
    refreshProviders,
    requestClearModels,
    saving,
    selectedId,
    selectedProvider,
    setDraft,
    setModelEditorDraft,
    setProviderToDelete,
    startDrag,
    closeModelDialog,
  } = useProvidersPageState();

  return (
    <PageScaffold className="overflow-hidden px-4 pt-6 sm:px-5">
      <div className="flex h-full min-h-0 flex-col">
        <PageTitleBar title="Providers" />
        <PanelCard
          as="div"
          padding="none"
          className="mt-6 flex min-h-0 flex-1 overflow-hidden border-border/60 bg-card/[0.14]"
        >
          <ProvidersSidebar
            isDragging={isDragging}
            loading={loading}
            onCreate={handleCreateNew}
            onDelete={setProviderToDelete}
            onRefresh={() => {
              void refreshProviders();
            }}
            onResizeStart={startDrag}
            onSelect={handleSelect}
            panelWidth={panelWidth}
            providers={providers}
            selectedId={selectedId}
          />

          <div className="min-w-0 flex-1 overflow-y-auto bg-transparent">
            {isCreating || selectedProvider ? (
              <div className="flex min-h-full flex-col px-8 py-8 md:px-12 md:py-10">
                <div className="mb-8 flex items-center justify-between">
                  <div>
                    <h2 className="text-xl font-medium text-foreground">
                      {isCreating ? "New Provider" : selectedProvider?.name}
                    </h2>
                    {!isCreating ? (
                      <p className="mt-1 select-text font-mono text-[12px] text-muted-foreground">
                        {selectedProvider?.id}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-2">
                    {hasChanges ? (
                      <>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={handleCancel}
                          disabled={saving}
                        >
                          Cancel
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          onClick={() => void handleSave()}
                          disabled={saving}
                        >
                          <Check className="size-3.5" />
                          {saving ? "Saving..." : "Save"}
                        </Button>
                      </>
                    ) : null}
                  </div>
                </div>

                <div className="mx-auto w-full max-w-[720px] flex-1">
                  <FormSection
                    title="Identity"
                    className="mb-10"
                    contentClassName="rounded-lg border-dashed bg-card/30"
                  >
                    <SettingsRow label="Name">
                      <FormInput
                        value={draft.name}
                        onChange={(event) =>
                          setDraft({ ...draft, name: event.target.value })
                        }
                        placeholder="e.g., OpenAI Production"
                      />
                    </SettingsRow>
                    <SettingsRow label="Type">
                      <Select
                        value={draft.type}
                        onValueChange={(value) =>
                          setDraft({ ...draft, type: value })
                        }
                      >
                        <SelectTrigger className={formSelectTriggerClass}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="rounded-xl border-border bg-popover">
                          {providerTypeOptions.map((option) => (
                            <SelectItem
                              key={option.value}
                              value={option.value}
                              className="text-[13px]"
                            >
                              {option.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </SettingsRow>
                  </FormSection>

                  <FormSection
                    title="Endpoint & Auth"
                    separated
                    contentClassName="rounded-lg border-dashed bg-card/30"
                  >
                    <SettingsRow label="Base URL">
                      <FormInput
                        value={draft.base_url}
                        onChange={(event) =>
                          setDraft({ ...draft, base_url: event.target.value })
                        }
                        placeholder="https://api.openai.com/v1"
                      />
                    </SettingsRow>
                    <SettingsRow label="Request Preview">
                      <div
                        className={cn(
                          "w-full select-text rounded-md border px-3 py-2 text-[12px]",
                          endpointPreview.error
                            ? "border-destructive/20 bg-destructive/8 text-destructive"
                            : "border-border bg-card/30 text-foreground/80",
                        )}
                      >
                        {endpointPreview.error ? (
                          endpointPreview.error
                        ) : endpointPreview.previewUrl ? (
                          <code className="select-text font-mono">
                            {endpointPreview.previewUrl}
                          </code>
                        ) : (
                          <span className="text-muted-foreground">
                            Enter a base URL to preview
                          </span>
                        )}
                      </div>
                    </SettingsRow>
                    <SettingsRow label="API Key">
                      <SecretInput
                        value={draft.api_key}
                        onChange={(event) =>
                          setDraft({ ...draft, api_key: event.target.value })
                        }
                        placeholder="sk-..."
                        mono
                        showLabel="Show API key"
                        hideLabel="Hide API key"
                      />
                    </SettingsRow>
                    <SettingsRow label="Headers">
                      <div className="space-y-2">
                        <FormTextarea
                          value={draft.headers_text}
                          onChange={(event) =>
                            setDraft({
                              ...draft,
                              headers_text: event.target.value,
                            })
                          }
                          placeholder={'{\n  "Authorization": "Bearer ..."\n}'}
                          spellCheck={false}
                          className={cn(
                            "min-h-[140px]",
                            parsedHeaders.error
                              ? "border-destructive/30 text-destructive focus-visible:border-destructive/50 focus-visible:ring-destructive/20"
                              : "",
                          )}
                          mono
                        />
                        {parsedHeaders.error ? (
                          <p className="text-[11px] text-destructive">
                            {parsedHeaders.error}
                          </p>
                        ) : null}
                      </div>
                    </SettingsRow>
                    <SettingsRow label="429 Retry Delay">
                      <div className="space-y-2">
                        <div className="flex items-center gap-2">
                          <FormInput
                            aria-label="429 Retry Delay"
                            inputMode="numeric"
                            pattern="[0-9]*"
                            value={String(draft.retry_429_delay_seconds)}
                            onChange={(event) => {
                              const nextValue = event.target.value.trim();
                              if (!/^\d+$/.test(nextValue)) {
                                return;
                              }
                              const parsed = Number.parseInt(nextValue, 10);
                              if (!Number.isSafeInteger(parsed) || parsed < 0) {
                                return;
                              }
                              setDraft({
                                ...draft,
                                retry_429_delay_seconds: parsed,
                              });
                            }}
                            mono
                          />
                          <span className="text-[13px] font-medium text-muted-foreground">
                            s
                          </span>
                        </div>
                      </div>
                    </SettingsRow>
                  </FormSection>

                  <div className="border-t border-border pt-8">
                    <FormSection
                      title="Models"
                      contentClassName="space-y-4 bg-card/30 p-5"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <p className="text-[13px] font-medium text-foreground/80">
                            {draft.models.length} model
                            {draft.models.length === 1 ? "" : "s"}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            disabled={fetchingModels}
                            onClick={() => void handleFetchModels()}
                          >
                            <RefreshCw
                              className={cn(
                                "size-3.5",
                                fetchingModels && "animate-spin",
                              )}
                            />
                            Fetch Models
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={openCreateModelDialog}
                          >
                            <Plus className="size-3.5" />
                            Add Model
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            disabled={
                              draft.models.length === 0 || fetchingModels
                            }
                            onClick={requestClearModels}
                          >
                            <Trash2 className="size-3.5" />
                            Clear Models
                          </Button>
                        </div>
                      </div>

                      {draft.models.length === 0 ? (
                        <PanelCard
                          as="div"
                          padding="sm"
                          className="border-dashed bg-background/35 py-5 text-center"
                        >
                          <p className="text-[13px] font-medium text-foreground/80">
                            No models in this provider draft
                          </p>
                          <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                            Fetch models or add a manual entry.
                          </p>
                        </PanelCard>
                      ) : (
                        <div className="space-y-2">
                          {draft.models.map((entry) => {
                            const testState = modelTestStates[entry.model];
                            return (
                              <PanelCard
                                as="div"
                                key={entry.model}
                                padding="sm"
                                className="bg-background/35"
                              >
                                <div className="flex flex-wrap items-start justify-between gap-3">
                                  <div className="min-w-0 flex-1">
                                    <div className="flex flex-wrap items-center gap-2">
                                      <p className="truncate select-text font-mono text-[13px] text-foreground/85">
                                        {entry.model}
                                      </p>
                                      <StatusChip
                                        tone={
                                          entry.source === "manual"
                                            ? "idle"
                                            : "running"
                                        }
                                        className="px-2 py-0.5"
                                      >
                                        {entry.source === "manual"
                                          ? "Manual"
                                          : "Discovered"}
                                      </StatusChip>
                                    </div>
                                    <p className="mt-1 select-text text-[11px] leading-relaxed text-muted-foreground">
                                      {buildModelSummary(entry)}
                                    </p>
                                    {testState?.state === "running" ? (
                                      <p className="mt-2 select-text text-[11px] text-muted-foreground">
                                        Testing this model against the current
                                        draft provider...
                                      </p>
                                    ) : null}
                                    {testState?.state === "success" ? (
                                      <p className="mt-2 select-text text-[11px] text-graph-status-running">
                                        Test succeeded in{" "}
                                        {testState.duration_ms}
                                        ms
                                      </p>
                                    ) : null}
                                    {testState?.state === "error" ? (
                                      <p className="mt-2 select-text text-[11px] text-destructive">
                                        {testState.error_summary}
                                      </p>
                                    ) : null}
                                  </div>
                                  <div className="flex shrink-0 items-center gap-1.5">
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="sm"
                                      disabled={testState?.state === "running"}
                                      onClick={() =>
                                        void handleTestModel(entry)
                                      }
                                    >
                                      <Play className="size-3.5" />
                                      Test
                                    </Button>
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="sm"
                                      onClick={() => openEditModelDialog(entry)}
                                    >
                                      <PencilLine className="size-3.5" />
                                      Edit
                                    </Button>
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="sm"
                                      onClick={() =>
                                        handleDeleteModel(entry.model)
                                      }
                                    >
                                      <Trash2 className="size-3.5" />
                                      Delete
                                    </Button>
                                  </div>
                                </div>
                              </PanelCard>
                            );
                          })}
                        </div>
                      )}
                    </FormSection>
                  </div>

                  {!isCreating && selectedProvider ? (
                    <div className="border-t border-border pt-8">
                      <FormSection
                        title="Provider"
                        contentClassName="rounded-lg border-dashed bg-card/30"
                      >
                        <SettingsRow label="Provider ID">
                          <div className="select-text rounded-md border border-border bg-card/30 px-3 py-2 font-mono text-[12px] text-foreground/80">
                            {selectedProvider.id}
                          </div>
                        </SettingsRow>
                      </FormSection>
                    </div>
                  ) : null}
                </div>
              </div>
            ) : (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="flex h-full flex-col items-center justify-center px-6 text-center"
              >
                <PageState
                  icon={Server}
                  title="No provider selected"
                  className="border-transparent bg-transparent"
                />
              </motion.div>
            )}
          </div>
        </PanelCard>

        <ProviderModelDialog
          draft={modelEditorDraft}
          onClose={closeModelDialog}
          onDraftChange={setModelEditorDraft}
          onSave={handleSaveModel}
          state={modelEditorState}
        />

        <AlertDialog
          open={clearModelsConfirmOpen}
          onOpenChange={(open) => {
            if (!open) {
              cancelClearModels();
            }
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Clear all models?</AlertDialogTitle>
              <AlertDialogDescription>
                This removes every model from this provider, including
                discovered and manual entries. Save the provider to keep the
                cleared list.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel asChild>
                <Button type="button" variant="ghost">
                  Cancel
                </Button>
              </AlertDialogCancel>
              <AlertDialogAction asChild>
                <Button
                  type="button"
                  variant="destructive"
                  onClick={handleClearModels}
                >
                  Clear Models
                </Button>
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <AlertDialog
          open={providerToDelete !== null}
          onOpenChange={(open) => {
            if (!open) {
              setProviderToDelete(null);
            }
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete provider?</AlertDialogTitle>
              <AlertDialogDescription>
                {providerToDelete
                  ? `This will permanently remove ${providerToDelete.name}.`
                  : "This will permanently remove the selected provider."}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel asChild>
                <Button variant="ghost">Cancel</Button>
              </AlertDialogCancel>
              <AlertDialogAction asChild>
                <Button
                  variant="destructive"
                  onClick={() => void handleDelete()}
                >
                  Delete
                </Button>
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </PageScaffold>
  );
}
