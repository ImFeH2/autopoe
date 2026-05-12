import { Info } from "lucide-react";
import { ModelParamsFields } from "@/components/ModelParamsFields";
import { FormSection } from "@/components/layout/PageScaffold";
import { Button } from "@/components/ui/button";
import { PanelCard, StatusChip } from "@/components/surface";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cloneModelParams, isEmptyModelParams } from "@/lib/modelParams";
import type { RoleDraft } from "@/pages/roles/lib";
import { RoleModeSwitch } from "@/pages/roles/RoleModeSwitch";

interface RoleModelParametersSectionProps {
  draft: RoleDraft;
  isReadOnly: boolean;
  onModelParamsModeChange: (enabled: boolean) => void;
  onUpdateDraft: (updater: (current: RoleDraft) => RoleDraft) => void;
}

export function RoleModelParametersSection({
  draft,
  isReadOnly,
  onModelParamsModeChange,
  onUpdateDraft,
}: RoleModelParametersSectionProps) {
  const hasParameterOverrides = !isEmptyModelParams(draft.model_params);

  return (
    <FormSection
      title="Model Parameters"
      className="mb-10"
      separated
      contentClassName="border-transparent bg-transparent p-0 shadow-none"
    >
      <div className="space-y-6">
        <div className="flex flex-wrap gap-3">
          <RoleModeSwitch
            disabled={isReadOnly}
            isDefaultSelected={!hasParameterOverrides}
            onSelectDefault={() => onModelParamsModeChange(false)}
            onSelectOverride={() => onModelParamsModeChange(true)}
            overrideLabel="Set Parameter Overrides"
          />
          {!hasParameterOverrides ? <ParameterOverrideTooltip /> : null}
        </div>

        {hasParameterOverrides ? (
          <PanelCard>
            <ModelParamsFields
              value={cloneModelParams(draft.model_params)}
              onChange={(params) =>
                onUpdateDraft((current) => ({
                  ...current,
                  model_params: params,
                }))
              }
              disabled={isReadOnly}
              emptyLabel="Inherit settings default"
              numberPlaceholder="Inherit settings default"
              reasoningDisableLabel="Disable"
            />
          </PanelCard>
        ) : (
          <StatusChip tone="muted">Settings default</StatusChip>
        )}
      </div>
    </FormSection>
  );
}

function ParameterOverrideTooltip() {
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="rounded-full text-muted-foreground hover:bg-accent/35 hover:text-foreground"
            aria-label="Parameter override details"
          >
            <Info className="size-3.5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs">
          Overrides affect this role only. Unsupported fields may be ignored.
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
