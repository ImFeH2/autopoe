import * as RadioGroup from "@radix-ui/react-radio-group";

type SegmentedControlOption<Value extends string> = {
  disabled?: boolean;
  label: string;
  value: Value;
};

type SegmentedControlProps<Value extends string> = {
  "aria-label"?: string;
  "aria-labelledby"?: string;
  disabled?: boolean;
  onValueChange: (value: Value) => void;
  options: SegmentedControlOption<Value>[];
  value: Value;
};

export function SegmentedControl<Value extends string>({
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledBy,
  disabled = false,
  onValueChange,
  options,
  value,
}: SegmentedControlProps<Value>) {
  return (
    <RadioGroup.Root
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledBy}
      className="ui-segmented-control"
      disabled={disabled}
      loop
      onValueChange={(nextValue) => onValueChange(nextValue as Value)}
      orientation="horizontal"
      value={value}
    >
      {options.map((option) => (
        <RadioGroup.Item
          className="ui-segmented-control__item"
          disabled={option.disabled}
          key={option.value}
          value={option.value}
        >
          {option.label}
        </RadioGroup.Item>
      ))}
    </RadioGroup.Root>
  );
}
