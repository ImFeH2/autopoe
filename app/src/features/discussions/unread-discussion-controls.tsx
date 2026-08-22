import { forwardRef } from "react";
import "./unread-discussion-controls.css";

export interface UnreadBadgeProps {
  count: number;
  label?: string;
}

function visibleCount(count: number): string {
  return count > 99 ? "99+" : String(count);
}

export function UnreadBadge({
  count,
  label = "unread messages",
}: UnreadBadgeProps) {
  if (count <= 0) {
    return null;
  }

  return (
    <span
      aria-label={`${count} ${label}`}
      className="human-unread-badge"
      role="status"
    >
      {visibleCount(count)}
    </span>
  );
}

export interface FirstUnreadDividerProps {
  label?: string;
}

export const FirstUnreadDivider = forwardRef<
  HTMLHRElement,
  FirstUnreadDividerProps
>(({ label = "New messages" }, ref) => (
  <div className="human-unread-divider">
    <hr aria-label={label} ref={ref} tabIndex={-1} />
    <span aria-hidden="true">{label}</span>
  </div>
));
FirstUnreadDivider.displayName = "FirstUnreadDivider";

interface UnreadControlButtonProps {
  disabled?: boolean;
  onActivate: () => void;
}

export interface NewMessageJumpButtonProps extends UnreadControlButtonProps {
  unreadCount: number;
}

export function NewMessageJumpButton({
  disabled = false,
  onActivate,
  unreadCount,
}: NewMessageJumpButtonProps) {
  if (unreadCount <= 0) {
    return null;
  }

  return (
    <button
      aria-label={`Jump to first unread message (${unreadCount} unread)`}
      className="human-unread-control"
      disabled={disabled}
      onClick={onActivate}
      type="button"
    >
      <span aria-hidden="true">↓</span>
      <span>New messages</span>
      <UnreadBadge count={unreadCount} />
    </button>
  );
}

export interface NextHumanMentionButtonProps extends UnreadControlButtonProps {
  unreadMentionCount: number;
}

export function NextHumanMentionButton({
  disabled = false,
  onActivate,
  unreadMentionCount,
}: NextHumanMentionButtonProps) {
  if (unreadMentionCount <= 0) {
    return null;
  }

  return (
    <button
      aria-label={`Jump to next unread mention (${unreadMentionCount} unread)`}
      className="human-unread-control human-unread-control--mention"
      disabled={disabled}
      onClick={onActivate}
      type="button"
    >
      <span aria-hidden="true">@</span>
      <span>Next mention</span>
      <UnreadBadge count={unreadMentionCount} label="unread mentions" />
    </button>
  );
}
