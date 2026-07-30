import { lazy, Suspense, useState } from "react";
import { Theme } from "@radix-ui/themes";
import { AppHeader } from "@/components/app/AppHeader";
import { AppSidebar } from "@/components/app/AppSidebar";
import { cloneDefaultWorkflow } from "@/data/defaultWorkflow";
import type { AppView } from "@/types/navigation";
import type { WorkflowRun } from "@/types/run";

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

function App() {
  const [activeView, setActiveView] = useState<AppView>("workflows");
  const [workflow, setWorkflow] = useState(cloneDefaultWorkflow);
  const [runs, setRuns] = useState<WorkflowRun[]>([]);

  function startRun() {
    const id = `run-${Date.now().toString(36)}`;
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
    setActiveView("runs");
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
                  onRun={startRun}
                  onSave={() => undefined}
                  workflow={workflow}
                />
              ) : null}
              {activeView === "agents" ? (
                <AgentsView onChange={setWorkflow} workflow={workflow} />
              ) : null}
              {activeView === "runs" ? <RunsView runs={runs} /> : null}
              {activeView === "chat" ? <ChatView /> : null}
              {activeView === "settings" ? <SettingsView /> : null}
            </Suspense>
          </div>
        </section>
      </main>
    </Theme>
  );
}

export default App;
