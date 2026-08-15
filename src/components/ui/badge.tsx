import type { HTMLAttributes } from "react";

type BadgeTone = "accent" | "danger" | "neutral" | "success";
type BadgeSize = "default" | "small";

type BadgeProps = HTMLAttributes<HTMLSpanElement> & {
  size?: BadgeSize;
  tone?: BadgeTone;
};

const tones: Record<BadgeTone, string> = {
  accent: "ui-badge--accent",
  danger: "ui-badge--danger",
  neutral: "ui-badge--neutral",
  success: "ui-badge--success",
};

const sizes: Record<BadgeSize, string> = {
  default: "ui-badge--default",
  small: "ui-badge--small",
};

export function Badge({
  className = "",
  size = "default",
  tone = "neutral",
  ...props
}: BadgeProps) {
  return (
    <span
      className={`ui-badge ${tones[tone]} ${sizes[size]} ${className}`}
      {...props}
    />
  );
}
