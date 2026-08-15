import { forwardRef, type InputHTMLAttributes } from "react";

type InputInset = "default" | "leading-icon";

type InputProps = InputHTMLAttributes<HTMLInputElement> & {
  inset?: InputInset;
};

const insets: Record<InputInset, string> = {
  default: "",
  "leading-icon": "ui-input--leading-icon",
};

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className = "", inset = "default", ...props }, ref) => (
    <input
      className={`ui-input ${insets[inset]} ${className}`}
      ref={ref}
      {...props}
    />
  ),
);
Input.displayName = "Input";
