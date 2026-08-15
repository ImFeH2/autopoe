import type { HTMLAttributes } from "react";

type StatusTone = "accent" | "danger" | "neutral" | "success";

type StatusIndicatorProps = HTMLAttributes<HTMLSpanElement> & {
  tone?: StatusTone;
};

const tones: Record<StatusTone, string> = {
  accent: "ui-status--accent",
  danger: "ui-status--danger",
  neutral: "ui-status--neutral",
  success: "ui-status--success",
};

export function StatusIndicator({
  className = "",
  tone = "neutral",
  ...props
}: StatusIndicatorProps) {
  return (
    <span className={`ui-status ${tones[tone]} ${className}`} {...props} />
  );
}
