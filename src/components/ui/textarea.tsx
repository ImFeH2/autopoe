import type { ComponentPropsWithRef } from "react";

export function Textarea({
  className = "",
  ...props
}: ComponentPropsWithRef<"textarea">) {
  return <textarea className={`ui-textarea ${className}`} {...props} />;
}
