import { PageHeader } from "@/components/layout";
import { StatusIndicator } from "@/components/ui";
import { agentStatusTone } from "@/features/agent-status";
import type { Member } from "@/lib/backend";

type MembersPageProps = {
  members: Member[];
};

export function MembersPage({ members }: MembersPageProps) {
  return (
    <section className="page-pane">
      <PageHeader count={members.length} title="Members" />
      <ul className="entity-list">
        {members.map((member) => (
          <li key={member.id}>
            <span className="entity-mark" aria-hidden="true">
              {member.name.slice(0, 1).toUpperCase()}
            </span>
            <span className="entity-copy">
              <strong>{member.name}</strong>
              <span>{member.type === "human" ? "Human" : "Agent"}</span>
            </span>
            <StatusIndicator
              tone={
                member.type === "agent"
                  ? agentStatusTone(member.status)
                  : "success"
              }
            >
              {member.type === "agent" ? member.status.toUpperCase() : "ACTIVE"}
            </StatusIndicator>
          </li>
        ))}
      </ul>
    </section>
  );
}
