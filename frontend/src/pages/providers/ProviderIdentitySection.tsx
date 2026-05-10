import { FormSection, SettingsRow } from "@/components/layout/PageScaffold";
import {
  FormInput,
  formSelectTriggerClass,
} from "@/components/form/FormControls";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { providerTypeOptions } from "@/lib/providerTypes";
import type { ProviderDraft } from "@/pages/providers/lib";

interface ProviderIdentitySectionProps {
  draft: ProviderDraft;
  onUpdateDraft: (draft: ProviderDraft) => void;
}

export function ProviderIdentitySection({
  draft,
  onUpdateDraft,
}: ProviderIdentitySectionProps) {
  return (
    <FormSection
      title="Identity"
      className="mb-10"
      contentClassName="rounded-lg border-dashed bg-card/30"
    >
      <SettingsRow label="Name">
        <FormInput
          value={draft.name}
          onChange={(event) =>
            onUpdateDraft({ ...draft, name: event.target.value })
          }
          placeholder="e.g., OpenAI Production"
        />
      </SettingsRow>
      <SettingsRow label="Type">
        <Select
          value={draft.type}
          onValueChange={(value) => onUpdateDraft({ ...draft, type: value })}
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
  );
}
