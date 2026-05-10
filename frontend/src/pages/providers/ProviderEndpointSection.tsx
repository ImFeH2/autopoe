import {
  FormInput,
  FormTextarea,
  SecretInput,
} from "@/components/form/FormControls";
import { FormSection, SettingsRow } from "@/components/layout/PageScaffold";
import { cn } from "@/lib/utils";
import {
  parseNonNegativeIntegerInput,
  type ProviderDraft,
} from "@/pages/providers/lib";

interface ProviderEndpointSectionProps {
  draft: ProviderDraft;
  endpointPreview: {
    error: string | null;
    previewUrl: string | null;
  };
  onUpdateDraft: (draft: ProviderDraft) => void;
  parsedHeaders: {
    error: string | null;
  };
}

export function ProviderEndpointSection({
  draft,
  endpointPreview,
  onUpdateDraft,
  parsedHeaders,
}: ProviderEndpointSectionProps) {
  return (
    <FormSection
      title="Connection"
      separated
      contentClassName="rounded-lg border-dashed bg-card/30"
    >
      <SettingsRow label="Base URL">
        <FormInput
          value={draft.base_url}
          onChange={(event) =>
            onUpdateDraft({ ...draft, base_url: event.target.value })
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
      <SettingsRow label="Access Key">
        <SecretInput
          value={draft.api_key}
          onChange={(event) =>
            onUpdateDraft({ ...draft, api_key: event.target.value })
          }
          placeholder="sk-..."
          mono
          showLabel="Show access key"
          hideLabel="Hide access key"
        />
      </SettingsRow>
      <SettingsRow label="Headers">
        <div className="space-y-2">
          <FormTextarea
            value={draft.headers_text}
            onChange={(event) =>
              onUpdateDraft({
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
        <div className="flex items-center gap-2">
          <FormInput
            aria-label="429 Retry Delay"
            inputMode="numeric"
            pattern="[0-9]*"
            value={String(draft.retry_429_delay_seconds)}
            onChange={(event) => {
              const parsedValue = parseNonNegativeIntegerInput(
                event.target.value,
              );
              if (parsedValue === null) {
                return;
              }
              onUpdateDraft({
                ...draft,
                retry_429_delay_seconds: parsedValue,
              });
            }}
            mono
          />
          <span className="text-[13px] font-medium text-muted-foreground">
            s
          </span>
        </div>
      </SettingsRow>
    </FormSection>
  );
}
