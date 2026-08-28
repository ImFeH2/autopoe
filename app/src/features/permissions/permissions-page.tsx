import { type ReactNode, useEffect, useState } from "react";
import { PageHeader } from "@/components/layout";
import { Badge, Button } from "@/components/ui";
import { MemberStatusAvatar } from "@/components/ui/member-status-avatar";
import {
  type AgentMember,
  backend,
  type Member,
  type OrganizationAudit,
  type OrganizationAuditEvent,
  type OrganizationPermissions,
} from "@/lib/backend";

type PermissionsPageProps = {
  members: Member[];
};

type PermissionsData = {
  permissions: OrganizationPermissions;
  audit: OrganizationAudit;
};

const actionLabels: Record<OrganizationAuditEvent["action"], string> = {
  "organization.agent.create": "Created Agent",
  "organization.agent.delete": "Deleted Agent",
  "organization.agent.pause": "Paused Agent",
  "organization.agent.resume": "Resumed Agent",
  "organization.role.grant": "Granted Admin",
  "organization.role.revoke": "Revoked Admin",
  "discussion.create": "Created discussion",
  "discussion.members.update": "Updated members",
  "discussion.delete": "Deleted discussion",
};

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

async function loadPermissionsData(): Promise<PermissionsData> {
  const [permissions, audit] = await Promise.all([
    backend.getPermissions(),
    backend.getAudit(),
  ]);
  return { permissions, audit };
}

function eventTarget(event: OrganizationAuditEvent) {
  const topic = event.metadata.discussion_topic;
  if (typeof topic === "string") {
    return topic;
  }
  if (event.target_type === "organization") {
    return "Organization";
  }
  return `${event.target_type === "member" ? "Member" : "Discussion"} #${event.target_id}`;
}

function eventTime(occurredAt: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(occurredAt));
}

export function permissionMemberGroups(
  members: Member[],
  adminAgentIds: number[],
) {
  const adminIds = new Set(adminAgentIds);
  const agents = members.filter(
    (member): member is AgentMember => member.type === "agent",
  );
  return {
    humans: members.filter((member) => member.type === "human"),
    admins: agents.filter((agent) => adminIds.has(agent.id)),
    regularMembers: agents.filter((agent) => !adminIds.has(agent.id)),
  };
}

function RoleMember({
  action,
  member,
  roleLabel,
}: {
  action?: ReactNode;
  member: Member;
  roleLabel: "Admin" | "Member" | "Super Admin";
}) {
  return (
    <li className="permissions-member-row">
      <MemberStatusAvatar
        identity={member.type}
        memberId={member.id}
        name={member.name}
        status={member.type === "agent" ? member.status : undefined}
        variant="member"
      />
      <span className="permissions-member-copy">
        <strong>{member.name}</strong>
        <span>{member.type === "human" ? "Human" : "Agent"}</span>
      </span>
      <Badge tone={roleLabel === "Admin" ? "accent" : "neutral"}>
        {roleLabel}
      </Badge>
      {action}
    </li>
  );
}

export function PermissionsPage({ members }: PermissionsPageProps) {
  const [data, setData] = useState<PermissionsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savingAgentId, setSavingAgentId] = useState<number | null>(null);

  useEffect(() => {
    let active = true;
    void loadPermissionsData()
      .then((next) => {
        if (active) {
          setData(next);
        }
      })
      .catch((reason) => {
        if (active) {
          setError(errorMessage(reason));
        }
      });
    return () => {
      active = false;
    };
  }, []);

  async function reload() {
    setError(null);
    try {
      setData(await loadPermissionsData());
    } catch (reason) {
      setError(errorMessage(reason));
    }
  }

  async function changeAdmin(agentId: number, grant: boolean) {
    if (data === null) {
      return;
    }
    setSavingAgentId(agentId);
    setError(null);
    try {
      await (grant
        ? backend.grantAdmin(agentId, data.permissions.management_revision)
        : backend.revokeAdmin(agentId, data.permissions.management_revision));
      setData(await loadPermissionsData());
    } catch (reason) {
      setError(errorMessage(reason));
      try {
        setData(await loadPermissionsData());
      } catch (reloadReason) {
        setError(`${errorMessage(reason)}. ${errorMessage(reloadReason)}`);
      }
    } finally {
      setSavingAgentId(null);
    }
  }

  const { humans, admins, regularMembers } = permissionMemberGroups(
    members,
    data?.permissions.admin_agent_ids ?? [],
  );
  const events = data ? [...data.audit.events].reverse().slice(0, 50) : [];

  return (
    <section className="page-pane page-pane--permissions">
      <PageHeader title="Permissions" />
      <div className="permissions-scroll">
        {error ? (
          <div className="permissions-error" role="alert">
            <span>{error}</span>
            <Button onClick={reload} size="compact" variant="secondary">
              Retry
            </Button>
          </div>
        ) : null}
        {data === null ? (
          error ? null : (
            <p className="permissions-empty">Loading…</p>
          )
        ) : (
          <>
            <RoleSection id="super-admins" title="Super Admins">
              {humans.map((human) => (
                <RoleMember
                  key={human.id}
                  member={human}
                  roleLabel="Super Admin"
                />
              ))}
            </RoleSection>
            <RoleSection id="admins" title="Admins">
              {admins.length === 0 ? (
                <li className="permissions-empty">No Admins</li>
              ) : (
                admins.map((agent) => (
                  <RoleMember
                    action={
                      <Button
                        aria-label={`Revoke Admin from ${agent.name}`}
                        disabled={savingAgentId !== null}
                        onClick={() => changeAdmin(agent.id, false)}
                        size="compact"
                        variant="secondary"
                      >
                        Revoke
                      </Button>
                    }
                    key={agent.id}
                    member={agent}
                    roleLabel="Admin"
                  />
                ))
              )}
            </RoleSection>
            <RoleSection id="members" title="Members">
              {regularMembers.length === 0 ? (
                <li className="permissions-empty">No Members</li>
              ) : (
                regularMembers.map((agent) => (
                  <RoleMember
                    action={
                      <Button
                        aria-label={`Grant Admin to ${agent.name}`}
                        disabled={savingAgentId !== null}
                        onClick={() => changeAdmin(agent.id, true)}
                        size="compact"
                        variant="secondary"
                      >
                        Grant
                      </Button>
                    }
                    key={agent.id}
                    member={agent}
                    roleLabel="Member"
                  />
                ))
              )}
            </RoleSection>
            <section aria-labelledby="permissions-activity-title">
              <header className="permissions-section-heading">
                <h2 id="permissions-activity-title">Activity</h2>
              </header>
              {events.length === 0 ? (
                <p className="permissions-empty">No activity</p>
              ) : (
                <ol className="permissions-audit-list">
                  {events.map((event) => (
                    <li className="permissions-audit-row" key={event.id}>
                      <span className="permissions-audit-copy">
                        <strong>{actionLabels[event.action]}</strong>
                        <span>
                          {event.actor_name ?? "Unavailable actor"} ·{" "}
                          {eventTarget(event)}
                        </span>
                      </span>
                      <time dateTime={event.occurred_at}>
                        {eventTime(event.occurred_at)}
                      </time>
                      <Badge
                        tone={event.result === "success" ? "success" : "danger"}
                      >
                        {event.result === "success" ? "Success" : "Failed"}
                      </Badge>
                    </li>
                  ))}
                </ol>
              )}
            </section>
          </>
        )}
      </div>
    </section>
  );
}

function RoleSection({
  children,
  id,
  title,
}: {
  children: ReactNode;
  id: string;
  title: string;
}) {
  const titleId = `permissions-${id}-title`;
  return (
    <section aria-labelledby={titleId}>
      <header className="permissions-section-heading">
        <h2 id={titleId}>{title}</h2>
      </header>
      <ul className="permissions-member-list">{children}</ul>
    </section>
  );
}
