import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Theme } from "@radix-ui/themes";
import { AppHeader } from "@/components/app/AppHeader";
import { AppSidebar } from "@/components/app/AppSidebar";
import { cloneDefaultWorkflow } from "@/data/defaultWorkflow";
import { RunWorkflowDialog } from "@/features/runs/RunWorkflowDialog";
import type { RunWorkflowInput } from "@/features/runs/RunWorkflowDialog";
import { applyRuntimeEvent, markApprovalResolved } from "@/lib/run-events";
import { runWorkflow, runtimeRequest } from "@/lib/runtime";
import type { AppView } from "@/types/navigation";
import type { WorkflowRun } from "@/types/run";
import type { RuntimeEvent, WorkflowVersionResponse } from "@/types/runtime";
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

function App() {
  const [activeView, setActiveView] = useState<AppView>("workflows");
  const [workflow, setWorkflow] = useState(cloneDefaultWorkflow);
  const [runs, setRuns] = useState<WorkflowRun[]>([]);
  const [runDialogOpen, setRunDialogOpen] = useState(false);
  const [startingRun, setStartingRun] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const loadedRef = useRef(false);
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

  async function saveWorkflow() {
    await runtimeRequest("workflow.save", { workflow });
    setNotice(null);
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
    await runtimeRequest("approval.resolve", {
      approval_id: approvalId,
      approved,
      data: {},
    });
    setRuns((current) => [
      ...current.map((run) => markApprovalResolved(run, approvalId)),
    ]);
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
                  onRun={() => setRunDialogOpen(true)}
                  onSave={saveWorkflow}
                  workflow={workflow}
                />
              ) : null}
              {activeView === "agents" ? (
                <AgentsView onChange={setWorkflow} workflow={workflow} />
              ) : null}
              {activeView === "runs" ? (
                <RunsView onResolveApproval={resolveApproval} runs={runs} />
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
