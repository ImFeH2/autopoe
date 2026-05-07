import { Eye, EyeOff } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch, SwitchThumb } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

export const formLabelClass = "text-[12px] font-medium text-foreground/80";
export const formHelpTextClass =
  "text-[11px] leading-relaxed text-muted-foreground";
export const formInputClass =
  "bg-background/50 text-[13px] focus:bg-background/65";
export const formMonoInputClass = `${formInputClass} font-mono`;
export const formTextareaClass =
  "bg-background/50 text-[13px] leading-relaxed focus:bg-background/65";
export const formMonoTextareaClass = `${formTextareaClass} font-mono`;
export const formSelectTriggerClass =
  "h-8 w-full rounded-md bg-background/50 text-[13px]";
export const formReadOnlyClass = "cursor-default opacity-60 focus:outline-none";

const formIconButtonClass =
  "rounded-md border border-border/70 bg-accent/20 text-muted-foreground hover:bg-accent/45 hover:text-foreground";

interface FormInputProps extends Omit<
  React.ComponentProps<typeof Input>,
  "size"
> {
  mono?: boolean;
}

export function FormInput({
  className,
  mono = false,
  ...props
}: FormInputProps) {
  return (
    <Input
      className={cn(mono ? formMonoInputClass : formInputClass, className)}
      {...props}
    />
  );
}

interface FormTextareaProps extends React.ComponentProps<typeof Textarea> {
  mono?: boolean;
}

export function FormTextarea({
  className,
  mono = false,
  ...props
}: FormTextareaProps) {
  return (
    <Textarea
      className={cn(
        mono ? formMonoTextareaClass : formTextareaClass,
        className,
      )}
      {...props}
    />
  );
}

interface FormIconButtonProps extends Omit<
  React.ComponentProps<typeof Button>,
  "size"
> {
  size?: "compact" | "default";
}

export function FormIconButton({
  className,
  size = "compact",
  type = "button",
  variant = "ghost",
  ...props
}: FormIconButtonProps) {
  return (
    <Button
      type={type}
      variant={variant}
      size={size === "default" ? "icon-sm" : "icon-xs"}
      className={cn(formIconButtonClass, className)}
      {...props}
    />
  );
}

interface SecretInputProps extends Omit<FormInputProps, "type"> {
  buttonSize?: "compact" | "default";
  hideLabel: string;
  showLabel: string;
}

export function SecretInput({
  buttonSize = "compact",
  className,
  hideLabel,
  mono = false,
  showLabel,
  ...props
}: SecretInputProps) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="relative">
      <FormInput
        type={visible ? "text" : "password"}
        mono={mono}
        className={cn("pr-10", className)}
        {...props}
      />
      <FormIconButton
        aria-label={visible ? hideLabel : showLabel}
        size={buttonSize}
        className="absolute right-2 top-1/2 -translate-y-1/2"
        onClick={() => setVisible((current) => !current)}
      >
        {visible ? (
          <EyeOff
            className={buttonSize === "default" ? "size-4" : "size-3.5"}
          />
        ) : (
          <Eye className={buttonSize === "default" ? "size-4" : "size-3.5"} />
        )}
      </FormIconButton>
    </div>
  );
}

interface FormSwitchProps {
  checked: boolean;
  className?: string;
  disabled?: boolean;
  label?: string;
  offText?: string;
  onCheckedChange: (nextValue: boolean) => void;
  onText?: string;
  showStateText?: boolean;
}

export function FormSwitch({
  checked,
  className,
  disabled = false,
  label,
  offText = "OFF",
  onCheckedChange,
  onText = "ON",
  showStateText = false,
}: FormSwitchProps) {
  return (
    <Switch
      checked={checked}
      aria-label={label}
      disabled={disabled}
      onCheckedChange={onCheckedChange}
      className={cn(
        "relative shrink-0 border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
        showStateText
          ? "h-8 w-[72px] px-1"
          : "h-5 w-9 justify-center border-2 border-transparent focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        checked
          ? "border-graph-status-running/30 bg-graph-status-running/15"
          : "border-border bg-accent/30",
        className,
      )}
    >
      {label ? <span className="sr-only">{label}</span> : null}
      <SwitchThumb
        aria-hidden="true"
        className={cn(
          "pointer-events-none inline-flex items-center justify-center rounded-full transition-all duration-200 ease-in-out",
          showStateText
            ? "h-6 w-6 text-[10px] font-semibold"
            : "size-4 bg-background shadow-xs ring-0",
          checked
            ? showStateText
              ? "translate-x-[40px] bg-graph-status-running text-background"
              : "translate-x-2"
            : showStateText
              ? "translate-x-0 bg-foreground text-background"
              : "-translate-x-2",
        )}
      >
        {showStateText ? (checked ? onText : offText) : null}
      </SwitchThumb>
    </Switch>
  );
}
