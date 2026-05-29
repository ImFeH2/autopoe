import { useEffect, useState } from "react";
import type { FormEvent } from "react";

import { Button } from "@/components/ui/button";
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
  fieldLabelClassName,
  fieldTriggerClassName,
  formActionsClassName,
  mutedTextClassName,
  stableScrollbarClassName,
} from "@/components/flowent/styles";
import type {
  Provider,
  ReasoningEffort,
  RuntimeSettings,
} from "@/components/flowent/types";
import { cn } from "@/lib/utils";

const reasoningOptions: Array<{ label: string; value: ReasoningEffort }> = [
  { label: "Default", value: "default" },
  { label: "Low", value: "low" },
  { label: "Medium", value: "medium" },
  { label: "High", value: "high" },
  { label: "XHigh", value: "xhigh" },
];

export function SettingsView({
  agentPrompt,
  appVersion,
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

  useEffect(() => {
    setAgentPromptDraft(agentPrompt);
  }, [agentPrompt]);

  const saveSettings = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onRuntimeSettingsSave({
      agentPrompt: agentPromptDraft,
      reasoningEffort,
      selectedModel,
      selectedProviderId,
    });
  };

  return (
    <section
      className={cn(
        "flex h-full min-h-0 flex-col overflow-auto bg-black max-[900px]:h-auto max-[900px]:min-h-[calc(100vh-126px)] max-[900px]:overflow-visible",
        stableScrollbarClassName,
      )}
      aria-label="Settings"
    >
      <form
        className="m-8 grid w-[min(620px,calc(100%-64px))] gap-5 self-start bg-black max-[900px]:m-5 max-[900px]:w-auto"
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
            </div>
          </div>
        </section>

        <section className="grid gap-3">
          <div className="grid gap-1">
            <h3 className="text-base font-semibold text-white">Agent prompt</h3>
            <p className={cn("m-0 text-xs leading-5", mutedTextClassName)}>
              These instructions are sent before AGENTS.md project instructions
              on every workspace turn.
            </p>
          </div>
          <div className={cn(dashedPanelClassName, "p-3")}>
            <Label className="sr-only" htmlFor="agent-prompt">
              Agent prompt
            </Label>
            <Textarea
              className="min-h-48 resize-y rounded-md border-white/10 bg-input/30 px-3 py-2 text-[13px] leading-5 text-white shadow-none placeholder:text-[#777] focus-visible:border-[#7a7a7a] focus-visible:ring-2 focus-visible:ring-ring/25"
              id="agent-prompt"
              value={agentPromptDraft}
              onChange={(event) => setAgentPromptDraft(event.target.value)}
              placeholder="Add Flowent-specific instructions for the agent."
              aria-label="Agent prompt"
            />
          </div>
        </section>

        <div className={cn(formActionsClassName, "mt-0")}>
          <Button type="submit">Save</Button>
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
