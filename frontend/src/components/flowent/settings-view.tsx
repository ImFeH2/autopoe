import { useEffect, useState } from "react";
import type { FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  dashedPanelClassName,
  dataRowClassName,
  dataRowLabelClassName,
  emptyStateClassName,
  fieldInputClassName,
  fieldLabelClassName,
  fieldTriggerClassName,
  formActionsClassName,
  stableScrollbarClassName,
} from "@/components/flowent/styles";
import type {
  ReasoningEffort,
  RuntimeSettings,
} from "@/components/flowent/types";
import type { Provider } from "@/features/providers/model/provider-types";
import { cn } from "@/lib/utils";

const reasoningOptions: Array<{ label: string; value: ReasoningEffort }> = [
  { label: "Default", value: "default" },
  { label: "Low", value: "low" },
  { label: "Medium", value: "medium" },
  { label: "High", value: "high" },
  { label: "XHigh", value: "xhigh" },
];

type ContextLimitMode = "auto" | "manual";

export function SettingsView({
  agentPrompt,
  appVersion,
  contextWindowLimit,
  modelOptions,
  onModelChange,
  onProviderChange,
  onReasoningEffortChange,
  onRuntimeSettingsSave,
  providers,
  reasoningEffort,
  selectedModel,
  selectedProviderId,
}: {
  agentPrompt: string;
  appVersion: string;
  contextWindowLimit: number | null;
  modelOptions: string[];
  onModelChange: (value: string) => void;
  onProviderChange: (value: string) => void;
  onReasoningEffortChange: (value: ReasoningEffort) => void;
  onRuntimeSettingsSave: (settings: RuntimeSettings) => void;
  providers: Provider[];
  reasoningEffort: ReasoningEffort;
  selectedModel: string;
  selectedProviderId: string;
}) {
  const [agentPromptDraft, setAgentPromptDraft] = useState(agentPrompt);
  const [contextLimitMode, setContextLimitMode] = useState<ContextLimitMode>(
    contextWindowLimit === null ? "auto" : "manual",
  );
  const [contextLimitDraft, setContextLimitDraft] = useState(
    contextWindowLimit === null ? "" : String(contextWindowLimit),
  );

  useEffect(() => {
    setAgentPromptDraft(agentPrompt);
  }, [agentPrompt]);

  useEffect(() => {
    setContextLimitMode(contextWindowLimit === null ? "auto" : "manual");
    setContextLimitDraft(
      contextWindowLimit === null ? "" : String(contextWindowLimit),
    );
  }, [contextWindowLimit]);

  const trimmedContextLimitDraft = contextLimitDraft.trim();
  const manualContextLimit = Number(trimmedContextLimitDraft);
  const isManualContextLimitValid =
    contextLimitMode === "auto" ||
    (/^\d+$/.test(trimmedContextLimitDraft) && manualContextLimit > 0);

  const saveSettings = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!isManualContextLimitValid) {
      return;
    }
    onRuntimeSettingsSave({
      agentPrompt: agentPromptDraft,
      contextWindowLimit:
        contextLimitMode === "manual" ? manualContextLimit : null,
      reasoningEffort,
      selectedModel,
      selectedProviderId,
    });
  };

  return (
    <section
      className={cn(
        "flex h-full min-h-0 flex-col overflow-auto bg-black",
        stableScrollbarClassName,
      )}
      aria-label="Settings"
    >
      <form
        className="m-8 grid gap-5 bg-black max-[900px]:m-5"
        aria-label="Runtime settings"
        onSubmit={saveSettings}
      >
        <section className="grid gap-3">
          <h3 className="text-base font-semibold text-white">Model routing</h3>
          <div className={dashedPanelClassName}>
            <div className="grid gap-0">
              {providers.length === 0 ? (
                <div className="p-3">
                  <p className={emptyStateClassName}>No providers</p>
                </div>
              ) : null}
              <RuntimeProviderSelect
                onProviderChange={onProviderChange}
                providers={providers}
                selectedProviderId={selectedProviderId}
              />
              <RuntimeModelSelect
                modelOptions={modelOptions}
                onModelChange={onModelChange}
                selectedModel={selectedModel}
                selectedProviderId={selectedProviderId}
              />
              <RuntimeReasoningSelect
                onReasoningEffortChange={onReasoningEffortChange}
                reasoningEffort={reasoningEffort}
              />
              <RuntimeContextLimitField
                contextLimitDraft={contextLimitDraft}
                contextLimitMode={contextLimitMode}
                isValid={isManualContextLimitValid}
                onContextLimitDraftChange={setContextLimitDraft}
                onContextLimitModeChange={setContextLimitMode}
              />
            </div>
          </div>
        </section>

        <section className="grid gap-3">
          <div className="grid gap-1">
            <h3 className="text-base font-semibold text-white">Agent prompt</h3>
          </div>
          <div className={cn(dashedPanelClassName, "p-3")}>
            <Label className="sr-only" htmlFor="agent-prompt">
              Agent prompt
            </Label>
            <Textarea
              className="min-h-48 resize-y rounded-md border-white/10 bg-input/30 px-3 py-2 text-base leading-5 text-white shadow-none placeholder:text-[#777] focus-visible:border-[#7a7a7a] focus-visible:ring-2 focus-visible:ring-ring/25"
              id="agent-prompt"
              value={agentPromptDraft}
              onChange={(event) => setAgentPromptDraft(event.target.value)}
              placeholder="Add Flowent-specific instructions for the agent."
              aria-label="Agent prompt"
            />
          </div>
        </section>

        <div className={cn(formActionsClassName, "mt-0")}>
          <Button type="submit" disabled={!isManualContextLimitValid}>
            Save
          </Button>
        </div>
      </form>
      {appVersion ? (
        <p className="mx-8 mt-auto pb-6 text-center text-xs leading-5 text-white/30 max-[900px]:mx-5">
          Flowent v{appVersion}
        </p>
      ) : null}
    </section>
  );
}

function RuntimeContextLimitField({
  contextLimitDraft,
  contextLimitMode,
  isValid,
  onContextLimitDraftChange,
  onContextLimitModeChange,
}: {
  contextLimitDraft: string;
  contextLimitMode: ContextLimitMode;
  isValid: boolean;
  onContextLimitDraftChange: (value: string) => void;
  onContextLimitModeChange: (value: ContextLimitMode) => void;
}) {
  const errorId = "context-limit-error";
  const showError = contextLimitMode === "manual" && !isValid;

  return (
    <div className={dataRowClassName}>
      <Label
        className={cn(fieldLabelClassName, dataRowLabelClassName)}
        htmlFor="context-limit-mode"
      >
        Context window
      </Label>
      <div className="grid gap-1.5">
        <div className="flex min-w-0 gap-2 max-[640px]:flex-col">
          <Select
            value={contextLimitMode}
            onValueChange={(value) =>
              onContextLimitModeChange(value as ContextLimitMode)
            }
          >
            <SelectTrigger
              className={cn(fieldTriggerClassName, "w-36 max-[640px]:w-full")}
              id="context-limit-mode"
              aria-label="Context window"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="auto">Auto</SelectItem>
              <SelectItem value="manual">Manual</SelectItem>
            </SelectContent>
          </Select>
          {contextLimitMode === "manual" ? (
            <Input
              aria-describedby={showError ? errorId : undefined}
              aria-invalid={showError}
              aria-label="Context size"
              className={fieldInputClassName}
              inputMode="numeric"
              placeholder="e.g. 128000"
              value={contextLimitDraft}
              onChange={(event) =>
                onContextLimitDraftChange(event.target.value)
              }
            />
          ) : null}
        </div>
        {showError ? (
          <p className="m-0 text-xs leading-4 text-red-400" id={errorId}>
            Enter a positive integer
          </p>
        ) : null}
      </div>
    </div>
  );
}

function RuntimeProviderSelect({
  onProviderChange,
  providers,
  selectedProviderId,
}: {
  onProviderChange: (value: string) => void;
  providers: Provider[];
  selectedProviderId: string;
}) {
  return (
    <div className={dataRowClassName}>
      <Label
        className={cn(fieldLabelClassName, dataRowLabelClassName)}
        htmlFor="active-provider"
      >
        Provider
      </Label>
      <Select value={selectedProviderId} onValueChange={onProviderChange}>
        <SelectTrigger
          className={fieldTriggerClassName}
          disabled={providers.length === 0}
          id="active-provider"
          aria-label="Provider"
        >
          <SelectValue placeholder="No providers" />
        </SelectTrigger>
        <SelectContent>
          {providers.length === 0 ? (
            <SelectItem value="none" disabled>
              No providers
            </SelectItem>
          ) : null}
          {providers.map((provider) => (
            <SelectItem key={provider.id} value={provider.id}>
              {provider.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function RuntimeReasoningSelect({
  onReasoningEffortChange,
  reasoningEffort,
}: {
  onReasoningEffortChange: (value: ReasoningEffort) => void;
  reasoningEffort: ReasoningEffort;
}) {
  return (
    <div className={dataRowClassName}>
      <Label
        className={cn(fieldLabelClassName, dataRowLabelClassName)}
        htmlFor="reasoning-effort"
      >
        Reasoning
      </Label>
      <Select value={reasoningEffort} onValueChange={onReasoningEffortChange}>
        <SelectTrigger
          className={fieldTriggerClassName}
          id="reasoning-effort"
          aria-label="Reasoning"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {reasoningOptions.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function RuntimeModelSelect({
  modelOptions,
  onModelChange,
  selectedModel,
  selectedProviderId,
}: {
  modelOptions: string[];
  onModelChange: (value: string) => void;
  selectedModel: string;
  selectedProviderId: string;
}) {
  return (
    <div className={dataRowClassName}>
      <Label
        className={cn(fieldLabelClassName, dataRowLabelClassName)}
        htmlFor="active-model"
      >
        Model
      </Label>
      <Select
        key={`settings-model-${selectedProviderId}`}
        value={selectedModel}
        onValueChange={onModelChange}
      >
        <SelectTrigger
          className={fieldTriggerClassName}
          disabled={modelOptions.length === 0}
          id="active-model"
          aria-label="Model"
        >
          <SelectValue placeholder="No models" />
        </SelectTrigger>
        <SelectContent>
          {modelOptions.map((model) => (
            <SelectItem key={model} value={model}>
              {model}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
