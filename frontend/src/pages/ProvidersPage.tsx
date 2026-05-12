import { PageScaffold, PageTitleBar } from "@/components/layout/PageScaffold";
import { PanelCard } from "@/components/surface";
import { ProviderActionDialogs } from "@/pages/providers/ProviderActionDialogs";
import { ProviderEditor } from "@/pages/providers/ProviderEditor";
import { ProviderModelDialog } from "@/pages/providers/ProviderModelDialog";
import { ProvidersSidebar } from "@/pages/providers/ProvidersSidebar";
import { useProvidersPageState } from "@/pages/providers/useProvidersPageState";

export function ProvidersPage() {
  const {
    cancelClearModels,
    cancelDeleteProvider,
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
    modelTestResults,
    openCreateModelDialog,
    openEditModelDialog,
    panelWidth,
    parsedHeaders,
    providerToDelete,
    providers,
    refreshProviders,
    requestClearModels,
    requestDeleteProvider,
    saving,
    selectedId,
    selectedProvider,
    updateProviderDraft,
    updateProviderModelDraft,
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
            onDelete={requestDeleteProvider}
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
            <ProviderEditor
              draft={draft}
              endpointPreview={endpointPreview}
              fetchingModels={fetchingModels}
              hasChanges={hasChanges}
              isCreating={isCreating}
              modelTestResults={modelTestResults}
              onAddModel={openCreateModelDialog}
              onCancelChanges={handleCancel}
              onClearModels={requestClearModels}
              onDeleteModel={handleDeleteModel}
              onEditModel={openEditModelDialog}
              onFetchModels={() => {
                void handleFetchModels();
              }}
              onSaveProvider={() => {
                void handleSave();
              }}
              onTestModel={(model) => {
                void handleTestModel(model);
              }}
              onUpdateDraft={updateProviderDraft}
              parsedHeaders={parsedHeaders}
              saving={saving}
              selectedProvider={selectedProvider}
            />
          </div>
        </PanelCard>

        <ProviderModelDialog
          draft={modelEditorDraft}
          onClose={closeModelDialog}
          onDraftChange={updateProviderModelDraft}
          onSave={handleSaveModel}
          state={modelEditorState}
        />

        <ProviderActionDialogs
          clearModelsConfirmOpen={clearModelsConfirmOpen}
          onCancelClearModels={cancelClearModels}
          onCancelDeleteProvider={cancelDeleteProvider}
          onClearModels={handleClearModels}
          onDeleteProvider={() => {
            void handleDelete();
          }}
          providerToDelete={providerToDelete}
        />
      </div>
    </PageScaffold>
  );
}
