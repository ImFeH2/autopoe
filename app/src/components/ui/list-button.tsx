import { type ButtonHTMLAttributes, type ReactNode, useState } from "react";
import { Button } from "./button";

type ListButtonProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "children"
> & {
  action?: ReactNode;
  actionSize?: "single" | "double";
  active?: boolean;
  meta: ReactNode;
  title: string;
};

export function ListButton({
  action,
  actionSize = "single",
  active = false,
  className = "",
  meta,
  title,
  ...props
}: ListButtonProps) {
  const [focusWithin, setFocusWithin] = useState(false);

  return (
    <div
      className={`ui-list-item ui-list-item--${actionSize}-action${focusWithin ? " ui-list-item--focused" : ""}`}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          setFocusWithin(false);
        }
      }}
      onFocusCapture={() => setFocusWithin(true)}
    >
      <Button
        {...props}
        aria-current={active ? "page" : undefined}
        className={`ui-list-button ${className}`}
        variant={active ? "secondary" : "quiet"}
      >
        <span className="ui-list-button__title">{title}</span>
        <span className="ui-list-button__meta">{meta}</span>
      </Button>
      {action ? <div className="ui-list-item__action">{action}</div> : null}
    </div>
  );
}
