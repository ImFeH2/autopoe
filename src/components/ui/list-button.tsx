import type { ButtonHTMLAttributes } from "react";
import { Button } from "./button";

type ListButtonProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "children"
> & {
  active?: boolean;
  meta: string;
  title: string;
};

export function ListButton({
  active = false,
  className = "",
  meta,
  title,
  ...props
}: ListButtonProps) {
  return (
    <Button
      {...props}
      aria-current={active ? "page" : undefined}
      className={`ui-list-button ${className}`}
      variant={active ? "secondary" : "quiet"}
    >
      <span className="ui-list-button__title">{title}</span>
      <span className="ui-list-button__meta">{meta}</span>
    </Button>
  );
}
