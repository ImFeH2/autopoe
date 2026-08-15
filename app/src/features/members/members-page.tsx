import { type FormEvent, useEffect, useRef } from "react";
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
import type {
  AgentHistory,
  AgentHistoryEntry,
  AgentHistoryRun,
  AgentMember,
  Member,
} from "@/lib/backend";

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
  history,
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
            history={history ?? { status: "loading" }}
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
  history,
  onRetry,
}: {
  agent: AgentMember;
  disabled: boolean;
  history: AgentHistoryState;
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
        <AgentHistoryView agent={agent} state={history} />
      </div>
    </section>
  );
}

const historyTimeFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "medium",
});

function formatHistoryTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.valueOf())
    ? value
    : historyTimeFormatter.format(date);
}

function activationLabel(entry: AgentHistoryEntry) {
  const activation = entry.activation;
  return activation
    ? `Discussion ${activation.discussion_id} · Message ${activation.message_id}`
    : "";
}

function usageLabel(run: AgentHistoryRun) {
  const input = run.usage?.input_tokens;
  const output = run.usage?.output_tokens;
  if (typeof input !== "number" && typeof output !== "number") {
    return null;
  }
  return `${typeof input === "number" ? input : 0} in · ${typeof output === "number" ? output : 0} out`;
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
                  <HistoryEntry entry={entry} key={entry.id} run={run} />
                ))}
              </div>
            ))}
          </div>
        )}
      </section>
    </section>
  );
}

function HistoryEntry({
  entry,
  run,
}: {
  entry: AgentHistoryEntry;
  run: AgentHistoryRun;
}) {
  const time = formatHistoryTime(entry.timestamp);
  const stateLabel =
    entry.state === "interrupted"
      ? "Interrupted"
      : entry.state === "streaming"
        ? "Streaming"
        : null;

  if (entry.type === "activation") {
    const usage = usageLabel(run);
    return (
      <article className="agent-history-entry agent-history-entry--activation">
        <div className="agent-history-entry-meta">
          <strong>Activation</strong>
          <time dateTime={entry.timestamp}>{time}</time>
        </div>
        <div className="agent-history-activation">
          <p>{activationLabel(entry)}</p>
          <span>
            {run.status.toUpperCase()}
            {usage ? ` · ${usage}` : ""}
          </span>
        </div>
      </article>
    );
  }

  if (
    entry.type === "tool_call" ||
    entry.type === "tool_result" ||
    entry.type === "retry"
  ) {
    const label =
      entry.type === "tool_call"
        ? "Tool call"
        : entry.type === "tool_result"
          ? "Tool result"
          : "Retry";
    return (
      <article className="agent-history-entry">
        <div className="agent-history-entry-meta">
          <strong>{label}</strong>
          <time dateTime={entry.timestamp}>{time}</time>
        </div>
        <details className="agent-history-tool">
          <summary>
            <span>{entry.tool_name ?? "Tool"}</span>
            {stateLabel ? <span>{stateLabel}</span> : null}
          </summary>
          <pre>{entry.content}</pre>
        </details>
      </article>
    );
  }

  return (
    <article
      className={`agent-history-entry agent-history-entry--${entry.type}`}
    >
      <div className="agent-history-entry-meta">
        <strong>
          {entry.type === "assistant"
            ? agentHistoryAssistantLabel(run)
            : entry.type === "thinking"
              ? "Thinking"
              : "Error"}
        </strong>
        <time dateTime={entry.timestamp}>{time}</time>
      </div>
      <div className="agent-history-content">
        {entry.type === "thinking" ? (
          <span className="agent-history-thinking">Thinking</span>
        ) : (
          <p>{entry.content}</p>
        )}
        {stateLabel ? (
          <span className="agent-history-state">{stateLabel}</span>
        ) : null}
      </div>
    </article>
  );
}

function agentHistoryAssistantLabel(run: AgentHistoryRun) {
  return run.status === "running" ? "Agent · Live" : "Agent";
}
