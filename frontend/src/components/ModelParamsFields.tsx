import { cn } from "@/lib/utils";
import type { ModelParams } from "@/types";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface ModelParamsFieldsProps {
  className?: string;
  disabled?: boolean;
  emptyLabel?: string;
  helperText?: string;
  numberPlaceholder?: string;
  onChange: (next: ModelParams) => void;
  onCommit?: (next: ModelParams) => void;
  reasoningDisableLabel?: string | null;
  value: ModelParams;
}

const EMPTY_OPTION_VALUE = "__empty__";
const modelParamFieldClass =
  "w-full rounded-md border border-input bg-background/60 px-3 py-2 text-sm transition-[border-color] placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-[3px] focus:ring-ring/50";

function parseNumberInput(value: string) {
  if (!value.trim()) {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function ModelParamsFields({
  className,
  disabled = false,
  emptyLabel = "Inherit / provider default",
  helperText,
  numberPlaceholder = emptyLabel,
  onChange,
  onCommit,
  reasoningDisableLabel = "None",
  value,
}: ModelParamsFieldsProps) {
  const updateValue = (next: ModelParams, commit = false) => {
    onChange(next);
    if (commit) {
      onCommit?.(next);
    }
  };
  const blurOnEnter = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.currentTarget.blur();
    }
  };
  const commitNumberInput = (
    field: "max_output_tokens" | "temperature" | "top_p",
    rawValue: string,
  ) => {
    onCommit?.({
      ...value,
      [field]: parseNumberInput(rawValue),
    });
  };

  return (
    <div className={cn("space-y-4", className)}>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <label className="text-sm font-medium">Reasoning Effort</label>
          <Select
            value={value.reasoning_effort ?? EMPTY_OPTION_VALUE}
            onValueChange={(nextValue) =>
              updateValue(
                {
                  ...value,
                  reasoning_effort:
                    nextValue !== EMPTY_OPTION_VALUE
                      ? (nextValue as ModelParams["reasoning_effort"])
                      : null,
                },
                true,
              )
            }
            disabled={disabled}
          >
            <SelectTrigger className="rounded-md bg-background/60">
              <SelectValue placeholder={emptyLabel} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={EMPTY_OPTION_VALUE}>{emptyLabel}</SelectItem>
              {reasoningDisableLabel ? (
                <SelectItem value="none">{reasoningDisableLabel}</SelectItem>
              ) : null}
              <SelectItem value="low">Low</SelectItem>
              <SelectItem value="medium">Medium</SelectItem>
              <SelectItem value="high">High</SelectItem>
              <SelectItem value="xhigh">XHigh</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium">Verbosity</label>
          <Select
            value={value.verbosity ?? EMPTY_OPTION_VALUE}
            onValueChange={(nextValue) =>
              updateValue(
                {
                  ...value,
                  verbosity:
                    nextValue !== EMPTY_OPTION_VALUE
                      ? (nextValue as ModelParams["verbosity"])
                      : null,
                },
                true,
              )
            }
            disabled={disabled}
          >
            <SelectTrigger className="rounded-md bg-background/60">
              <SelectValue placeholder={emptyLabel} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={EMPTY_OPTION_VALUE}>{emptyLabel}</SelectItem>
              <SelectItem value="low">Low</SelectItem>
              <SelectItem value="medium">Medium</SelectItem>
              <SelectItem value="high">High</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium">Max Output Tokens</label>
          <Input
            type="number"
            min={1}
            step={1}
            value={value.max_output_tokens ?? ""}
            onChange={(event) =>
              updateValue({
                ...value,
                max_output_tokens: parseNumberInput(event.target.value),
              })
            }
            onBlur={(event) =>
              commitNumberInput("max_output_tokens", event.target.value)
            }
            onKeyDown={blurOnEnter}
            disabled={disabled}
            placeholder={numberPlaceholder}
            className={cn(
              modelParamFieldClass,
              disabled
                ? "cursor-default text-muted-foreground focus:outline-none"
                : "",
            )}
          />
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium">Temperature</label>
          <Input
            type="number"
            min={0}
            max={2}
            step={0.1}
            value={value.temperature ?? ""}
            onChange={(event) =>
              updateValue({
                ...value,
                temperature: parseNumberInput(event.target.value),
              })
            }
            onBlur={(event) =>
              commitNumberInput("temperature", event.target.value)
            }
            onKeyDown={blurOnEnter}
            disabled={disabled}
            placeholder={numberPlaceholder}
            className={cn(
              modelParamFieldClass,
              disabled
                ? "cursor-default text-muted-foreground focus:outline-none"
                : "",
            )}
          />
        </div>

        <div className="space-y-2 md:col-span-2">
          <label className="text-sm font-medium">Top P</label>
          <Input
            type="number"
            min={0.01}
            max={1}
            step={0.01}
            value={value.top_p ?? ""}
            onChange={(event) =>
              updateValue({
                ...value,
                top_p: parseNumberInput(event.target.value),
              })
            }
            onBlur={(event) => commitNumberInput("top_p", event.target.value)}
            onKeyDown={blurOnEnter}
            disabled={disabled}
            placeholder={numberPlaceholder}
            className={cn(
              modelParamFieldClass,
              disabled
                ? "cursor-default text-muted-foreground focus:outline-none"
                : "",
            )}
          />
        </div>
      </div>

      {helperText ? (
        <p className="text-xs text-muted-foreground">{helperText}</p>
      ) : null}
    </div>
  );
}
