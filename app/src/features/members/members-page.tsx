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
import { AgentMemoryBrowser } from "./agent-memory-browser";
import { AgentRenameEditor } from "./agent-rename-editor";
import { AgentTodos } from "./agent-todos";
import { HistoryBlock } from "./history-block";
import { HumanRenameEditor } from "./human-rename-editor";

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
  onBackToDiscussion?: () => void;
  onCreateAgent: (event: FormEvent<HTMLFormElement>) => void;
  onDeleteAgent: (agentId: number) => void;
  onPauseAgent: (agentId: number) => void;
  onRenameAgent?: (memberId: number, name: string) => Promise<void>;
  onRenameMember?: (memberId: number, name: string) => Promise<void>;
  onResumeAgent: (agentId: number) => void;
  onSelectMember: (memberId: number) => void;
  selectedMember?: Member;
  sourceDiscussionTopic?: string;
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
  onBackToDiscussion,
  onCreateAgent,
  onDeleteAgent,
  onPauseAgent,
  onRenameAgent = async () => undefined,
  onRenameMember = async () => undefined,
  onResumeAgent,
  onSelectMember,
  selectedMember,
  sourceDiscussionTopic,
}: MembersPageProps) {
  const agentNameInputRef = useRef<HTMLInputElement>(null);
  const [deletingAgentId, setDeletingAgentId] = useState<number | null>(null);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");

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
                    description={`Deleting ${member.name} will permanently delete its History, Memory, and Todos. Discussion messages will remain.`}
                    onOpenChange={(open) => {
                      setDeletingAgentId(open ? member.id : null);
                      setDeleteConfirmation("");
                    }}
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
                        Deleting this Agent will permanently delete its History,
                        Memory, and Todos. Discussion messages will remain. This
                        action cannot be undone.
                      </p>
                      <label
                        className="member-agent-field"
                        htmlFor={`delete-agent-${member.id}-confirmation`}
                      >
                        <span>Type {member.name} to confirm</span>
                        <Input
                          autoComplete="off"
                          id={`delete-agent-${member.id}-confirmation`}
                          onChange={(event) =>
                            setDeleteConfirmation(event.target.value)
                          }
                          value={deleteConfirmation}
                        />
                      </label>
                      <div className="member-agent-actions">
                        <Button
                          onClick={() => setDeletingAgentId(null)}
                          variant="quiet"
                        >
                          Cancel
                        </Button>
                        <Button
                          disabled={
                            disabled || deleteConfirmation !== member.name
                          }
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
            key={selectedMember.id}
            disabled={disabled}
            history={history ?? { status: "loading" }}
            onBackToDiscussion={onBackToDiscussion}
            onPause={onPauseAgent}
            onRename={onRenameAgent}
            onResume={onResumeAgent}
            sourceDiscussionTopic={sourceDiscussionTopic}
          />
        ) : selectedMember ? (
          <HumanDetails
            disabled={disabled}
            human={selectedMember}
            onBackToDiscussion={onBackToDiscussion}
            onRename={onRenameMember}
            sourceDiscussionTopic={sourceDiscussionTopic}
          />
        ) : (
          <div className="member-detail-empty">
            <p>Select a member</p>
          </div>
        )}
      </section>
    </section>
  );
}

function DiscussionReturnButton({
  onBackToDiscussion,
  sourceDiscussionTopic,
}: {
  onBackToDiscussion?: () => void;
  sourceDiscussionTopic?: string;
}) {
  const topic = sourceDiscussionTopic?.trim();
  return onBackToDiscussion ? (
    <Button
      aria-label={
        topic ? `Back to ${topic} discussion` : "Back to source discussion"
      }
      data-member-return-focus
      onClick={onBackToDiscussion}
      title={topic ? `Return to ${topic}` : "Return to source Discussion"}
      variant="quiet"
    >
      Back to Discussion
    </Button>
  ) : null;
}

function HumanDetails({
  disabled,
  human,
  onBackToDiscussion,
  onRename,
  sourceDiscussionTopic,
}: {
  disabled: boolean;
  human: Extract<Member, { type: "human" }>;
  onBackToDiscussion?: () => void;
  onRename: (memberId: number, name: string) => Promise<void>;
  sourceDiscussionTopic?: string;
}) {
  return (
    <section
      className="member-agent-detail"
      aria-label={`${human.name} details`}
    >
      <header className="member-detail-header">
        <span className="member-detail-mark" aria-hidden="true">
          {human.name.slice(0, 1).toUpperCase()}
        </span>
        <div className="member-detail-title">
          <span>Human</span>
          <h2>{human.name}</h2>
        </div>
        <div className="member-detail-controls">
          <DiscussionReturnButton
            onBackToDiscussion={onBackToDiscussion}
            sourceDiscussionTopic={sourceDiscussionTopic}
          />
        </div>
      </header>
      <div
        aria-label="Human details"
        className="member-detail-tabs"
        role="tablist"
      >
        <button
          aria-controls={`human-${human.id}-overview-panel`}
          aria-selected="true"
          data-member-overview-focus
          id={`human-${human.id}-overview-tab`}
          role="tab"
          type="button"
        >
          Overview
        </button>
      </div>
      <div className="member-detail-body">
        <section
          aria-labelledby={`human-${human.id}-overview-tab`}
          className="member-detail-panel member-detail-overview"
          id={`human-${human.id}-overview-panel`}
          role="tabpanel"
        >
          <div className="member-detail-summary">
            <dl className="member-detail-fields">
              <div>
                <dt>Type</dt>
                <dd>Human</dd>
              </div>
              {human.id === 1 ? (
                <div>
                  <dt>Current viewer</dt>
                  <dd>You</dd>
                </div>
              ) : null}
            </dl>
            {human.id === 1 ? (
              <div className="human-rename-section">
                <h3>Formal name</h3>
                <p>Used for message authors, Members, mentions, and search.</p>
                <HumanRenameEditor
                  disabled={disabled}
                  human={human}
                  onRename={onRename}
                />
              </div>
            ) : null}
          </div>
        </section>
      </div>
    </section>
  );
}

function AgentDetails({
  agent,
  disabled,
  history,
  onBackToDiscussion,
  onPause,
  onRename,
  onResume,
  sourceDiscussionTopic,
}: {
  agent: AgentMember;
  disabled: boolean;
  history: AgentHistoryState;
  onBackToDiscussion?: () => void;
  onPause: (agentId: number) => void;
  onRename: (memberId: number, name: string) => Promise<void>;
  onResume: (agentId: number) => void;
  sourceDiscussionTopic?: string;
}) {
  const [tab, setTab] = useState<"overview" | "memory" | "history">("overview");
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
          <DiscussionReturnButton
            onBackToDiscussion={onBackToDiscussion}
            sourceDiscussionTopic={sourceDiscussionTopic}
          />
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
      <div
        aria-label="Agent details"
        className="member-detail-tabs"
        role="tablist"
      >
        {(
          [
            ["overview", "Overview"],
            ["memory", "Memory"],
            ["history", "History"],
          ] as const
        ).map(([value, label]) => (
          <button
            aria-controls={`agent-${agent.id}-${value}-panel`}
            aria-selected={tab === value}
            data-member-overview-focus={value === "overview" ? "" : undefined}
            id={`agent-${agent.id}-${value}-tab`}
            key={value}
            onClick={() => setTab(value)}
            role="tab"
            type="button"
          >
            {label}
          </button>
        ))}
      </div>
      <div className="member-detail-body">
        {tab === "overview" ? (
          <section
            aria-labelledby={`agent-${agent.id}-overview-tab`}
            className="member-detail-panel member-detail-overview"
            id={`agent-${agent.id}-overview-panel`}
            role="tabpanel"
          >
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
                <div>
                  <dt>Name</dt>
                  <dd>
                    <AgentRenameEditor
                      agent={agent}
                      disabled={disabled}
                      onRename={onRename}
                    />
                  </dd>
                </div>
              </dl>
              {agent.error ? (
                <section
                  className="member-detail-error"
                  aria-label="Agent error"
                >
                  <p className="caption-text m-0 text-danger" role="alert">
                    {agent.error}
                  </p>
                </section>
              ) : null}
            </div>
            <AgentTodos agentId={agent.id} />
          </section>
        ) : null}
        {tab === "memory" ? (
          <section
            aria-labelledby={`agent-${agent.id}-memory-tab`}
            className="member-detail-panel"
            id={`agent-${agent.id}-memory-panel`}
            role="tabpanel"
          >
            <AgentMemoryBrowser agentId={agent.id} />
          </section>
        ) : null}
        {tab === "history" ? (
          <section
            aria-labelledby={`agent-${agent.id}-history-tab`}
            className="member-detail-panel"
            id={`agent-${agent.id}-history-panel`}
            role="tabpanel"
          >
            <AgentHistoryView agent={agent} state={history} />
          </section>
        ) : null}
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
