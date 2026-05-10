import { PencilLine, Play, Plus, RefreshCw, Trash2 } from "lucide-react";
import { FormSection } from "@/components/layout/PageScaffold";
import { Button } from "@/components/ui/button";
import { PanelCard, StatusChip } from "@/components/ui/surface";
import { cn } from "@/lib/utils";
import type { ProviderModelCatalogEntry } from "@/types";
import {
  formatProviderModelCapabilities,
  type ProviderModelTestResult,
} from "@/pages/providers/lib";

interface ProviderModelsSectionProps {
  fetchingModels: boolean;
  modelTestResults: Record<string, ProviderModelTestResult>;
  models: ProviderModelCatalogEntry[];
  onAddModel: () => void;
  onClearModels: () => void;
  onDeleteModel: (modelId: string) => void;
  onEditModel: (entry: ProviderModelCatalogEntry) => void;
  onFetchModels: () => void;
  onTestModel: (entry: ProviderModelCatalogEntry) => void;
}

export function ProviderModelsSection({
  fetchingModels,
  modelTestResults,
  models,
  onAddModel,
  onClearModels,
  onDeleteModel,
  onEditModel,
  onFetchModels,
  onTestModel,
}: ProviderModelsSectionProps) {
  return (
    <div className="border-t border-border pt-8">
      <FormSection title="Models" contentClassName="space-y-4 bg-card/30 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-[13px] font-medium text-foreground/80">
            {models.length} model{models.length === 1 ? "" : "s"}
          </p>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={fetchingModels}
              onClick={onFetchModels}
            >
              <RefreshCw
                className={cn("size-3.5", fetchingModels && "animate-spin")}
              />
              Fetch Models
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onAddModel}
            >
              <Plus className="size-3.5" />
              Add Model
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={models.length === 0 || fetchingModels}
              onClick={onClearModels}
            >
              <Trash2 className="size-3.5" />
              Clear Models
            </Button>
          </div>
        </div>

        {models.length === 0 ? (
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
            {models.map((model) => (
              <ProviderModelRow
                key={model.model}
                model={model}
                onDeleteModel={onDeleteModel}
                onEditModel={onEditModel}
                onTestModel={onTestModel}
                testResult={modelTestResults[model.model]}
              />
            ))}
          </div>
        )}
      </FormSection>
    </div>
  );
}

interface ProviderModelRowProps {
  model: ProviderModelCatalogEntry;
  onDeleteModel: (modelId: string) => void;
  onEditModel: (entry: ProviderModelCatalogEntry) => void;
  onTestModel: (entry: ProviderModelCatalogEntry) => void;
  testResult: ProviderModelTestResult | undefined;
}

function ProviderModelRow({
  model,
  onDeleteModel,
  onEditModel,
  onTestModel,
  testResult,
}: ProviderModelRowProps) {
  return (
    <PanelCard as="div" padding="sm" className="bg-background/35">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate select-text font-mono text-[13px] text-foreground/85">
              {model.model}
            </p>
            <StatusChip
              tone={model.source === "manual" ? "idle" : "running"}
              className="px-2 py-0.5"
            >
              {model.source === "manual" ? "Manual" : "Discovered"}
            </StatusChip>
          </div>
          <p className="mt-1 select-text text-[11px] leading-relaxed text-muted-foreground">
            {formatProviderModelCapabilities(model)}
          </p>
          <ProviderModelTestMessage testResult={testResult} />
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={testResult?.state === "running"}
            onClick={() => onTestModel(model)}
          >
            <Play className="size-3.5" />
            Test
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onEditModel(model)}
          >
            <PencilLine className="size-3.5" />
            Edit
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onDeleteModel(model.model)}
          >
            <Trash2 className="size-3.5" />
            Delete
          </Button>
        </div>
      </div>
    </PanelCard>
  );
}

function ProviderModelTestMessage({
  testResult,
}: {
  testResult: ProviderModelTestResult | undefined;
}) {
  if (testResult?.state === "running") {
    return (
      <p className="mt-2 select-text text-[11px] text-muted-foreground">
        Testing this model against the current draft provider...
      </p>
    );
  }

  if (testResult?.state === "success") {
    return (
      <p className="mt-2 select-text text-[11px] text-graph-status-running">
        Test succeeded in {testResult.duration_ms}ms
      </p>
    );
  }

  if (testResult?.state === "error") {
    return (
      <p className="mt-2 select-text text-[11px] text-destructive">
        {testResult.error_summary}
      </p>
    );
  }

  return null;
}
