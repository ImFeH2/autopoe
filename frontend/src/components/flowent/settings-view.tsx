import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { useTranslation } from "react-i18next";

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
import type { Provider } from "@/features/providers/model/provider-types";
import type {
  ReasoningEffort,
  RuntimeSettings,
} from "@/features/settings/model/runtime-settings-types";
import { changeAppLanguage, currentAppLanguage } from "@/i18n/i18n";
import { isAppLanguage } from "@/i18n/languages";
import { cn } from "@/lib/utils";

const reasoningOptions = [
  {
    labelKey: "settings.modelRouting.reasoningOptions.default",
    value: "default",
  },
  {
    labelKey: "settings.modelRouting.reasoningOptions.low",
    value: "low",
  },
  {
    labelKey: "settings.modelRouting.reasoningOptions.medium",
    value: "medium",
  },
  {
    labelKey: "settings.modelRouting.reasoningOptions.high",
    value: "high",
  },
  {
    labelKey: "settings.modelRouting.reasoningOptions.xhigh",
    value: "xhigh",
  },
] as const satisfies ReadonlyArray<{
  labelKey: string;
  value: ReasoningEffort;
}>;

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
  const { t } = useTranslation();
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
  const activeLanguage = currentAppLanguage();

  const selectLanguage = (language: string) => {
    if (isAppLanguage(language)) {
      void changeAppLanguage(language);
    }
  };

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
      aria-label={t("settings.pageLabel")}
    >
      <div className="m-8 grid gap-5 bg-black max-[900px]:m-5">
        <section className="grid gap-3">
          <h3 className="text-base font-semibold text-white">
            {t("settings.language.title")}
          </h3>
          <div className={dashedPanelClassName}>
            <div className={dataRowClassName}>
              <Label
                className={cn(fieldLabelClassName, dataRowLabelClassName)}
                htmlFor="app-language"
              >
                {t("settings.language.label")}
              </Label>
              <Select value={activeLanguage} onValueChange={selectLanguage}>
                <SelectTrigger
                  aria-label={t("settings.language.label")}
                  className={fieldTriggerClassName}
                  id="app-language"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="en">
                    {t("settings.language.english")}
                  </SelectItem>
                  <SelectItem value="zh-CN">
                    {t("settings.language.simplifiedChinese")}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </section>

        <form
          className="grid gap-5"
          aria-label={t("settings.runtimeFormLabel")}
          onSubmit={saveSettings}
        >
          <section className="grid gap-3">
            <h3 className="text-base font-semibold text-white">
              {t("settings.modelRouting.title")}
            </h3>
            <div className={dashedPanelClassName}>
              <div className="grid gap-0">
                {providers.length === 0 ? (
                  <div className="p-3">
                    <p className={emptyStateClassName}>
                      {t("settings.modelRouting.noProviders")}
                    </p>
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
              <h3 className="text-base font-semibold text-white">
                {t("settings.agentPrompt.title")}
              </h3>
            </div>
            <div className={cn(dashedPanelClassName, "p-3")}>
              <Label className="sr-only" htmlFor="agent-prompt">
                {t("settings.agentPrompt.title")}
              </Label>
              <Textarea
                className="min-h-48 resize-y rounded-md border-white/10 bg-input/30 px-3 py-2 text-base leading-5 text-white shadow-none placeholder:text-[#777] focus-visible:border-[#7a7a7a] focus-visible:ring-2 focus-visible:ring-ring/25"
                id="agent-prompt"
                value={agentPromptDraft}
                onChange={(event) => setAgentPromptDraft(event.target.value)}
                placeholder={t("settings.agentPrompt.placeholder")}
                aria-label={t("settings.agentPrompt.title")}
              />
            </div>
          </section>

          <div className={cn(formActionsClassName, "mt-0")}>
            <Button type="submit" disabled={!isManualContextLimitValid}>
              {t("settings.save")}
            </Button>
          </div>
        </form>
      </div>
      {appVersion ? (
        <p className="mx-8 mt-auto pb-6 text-center text-xs leading-5 text-white/30 max-[900px]:mx-5">
          {t("settings.version", { version: appVersion })}
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
  const { t } = useTranslation();
  const errorId = "context-limit-error";
  const showError = contextLimitMode === "manual" && !isValid;

  return (
    <div className={dataRowClassName}>
      <Label
        className={cn(fieldLabelClassName, dataRowLabelClassName)}
        htmlFor="context-limit-mode"
      >
        {t("settings.modelRouting.contextWindow")}
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
              aria-label={t("settings.modelRouting.contextWindow")}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="auto">
                {t("settings.modelRouting.contextLimitModes.auto")}
              </SelectItem>
              <SelectItem value="manual">
                {t("settings.modelRouting.contextLimitModes.manual")}
              </SelectItem>
            </SelectContent>
          </Select>
          {contextLimitMode === "manual" ? (
            <Input
              aria-describedby={showError ? errorId : undefined}
              aria-invalid={showError}
              aria-label={t("settings.modelRouting.contextSize")}
              className={fieldInputClassName}
              inputMode="numeric"
              placeholder={t("settings.modelRouting.contextSizePlaceholder")}
              value={contextLimitDraft}
              onChange={(event) =>
                onContextLimitDraftChange(event.target.value)
              }
            />
          ) : null}
        </div>
        {showError ? (
          <p className="m-0 text-xs leading-4 text-red-400" id={errorId}>
            {t("settings.modelRouting.contextSizeError")}
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
  const { t } = useTranslation();

  return (
    <div className={dataRowClassName}>
      <Label
        className={cn(fieldLabelClassName, dataRowLabelClassName)}
        htmlFor="active-provider"
      >
        {t("settings.modelRouting.provider")}
      </Label>
      <Select value={selectedProviderId} onValueChange={onProviderChange}>
        <SelectTrigger
          className={fieldTriggerClassName}
          disabled={providers.length === 0}
          id="active-provider"
          aria-label={t("settings.modelRouting.provider")}
        >
          <SelectValue placeholder={t("settings.modelRouting.noProviders")} />
        </SelectTrigger>
        <SelectContent>
          {providers.length === 0 ? (
            <SelectItem value="none" disabled>
              {t("settings.modelRouting.noProviders")}
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
  const { t } = useTranslation();

  return (
    <div className={dataRowClassName}>
      <Label
        className={cn(fieldLabelClassName, dataRowLabelClassName)}
        htmlFor="reasoning-effort"
      >
        {t("settings.modelRouting.reasoning")}
      </Label>
      <Select value={reasoningEffort} onValueChange={onReasoningEffortChange}>
        <SelectTrigger
          className={fieldTriggerClassName}
          id="reasoning-effort"
          aria-label={t("settings.modelRouting.reasoning")}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {reasoningOptions.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {t(option.labelKey)}
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
  const { t } = useTranslation();

  return (
    <div className={dataRowClassName}>
      <Label
        className={cn(fieldLabelClassName, dataRowLabelClassName)}
        htmlFor="active-model"
      >
        {t("settings.modelRouting.model")}
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
          aria-label={t("settings.modelRouting.model")}
        >
          <SelectValue placeholder={t("settings.modelRouting.noModels")} />
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
