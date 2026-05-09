import { FormSection } from "@/components/layout/PageScaffold";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ToolInfo } from "@/lib/api/meta";
import type { ToolState } from "@/pages/roles/lib";

interface RoleToolsSectionProps {
  configurableTools: ToolInfo[];
  getToolState: (toolName: string) => ToolState;
  isReadOnly: boolean;
  onToolStateCycle: (toolName: string) => void;
  shouldLockIdentityFields: boolean;
}

export function RoleToolsSection({
  configurableTools,
  getToolState,
  isReadOnly,
  onToolStateCycle,
  shouldLockIdentityFields,
}: RoleToolsSectionProps) {
  return (
    <FormSection
      title="Tool Configuration"
      className="mb-10"
      separated
      contentClassName="bg-card/30"
    >
      {configurableTools.map((tool) => (
        <RoleToolRow
          key={tool.name}
          isDisabled={isReadOnly || shouldLockIdentityFields}
          onToolStateCycle={onToolStateCycle}
          state={getToolState(tool.name)}
          tool={tool}
        />
      ))}
    </FormSection>
  );
}

interface RoleToolRowProps {
  isDisabled: boolean;
  onToolStateCycle: (toolName: string) => void;
  state: ToolState;
  tool: ToolInfo;
}

function RoleToolRow({
  isDisabled,
  onToolStateCycle,
  state,
  tool,
}: RoleToolRowProps) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-border px-5 py-4 last:border-b-0">
      <div className="min-w-0 flex-1" title={tool.description}>
        <p className="font-mono text-[13px] text-foreground/80">{tool.name}</p>
        <p className="mt-1 truncate text-[12px] text-muted-foreground">
          {tool.description}
        </p>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="xs"
        onClick={() => onToolStateCycle(tool.name)}
        disabled={isDisabled}
        className={cn(
          "shrink-0 rounded-full px-3 py-1 text-xs font-medium transition-colors",
          state === "included" && "bg-accent/50 text-foreground",
          state === "excluded" &&
            "bg-transparent text-muted-foreground line-through",
          state === "allowed" &&
            "bg-accent/20 text-muted-foreground hover:bg-accent/35",
          isDisabled && "cursor-default hover:bg-inherit opacity-60",
        )}
      >
        {state === "allowed"
          ? "Allowed"
          : state === "included"
            ? "Included"
            : "Excluded"}
      </Button>
    </div>
  );
}
