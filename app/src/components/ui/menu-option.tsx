import type { ButtonHTMLAttributes } from "react";
import { Button } from "./button";

type MenuOptionProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "children"
> & {
  label: string;
  meta?: string;
  selected?: boolean;
};

export function MenuOption({
  className = "",
  label,
  meta,
  selected = false,
  tabIndex = -1,
  ...props
}: MenuOptionProps) {
  return (
    <Button
      {...props}
      aria-selected={selected}
      className={`ui-menu-option ${className}`}
      role="option"
      tabIndex={tabIndex}
      variant={selected ? "secondary" : "quiet"}
    >
      <span className="ui-menu-option__label">{label}</span>
      {meta ? <span className="ui-menu-option__meta">{meta}</span> : null}
    </Button>
  );
}
