import { Save } from "lucide-react";
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
  type TriStateCapability,
  type UserSettings,
} from "@/pages/settings/lib";
import type {
  AccessDraft,
  UpdateAccessDraft,
  UpdateSettings,
} from "@/pages/settings/useSettingsPageState";
import type { Provider, RetryPolicy, Role } from "@/types";

const retryPolicyOptions: Array<{ value: RetryPolicy; label: string }> = [
  { value: "no_retry", label: "No retry" },
  { value: "limited", label: "Limited" },
  { value: "unlimited", label: "Unlimited" },
];

interface SettingsHeaderProps {
  accessDraftError: string | null;
  onSave: () => void;
  saving: boolean;
  settings: UserSettings;
}

export function SettingsHeader({
  accessDraftError,
  onSave,
  saving,
  settings,
}: SettingsHeaderProps) {
  return (
    <PageTitleBar
      title="Settings"
      actions={
        <Button
          type="button"
          size="sm"
          onClick={onSave}
          disabled={
            saving || Boolean(accessDraftError) || !settings.working_dir.trim()
          }
          className="text-[13px]"
        >
          <Save className="size-4" />
          {saving ? "Saving..." : "Save Changes"}
        </Button>
      }
      className="mb-8"
    />
  );
}

interface AccessConfigurationSectionProps {
  accessDraft: AccessDraft;
  accessDraftError: string | null;
  onAccessDraftChange: UpdateAccessDraft;
}

export function AccessConfigurationSection({
  accessDraft,
  accessDraftError,
  onAccessDraftChange,
}: AccessConfigurationSectionProps) {
  return (
    <FormSection title="Access Configuration" className="mt-8 first:mt-0">
      <SettingsRow label="New Access Code">
        <div className="space-y-2 w-full">
          <SecretInput
            id="new-access-code"
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
        </div>
      </SettingsRow>

      <SettingsRow label="Confirm Access Code">
        <div className="space-y-2 w-full">
          <SecretInput
            id="confirm-access-code"
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
      </SettingsRow>
    </FormSection>
  );
}

interface PathConfigurationSectionProps {
  onSettingsChange: UpdateSettings;
  settings: UserSettings;
}

export function PathConfigurationSection({
  onSettingsChange,
  settings,
}: PathConfigurationSectionProps) {
  return (
    <FormSection title="Path Configuration" className="mt-10">
      <SettingsRow label="App Data Directory">
        <div className="space-y-2">
          <FormInput
            aria-label="App Data Directory"
            value={settings.app_data_dir}
            readOnly
            mono
          />
        </div>
      </SettingsRow>

      <SettingsRow label="Working Directory">
        <div className="space-y-2">
          <FormInput
            aria-label="Working Directory"
            value={settings.working_dir}
            onChange={(event) =>
              onSettingsChange((current) => ({
                ...current,
                working_dir: event.target.value,
              }))
            }
            placeholder="/workspace/project"
            mono
          />
          <div className={cn("space-y-2", formHelpTextClass)}>
            {!settings.working_dir.trim() ? (
              <p className="text-destructive">
                Working Directory must not be empty.
              </p>
            ) : null}
          </div>
        </div>
      </SettingsRow>
    </FormSection>
  );
}

interface AssistantConfigurationSectionProps {
  assistantRole: Role | null;
  onSettingsChange: UpdateSettings;
  roles: Role[];
  settings: UserSettings;
}

export function AssistantConfigurationSection({
  assistantRole,
  onSettingsChange,
  roles,
  settings,
}: AssistantConfigurationSectionProps) {
  return (
    <FormSection title="Assistant Configuration">
      <SettingsRow label="Assistant Role">
        <Select
          value={settings.assistant.role_name}
          onValueChange={(value) =>
            onSettingsChange((current) => ({
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
      </SettingsRow>

      <SettingsRow label="Network Access">
        <div className="space-y-2">
          <FormSwitch
            checked={settings.assistant.allow_network}
            label="Network Access"
            onCheckedChange={(nextValue) =>
              onSettingsChange((current) => ({
                ...current,
                assistant: {
                  ...current.assistant,
                  allow_network: nextValue,
                },
              }))
            }
            showStateText
          />
        </div>
      </SettingsRow>

      <SettingsRow label="Write Dirs">
        <div className="space-y-2">
          <FormTextarea
            aria-label="Write Dirs"
            value={settings.assistant.write_dirs.join("\n")}
            onChange={(event) =>
              onSettingsChange((current) => ({
                ...current,
                assistant: {
                  ...current.assistant,
                  write_dirs: event.target.value.split("\n"),
                },
              }))
            }
            rows={4}
            spellCheck={false}
            placeholder="/workspace/output"
            className="min-h-[108px]"
            mono
          />
        </div>
      </SettingsRow>
    </FormSection>
  );
}

interface LeaderConfigurationSectionProps {
  leaderRole: Role | null;
  onSettingsChange: UpdateSettings;
  roles: Role[];
  settings: UserSettings;
}

export function LeaderConfigurationSection({
  leaderRole,
  onSettingsChange,
  roles,
  settings,
}: LeaderConfigurationSectionProps) {
  return (
    <FormSection title="Leader Configuration" className="mt-10">
      <SettingsRow label="Leader Role">
        <Select
          value={settings.leader.role_name}
          onValueChange={(value) =>
            onSettingsChange((current) => ({
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
  onSettingsChange: UpdateSettings;
  providers: Provider[];
  settings: UserSettings;
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
  settings,
}: ModelConfigurationSectionProps) {
  return (
    <FormSection title="Model Configuration" className="mt-10">
      <SettingsRow label="Active Provider">
        <Select
          value={settings.model.active_provider_id}
          onValueChange={(value) => {
            onSettingsChange((current) => ({
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
          <p className="mt-2 text-xs text-muted-foreground">
            Using {activeProvider.name} ({activeProvider.base_url})
          </p>
        ) : null}
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
                    onSettingsChange((current) => ({
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
              onSettingsChange((current) => ({
                ...current,
                model: {
                  ...current.model,
                  active_model: event.target.value,
                },
              }))
            }
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
      </SettingsRow>

      <SettingsRow label="Model Metadata Overrides">
        <div className="space-y-3">
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
                    onSettingsChange((current) => ({
                      ...current,
                      model: {
                        ...current.model,
                        context_window_tokens: nextValue
                          ? Number.parseInt(nextValue, 10)
                          : null,
                      },
                    }));
                  }}
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
                  onSettingsChange((current) => ({
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
                  onSettingsChange((current) => ({
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
                  onSettingsChange((current) => ({
                    ...current,
                    model: {
                      ...current.model,
                      structured_output: nullableBoolFromTriState(value),
                    },
                  }))
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
        </div>
      </SettingsRow>

      <SettingsRow
        label="Default Model Parameters"
        valueClassName="w-full md:w-80"
      >
        <div className="rounded-xl border border-border bg-card/30 p-5">
          <ModelParamsFields
            className="w-full"
            value={cloneModelParams(settings.model.params)}
            onChange={(params) =>
              onSettingsChange((current) => ({
                ...current,
                model: {
                  ...current.model,
                  params,
                },
              }))
            }
            emptyLabel="Not set"
            numberPlaceholder="Not set"
            reasoningDisableLabel={null}
            helperText="Empty fields are omitted from outgoing provider requests. Reasoning effort and verbosity are mainly effective on reasoning-capable providers such as OpenAI Responses with GPT-5 family models."
          />
        </div>
      </SettingsRow>

      <SettingsRow label="Request Timeout">
        <div className="space-y-2">
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
                onSettingsChange((current) => ({
                  ...current,
                  model: {
                    ...current.model,
                    timeout_ms: parsed,
                  },
                }));
              }}
              mono
            />
            <span className="text-[13px] font-medium text-muted-foreground">
              ms
            </span>
          </div>
        </div>
      </SettingsRow>

      <SettingsRow label="Retry Policy">
        <div className="space-y-3">
          <Select
            value={settings.model.retry_policy}
            onValueChange={(value: RetryPolicy) =>
              onSettingsChange((current) => ({
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

          {settings.model.retry_policy === "limited" ? (
            <div className="space-y-2">
              <div className="space-y-1">
                <label htmlFor="retry-attempts" className={formLabelClass}>
                  Retry Attempts
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
                    onSettingsChange((current) => ({
                      ...current,
                      model: {
                        ...current.model,
                        max_retries: parsed,
                      },
                    }));
                  }}
                  mono
                />
              </div>
            </div>
          ) : null}
        </div>
      </SettingsRow>

      <SettingsRow label="Retry Backoff">
        <div className="space-y-3">
          <div className="grid gap-3 md:grid-cols-3">
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
                    onSettingsChange((current) => ({
                      ...current,
                      model: {
                        ...current.model,
                        retry_initial_delay_seconds: parsed,
                      },
                    }));
                  }}
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
                    onSettingsChange((current) => ({
                      ...current,
                      model: {
                        ...current.model,
                        retry_max_delay_seconds: parsed,
                      },
                    }));
                  }}
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
                  onSettingsChange((current) => ({
                    ...current,
                    model: {
                      ...current.model,
                      retry_backoff_cap_retries: parsed,
                    },
                  }));
                }}
                mono
              />
            </div>
          </div>
        </div>
      </SettingsRow>

      <SettingsRow label="Automatic Compact">
        <div className="space-y-3">
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
                  onSettingsChange((current) => ({
                    ...current,
                    model: {
                      ...current.model,
                      auto_compact_token_limit: nextValue
                        ? Number.parseInt(nextValue, 10)
                        : null,
                    },
                  }));
                }}
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
              settings.model.auto_compact_token_limit >= knownSafeInputTokens
                ? " Save is blocked until the token limit is lower than this window."
                : null}
            </p>
          ) : settings.model.auto_compact_token_limit !== null ? (
            <p className="text-[11px] leading-relaxed text-graph-status-idle">
              The current model window is not resolved, so this token limit can
              be saved but cannot be fully validated yet.
            </p>
          ) : null}
        </div>
      </SettingsRow>
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
      <p className="mt-1.5 text-[10px] text-muted-foreground/80">
        A multi-agent collaboration framework.
      </p>
    </div>
  );
}
