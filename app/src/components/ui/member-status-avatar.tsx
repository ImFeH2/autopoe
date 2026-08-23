import "./member-status-avatar.css";

type MemberStatus = "error" | "idle" | "paused" | "running";
type MemberStatusShape = "diamond" | "dot" | "pause" | "ring";
export type MemberStatusAvatarVariant = "member" | "message";
export type MemberAvatarIdentity = "agent" | "deleted" | "human" | "unknown";

export type MemberStatusPresentation = {
  label: "Error" | "Idle" | "Paused" | "Running";
  shape: MemberStatusShape;
  status: MemberStatus;
};

const statusPresentations: Record<MemberStatus, MemberStatusPresentation> = {
  error: { label: "Error", shape: "diamond", status: "error" },
  idle: { label: "Idle", shape: "dot", status: "idle" },
  paused: { label: "Paused", shape: "pause", status: "paused" },
  running: { label: "Running", shape: "ring", status: "running" },
};

export function getMemberStatusPresentation(
  status: string | null | undefined,
): MemberStatusPresentation | null {
  const normalized = status === "pausing" ? "running" : status;

  if (
    normalized !== "error" &&
    normalized !== "idle" &&
    normalized !== "paused" &&
    normalized !== "running"
  ) {
    return null;
  }

  return statusPresentations[normalized];
}

export function getMemberAvatarDescription(
  name: string,
  identity: MemberAvatarIdentity,
  status?: string | null,
): string {
  const accessibleName = name.trim() || "Unknown member";
  const presentation =
    identity === "agent" ? getMemberStatusPresentation(status) : null;

  if (identity === "agent") {
    return `${accessibleName}, Agent status: ${presentation?.label ?? "Idle"}`;
  }
  if (identity === "human") {
    return `${accessibleName}, Human`;
  }
  if (identity === "deleted") {
    return `${accessibleName}, Deleted member`;
  }
  return accessibleName;
}

export type MemberStatusAvatarProps = {
  className?: string;
  identity?: MemberAvatarIdentity;
  name: string;
  navigationKey?: string;
  onActivate?: () => void;
  status?: string | null;
  variant?: MemberStatusAvatarVariant;
};

function memberInitials(name: string) {
  const parts = name.trim().split(/\s+/u).filter(Boolean);

  if (parts.length === 0) {
    return "?";
  }

  const first = Array.from(parts[0])[0] ?? "?";
  const lastPart = parts[parts.length - 1] ?? "";
  const last = parts.length > 1 ? (Array.from(lastPart)[0] ?? "") : "";
  return (first + last).toLocaleUpperCase();
}

export function MemberStatusAvatar({
  className = "",
  identity: explicitIdentity,
  name,
  navigationKey,
  onActivate,
  status,
  variant = "member",
}: MemberStatusAvatarProps) {
  const statusPresentation = getMemberStatusPresentation(status);
  const identity =
    explicitIdentity ?? (statusPresentation ? "agent" : "unknown");
  const presentation = identity === "agent" ? statusPresentation : null;
  const description = getMemberAvatarDescription(name, identity, status);
  const interactive = Boolean(onActivate);
  const classes = [
    "member-status-avatar",
    `member-status-avatar--${variant}`,
    `member-status-avatar--${identity}`,
    interactive ? "member-status-avatar--interactive" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");
  const commonProps = {
    className: classes,
    "data-member-identity": identity,
    "data-member-navigation-key": navigationKey,
    "data-member-status": presentation?.status ?? "none",
    "data-variant": variant,
  };
  const content = (
    <>
      <span aria-hidden="true" className="member-status-avatar__identity">
        {memberInitials(name)}
      </span>
      {presentation ? (
        <span
          aria-hidden="true"
          className={
            "member-status-avatar__mark " +
            "member-status-avatar__mark--" +
            presentation.status +
            " member-status-avatar__mark--" +
            presentation.shape
          }
          data-status-label={presentation.label}
          data-status-shape={presentation.shape}
        />
      ) : null}
    </>
  );

  if (onActivate) {
    return (
      <button
        {...commonProps}
        aria-label={
          variant === "message"
            ? `Open member details for ${name.trim() || "Unknown member"}`
            : description
        }
        onClick={onActivate}
        type="button"
      >
        {content}
      </button>
    );
  }

  if (variant === "message") {
    return (
      <span {...commonProps} aria-hidden="true">
        {content}
      </span>
    );
  }

  return (
    <span {...commonProps} aria-label={description} role="img">
      {content}
    </span>
  );
}
