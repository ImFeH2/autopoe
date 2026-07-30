import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { Theme } from "@radix-ui/themes";
import { AppHeader } from "@/components/app/AppHeader";
import { AppSidebar } from "@/components/app/AppSidebar";
import {
  cloneDefaultWorkflow,
  createBlankWorkflow,
} from "@/data/defaultWorkflow";
import { RunWorkflowDialog } from "@/features/runs/RunWorkflowDialog";
import type { RunWorkflowInput } from "@/features/runs/RunWorkflowDialog";
import { applyRuntimeEvent, markApprovalResolved } from "@/lib/run-events";
import { runWorkflow, runtimeRequest } from "@/lib/runtime";
import type { AppView } from "@/types/navigation";
import type { WorkflowRun, WorkflowRunStatus } from "@/types/run";
import type {
  RunEventsResponse,
  RunListResponse,
  RuntimeEvent,
  StoredWorkflowRun,
  WorkflowListResponse,
  WorkflowSummary,
  WorkflowVersionResponse,
} from "@/types/runtime";
import type { WorkflowDefinition } from "@/types/workflow";

const viewTitles: Record<AppView, string> = {
  workflows: "Workflows",
  agents: "Agents",
  runs: "Runs",
  chat: "Chat",
  settings: "Settings",
};

const WorkflowEditor = lazy(() =>
  import("@/features/workflows/WorkflowEditor").then((module) => ({
    default: module.WorkflowEditor,
  })),
);
const AgentsView = lazy(() =>
  import("@/features/agents/AgentsView").then((module) => ({
    default: module.AgentsView,
  })),
);
const RunsView = lazy(() =>
  import("@/features/runs/RunsView").then((module) => ({
    default: module.RunsView,
  })),
);
const ChatView = lazy(() =>
  import("@/features/chat/ChatView").then((module) => ({
    default: module.ChatView,
  })),
);
const SettingsView = lazy(() =>
  import("@/features/settings/SettingsView").then((module) => ({
    default: module.SettingsView,
  })),
);

function currentTime() {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date());
}

function createRunId() {
  return globalThis.crypto?.randomUUID?.() ?? `run-${Date.now().toString(36)}`;
}

function runStatus(status: string): WorkflowRunStatus {
  switch (status) {
    case "queued":
    case "running":
    case "waiting":
    case "completed":
    case "failed":
    case "cancelled":
    case "interrupted":
      return status;
    default:
      return "failed";
  }
}

function runTime(value: string | undefined) {
  if (!value) {
    return "Unknown";
  }
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function fromStoredRun(run: StoredWorkflowRun): WorkflowRun {
  return {
    id: run.id,
    workflowName: run.workflow_name,
    status: runStatus(run.status),
    startedAt: runTime(run.started_at ?? run.created_at),
    events: [],
    eventsLoaded: false,
  };
}

function App() {
  const [activeView, setActiveView] = useState<AppView>("workflows");
  const [workflow, setWorkflow] = useState(cloneDefaultWorkflow);
  const [workflowOptions, setWorkflowOptions] = useState<WorkflowSummary[]>([]);
  const [runs, setRuns] = useState<WorkflowRun[]>([]);
  const [runDialogOpen, setRunDialogOpen] = useState(false);
  const [startingRun, setStartingRun] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const loadedRef = useRef(false);
  const historyLoadedRef = useRef(false);
  const loadingRunIdsRef = useRef(new Set<string>());
  const queuedEventsRef = useRef(new Map<string, RuntimeEvent[]>());
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    if (loadedRef.current) {
      return;
    }
    loadedRef.current = true;
    void runtimeRequest<{ workflow: WorkflowDefinition }>("workflow.get", {
      workflow_id: workflow.id,
    })
      .then((response) => {
        if (response?.workflow?.id) {
          setWorkflow(response.workflow);
        }
      })
      .catch(() => undefined);
  }, [workflow.id]);

  useEffect(() => {
    void refreshWorkflows();
  }, []);

  useEffect(() => {
    if (historyLoadedRef.current) {
      return;
    }
    historyLoadedRef.current = true;
    void runtimeRequest<RunListResponse>("run.list", { limit: 50 })
      .then((response) => {
        if (!response?.runs) {
          return;
        }
        setRuns((current) => {
          const activeIds = new Set(current.map((run) => run.id));
          return [
            ...current,
            ...response.runs
              .filter((run) => !activeIds.has(run.id))
              .map(fromStoredRun),
          ];
        });
      })
      .catch(() => undefined);
  }, []);

  useEffect(
    () => () => {
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
      }
    },
    [],
  );

  function flushRunEvents() {
    frameRef.current = null;
    const batches = new Map(queuedEventsRef.current);
    queuedEventsRef.current.clear();
    setRuns((current) =>
      current.map((run) => {
        const events = batches.get(run.id);
        if (!events) {
          return run;
        }
        return events.reduce(applyRuntimeEvent, run);
      }),
    );
  }

  function enqueueRunEvent(runId: string, event: RuntimeEvent) {
    const current = queuedEventsRef.current.get(runId) ?? [];
    current.push(event);
    queuedEventsRef.current.set(runId, current);
    if (frameRef.current === null) {
      frameRef.current = requestAnimationFrame(flushRunEvents);
    }
  }

  const loadRunEvents = useCallback(async (runId: string) => {
    if (loadingRunIdsRef.current.has(runId)) {
      return;
    }
    loadingRunIdsRef.current.add(runId);
    try {
      const response = await runtimeRequest<RunEventsResponse>("run.events", {
        run_id: runId,
      });
      setRuns((current) =>
        current.map((run) => {
          if (run.id !== runId) {
            return run;
          }
          const replayed = (response?.events ?? []).reduce(applyRuntimeEvent, {
            ...run,
            events: [],
            eventsLoaded: true,
          });
          return run.status === "interrupted"
            ? { ...replayed, status: "interrupted" }
            : replayed;
        }),
      );
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      loadingRunIdsRef.current.delete(runId);
    }
  }, []);

  async function saveWorkflow() {
    await runtimeRequest("workflow.save", { workflow });
    await refreshWorkflows();
    setNotice(null);
  }

  async function refreshWorkflows() {
    try {
      const response = await runtimeRequest<WorkflowListResponse>(
        "workflow.list",
      );
      if (response?.workflows) {
        setWorkflowOptions(response.workflows);
      }
    } catch {
      return;
    }
  }

  async function selectWorkflow(workflowId: string) {
    if (workflowId === workflow.id) {
      return;
    }
    try {
      await saveWorkflow();
      const response = await runtimeRequest<{ workflow: WorkflowDefinition }>(
        "workflow.get",
        { workflow_id: workflowId },
      );
      setWorkflow(response.workflow);
      setNotice(null);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    }
  }

  async function newWorkflow() {
    try {
      await saveWorkflow();
      const next = createBlankWorkflow();
      await runtimeRequest("workflow.save", { workflow: next });
      setWorkflow(next);
      await refreshWorkflows();
      setNotice(null);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    }
  }

  async function startRun(input: RunWorkflowInput) {
    setStartingRun(true);
    setNotice(null);
    try {
      await saveWorkflow();
      const published = await runtimeRequest<WorkflowVersionResponse>(
        "workflow.publish",
        { workflow_id: workflow.id },
      );
      const id = createRunId();
      setRuns((current) => [
        {
          id,
          workflowName: workflow.name,
          status: "queued",
          startedAt: currentTime(),
          events: [
            {
              id: `${id}-queued`,
              name: "workflow.queued",
              timestamp: currentTime(),
            },
          ],
          eventsLoaded: true,
        },
        ...current,
      ]);
      setRunDialogOpen(false);
      setActiveView("runs");
      void runWorkflow(
        {
          runId: id,
          workflowId: workflow.id,
          version: published.version.version,
          input: { request: input.request },
          workspace: input.workspace,
        },
        (event) => enqueueRunEvent(id, event),
      ).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        enqueueRunEvent(id, {
          name: "workflow.failed",
          scope: { run_id: id, workflow_run_id: id },
          payload: { message },
        });
      });
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
      throw error;
    } finally {
      setStartingRun(false);
    }
  }

  async function resolveApproval(approvalId: string, approved: boolean) {
    try {
      const response = await runtimeRequest<{ resolved: boolean }>(
        "approval.resolve",
        {
          approval_id: approvalId,
          approved,
          data: {},
        },
      );
      if (!response.resolved) {
        throw new Error("Approval is no longer pending");
      }
      setRuns((current) =>
        current.map((run) => markApprovalResolved(run, approvalId)),
      );
      setNotice(null);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    }
  }

  async function cancelRun(runId: string) {
    try {
      const response = await runtimeRequest<{ cancelled: boolean }>(
        "workflow.cancel",
        { run_id: runId },
      );
      if (!response.cancelled) {
        throw new Error("Run is no longer active");
      }
      setNotice(null);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    }
  }

  return (
    <Theme
      accentColor="gray"
      appearance="dark"
      className="flowent-theme"
      grayColor="gray"
      panelBackground="translucent"
      radius="medium"
      scaling="100%"
    >
      <main className="app-shell">
        <AppSidebar activeView={activeView} onNavigate={setActiveView} />
        <section className="app-stage">
          <AppHeader
            meta={activeView === "workflows" ? workflow.name : undefined}
            title={viewTitles[activeView]}
          />
          <div className="app-content" data-view={activeView}>
            <Suspense fallback={<div className="view-loading">Loading</div>}>
              {activeView === "workflows" ? (
                <WorkflowEditor
                  onChange={setWorkflow}
                  onNewWorkflow={newWorkflow}
                  onRun={() => setRunDialogOpen(true)}
                  onSave={saveWorkflow}
                  onSelectWorkflow={selectWorkflow}
                  workflow={workflow}
                  workflowOptions={workflowOptions}
                />
              ) : null}
              {activeView === "agents" ? (
                <AgentsView onChange={setWorkflow} workflow={workflow} />
              ) : null}
              {activeView === "runs" ? (
                <RunsView
                  onCancelRun={cancelRun}
                  onResolveApproval={resolveApproval}
                  onSelectRun={loadRunEvents}
                  runs={runs}
                />
              ) : null}
              {activeView === "chat" ? <ChatView /> : null}
              {activeView === "settings" ? <SettingsView /> : null}
            </Suspense>
          </div>
        </section>
        {notice ? (
          <div className="app-notice" role="alert">
            {notice}
          </div>
        ) : null}
        <RunWorkflowDialog
          onOpenChange={setRunDialogOpen}
          onStart={startRun}
          open={runDialogOpen}
          running={startingRun}
        />
      </main>
    </Theme>
  );
}

export default App;
