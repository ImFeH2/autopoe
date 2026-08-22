import "./member-status-avatar.css";

type MemberStatus = "error" | "idle" | "paused" | "running";
type MemberStatusShape = "diamond" | "dot" | "pause" | "ring";
export type MemberStatusAvatarVariant = "member" | "message";

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

export type MemberStatusAvatarProps = {
  className?: string;
  name: string;
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
  name,
  status,
  variant = "member",
}: MemberStatusAvatarProps) {
  const presentation = getMemberStatusPresentation(status);
  const accessibleName = name.trim() || "Unknown member";
  const classes = [
    "member-status-avatar",
    `member-status-avatar--${variant}`,
    className,
  ]
    .filter(Boolean)
    .join(" ");

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
      {variant === "member" && presentation ? (
        <span aria-hidden="true" className="member-status-avatar__label">
          {presentation.label}
        </span>
      ) : null}
    </>
  );

  if (variant === "message") {
    return (
      <span
        aria-hidden="true"
        className={classes}
        data-member-status={presentation?.status ?? "none"}
        data-variant={variant}
      >
        {content}
      </span>
    );
  }

  return (
    <span
      aria-label={
        presentation
          ? `${accessibleName}, ${presentation.label}`
          : accessibleName
      }
      className={classes}
      data-member-status={presentation?.status ?? "none"}
      data-variant={variant}
      role="img"
    >
      {content}
    </span>
  );
}
