import { type ButtonHTMLAttributes, forwardRef } from "react";

type ButtonVariant = "primary" | "secondary" | "quiet";
type ButtonSize = "default" | "compact" | "icon";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  size?: ButtonSize;
  variant?: ButtonVariant;
};

const variants: Record<ButtonVariant, string> = {
  primary: "ui-button--primary",
  secondary: "ui-button--secondary",
  quiet: "ui-button--quiet",
};

const sizes: Record<ButtonSize, string> = {
  default: "ui-button--default",
  compact: "ui-button--compact",
  icon: "ui-button--icon",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className = "",
      size = "default",
      type = "button",
      variant = "secondary",
      ...props
    },
    ref,
  ) => (
    <button
      className={`ui-button ${variants[variant]} ${sizes[size]} ${className}`}
      ref={ref}
      type={type}
      {...props}
    />
  ),
);
Button.displayName = "Button";
