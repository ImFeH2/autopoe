import { type FormEvent, useEffect, useRef, useState } from "react";
import {
  Badge,
  Button,
  Dialog,
  Input,
  ListButton,
  Pause,
  Play,
  Plus,
  StatusIndicator,
  Tooltip,
  Trash2,
} from "@/components/ui";
import { agentStatusTone } from "@/features/agent-status";
import type { AgentHistory, AgentMember, Member } from "@/lib/backend";
import { HistoryBlock } from "./history-block";

type AgentHistoryState =
  | { status: "loading" }
  | { status: "ready"; history: AgentHistory }
  | { status: "error"; message: string };

type MembersPageProps = {
  agentName: string;
  disabled: boolean;
  error: string | null;
  history?: AgentHistoryState;
  isCreatingAgent: boolean;
  members: Member[];
  onAgentDialogOpenChange: (open: boolean) => void;
  onAgentNameChange: (name: string) => void;
  onCreateAgent: (event: FormEvent<HTMLFormElement>) => void;
  onDeleteAgent: (agentId: number) => void;
  onPauseAgent: (agentId: number) => void;
  onResumeAgent: (agentId: number) => void;
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
  history,
  isCreatingAgent,
  members,
  onAgentDialogOpenChange,
  onAgentNameChange,
  onCreateAgent,
  onDeleteAgent,
  onPauseAgent,
  onResumeAgent,
  onSelectMember,
  selectedMember,
}: MembersPageProps) {
  const agentNameInputRef = useRef<HTMLInputElement>(null);
  const [deletingAgentId, setDeletingAgentId] = useState<number | null>(null);

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
              action={
                member.type === "agent" ? (
                  <Dialog
                    description={`Delete ${member.name}, remove them from Discussions, and delete their history.`}
                    onOpenChange={(open) =>
                      setDeletingAgentId(open ? member.id : null)
                    }
                    open={deletingAgentId === member.id}
                    title="Delete Agent"
                    trigger={
                      <Button
                        aria-label={`Delete ${member.name}`}
                        disabled={
                          disabled ||
                          member.status === "running" ||
                          member.status === "pausing"
                        }
                        size="icon"
                        variant="quiet"
                      >
                        <Trash2 aria-hidden="true" size={14} />
                      </Button>
                    }
                    triggerTooltip={
                      member.status === "running" || member.status === "pausing"
                        ? "Running Agents cannot be deleted"
                        : "Delete"
                    }
                  >
                    <div className="member-delete-confirmation">
                      <p>
                        Delete this Agent, remove them from Discussions, and
                        delete their history? Messages will be kept.
                      </p>
                      <div className="member-agent-actions">
                        <Button
                          onClick={() => setDeletingAgentId(null)}
                          variant="quiet"
                        >
                          Cancel
                        </Button>
                        <Button
                          disabled={disabled}
                          onClick={() => {
                            onDeleteAgent(member.id);
                            setDeletingAgentId(null);
                          }}
                          variant="danger"
                        >
                          Delete
                        </Button>
                      </div>
                    </div>
                  </Dialog>
                ) : undefined
              }
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
            history={history ?? { status: "loading" }}
            onPause={onPauseAgent}
            onResume={onResumeAgent}
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
  history,
  onPause,
  onResume,
}: {
  agent: AgentMember;
  disabled: boolean;
  history: AgentHistoryState;
  onPause: (agentId: number) => void;
  onResume: (agentId: number) => void;
}) {
  const paused = agent.status === "paused" || agent.status === "pausing";
  const action = paused ? "Resume" : "Pause";

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
        <div className="member-detail-controls">
          <StatusIndicator tone={agentStatusTone(agent.status)}>
            {agent.status.toUpperCase()}
          </StatusIndicator>
          <Tooltip content={action}>
            <Button
              aria-label={`${action} ${agent.name}`}
              disabled={disabled}
              onClick={() => (paused ? onResume(agent.id) : onPause(agent.id))}
              size="icon"
              variant="quiet"
            >
              {paused ? (
                <Play aria-hidden="true" size={14} />
              ) : (
                <Pause aria-hidden="true" size={14} />
              )}
            </Button>
          </Tooltip>
        </div>
      </header>
      <div className="member-detail-body">
        <div className="member-detail-summary">
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
            </section>
          ) : null}
        </div>
        <AgentHistoryView agent={agent} state={history} />
      </div>
    </section>
  );
}

function AgentHistoryView({
  agent,
  state,
}: {
  agent: AgentMember;
  state: AgentHistoryState;
}) {
  const viewportRef = useRef<HTMLElement>(null);
  const followsLatestRef = useRef(true);
  const latestRun =
    state.status === "ready"
      ? state.history.runs[state.history.runs.length - 1]
      : null;
  const latestEntry = latestRun?.entries[latestRun.entries.length - 1];
  const historyRevision = latestRun
    ? `${latestRun.run_id}:${latestRun.status}:${latestRun.event_sequence}:${latestRun.entries.length}:${latestEntry?.content?.length ?? 0}`
    : state.status;

  useEffect(() => {
    if (!historyRevision) {
      return;
    }
    const viewport = viewportRef.current;
    if (viewport && followsLatestRef.current) {
      viewport.scrollTop = viewport.scrollHeight;
    }
  }, [historyRevision]);

  return (
    <section
      className="agent-history"
      aria-labelledby={`agent-${agent.id}-history`}
    >
      <header className="agent-history-header">
        <h3 id={`agent-${agent.id}-history`}>History</h3>
        {state.status === "ready" ? (
          <Badge size="small">{state.history.runs.length}</Badge>
        ) : null}
      </header>
      <section
        aria-busy={state.status === "loading"}
        aria-label={`${agent.name} history`}
        className="agent-history-viewport"
        onScroll={(event) => {
          const viewport = event.currentTarget;
          followsLatestRef.current =
            viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight <
            32;
        }}
        ref={viewportRef}
      >
        {state.status === "loading" ? (
          <p className="agent-history-empty">Loading history</p>
        ) : state.status === "error" ? (
          <p className="agent-history-empty text-danger" role="alert">
            {state.message}
          </p>
        ) : state.history.runs.length === 0 ? (
          <p className="agent-history-empty">No history</p>
        ) : (
          <div className="agent-history-timeline">
            {state.history.runs.map((run) => (
              <div className="agent-history-run" key={run.run_id}>
                {run.entries.map((entry) => (
                  <HistoryBlock entry={entry} key={entry.id} run={run} />
                ))}
              </div>
            ))}
          </div>
        )}
      </section>
    </section>
  );
}
