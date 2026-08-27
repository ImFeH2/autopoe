import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  getMemberStatusPresentation,
  MemberStatusAvatar,
} from "./member-status-avatar";

function render(
  status: string | null | undefined,
  variant: "member" | "message" = "member",
  identity?: "agent" | "deleted" | "human" | "unknown",
  memberId = 2,
) {
  return renderToStaticMarkup(
    <MemberStatusAvatar
      identity={identity}
      memberId={memberId}
      name="Ada Lovelace"
      status={status}
      variant={variant}
    />,
  );
}

describe("getMemberStatusPresentation", () => {
  it("owns the pausing to running normalization and four presentations", () => {
    expect(getMemberStatusPresentation("pausing")).toEqual({
      label: "Running",
      shape: "ring",
      status: "running",
    });
    expect(getMemberStatusPresentation("running")?.label).toBe("Running");
    expect(getMemberStatusPresentation("idle")?.shape).toBe("dot");
    expect(getMemberStatusPresentation("paused")?.shape).toBe("pause");
    expect(getMemberStatusPresentation("error")?.shape).toBe("diamond");
  });

  it("fails closed for human, missing, and unknown statuses", () => {
    expect(getMemberStatusPresentation(null)).toBeNull();
    expect(getMemberStatusPresentation(undefined)).toBeNull();
    expect(getMemberStatusPresentation("human")).toBeNull();
    expect(getMemberStatusPresentation("future-status")).toBeNull();
  });
});

describe("MemberStatusAvatar", () => {
  it.each([
    ["running", "Running", "ring"],
    ["idle", "Idle", "dot"],
    ["paused", "Paused", "pause"],
    ["error", "Error", "diamond"],
  ])("renders %s with a label and non-color shape", (status, label, shape) => {
    const markup = render(status);

    expect(markup).toContain(
      `aria-label="Ada Lovelace, Agent status: ${label}"`,
    );
    expect(markup).toContain(`data-status-label="${label}"`);
    expect(markup).toContain(`data-status-shape="${shape}"`);
  });

  it("keeps a fallback message avatar compact and non-interactive", () => {
    const markup = render("pausing", "message");

    expect(markup).toContain("member-status-avatar--message");
    expect(markup).toContain('data-member-status="running"');
    expect(markup).toContain('aria-hidden="true"');
    expect(markup).not.toContain("aria-label=");
    expect(markup).not.toContain('role="img"');
    expect(markup).not.toContain("tabindex=");
    expect(markup).not.toContain("aria-live=");
  });

  it("uses the same focusable contract for member and message navigation", () => {
    const member = renderToStaticMarkup(
      <MemberStatusAvatar
        identity="agent"
        memberId={2}
        name="Ada Lovelace"
        navigationKey="discussion:1:member:2"
        onActivate={() => undefined}
        status="running"
        variant="member"
      />,
    );
    const message = renderToStaticMarkup(
      <MemberStatusAvatar
        identity="agent"
        memberId={2}
        name="Historical Ada"
        navigationKey="discussion:1:message:7:member:2"
        onActivate={() => undefined}
        status="idle"
        variant="message"
      />,
    );

    expect(member).toContain("<button");
    expect(member).toContain(
      'aria-label="Ada Lovelace, Agent status: Running"',
    );
    expect(member).toContain(
      'data-member-navigation-key="discussion:1:member:2"',
    );
    expect(message).toContain("<button");
    expect(message).toContain(
      'aria-label="Open member details for Historical Ada"',
    );
    expect(message).toContain(
      'data-member-navigation-key="discussion:1:message:7:member:2"',
    );
    const memberPattern = member.match(
      /data-identicon-pattern="([^"]+)"/u,
    )?.[1];
    const messagePattern = message.match(
      /data-identicon-pattern="([^"]+)"/u,
    )?.[1];
    expect(memberPattern).toBe("010/101/110/111/100");
    expect(messagePattern).toBe(memberPattern);
    expect(member).toContain('data-identicon-version="v1"');
    expect(message).toContain('data-member-id="2"');
    expect(member).toContain("member-status-avatar__identicon");
    expect(message).not.toContain("aria-live=");
  });

  it("forwards keyboard and pointer button activation through the shared contract", () => {
    const onActivate = vi.fn();
    const avatar = MemberStatusAvatar({
      identity: "agent",
      memberId: 2,
      name: "Ada Lovelace",
      navigationKey: "discussion:1:message:7:member:2",
      onActivate,
      status: "running",
      variant: "message",
    });

    expect(avatar.type).toBe("button");
    avatar.props.onClick();
    expect(onActivate).toHaveBeenCalledOnce();
  });

  it("renders identity without a fabricated status for human, deleted, or unknown members", () => {
    const human = render(undefined, "message", "human");
    const deleted = render("running", "message", "deleted");
    const unknown = render("future-status", "message", "unknown");

    for (const markup of [human, deleted, unknown]) {
      expect(markup).toContain('aria-hidden="true"');
      expect(markup).toContain('data-member-status="none"');
      expect(markup).not.toContain("aria-label=");
      expect(markup).not.toContain('role="img"');
      expect(markup).not.toContain("member-status-avatar__mark");
      expect(markup).not.toContain("data-status-label");
    }
  });

  it("uses fixed message geometry and static reduced-motion status shapes", () => {
    const styles = readFileSync(
      new URL("./member-status-avatar.css", import.meta.url),
      "utf8",
    );

    expect(styles).toMatch(
      /\.member-status-avatar--message\s*\{[^}]*width:\s*24px;[^}]*height:\s*24px;[^}]*flex:\s*0 0 24px;/su,
    );
    expect(styles).toContain("member-status-avatar__mark--ring");
    expect(styles).toContain("member-status-avatar__mark--dot");
    expect(styles).toContain("member-status-avatar__mark--pause");
    expect(styles).toContain("member-status-avatar__mark--diamond");
    expect(styles).toMatch(/@media \(prefers-reduced-motion: reduce\)/u);
    expect(styles).toMatch(/animation:\s*none;/u);
  });
});
