import type { FocusEvent, KeyboardEvent, ReactNode } from "react";
import { ModelParamsFields } from "@/components/ModelParamsFields";
import {
  FormInput,
  FormSwitch,
  FormTextarea,
  SecretInput,
  formHelpTextClass,
  formLabelClass,
  formSelectTriggerClass,
} from "@/components/form/FormControls";
import {
  FormSection,
  PageTitleBar,
  SettingsRow,
  SettingsStack,
  SettingsGroup,
} from "@/components/layout/PageScaffold";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cloneModelParams } from "@/lib/modelParams";
import { providerTypeLabel } from "@/lib/providerTypes";
import { cn } from "@/lib/utils";
import {
  nullableBoolFromTriState,
  triStateFromNullableBool,
  validateAutoSaveSettings,
  type SettingsAutoSaveKey,
  type SettingsSaveState,
  type TriStateCapability,
  type UserSettings,
} from "@/pages/settings/lib";
import type {
  AccessDraft,
  CommitSettingsChange,
  SaveSettingsChange,
  UpdateAccessDraft,
  UpdateSettings,
} from "@/pages/settings/useSettingsPageState";
import type { Provider, RetryPolicy, Role } from "@/types";

const retryPolicyOptions: Array<{ value: RetryPolicy; label: string }> = [
  { value: "no_retry", label: "No retry" },
  { value: "limited", label: "Limited" },
  { value: "unlimited", label: "Unlimited" },
];

type SaveStateLookup = (saveKey: SettingsAutoSaveKey) => SettingsSaveState;

const enterKeySaves = (
  event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>,
) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.currentTarget.blur();
  }
};

function SaveStateLine({
  children,
  state,
}: {
  children?: ReactNode;
  state: SettingsSaveState;
}) {
  if (state.status === "idle" && !children) {
    return null;
  }

  return (
    <div className={cn("space-y-1", formHelpTextClass)}>
      {children}
      {state.status === "saving" ? (
        <p className="text-muted-foreground">Saving...</p>
      ) : null}
      {state.status === "saved" ? (
        <p className="text-graph-status-complete">{state.message ?? "Saved"}</p>
      ) : null}
      {state.status === "error" ? (
        <p className="font-medium text-destructive">
          {state.message ?? "Could not save this change."}
        </p>
      ) : null}
    </div>
  );
}

export function SettingsHeader() {
  return <PageTitleBar title="Settings" className="mb-8" />;
}

interface AccessConfigurationSectionProps {
  accessDraft: AccessDraft;
  accessDraftError: string | null;
  onAccessCodeUpdate: () => void;
  onAccessDraftChange: UpdateAccessDraft;
  saveState: SettingsSaveState;
}

export function AccessConfigurationSection({
  accessDraft,
  accessDraftError,
  onAccessCodeUpdate,
  onAccessDraftChange,
  saveState,
}: AccessConfigurationSectionProps) {
  const isChangingAccessCode = Boolean(
    accessDraft.newCode.trim() || accessDraft.confirmCode.trim(),
  );
  const canUpdateAccessCode = isChangingAccessCode && !accessDraftError;

  return (
    <FormSection title="Access Configuration" className="mt-8 first:mt-0">
      <SettingsStack label="New Access Code">
        <div className="space-y-2 w-full max-w-lg">
          <SecretInput
            id="new-access-code"
            aria-label="New Access Code"
            value={accessDraft.newCode}
            onChange={(event) =>
              onAccessDraftChange((current) => ({
                ...current,
                newCode: event.target.value,
              }))
            }
            placeholder="Leave empty to keep"
            showLabel="Show new access code"
            hideLabel="Hide new access code"
            buttonSize="default"
          />
          {isChangingAccessCode ? (
            <p className={formHelpTextClass}>
              Updating signs you out; use the new code to return.
            </p>
          ) : null}
        </div>
      </SettingsStack>

      <SettingsStack label="Confirm Access Code">
        <div className="space-y-2 w-full max-w-lg">
          <SecretInput
            id="confirm-access-code"
            aria-label="Confirm Access Code"
            value={accessDraft.confirmCode}
            onChange={(event) =>
              onAccessDraftChange((current) => ({
                ...current,
                confirmCode: event.target.value,
              }))
            }
            placeholder="Repeat the new access code"
            showLabel="Show confirmed access code"
            hideLabel="Hide confirmed access code"
            buttonSize="default"
          />
          {accessDraftError ? (
            <p
              className={cn(
                "text-destructive font-medium pt-1",
                formHelpTextClass,
              )}
            >
              {accessDraftError}
            </p>
          ) : null}
        </div>
      </SettingsStack>
      <SettingsStack label="Access Code Update">
        <div className="space-y-2 w-full max-w-lg">
          <Button
            type="button"
            size="sm"
            onClick={onAccessCodeUpdate}
            disabled={!canUpdateAccessCode || saveState.status === "saving"}
            className="text-[13px]"
          >
            {saveState.status === "saving"
              ? "Updating..."
              : "Update access code"}
          </Button>
          <SaveStateLine state={saveState} />
        </div>
      </SettingsStack>
    </FormSection>
  );
}

interface PathConfigurationSectionProps {
  onSettingsChange: CommitSettingsChange;
  saveSettingsChange: SaveSettingsChange;
  saveState: SettingsSaveState;
  settings: UserSettings;
  updateSettings: UpdateSettings;
}

export function PathConfigurationSection({
  onSettingsChange,
  saveSettingsChange,
  saveState,
  settings,
  updateSettings,
}: PathConfigurationSectionProps) {
  const saveWorkingDirectory = (nextSettings: UserSettings) => {
    void saveSettingsChange("working_dir", nextSettings);
  };

  return (
    <FormSection title="Path Configuration" className="mt-10">
      <SettingsStack label="App Data Directory">
        <div className="space-y-2 max-w-lg">
          <FormInput
            aria-label="App Data Directory"
            value={settings.app_data_dir}
            readOnly
            mono
          />
          <p className={formHelpTextClass}>
            Read-only while Flowent is running.
          </p>
        </div>
      </SettingsStack>

      <SettingsStack label="Working Directory">
        <div className="space-y-2 max-w-lg">
          <FormInput
            aria-label="Working Directory"
            value={settings.working_dir}
            onChange={(event) =>
              updateSettings((current) => ({
                ...current,
                working_dir: event.target.value,
              }))
            }
            onBlur={(event: FocusEvent<HTMLInputElement>) => {
              const nextSettings = {
                ...settings,
                working_dir: event.target.value,
              };
              if (event.target.value === settings.working_dir) {
                saveWorkingDirectory(nextSettings);
                return;
              }
              void onSettingsChange("working_dir", () => nextSettings);
            }}
            onKeyDown={enterKeySaves}
            placeholder="/workspace/project"
            mono
          />
          <p className={formHelpTextClass}>
            Changing this does not expand saved allowed folders.
          </p>
          <SaveStateLine state={saveState}>
            {!settings.working_dir.trim() ? (
              <p className="text-destructive">
                Working Directory must not be empty.
              </p>
            ) : null}
          </SaveStateLine>
        </div>
      </SettingsStack>
    </FormSection>
  );
}

interface AssistantConfigurationSectionProps {
  assistantRole: Role | null;
  onSettingsChange: CommitSettingsChange;
  roles: Role[];
  saveSettingsChange: SaveSettingsChange;
  saveStateFor: SaveStateLookup;
  settings: UserSettings;
  updateSettings: UpdateSettings;
}

export function AssistantConfigurationSection({
  assistantRole,
  onSettingsChange,
  roles,
  saveSettingsChange,
  saveStateFor,
  settings,
  updateSettings,
}: AssistantConfigurationSectionProps) {
  const writeDirsState = saveStateFor("assistant.write_dirs");
  const saveWriteDirs = (nextSettings: UserSettings) => {
    void saveSettingsChange("assistant.write_dirs", nextSettings);
  };

  return (
    <FormSection title="Assistant Configuration">
      <SettingsRow label="Assistant Role">
        <div className="w-full">
          <Select
            value={settings.assistant.role_name}
            onValueChange={(value) =>
              void onSettingsChange("assistant.role_name", (current) => ({
                ...current,
                assistant: {
                  ...current.assistant,
                  role_name: value,
                },
              }))
            }
          >
            <SelectTrigger className={formSelectTriggerClass}>
              <SelectValue placeholder="Select a role" />
            </SelectTrigger>
            <SelectContent>
              {roles.map((role) => (
                <SelectItem key={role.name} value={role.name}>
                  <div className="flex min-w-0 flex-col items-start">
                    <span>{role.name}</span>
                    <span className="text-[11px] text-muted-foreground">
                      {role.description}
                    </span>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {assistantRole ? (
            <div
              data-testid="assistant-role-guidance"
              className={cn("mt-2", formHelpTextClass)}
            >
              <p>{assistantRole.description}</p>
            </div>
          ) : null}
          <SaveStateLine state={saveStateFor("assistant.role_name")} />
        </div>
      </SettingsRow>

      <SettingsRow label="Network Access">
        <div className="space-y-2">
          <FormSwitch
            checked={settings.assistant.allow_network}
            label="Network Access"
            onCheckedChange={(nextValue) =>
              void onSettingsChange("assistant.allow_network", (current) => ({
                ...current,
                assistant: {
                  ...current.assistant,
                  allow_network: nextValue,
                },
              }))
            }
            showStateText
          />
          {!settings.assistant.allow_network ? (
            <p className={formHelpTextClass}>
              Assistant cannot connect to the web.
            </p>
          ) : null}
          <SaveStateLine state={saveStateFor("assistant.allow_network")} />
        </div>
      </SettingsRow>

      <SettingsStack label="Write Directories">
        <div className="space-y-2 max-w-xl">
          <FormTextarea
            aria-label="Write Dirs"
            value={settings.assistant.write_dirs.join("\n")}
            onChange={(event) =>
              updateSettings((current) => ({
                ...current,
                assistant: {
                  ...current.assistant,
                  write_dirs: event.target.value.split("\n"),
                },
              }))
            }
            onBlur={(event: FocusEvent<HTMLTextAreaElement>) => {
              const nextWriteDirs = event.target.value.split("\n");
              const nextSettings = {
                ...settings,
                assistant: {
                  ...settings.assistant,
                  write_dirs: nextWriteDirs,
                },
              };
              if (
                nextWriteDirs.join("\n") ===
                settings.assistant.write_dirs.join("\n")
              ) {
                saveWriteDirs(nextSettings);
                return;
              }
              void onSettingsChange("assistant.write_dirs", () => nextSettings);
            }}
            onKeyDown={enterKeySaves}
            rows={4}
            spellCheck={false}
            placeholder="/workspace/output"
            className="min-h-[108px]"
            mono
          />
          <p className={formHelpTextClass}>
            One absolute folder path per line.
          </p>
          <SaveStateLine state={writeDirsState} />
        </div>
      </SettingsStack>
    </FormSection>
  );
}

interface LeaderConfigurationSectionProps {
  leaderRole: Role | null;
  onSettingsChange: CommitSettingsChange;
  roles: Role[];
  saveStateFor: SaveStateLookup;
  settings: UserSettings;
}

export function LeaderConfigurationSection({
  leaderRole,
  onSettingsChange,
  roles,
  saveStateFor,
  settings,
}: LeaderConfigurationSectionProps) {
  return (
    <FormSection title="Leader Configuration" className="mt-10">
      <SettingsRow label="Leader Role">
        <div className="w-full">
          <Select
            value={settings.leader.role_name}
            onValueChange={(value) =>
              void onSettingsChange("leader.role_name", (current) => ({
                ...current,
                leader: {
                  role_name: value,
                },
              }))
            }
          >
            <SelectTrigger className={formSelectTriggerClass}>
              <SelectValue placeholder="Select a role" />
            </SelectTrigger>
            <SelectContent>
              {roles.map((role) => (
                <SelectItem key={role.name} value={role.name}>
                  <div className="flex min-w-0 flex-col items-start">
                    <span>{role.name}</span>
                    <span className="text-[11px] text-muted-foreground">
                      {role.description}
                    </span>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {leaderRole ? (
            <p className={cn("mt-2", formHelpTextClass)}>
              {leaderRole.description}
            </p>
          ) : null}
          <SaveStateLine state={saveStateFor("leader.role_name")} />
        </div>
      </SettingsRow>
    </FormSection>
  );
}

interface ModelConfigurationSectionProps {
  activeProvider: Provider | null;
  activeProviderModels: Provider["models"];
  availableActiveProviderModels: Provider["models"];
  effectiveContextWindowTokens: number | null;
  effectiveModelCapabilities: {
    input_image: boolean;
    output_image: boolean;
    structured_output: boolean;
  };
  knownSafeInputTokens: number | null;
  onSettingsChange: CommitSettingsChange;
  providers: Provider[];
  saveSettingsChange: SaveSettingsChange;
  saveStateFor: SaveStateLookup;
  settings: UserSettings;
  updateSettings: UpdateSettings;
}

export function ModelConfigurationSection({
  activeProvider,
  activeProviderModels,
  availableActiveProviderModels,
  effectiveContextWindowTokens,
  effectiveModelCapabilities,
  knownSafeInputTokens,
  onSettingsChange,
  providers,
  saveSettingsChange,
  saveStateFor,
  settings,
  updateSettings,
}: ModelConfigurationSectionProps) {
  const saveChangedSettings = (
    saveKey: SettingsAutoSaveKey,
    nextSettings: UserSettings,
  ) => {
    const validationError = validateAutoSaveSettings(
      saveKey,
      nextSettings,
      knownSafeInputTokens,
    );
    if (validationError) {
      void saveSettingsChange(saveKey, nextSettings);
      return;
    }
    if (nextSettings === settings) {
      void saveSettingsChange(saveKey, nextSettings);
      return;
    }
    void onSettingsChange(saveKey, () => nextSettings);
  };

  return (
    <FormSection title="Model Configuration" className="mt-10">
      <SettingsRow label="Active Provider">
        <div className="space-y-2">
          <Select
            value={settings.model.active_provider_id}
            onValueChange={(value) => {
              void onSettingsChange("model.active_provider", (current) => ({
                ...current,
                model: {
                  ...current.model,
                  active_provider_id: value,
                  active_model: "",
                },
              }));
            }}
          >
            <SelectTrigger className={formSelectTriggerClass}>
              <SelectValue placeholder="Select a provider" />
            </SelectTrigger>
            <SelectContent>
              {providers.map((provider) => (
                <SelectItem key={provider.id} value={provider.id}>
                  {provider.name} ({providerTypeLabel(provider.type)})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {activeProvider ? (
            <p className="text-xs text-muted-foreground">
              Using {activeProvider.name} ({activeProvider.base_url})
            </p>
          ) : null}
          <SaveStateLine state={saveStateFor("model.active_provider")} />
        </div>
      </SettingsRow>

      <SettingsRow label="Model">
        <div className="space-y-3">
          {settings.model.active_provider_id ? (
            activeProviderModels.length > 0 ? (
              <div className="space-y-2">
                <label className={formLabelClass}>Provider Models</label>
                <Select
                  value={
                    availableActiveProviderModels.some(
                      (model) => model.model === settings.model.active_model,
                    )
                      ? settings.model.active_model
                      : undefined
                  }
                  onValueChange={(value) =>
                    void onSettingsChange("model.active_model", (current) => ({
                      ...current,
                      model: {
                        ...current.model,
                        active_model: value,
                      },
                    }))
                  }
                >
                  <SelectTrigger className={formSelectTriggerClass}>
                    <SelectValue placeholder="Select a provider model" />
                  </SelectTrigger>
                  <SelectContent>
                    {availableActiveProviderModels.map((model) => (
                      <SelectItem key={model.model} value={model.model}>
                        {model.model}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <p className={formHelpTextClass}>No saved provider models.</p>
            )
          ) : null}

          <FormInput
            value={settings.model.active_model}
            onChange={(event) =>
              updateSettings((current) => ({
                ...current,
                model: {
                  ...current.model,
                  active_model: event.target.value,
                },
              }))
            }
            onBlur={(event: FocusEvent<HTMLInputElement>) => {
              const nextSettings = {
                ...settings,
                model: {
                  ...settings.model,
                  active_model: event.target.value,
                },
              };
              saveChangedSettings("model.active_model", nextSettings);
            }}
            onKeyDown={enterKeySaves}
            placeholder={
              settings.model.active_provider_id
                ? "Enter model ID manually"
                : "Select a provider first"
            }
          />
        </div>
        {settings.model.active_model ? (
          <div className={cn("mt-2 space-y-1", formHelpTextClass)}>
            <p>
              Context window:{" "}
              {effectiveContextWindowTokens
                ? effectiveContextWindowTokens.toLocaleString()
                : "Not resolved"}
            </p>
            <p>
              Capabilities: input_image=
              {effectiveModelCapabilities.input_image ? "true" : "false"},
              output_image=
              {effectiveModelCapabilities.output_image ? "true" : "false"},
              structured_output=
              {effectiveModelCapabilities.structured_output ? "true" : "false"}
            </p>
          </div>
        ) : null}
        <SaveStateLine state={saveStateFor("model.active_model")} />
      </SettingsRow>

      <SettingsStack label="Model Metadata Overrides">
        <div className="space-y-3 w-full">
          <div className="grid gap-3 md:grid-cols-4">
            <div className="space-y-1">
              <label htmlFor="model-context-window" className={formLabelClass}>
                Context Window
              </label>
              <div className="flex items-center gap-2">
                <FormInput
                  id="model-context-window"
                  aria-label="Context Window"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={
                    settings.model.context_window_tokens === null
                      ? ""
                      : String(settings.model.context_window_tokens)
                  }
                  onChange={(event) => {
                    const nextValue = event.target.value.trim();
                    if (!/^\d*$/.test(nextValue)) {
                      return;
                    }
                    if (nextValue && Number.parseInt(nextValue, 10) <= 0) {
                      return;
                    }
                    updateSettings((current) => ({
                      ...current,
                      model: {
                        ...current.model,
                        context_window_tokens: nextValue
                          ? Number.parseInt(nextValue, 10)
                          : null,
                      },
                    }));
                  }}
                  onBlur={(event: FocusEvent<HTMLInputElement>) => {
                    const nextValue = event.target.value.trim();
                    const nextSettings = {
                      ...settings,
                      model: {
                        ...settings.model,
                        context_window_tokens: nextValue
                          ? Number.parseInt(nextValue, 10)
                          : null,
                      },
                    };
                    saveChangedSettings(
                      "model.context_window_tokens",
                      nextSettings,
                    );
                  }}
                  onKeyDown={enterKeySaves}
                  placeholder="Auto"
                  mono
                />
                <span className="text-[13px] font-medium text-muted-foreground">
                  tokens
                </span>
              </div>
            </div>

            <div className="space-y-1">
              <label className={formLabelClass}>Input Image</label>
              <Select
                value={triStateFromNullableBool(settings.model.input_image)}
                onValueChange={(value: TriStateCapability) =>
                  void onSettingsChange("model.input_image", (current) => ({
                    ...current,
                    model: {
                      ...current.model,
                      input_image: nullableBoolFromTriState(value),
                    },
                  }))
                }
              >
                <SelectTrigger
                  aria-label="Input Image"
                  className={formSelectTriggerClass}
                >
                  <SelectValue placeholder="Auto" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">Auto</SelectItem>
                  <SelectItem value="enabled">Enabled</SelectItem>
                  <SelectItem value="disabled">Disabled</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <label className={formLabelClass}>Output Image</label>
              <Select
                value={triStateFromNullableBool(settings.model.output_image)}
                onValueChange={(value: TriStateCapability) =>
                  void onSettingsChange("model.output_image", (current) => ({
                    ...current,
                    model: {
                      ...current.model,
                      output_image: nullableBoolFromTriState(value),
                    },
                  }))
                }
              >
                <SelectTrigger
                  aria-label="Output Image"
                  className={formSelectTriggerClass}
                >
                  <SelectValue placeholder="Auto" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">Auto</SelectItem>
                  <SelectItem value="enabled">Enabled</SelectItem>
                  <SelectItem value="disabled">Disabled</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <label className={formLabelClass}>Structured Output</label>
              <Select
                value={triStateFromNullableBool(
                  settings.model.structured_output ?? null,
                )}
                onValueChange={(value: TriStateCapability) =>
                  void onSettingsChange(
                    "model.structured_output",
                    (current) => ({
                      ...current,
                      model: {
                        ...current.model,
                        structured_output: nullableBoolFromTriState(value),
                      },
                    }),
                  )
                }
              >
                <SelectTrigger
                  aria-label="Structured Output"
                  className={formSelectTriggerClass}
                >
                  <SelectValue placeholder="Auto" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">Auto</SelectItem>
                  <SelectItem value="enabled">Enabled</SelectItem>
                  <SelectItem value="disabled">Disabled</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid gap-2 md:grid-cols-4">
            <SaveStateLine
              state={saveStateFor("model.context_window_tokens")}
            />
            <SaveStateLine state={saveStateFor("model.input_image")} />
            <SaveStateLine state={saveStateFor("model.output_image")} />
            <SaveStateLine state={saveStateFor("model.structured_output")} />
          </div>
        </div>
      </SettingsStack>

      <SettingsStack label="Default Model Parameters">
        <div className="rounded-xl border border-border bg-card/30 p-5">
          <ModelParamsFields
            className="w-full"
            value={cloneModelParams(settings.model.params)}
            onChange={(params) =>
              updateSettings((current) => ({
                ...current,
                model: {
                  ...current.model,
                  params,
                },
              }))
            }
            onCommit={(params) => {
              saveChangedSettings("model.params", {
                ...settings,
                model: {
                  ...settings.model,
                  params,
                },
              });
            }}
            emptyLabel="Not set"
            numberPlaceholder="Not set"
            reasoningDisableLabel={null}
          />
          <div className="mt-3">
            <SaveStateLine state={saveStateFor("model.params")} />
          </div>
        </div>
      </SettingsStack>

      <SettingsRow label="Request Timeout">
        <div className="space-y-2 w-full max-w-xs">
          <div className="flex items-center gap-2">
            <FormInput
              aria-label="Request Timeout"
              inputMode="numeric"
              pattern="[0-9]*"
              value={String(settings.model.timeout_ms)}
              onChange={(event) => {
                const nextValue = event.target.value.trim();
                if (!/^\d+$/.test(nextValue)) {
                  return;
                }
                const parsed = Number.parseInt(nextValue, 10);
                if (!Number.isSafeInteger(parsed) || parsed <= 0) {
                  return;
                }
                updateSettings((current) => ({
                  ...current,
                  model: {
                    ...current.model,
                    timeout_ms: parsed,
                  },
                }));
              }}
              onBlur={(event: FocusEvent<HTMLInputElement>) => {
                const parsed = Number.parseInt(event.target.value.trim(), 10);
                const nextSettings = {
                  ...settings,
                  model: {
                    ...settings.model,
                    timeout_ms: parsed,
                  },
                };
                saveChangedSettings("model.timeout_ms", nextSettings);
              }}
              onKeyDown={enterKeySaves}
              mono
            />
            <span className="text-[13px] font-medium text-muted-foreground">
              ms
            </span>
          </div>
          <SaveStateLine state={saveStateFor("model.timeout_ms")} />
        </div>
      </SettingsRow>

      <SettingsStack label="Retry Strategy">
        <SettingsGroup className="max-w-3xl">
          <div className="grid gap-6 md:grid-cols-[1fr_2fr]">
            <div className="space-y-1">
              <label className={formLabelClass}>Policy</label>
              <Select
                value={settings.model.retry_policy}
                onValueChange={(value: RetryPolicy) =>
                  void onSettingsChange("model.retry_policy", (current) => ({
                    ...current,
                    model: {
                      ...current.model,
                      retry_policy: value,
                    },
                  }))
                }
              >
                <SelectTrigger className={formSelectTriggerClass}>
                  <SelectValue placeholder="Select a retry policy" />
                </SelectTrigger>
                <SelectContent>
                  {retryPolicyOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {settings.model.retry_policy === "limited" ? (
              <div className="space-y-1">
                <label htmlFor="retry-attempts" className={formLabelClass}>
                  Max Attempts
                </label>
                <FormInput
                  id="retry-attempts"
                  aria-label="Retry Attempts"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={String(settings.model.max_retries)}
                  onChange={(event) => {
                    const nextValue = event.target.value.trim();
                    if (!/^\d+$/.test(nextValue)) {
                      return;
                    }
                    const parsed = Number.parseInt(nextValue, 10);
                    if (!Number.isSafeInteger(parsed) || parsed <= 0) {
                      return;
                    }
                    updateSettings((current) => ({
                      ...current,
                      model: {
                        ...current.model,
                        max_retries: parsed,
                      },
                    }));
                  }}
                  onBlur={(event: FocusEvent<HTMLInputElement>) => {
                    const parsed = Number.parseInt(
                      event.target.value.trim(),
                      10,
                    );
                    const nextSettings = {
                      ...settings,
                      model: {
                        ...settings.model,
                        max_retries: parsed,
                      },
                    };
                    saveChangedSettings("model.max_retries", nextSettings);
                  }}
                  onKeyDown={enterKeySaves}
                  mono
                />
              </div>
            ) : (
              <div />
            )}
          </div>

          <div className="grid gap-3 md:grid-cols-3 mt-2 border-t border-border/40 pt-4">
            <div className="space-y-1">
              <label htmlFor="retry-initial-delay" className={formLabelClass}>
                Initial Delay
              </label>
              <div className="flex items-center gap-2">
                <FormInput
                  id="retry-initial-delay"
                  aria-label="Initial Delay"
                  inputMode="decimal"
                  value={String(settings.model.retry_initial_delay_seconds)}
                  onChange={(event) => {
                    const nextValue = event.target.value.trim();
                    if (!/^\d+(\.\d+)?$/.test(nextValue)) {
                      return;
                    }
                    const parsed = Number.parseFloat(nextValue);
                    if (!Number.isFinite(parsed) || parsed <= 0) {
                      return;
                    }
                    updateSettings((current) => ({
                      ...current,
                      model: {
                        ...current.model,
                        retry_initial_delay_seconds: parsed,
                      },
                    }));
                  }}
                  onBlur={(event: FocusEvent<HTMLInputElement>) => {
                    const parsed = Number.parseFloat(event.target.value.trim());
                    const nextSettings = {
                      ...settings,
                      model: {
                        ...settings.model,
                        retry_initial_delay_seconds: parsed,
                      },
                    };
                    saveChangedSettings("model.retry_backoff", nextSettings);
                  }}
                  onKeyDown={enterKeySaves}
                  mono
                />
                <span className="text-[13px] font-medium text-muted-foreground">
                  s
                </span>
              </div>
            </div>

            <div className="space-y-1">
              <label htmlFor="retry-max-delay" className={formLabelClass}>
                Max Delay
              </label>
              <div className="flex items-center gap-2">
                <FormInput
                  id="retry-max-delay"
                  aria-label="Max Delay"
                  inputMode="decimal"
                  value={String(settings.model.retry_max_delay_seconds)}
                  onChange={(event) => {
                    const nextValue = event.target.value.trim();
                    if (!/^\d+(\.\d+)?$/.test(nextValue)) {
                      return;
                    }
                    const parsed = Number.parseFloat(nextValue);
                    if (!Number.isFinite(parsed) || parsed <= 0) {
                      return;
                    }
                    updateSettings((current) => ({
                      ...current,
                      model: {
                        ...current.model,
                        retry_max_delay_seconds: parsed,
                      },
                    }));
                  }}
                  onBlur={(event: FocusEvent<HTMLInputElement>) => {
                    const parsed = Number.parseFloat(event.target.value.trim());
                    const nextSettings = {
                      ...settings,
                      model: {
                        ...settings.model,
                        retry_max_delay_seconds: parsed,
                      },
                    };
                    saveChangedSettings("model.retry_backoff", nextSettings);
                  }}
                  onKeyDown={enterKeySaves}
                  mono
                />
                <span className="text-[13px] font-medium text-muted-foreground">
                  s
                </span>
              </div>
            </div>

            <div className="space-y-1">
              <label
                htmlFor="retry-backoff-cap-retries"
                className={formLabelClass}
              >
                Cap Retries
              </label>
              <FormInput
                id="retry-backoff-cap-retries"
                aria-label="Cap Retries"
                inputMode="numeric"
                pattern="[0-9]*"
                value={String(settings.model.retry_backoff_cap_retries)}
                onChange={(event) => {
                  const nextValue = event.target.value.trim();
                  if (!/^\d+$/.test(nextValue)) {
                    return;
                  }
                  const parsed = Number.parseInt(nextValue, 10);
                  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
                    return;
                  }
                  updateSettings((current) => ({
                    ...current,
                    model: {
                      ...current.model,
                      retry_backoff_cap_retries: parsed,
                    },
                  }));
                }}
                onBlur={(event: FocusEvent<HTMLInputElement>) => {
                  const parsed = Number.parseInt(event.target.value.trim(), 10);
                  const nextSettings = {
                    ...settings,
                    model: {
                      ...settings.model,
                      retry_backoff_cap_retries: parsed,
                    },
                  };
                  saveChangedSettings("model.retry_backoff", nextSettings);
                }}
                onKeyDown={enterKeySaves}
                mono
              />
            </div>
          </div>
          <div className="grid gap-2 md:grid-cols-3">
            <SaveStateLine state={saveStateFor("model.retry_policy")} />
            <SaveStateLine state={saveStateFor("model.max_retries")} />
            <SaveStateLine state={saveStateFor("model.retry_backoff")} />
          </div>
        </SettingsGroup>
      </SettingsStack>

      <SettingsStack label="Automatic Compact">
        <div className="space-y-3 w-full max-w-sm">
          <div className="space-y-1">
            <label
              htmlFor="auto-compact-token-limit"
              className={formLabelClass}
            >
              Token Limit
            </label>
            <div className="flex items-center gap-2">
              <FormInput
                id="auto-compact-token-limit"
                aria-label="Automatic Compact Token Limit"
                inputMode="numeric"
                pattern="[0-9]*"
                value={
                  settings.model.auto_compact_token_limit === null
                    ? ""
                    : String(settings.model.auto_compact_token_limit)
                }
                onChange={(event) => {
                  const nextValue = event.target.value.trim();
                  if (!/^\d*$/.test(nextValue)) {
                    return;
                  }
                  if (nextValue && Number.parseInt(nextValue, 10) <= 0) {
                    return;
                  }
                  updateSettings((current) => ({
                    ...current,
                    model: {
                      ...current.model,
                      auto_compact_token_limit: nextValue
                        ? Number.parseInt(nextValue, 10)
                        : null,
                    },
                  }));
                }}
                onBlur={(event: FocusEvent<HTMLInputElement>) => {
                  const nextValue = event.target.value.trim();
                  const nextSettings = {
                    ...settings,
                    model: {
                      ...settings.model,
                      auto_compact_token_limit: nextValue
                        ? Number.parseInt(nextValue, 10)
                        : null,
                    },
                  };
                  saveChangedSettings(
                    "model.auto_compact_token_limit",
                    nextSettings,
                  );
                }}
                onKeyDown={enterKeySaves}
                placeholder="Disabled"
                mono
              />
              <span className="text-[13px] font-medium text-muted-foreground">
                tokens
              </span>
            </div>
          </div>

          {knownSafeInputTokens !== null ? (
            <p className={formHelpTextClass}>
              Known safe input window: {knownSafeInputTokens.toLocaleString()}{" "}
              tokens.
              {settings.model.auto_compact_token_limit !== null &&
              settings.model.auto_compact_token_limit >=
                knownSafeInputTokens ? (
                <span className="text-destructive">
                  {" "}
                  Lower the token limit before it can be saved.
                </span>
              ) : null}
            </p>
          ) : settings.model.auto_compact_token_limit !== null ? (
            <p className="text-[11px] leading-relaxed text-graph-status-idle">
              The current model window is not resolved, so this token limit can
              be saved but cannot be fully validated yet.
            </p>
          ) : null}
          <SaveStateLine
            state={saveStateFor("model.auto_compact_token_limit")}
          />
        </div>
      </SettingsStack>
    </FormSection>
  );
}

interface SettingsFooterProps {
  appVersion: string | null;
}

export function SettingsFooter({ appVersion }: SettingsFooterProps) {
  return (
    <div className="mt-12 flex flex-col items-center pt-2 pb-6 text-center">
      <p className="text-[11px] font-medium text-muted-foreground">
        Flowent Agent Studio v{appVersion ?? "—"}
      </p>
    </div>
  );
}
