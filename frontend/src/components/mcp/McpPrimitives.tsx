import { FormSwitch } from "@/components/form/FormControls";
import {
  FilterToggle,
  MetricCard,
  PanelCard,
  ReadonlyBlock as SharedReadonlyBlock,
} from "@/components/ui/surface";
import { cn } from "@/lib/utils";

export function SummaryCard({
  label,
  value,
}: {
  label: string;
  value: number;
}) {
  return <MetricCard label={label} value={value} className="min-h-0 px-4" />;
}

export function FilterPill({
  active,
  label,
  onClick,
  variant = "pill",
}: {
  active: boolean;
  label: string;
  onClick: () => void;
  variant?: "pill" | "tab";
}) {
  return (
    <FilterToggle
      active={active}
      label={label}
      onClick={onClick}
      variant={variant}
    />
  );
}

export function ReadonlyBlock({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return <SharedReadonlyBlock label={label} value={value} mono={mono} />;
}

export function MountToggle({
  checked,
  disabled,
  label,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  onChange: (nextValue: boolean) => void;
}) {
  return (
    <label
      className={cn(
        "flex items-center justify-between gap-4 text-sm",
        disabled && "opacity-50",
      )}
    >
      <PanelCard
        as="div"
        padding="sm"
        className="flex w-full items-center justify-between gap-4 bg-card/20"
      >
        <span className="text-foreground/85">{label}</span>
        <FormSwitch
          checked={checked}
          disabled={disabled}
          label={label}
          onCheckedChange={onChange}
          className="h-6 w-11"
        />
      </PanelCard>
    </label>
  );
}
