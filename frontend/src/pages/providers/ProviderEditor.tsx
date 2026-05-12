import { Check, Server } from "lucide-react";
import { motion } from "motion/react";
import { FormSection, SettingsRow } from "@/components/layout/PageScaffold";
import { Button } from "@/components/ui/button";
import { PageState } from "@/components/surface";
import type { Provider } from "@/types";
import { ProviderEndpointSection } from "@/pages/providers/ProviderEndpointSection";
import { ProviderIdentitySection } from "@/pages/providers/ProviderIdentitySection";
import { ProviderModelsSection } from "@/pages/providers/ProviderModelsSection";
import type {
  ProviderDraft,
  ProviderModelTestResult,
} from "@/pages/providers/lib";

interface ProviderEditorProps {
  draft: ProviderDraft;
  endpointPreview: {
    error: string | null;
    previewUrl: string | null;
  };
  fetchingModels: boolean;
  hasChanges: boolean;
  isCreating: boolean;
  modelTestResults: Record<string, ProviderModelTestResult>;
  onAddModel: () => void;
  onCancelChanges: () => void;
  onClearModels: () => void;
  onDeleteModel: (modelId: string) => void;
  onEditModel: (entry: Provider["models"][number]) => void;
  onFetchModels: () => void;
  onSaveProvider: () => void;
  onTestModel: (entry: Provider["models"][number]) => void;
  onUpdateDraft: (draft: ProviderDraft) => void;
  parsedHeaders: {
    error: string | null;
  };
  saving: boolean;
  selectedProvider: Provider | undefined;
}

export function ProviderEditor({
  draft,
  endpointPreview,
  fetchingModels,
  hasChanges,
  isCreating,
  modelTestResults,
  onAddModel,
  onCancelChanges,
  onClearModels,
  onDeleteModel,
  onEditModel,
  onFetchModels,
  onSaveProvider,
  onTestModel,
  onUpdateDraft,
  parsedHeaders,
  saving,
  selectedProvider,
}: ProviderEditorProps) {
  if (!isCreating && !selectedProvider) {
    return (
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
    );
  }

  return (
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
        {hasChanges ? (
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onCancelChanges}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={onSaveProvider}
              disabled={saving}
            >
              <Check className="size-3.5" />
              {saving ? "Saving..." : "Save Provider"}
            </Button>
          </div>
        ) : null}
      </div>

      <div className="mx-auto w-full max-w-[720px] flex-1">
        <ProviderIdentitySection draft={draft} onUpdateDraft={onUpdateDraft} />
        <ProviderEndpointSection
          draft={draft}
          endpointPreview={endpointPreview}
          onUpdateDraft={onUpdateDraft}
          parsedHeaders={parsedHeaders}
        />
        <ProviderModelsSection
          fetchingModels={fetchingModels}
          modelTestResults={modelTestResults}
          models={draft.models}
          onAddModel={onAddModel}
          onClearModels={onClearModels}
          onDeleteModel={onDeleteModel}
          onEditModel={onEditModel}
          onFetchModels={onFetchModels}
          onTestModel={onTestModel}
        />

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
  );
}
