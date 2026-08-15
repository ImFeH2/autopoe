import { type FormEvent, useRef } from "react";
import {
  Badge,
  Button,
  Dialog,
  Input,
  ListButton,
  Plus,
  StatusIndicator,
} from "@/components/ui";
import { agentStatusTone } from "@/features/agent-status";
import type { AgentMember, Member } from "@/lib/backend";

type MembersPageProps = {
  agentName: string;
  disabled: boolean;
  error: string | null;
  isCreatingAgent: boolean;
  members: Member[];
  onAgentDialogOpenChange: (open: boolean) => void;
  onAgentNameChange: (name: string) => void;
  onCreateAgent: (event: FormEvent<HTMLFormElement>) => void;
  onRetryAgent: (agentId: number) => void;
  onSelectMember: (memberId: number) => void;
  selectedMember?: Member;
};

function memberMeta(member: Member) {
  return member.type === "human"
    ? "Human"
    : `Agent · ${member.status.toUpperCase()}`;
}

export function MembersPage({
  agentName,
  disabled,
  error,
  isCreatingAgent,
  members,
  onAgentDialogOpenChange,
  onAgentNameChange,
  onCreateAgent,
  onRetryAgent,
  onSelectMember,
  selectedMember,
}: MembersPageProps) {
  const agentNameInputRef = useRef<HTMLInputElement>(null);

  return (
    <section className="members-workspace">
      <aside className="member-list-pane" aria-label="Member list">
        <div className="member-list-toolbar">
          <div className="member-list-heading">
            <h2>Members</h2>
            <Badge size="small">{members.length}</Badge>
          </div>
          <Dialog
            description="Enter a name for the new Agent."
            onOpenAutoFocus={() => {
              agentNameInputRef.current?.focus();
              return true;
            }}
            onOpenChange={onAgentDialogOpenChange}
            open={isCreatingAgent}
            title="New Agent"
            trigger={
              <Button
                aria-label="New Agent"
                disabled={disabled}
                size="icon"
                variant="primary"
              >
                <Plus aria-hidden="true" size={15} />
              </Button>
            }
            triggerTooltip="New Agent"
          >
            <form
              className="member-agent-form"
              aria-label="Create Agent"
              onSubmit={onCreateAgent}
            >
              <label className="member-agent-field" htmlFor="agent-name">
                <span>Name</span>
                <Input
                  autoComplete="off"
                  disabled={disabled}
                  id="agent-name"
                  onChange={(event) => onAgentNameChange(event.target.value)}
                  placeholder="Agent name"
                  ref={agentNameInputRef}
                  required
                  value={agentName}
                />
              </label>
              {error ? (
                <p className="caption-text m-0 text-danger" role="alert">
                  {error}
                </p>
              ) : null}
              <div className="member-agent-actions">
                <Button
                  disabled={disabled}
                  onClick={() => onAgentDialogOpenChange(false)}
                  variant="quiet"
                >
                  Cancel
                </Button>
                <Button disabled={disabled} type="submit" variant="primary">
                  Create
                </Button>
              </div>
            </form>
          </Dialog>
        </div>
        <div className="member-list-items">
          {members.map((member) => (
            <ListButton
              active={selectedMember?.id === member.id}
              aria-label={`Open ${member.name}`}
              key={member.id}
              meta={memberMeta(member)}
              onClick={() => onSelectMember(member.id)}
              title={member.name}
            />
          ))}
        </div>
      </aside>
      <section className="member-detail-pane" aria-label="Member details">
        {selectedMember?.type === "agent" ? (
          <AgentDetails
            agent={selectedMember}
            disabled={disabled}
            onRetry={onRetryAgent}
          />
        ) : selectedMember ? null : (
          <div className="member-detail-empty">
            <p>Select a member</p>
          </div>
        )}
      </section>
    </section>
  );
}

function AgentDetails({
  agent,
  disabled,
  onRetry,
}: {
  agent: AgentMember;
  disabled: boolean;
  onRetry: (agentId: number) => void;
}) {
  return (
    <section
      className="member-agent-detail"
      aria-label={`${agent.name} details`}
    >
      <header className="member-detail-header">
        <span className="member-detail-mark" aria-hidden="true">
          {agent.name.slice(0, 1).toUpperCase()}
        </span>
        <div className="member-detail-title">
          <span>Agent {agent.id}</span>
          <h2>{agent.name}</h2>
        </div>
        <StatusIndicator tone={agentStatusTone(agent.status)}>
          {agent.status.toUpperCase()}
        </StatusIndicator>
      </header>
      <div className="member-detail-body">
        <dl className="member-detail-fields">
          <div>
            <dt>Type</dt>
            <dd>Agent</dd>
          </div>
          <div>
            <dt>Member ID</dt>
            <dd>{agent.id}</dd>
          </div>
        </dl>
        {agent.error ? (
          <section className="member-detail-error" aria-label="Agent error">
            <p className="caption-text m-0 text-danger" role="alert">
              {agent.error}
            </p>
            <Button
              aria-label={`Retry ${agent.name}`}
              disabled={disabled}
              onClick={() => onRetry(agent.id)}
              size="compact"
              variant="secondary"
            >
              Retry
            </Button>
          </section>
        ) : null}
      </div>
    </section>
  );
}
