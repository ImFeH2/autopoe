import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  Ref,
  TextareaHTMLAttributes,
} from "react";
import "./ui.css";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "default" | "primary" | "ghost" | "danger";
  size?: "md" | "sm";
};

export function Button({
  variant = "default",
  size = "md",
  type = "button",
  className,
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={className ? `button ${className}` : "button"}
      data-variant={variant}
      data-size={size}
      {...rest}
    />
  );
}

export function Input({
  className,
  ...rest
}: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input className={className ? `field ${className}` : "field"} {...rest} />
  );
}

export function Textarea({
  className,
  ref,
  ...rest
}: TextareaHTMLAttributes<HTMLTextAreaElement> & {
  ref?: Ref<HTMLTextAreaElement>;
}) {
  return (
    <textarea
      ref={ref}
      className={className ? `field ${className}` : "field"}
      {...rest}
    />
  );
}

export function Badge({
  tone = "default",
  children,
}: {
  tone?: "default" | "unread" | "pending";
  children: ReactNode;
}) {
  return (
    <span className="badge" data-tone={tone}>
      {children}
    </span>
  );
}

export function StateDot({ state }: { state: "idle" | "running" | "paused" }) {
  const label =
    state === "running" ? "Running" : state === "paused" ? "Paused" : "Idle";
  return (
    <span className="dot" data-state={state} role="img" aria-label={label} />
  );
}

const HUES = [
  "var(--blue-100)",
  "var(--green-200)",
  "var(--yellow-200)",
  "var(--red-100)",
  "var(--purple-300)",
];

export function hueFor(name: string): string {
  let total = 0;
  for (let index = 0; index < name.length; index += 1) {
    total = (total * 31 + name.charCodeAt(index)) >>> 0;
  }
  return HUES[total % HUES.length];
}

export function initialsFor(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

export function Avatar({ name }: { name: string }) {
  return (
    <span
      className="avatar"
      style={{ background: `rgb(${hueFor(name)})` }}
      aria-hidden="true"
    >
      {initialsFor(name)}
    </span>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      {description ? <p>{description}</p> : null}
      {action}
    </div>
  );
}
