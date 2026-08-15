import type { ComponentPropsWithRef } from "react";

type TextareaProps = ComponentPropsWithRef<"textarea"> & {
  variant?: "default" | "composer";
};

export function Textarea({
  className = "",
  variant = "default",
  ...props
}: TextareaProps) {
  return (
    <textarea
      className={`ui-textarea ui-textarea--${variant} ${className}`}
      {...props}
    />
  );
}
