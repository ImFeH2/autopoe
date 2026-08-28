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
import type { AgentHistoryCache } from "@/features/incremental/agent-history-cache";
import type {
  AgentHistory,
  AgentMember,
  Discussion,
  Member,
  MemberNamePolicy,
} from "@/lib/backend";
import { AgentMemoryBrowser } from "./agent-memory-browser";
import { AgentRenameEditor } from "./agent-rename-editor";
import { AgentTodos } from "./agent-todos";
import { HistoryBlock } from "./history-block";
import { HumanRenameEditor } from "./human-rename-editor";
import {
  memberNameConstraints,
  memberNameCount,
  memberNameValidationMessage,
} from "./member-name-policy";

type AgentHistoryState =
  | { status: "loading" }
  | { status: "ready"; history: AgentHistory }
  | { status: "error"; message: string };

type MembersPageProps = {
  agentName: string;
  disabled: boolean;
  discussions?: Discussion[];
  error: string | null;
  history?: AgentHistoryState;
  historyCache?: AgentHistoryCache;
  isCreatingAgent: boolean;
  onLoadEarlierHistory?: (
    agentId: number,
    beforeSequence: number | null,
  ) => Promise<void>;
  onLoadHistoryRun?: (agentId: number, runId: string) => Promise<void>;
  onToggleHistoryEntry?: (
    agentId: number,
    runId: string,
    entryId: string,
    open: boolean,
  ) => Promise<void> | void;
  onHistoryScrollState?: (
    agentId: number,
    scrollTop: number,
    followsLatest: boolean,
  ) => void;
  members: Member[];
  namePolicy: MemberNamePolicy;
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
  discussions = [],
  error,
  history,
  historyCache,
  isCreatingAgent,
  onLoadEarlierHistory,
  onLoadHistoryRun,
  onToggleHistoryEntry,
  onHistoryScrollState,
  members,
  namePolicy,
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
  const agentNameValidationError = agentName
    ? memberNameValidationMessage(agentName, namePolicy)
    : null;
  const agentNameCount = memberNameCount(agentName, namePolicy);
  const agentNameConstraints = memberNameConstraints(namePolicy);

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
              onSubmit={(event) => {
                if (agentNameValidationError) {
                  event.preventDefault();
                  return;
                }
                onCreateAgent(event);
              }}
            >
              <label className="member-agent-field" htmlFor="agent-name">
                <span>Name</span>
                <Input
                  aria-describedby={[
                    "agent-name-constraints",
                    agentNameCount ? "agent-name-count" : null,
                    agentNameValidationError || error
                      ? "agent-name-error"
                      : null,
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  aria-invalid={
                    agentNameValidationError || error ? "true" : undefined
                  }
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
              <span className="sr-only" id="agent-name-constraints">
                {agentNameConstraints}
              </span>
              {agentNameCount ? (
                <p
                  aria-live="polite"
                  className="caption-text m-0"
                  id="agent-name-count"
                >
                  {agentNameCount}
                </p>
              ) : null}
              {agentNameValidationError || error ? (
                <p
                  className="caption-text m-0 text-danger"
                  id="agent-name-error"
                  role="alert"
                >
                  {agentNameValidationError ?? error}
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
                <Button
                  disabled={disabled || agentNameValidationError !== null}
                  type="submit"
                  variant="primary"
                >
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
                        variant="danger"
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
            discussions={discussions}
            history={history ?? { status: "loading" }}
            historyCache={historyCache}
            members={members}
            namePolicy={namePolicy}
            onLoadEarlierHistory={onLoadEarlierHistory}
            onLoadHistoryRun={onLoadHistoryRun}
            onToggleHistoryEntry={onToggleHistoryEntry}
            onHistoryScrollState={onHistoryScrollState}
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
            namePolicy={namePolicy}
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
  namePolicy,
  onBackToDiscussion,
  onRename,
  sourceDiscussionTopic,
}: {
  disabled: boolean;
  human: Extract<Member, { type: "human" }>;
  namePolicy: MemberNamePolicy;
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
                  namePolicy={namePolicy}
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
  discussions,
  history,
  historyCache,
  members,
  namePolicy,
  onBackToDiscussion,
  onLoadEarlierHistory,
  onLoadHistoryRun,
  onToggleHistoryEntry,
  onHistoryScrollState,
  onPause,
  onRename,
  onResume,
  sourceDiscussionTopic,
}: {
  agent: AgentMember;
  disabled: boolean;
  discussions: Discussion[];
  history: AgentHistoryState;
  historyCache?: AgentHistoryCache;
  members: Member[];
  namePolicy: MemberNamePolicy;
  onLoadEarlierHistory?: (
    agentId: number,
    beforeSequence: number | null,
  ) => Promise<void>;
  onLoadHistoryRun?: (agentId: number, runId: string) => Promise<void>;
  onToggleHistoryEntry?: (
    agentId: number,
    runId: string,
    entryId: string,
    open: boolean,
  ) => Promise<void> | void;
  onHistoryScrollState?: (
    agentId: number,
    scrollTop: number,
    followsLatest: boolean,
  ) => void;
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
          <span>Agent</span>
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
                  <dt>Name</dt>
                  <dd>
                    <AgentRenameEditor
                      agent={agent}
                      disabled={disabled}
                      namePolicy={namePolicy}
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
            <AgentHistoryView
              agent={agent}
              discussions={discussions}
              members={members}
              state={history}
              cache={historyCache}
              onLoadEarlier={onLoadEarlierHistory}
              onLoadRun={onLoadHistoryRun}
              onToggleEntry={onToggleHistoryEntry}
              onScrollState={onHistoryScrollState}
            />
          </section>
        ) : null}
      </div>
    </section>
  );
}

function AgentHistoryView({
  agent,
  discussions,
  members,
  state,
  cache,
  onLoadEarlier,
  onLoadRun,
  onToggleEntry,
  onScrollState,
}: {
  agent: AgentMember;
  discussions: Discussion[];
  members: Member[];
  state: AgentHistoryState;
  cache?: AgentHistoryCache;
  onLoadEarlier?: (
    agentId: number,
    beforeSequence: number | null,
  ) => Promise<void>;
  onLoadRun?: (agentId: number, runId: string) => Promise<void>;
  onToggleEntry?: (
    agentId: number,
    runId: string,
    entryId: string,
    open: boolean,
  ) => Promise<void> | void;
  onScrollState?: (
    agentId: number,
    scrollTop: number,
    followsLatest: boolean,
  ) => void;
}) {
  const viewportRef = useRef<HTMLElement>(null);
  const followsLatestRef = useRef(cache?.followsLatest ?? true);
  const initialHistoryScrollTopRef = useRef(cache?.scrollTop);
  const readyRuns = state.status === "ready" ? state.history.runs : [];

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    if (cache?.loaded)
      viewport.scrollTop = initialHistoryScrollTopRef.current ?? 0;
    else if (followsLatestRef.current)
      viewport.scrollTop = viewport.scrollHeight;
  }, [cache?.loaded]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (viewport && followsLatestRef.current)
      viewport.scrollTop = viewport.scrollHeight;
  });

  const loading = cache
    ? cache.loading && !cache.loaded
    : state.status === "loading";
  const error =
    cache?.error ?? (state.status === "error" ? state.message : null);
  const count = cache ? cache.orderedRunIds.length : readyRuns.length;

  return (
    <section
      className="agent-history"
      aria-labelledby={`agent-${agent.id}-history`}
    >
      <header className="agent-history-header">
        <h3 id={`agent-${agent.id}-history`}>History</h3>
        {!loading ? <Badge size="small">{count}</Badge> : null}
      </header>
      <section
        aria-busy={loading}
        aria-label={`${agent.name} history`}
        className="agent-history-viewport"
        // biome-ignore lint/a11y/noNoninteractiveTabindex: The scroll viewport must be keyboard reachable for PageDown and PageUp.
        tabIndex={0}
        onScroll={(event) => {
          const viewport = event.currentTarget;
          const followsLatest =
            viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight <
            32;
          followsLatestRef.current = followsLatest;
          onScrollState?.(agent.id, viewport.scrollTop, followsLatest);
        }}
        ref={viewportRef}
      >
        {loading ? (
          <p className="agent-history-empty">Loading history</p>
        ) : error ? (
          <p className="agent-history-empty text-danger" role="alert">
            {error}
          </p>
        ) : count === 0 ? (
          <p className="agent-history-empty">No history</p>
        ) : cache ? (
          <div className="agent-history-timeline">
            {cache.newRunCount > 0 ? (
              <Button
                onClick={() => {
                  const viewport = viewportRef.current;
                  if (viewport) viewport.scrollTop = viewport.scrollHeight;
                }}
                variant="quiet"
              >
                {cache.newRunCount} new History{" "}
                {cache.newRunCount === 1 ? "run" : "runs"}
              </Button>
            ) : null}
            {cache.hasEarlier && onLoadEarlier ? (
              <Button
                disabled={cache.loading}
                onClick={() =>
                  void onLoadEarlier(agent.id, cache.nextBeforeSequence)
                }
                variant="quiet"
              >
                {cache.loading
                  ? "Loading earlier History"
                  : "Load earlier History"}
              </Button>
            ) : null}
            {cache.orderedRunIds.map((runId) => {
              const metadata = cache.metadataByRunId[runId];
              const run = cache.detailByRunId[runId];
              return (
                <div className="agent-history-run" key={runId}>
                  {!run ? (
                    <Button
                      onClick={() => void onLoadRun?.(agent.id, runId)}
                      variant="quiet"
                    >
                      Load run {metadata?.sequence ?? ""} details ·{" "}
                      {metadata?.entry_count ?? 0} entries
                    </Button>
                  ) : (
                    run.entries.map((entry) => (
                      <HistoryBlock
                        discussions={discussions}
                        entry={entry}
                        key={entry.id}
                        members={members}
                        run={run}
                        open={cache.expandedIds.includes(entry.id)}
                        onOpenChange={(open) =>
                          void onToggleEntry?.(agent.id, runId, entry.id, open)
                        }
                      />
                    ))
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="agent-history-timeline">
            {readyRuns.map((run) => (
              <div className="agent-history-run" key={run.run_id}>
                {run.entries.map((entry) => (
                  <HistoryBlock
                    discussions={discussions}
                    entry={entry}
                    key={entry.id}
                    members={members}
                    run={run}
                  />
                ))}
              </div>
            ))}
          </div>
        )}
      </section>
    </section>
  );
}
