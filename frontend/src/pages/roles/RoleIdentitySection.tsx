import {
  FormInput,
  FormTextarea,
  formReadOnlyClass,
} from "@/components/form/FormControls";
import { FormSection, SettingsRow } from "@/components/layout/PageScaffold";
import { cn } from "@/lib/utils";
import type { RoleDraft } from "@/pages/roles/lib";
import type { Role } from "@/types";

interface RoleIdentitySectionProps {
  activeRole: Role | null;
  draft: RoleDraft;
  isReadOnly: boolean;
  onUpdateDraft: (updater: (current: RoleDraft) => RoleDraft) => void;
  shouldLockIdentityFields: boolean;
}

export function RoleIdentitySection({
  activeRole,
  draft,
  isReadOnly,
  onUpdateDraft,
  shouldLockIdentityFields,
}: RoleIdentitySectionProps) {
  const isIdentityReadOnly = isReadOnly || shouldLockIdentityFields;

  return (
    <FormSection
      title="Identity"
      className="mb-10"
      contentClassName="rounded-lg border-dashed bg-card/30"
    >
      <SettingsRow label="Role Name">
        <FormInput
          value={draft.name}
          onChange={(event) =>
            onUpdateDraft((current) => ({
              ...current,
              name: event.target.value,
            }))
          }
          readOnly={isIdentityReadOnly}
          placeholder="e.g., Code Reviewer"
          className={cn(isIdentityReadOnly ? formReadOnlyClass : "")}
        />
      </SettingsRow>

      <SettingsRow label="Description">
        <FormTextarea
          value={draft.description}
          onChange={(event) =>
            onUpdateDraft((current) => ({
              ...current,
              description: event.target.value,
            }))
          }
          readOnly={isIdentityReadOnly}
          placeholder="Briefly explain what this role is best suited for"
          rows={3}
          className={cn(
            "resize-y",
            isIdentityReadOnly ? formReadOnlyClass : "",
          )}
        />
      </SettingsRow>

      <SettingsRow label="System Prompt">
        <div className="space-y-2">
          <FormTextarea
            value={draft.system_prompt}
            onChange={(event) =>
              onUpdateDraft((current) => ({
                ...current,
                system_prompt: event.target.value,
              }))
            }
            readOnly={isIdentityReadOnly}
            placeholder="You are a helpful assistant that..."
            rows={12}
            className={cn(
              "resize-y",
              isIdentityReadOnly ? formReadOnlyClass : "",
            )}
            mono
          />
          {isIdentityReadOnly ? (
            <p className="text-[11px] text-muted-foreground">
              {activeRole?.is_builtin || shouldLockIdentityFields
                ? "Built-in role fields are locked."
                : "View only."}
            </p>
          ) : null}
        </div>
      </SettingsRow>
    </FormSection>
  );
}
