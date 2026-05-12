import { Button } from "@/components/ui/button";
import { StatusChip } from "@/components/surface";
import { cn } from "@/lib/utils";

interface RoleModeSwitchProps {
  disabled: boolean;
  isDefaultSelected: boolean;
  onSelectDefault: () => void;
  onSelectOverride: () => void;
  overrideLabel: string;
}

export function RoleModeSwitch({
  disabled,
  isDefaultSelected,
  onSelectDefault,
  onSelectOverride,
  overrideLabel,
}: RoleModeSwitchProps) {
  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={disabled}
        onClick={onSelectDefault}
        className={cn(
          "h-8 rounded-md border px-3 text-[13px] font-medium transition-colors",
          isDefaultSelected
            ? "border-border bg-accent/45 text-foreground"
            : "border-transparent bg-card/20 text-muted-foreground hover:bg-accent/25",
          disabled && "cursor-default",
        )}
      >
        Use Settings Default
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={disabled}
        onClick={onSelectOverride}
        className={cn(
          "h-8 rounded-md border px-3 text-[13px] font-medium transition-colors",
          !isDefaultSelected
            ? "border-border bg-accent/45 text-foreground"
            : "border-transparent bg-card/20 text-muted-foreground hover:bg-accent/25",
          disabled && "cursor-default",
        )}
      >
        {overrideLabel}
      </Button>
      {isDefaultSelected ? (
        <StatusChip tone="muted">Settings default</StatusChip>
      ) : null}
    </>
  );
}
