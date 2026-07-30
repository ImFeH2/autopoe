import { useEffect, useState } from "react";
import { Button, ScrollArea } from "@radix-ui/themes";
import {
  Bot,
  Check,
  Circle,
  CircleStop,
  Clock3,
  PlayCircle,
  ShieldCheck,
  TerminalSquare,
  Wrench,
} from "lucide-react";
import type { WorkflowRun, WorkflowRunStatus } from "@/types/run";

interface RunsViewProps {
  runs: WorkflowRun[];
  onCancelRun: (runId: string) => Promise<void>;
  onResolveApproval: (approvalId: string, approved: boolean) => Promise<void>;
  onSelectRun: (runId: string) => Promise<void>;
}

const dotPattern = /\./g;

const statusLabels: Record<WorkflowRunStatus, string> = {
  queued: "Queued",
  running: "Running",
  waiting: "Waiting",
  completed: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
  interrupted: "Interrupted",
};

function EventIcon({ name }: { name: string }) {
  if (name.includes("approval")) {
    return <ShieldCheck size={14} strokeWidth={1.7} />;
  }
  if (name.includes("tool")) {
    return <Wrench size={14} strokeWidth={1.7} />;
  }
  if (name.includes("agent")) {
    return <Bot size={14} strokeWidth={1.7} />;
  }
  if (name.includes("completed")) {
    return <Check size={14} strokeWidth={1.8} />;
  }
  return <Circle size={10} strokeWidth={1.8} />;
}

export function RunsView({
  runs,
  onCancelRun,
  onResolveApproval,
  onSelectRun,
}: RunsViewProps) {
  const [selectedId, setSelectedId] = useState(runs[0]?.id ?? "");
  const selected = runs.find((run) => run.id === selectedId) ?? runs[0];

  useEffect(() => {
    if (selected && !selected.eventsLoaded) {
      void onSelectRun(selected.id);
    }
  }, [onSelectRun, selected]);

  if (runs.length === 0) {
    return (
      <section className="empty-page">
        <span className="empty-page-icon">
          <PlayCircle size={23} strokeWidth={1.45} />
        </span>
        <h2>No runs</h2>
        <span>Run a workflow to start.</span>
      </section>
    );
  }

  return (
    <section className="runs-view">
      <aside className="run-list-panel">
        <ScrollArea className="collection-scroll" scrollbars="vertical">
          <div className="run-list">
            {runs.map((run) => (
              <Button
                aria-current={run.id === selected?.id ? "page" : undefined}
                className="run-list-item"
                color="gray"
                key={run.id}
                onClick={() => setSelectedId(run.id)}
                variant="ghost"
              >
                <span className="run-list-topline">
                  <strong>{run.workflowName}</strong>
                  <span className="status-label" data-status={run.status}>
                    {statusLabels[run.status]}
                  </span>
                </span>
                <span className="run-list-time">
                  <Clock3 size={12} strokeWidth={1.7} />
                  {run.startedAt}
                </span>
              </Button>
            ))}
          </div>
        </ScrollArea>
      </aside>

      {selected ? (
        <div className="run-console">
          <div className="console-head">
            <div className="console-title">
              <span className="eyebrow">Run</span>
              <strong>{selected.workflowName}</strong>
            </div>
            <div className="console-actions">
              <span className="status-label" data-status={selected.status}>
                {statusLabels[selected.status]}
              </span>
              {selected.status === "queued" ||
              selected.status === "running" ||
              selected.status === "waiting" ? (
                <Button
                  className="secondary-button"
                  color="gray"
                  onClick={() => void onCancelRun(selected.id)}
                  size="1"
                  variant="soft"
                >
                  <CircleStop size={13} strokeWidth={1.7} />
                  Cancel
                </Button>
              ) : null}
            </div>
          </div>
          <ScrollArea className="event-scroll" scrollbars="vertical">
            <div className="event-timeline" role="log" aria-live="polite">
              {!selected.eventsLoaded ? (
                <div className="run-event-loading">Loading</div>
              ) : null}
              {selected.events.map((event) => (
                <article className="timeline-event" key={event.id}>
                  <span className="timeline-icon">
                    <EventIcon name={event.name} />
                  </span>
                  <div>
                    <span className="timeline-title">
                      {event.name.replace(dotPattern, " ")}
                    </span>
                    {event.node ? (
                      <span className="timeline-node">{event.node}</span>
                    ) : null}
                    {event.detail ? (
                      <pre className="timeline-detail">{event.detail}</pre>
                    ) : null}
                    {event.prompt ? (
                      <span className="approval-prompt">{event.prompt}</span>
                    ) : null}
                    {event.approvalId && !event.resolved ? (
                      <div className="approval-actions">
                        <Button
                          className="secondary-button"
                          color="gray"
                          onClick={() =>
                            void onResolveApproval(event.approvalId!, false)
                          }
                          variant="soft"
                        >
                          Reject
                        </Button>
                        <Button
                          className="primary-button"
                          onClick={() =>
                            void onResolveApproval(event.approvalId!, true)
                          }
                        >
                          Approve
                        </Button>
                      </div>
                    ) : null}
                  </div>
                  <time>{event.timestamp}</time>
                </article>
              ))}
            </div>
          </ScrollArea>
          <div className="console-foot">
            <TerminalSquare size={14} strokeWidth={1.7} />
            <span>{selected.events.length} events</span>
          </div>
        </div>
      ) : null}
    </section>
  );
}
