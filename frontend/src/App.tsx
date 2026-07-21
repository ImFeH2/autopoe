import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import "@/i18n/i18n";

import { fetchAppState } from "@/app/api/state-requests";
import type { ApiState } from "@/app/api/types";
import { useAppHydration } from "@/app/controllers/use-app-hydration";
import { useWorkflows } from "@/app/controllers/use-workflows";
import { useWorkspaceController } from "@/app/controllers/use-workspace-controller";
import {
  readNavigationState,
  writeNavigationState,
} from "@/app/navigation-state";
import type { ViewId } from "@/app/navigation/view-types";
import { AppShell } from "@/components/flowent/app-shell";
import { viewPanelClassName } from "@/components/flowent/styles";
import { FlowentToastProvider } from "@/components/flowent/toast";
import { useFlowentToast } from "@/components/flowent/toast-context";
import { TabsContent } from "@/components/ui/tabs";
import { useTelegramChannel } from "@/features/channels/hooks/use-telegram-channel";
import { mcpServerFromApi } from "@/features/mcp/api/mcp-mappers";
import { useMcpServers } from "@/features/mcp/hooks/use-mcp-servers";
import { useWritablePaths } from "@/features/permissions/hooks/use-writable-paths";
import { useProviders } from "@/features/providers/hooks/use-providers";
import { useRuntimeSettings } from "@/features/settings/hooks/use-runtime-settings";
import { useSkills } from "@/features/skills/hooks/use-skills";

const ChannelsView = lazy(() =>
  import("@/components/flowent/channels-view").then((module) => ({
    default: module.ChannelsView,
  })),
);
const McpView = lazy(() =>
  import("@/components/flowent/mcp-view").then((module) => ({
    default: module.McpView,
  })),
);
const PermissionsView = lazy(() =>
  import("@/components/flowent/permissions-view").then((module) => ({
    default: module.PermissionsView,
  })),
);
const ProvidersView = lazy(() =>
  import("@/components/flowent/providers-view").then((module) => ({
    default: module.ProvidersView,
  })),
);
const SettingsView = lazy(() =>
  import("@/components/flowent/settings-view").then((module) => ({
    default: module.SettingsView,
  })),
);
const SkillsView = lazy(() =>
  import("@/components/flowent/skills-view").then((module) => ({
    default: module.SkillsView,
  })),
);
const WorkflowsView = lazy(() =>
  import("@/components/flowent/workflows-view").then((module) => ({
    default: module.WorkflowsView,
  })),
);
const WorkspaceView = lazy(() =>
  import("@/components/flowent/workspace-view").then((module) => ({
    default: module.WorkspaceView,
  })),
);

function ViewLoadFallback() {
  return <div aria-hidden="true" className="h-full bg-black" />;
}

function FlowentApp() {
  const toast = useFlowentToast();
  const initialNavigationState = useMemo(() => readNavigationState(), []);
  const [activeView, setActiveView] = useState<ViewId>(
    initialNavigationState.view,
  );
  const refreshAppStateRef = useRef<(() => Promise<ApiState | null>) | null>(
    null,
  );
  const refreshProviderSettingsState = useCallback(async () => {
    await refreshAppStateRef.current?.();
  }, []);
  const refreshWorkspaceState = useCallback(
    async () => refreshAppStateRef.current?.() ?? null,
    [],
  );
  const refreshMcpServerState = useCallback(async () => {
    const state = await fetchAppState();
    if (!state) {
      return null;
    }
    return (state.mcp_servers ?? []).map(mcpServerFromApi);
  }, []);
  const {
    commands: workspaceCommands,
    draft,
    editMessage,
    handleCommandError: handleWorkspaceCommandError,
    isRefiningContext,
    isResponding,
    loadState: loadWorkspaceState,
    messages,
    retryError,
    retryMessage,
    runCommand: runWorkspaceCommand,
    sendMessage,
    setContextWindowLimit: setWorkspaceContextWindowLimit,
    setDraft,
    stopResponse,
    usageInfo,
  } = useWorkspaceController({
    refreshAppState: refreshWorkspaceState,
    showError: toast.error,
  });
  const handleWorkspaceContextWindowLimitChange = useCallback(
    (nextContextWindowLimit: number | null) => {
      setWorkspaceContextWindowLimit(nextContextWindowLimit);
    },
    [setWorkspaceContextWindowLimit],
  );
  const {
    fetchProviderModels,
    isCreatingProvider,
    isFetchingModels,
    loadProviderEditor,
    openNewProviderEditor,
    providerDraft,
    providers,
    replaceProviders,
    removeProvider: removeProviderFromState,
    saveProvider: saveProviderToState,
    updateProviderDraft,
  } = useProviders({
    showError: toast.error,
  });
  const {
    activeProvider,
    agentPrompt,
    contextWindowLimit,
    handleActiveModelChange,
    handleActiveProviderChange,
    handleProviderRemoved,
    handleProviderSaved,
    handleReasoningEffortChange,
    reasoningEffort,
    replaceRuntimeSettings,
    saveRuntimeSettings,
    selectedModel,
    selectedProviderId,
  } = useRuntimeSettings({
    onContextWindowLimitChange: handleWorkspaceContextWindowLimitChange,
    providers,
    refreshAppState: refreshProviderSettingsState,
  });
  const saveProvider = useCallback(async () => {
    const savedProvider = await saveProviderToState();
    if (savedProvider) {
      handleProviderSaved(savedProvider.id);
    }
  }, [handleProviderSaved, saveProviderToState]);
  const removeProvider = useCallback(async () => {
    const result = await removeProviderFromState();
    if (result) {
      handleProviderRemoved(result.removedProviderId, result.nextProvider);
    }
  }, [handleProviderRemoved, removeProviderFromState]);
  const {
    approveTelegramSession,
    replaceTelegramBot,
    saveTelegramBot,
    telegramBot,
    updateTelegramBot,
  } = useTelegramChannel();
  const {
    activeSkill,
    reloadSkills,
    replaceSkills,
    selectSkill,
    skills,
    toggleSkill,
  } = useSkills();
  const {
    addWritablePath,
    removeWritablePath,
    replaceWritablePaths,
    writablePaths,
  } = useWritablePaths();
  const {
    importMcpServer,
    importingMcpServerId,
    isCreatingMcpServer,
    isMcpImportOpen,
    isPreviewingMcpImport,
    loadMcpEditor,
    mcpDraft,
    mcpImportPreview,
    mcpImportSource,
    mcpServers,
    openMcpImport,
    openNewMcpEditor,
    reconnectMcpServer,
    removeMcpServer,
    replaceMcpServers,
    saveMcpServer,
    updateMcpDraft,
    updateMcpImportSource,
  } = useMcpServers({
    refreshMcpServers: refreshMcpServerState,
    showError: toast.error,
  });
  const {
    activeWorkflow,
    activeWorkflowId,
    closeWorkflowEditor,
    deleteWorkflow,
    newWorkflowKey,
    openNewWorkflow,
    openWorkflow,
    replaceWorkflows,
    renameWorkflow,
    runWorkflow,
    runningWorkflowId,
    saveWorkflow,
    startWorkflowSchedule,
    stopWorkflowSchedule,
    workflowRunResult,
    workflowSchedule,
    workflowScheduleRequestState,
    workflows,
  } = useWorkflows(initialNavigationState.workflowId);

  const { appVersion, refreshAppState } = useAppHydration({
    loadWorkspaceState,
    mcpServers,
    replaceMcpServers,
    replaceProviders,
    replaceRuntimeSettings,
    replaceSkills,
    replaceTelegramBot,
    replaceWorkflows,
    replaceWritablePaths,
    showError: toast.error,
    skills,
    telegramBot,
  });
  refreshAppStateRef.current = refreshAppState;

  const updateNavigation = useCallback(
    (view: ViewId, workflowId = "", options?: { replace?: boolean }) => {
      setActiveView(view);
      if (view === "workflows") {
        if (workflowId) {
          openWorkflow(workflowId);
        } else {
          openNewWorkflow();
        }
      }
      writeNavigationState({ view, workflowId }, options);
    },
    [openNewWorkflow, openWorkflow],
  );

  useEffect(() => {
    writeNavigationState(
      {
        view: activeView,
        workflowId: activeView === "workflows" ? activeWorkflowId : "",
      },
      { replace: true },
    );
  }, [activeView, activeWorkflowId]);

  useEffect(() => {
    const handlePopState = () => {
      const nextNavigationState = readNavigationState();
      setActiveView(nextNavigationState.view);
      if (nextNavigationState.view === "workflows") {
        if (nextNavigationState.workflowId) {
          openWorkflow(nextNavigationState.workflowId);
        } else {
          openNewWorkflow();
        }
        return;
      }
      closeWorkflowEditor();
    };

    window.addEventListener("popstate", handlePopState);
    return () => {
      window.removeEventListener("popstate", handlePopState);
    };
  }, [closeWorkflowEditor, openNewWorkflow, openWorkflow]);

  return (
    <AppShell
      activeProviderName={activeProvider?.name}
      activeView={activeView}
      activeWorkflowId={activeWorkflowId}
      onNewWorkflow={() => updateNavigation("workflows")}
      onViewChange={(view) => updateNavigation(view)}
      onWorkflowDelete={(workflowId) => {
        void deleteWorkflow(workflowId);
      }}
      onWorkflowRename={(workflowId, nextName) => {
        void renameWorkflow(workflowId, nextName).then((result) => {
          if (!result.data) {
            toast.error(result.error);
          }
        });
      }}
      onWorkflowSelect={(workflowId) =>
        updateNavigation("workflows", workflowId)
      }
      workflows={workflows}
    >
      <TabsContent
        value="workspace"
        className={viewPanelClassName}
        tabIndex={-1}
      >
        <Suspense fallback={<ViewLoadFallback />}>
          <WorkspaceView
            contextWindowLimit={contextWindowLimit}
            draft={draft}
            isRefiningContext={isRefiningContext}
            isResponding={isResponding}
            messages={messages}
            usageInfo={usageInfo}
            commands={workspaceCommands}
            skills={skills}
            onCommand={runWorkspaceCommand}
            onCommandError={handleWorkspaceCommandError}
            onDraftChange={setDraft}
            onEditMessage={(request) => {
              void editMessage(request);
            }}
            onRetryMessage={(messageId) => {
              void retryMessage(messageId);
            }}
            onRetryError={(request) => {
              void retryError(request);
            }}
            onSendMessage={(content) => {
              void sendMessage(content);
            }}
            onStopResponse={stopResponse}
          />
        </Suspense>
      </TabsContent>
      <TabsContent value="workflows" className={viewPanelClassName}>
        <Suspense fallback={<ViewLoadFallback />}>
          <WorkflowsView
            activeWorkflow={activeWorkflow}
            newWorkflowKey={newWorkflowKey}
            onWorkflowPersisted={openWorkflow}
            onRunWorkflow={runWorkflow}
            onSaveWorkflow={saveWorkflow}
            onStartWorkflowSchedule={startWorkflowSchedule}
            onStopWorkflowSchedule={stopWorkflowSchedule}
            runningWorkflowId={runningWorkflowId}
            workflowRunResult={workflowRunResult}
            workflowSchedule={workflowSchedule}
            workflowScheduleRequestState={workflowScheduleRequestState}
          />
        </Suspense>
      </TabsContent>
      <TabsContent value="providers" className={viewPanelClassName}>
        <Suspense fallback={<ViewLoadFallback />}>
          <ProvidersView
            activeProvider={providerDraft}
            isFetchingModels={isFetchingModels}
            isCreatingProvider={isCreatingProvider}
            onFetchModels={fetchProviderModels}
            onNewProvider={openNewProviderEditor}
            onProviderSelect={loadProviderEditor}
            onRemoveProvider={removeProvider}
            onSaveProvider={saveProvider}
            onUpdateProvider={updateProviderDraft}
            providers={providers}
          />
        </Suspense>
      </TabsContent>
      <TabsContent value="channels" className={viewPanelClassName}>
        <Suspense fallback={<ViewLoadFallback />}>
          <ChannelsView
            onApproveSession={approveTelegramSession}
            onSaveTelegramBot={saveTelegramBot}
            onUpdateTelegramBot={updateTelegramBot}
            telegramBot={telegramBot}
          />
        </Suspense>
      </TabsContent>
      <TabsContent value="permissions" className={viewPanelClassName}>
        <Suspense fallback={<ViewLoadFallback />}>
          <PermissionsView
            onAddWritablePath={addWritablePath}
            onRemoveWritablePath={(path) => {
              void removeWritablePath(path);
            }}
            writablePaths={writablePaths}
          />
        </Suspense>
      </TabsContent>
      <TabsContent value="mcp" className={viewPanelClassName}>
        <Suspense fallback={<ViewLoadFallback />}>
          <McpView
            activeServer={mcpDraft}
            isCreatingServer={isCreatingMcpServer}
            isImportOpen={isMcpImportOpen}
            importPreview={mcpImportPreview}
            importSource={mcpImportSource}
            importingServerId={importingMcpServerId}
            isPreviewing={isPreviewingMcpImport}
            onNewServer={openNewMcpEditor}
            onImport={openMcpImport}
            onImportSourceChange={updateMcpImportSource}
            onImportServer={(serverId) => {
              void importMcpServer(serverId);
            }}
            onReconnectServer={reconnectMcpServer}
            onRemoveServer={removeMcpServer}
            onSaveServer={() => {
              void saveMcpServer();
            }}
            onServerSelect={loadMcpEditor}
            onUpdateServer={updateMcpDraft}
            servers={mcpServers}
          />
        </Suspense>
      </TabsContent>
      <TabsContent value="skills" className={viewPanelClassName}>
        <Suspense fallback={<ViewLoadFallback />}>
          <SkillsView
            activeSkill={activeSkill}
            onReloadSkills={() => {
              void reloadSkills();
            }}
            onSkillSelect={selectSkill}
            onSkillToggle={(skill, enabled) => {
              void toggleSkill(skill, enabled);
            }}
            skills={skills}
          />
        </Suspense>
      </TabsContent>
      <TabsContent value="settings" className={viewPanelClassName}>
        <Suspense fallback={<ViewLoadFallback />}>
          <SettingsView
            agentPrompt={agentPrompt}
            appVersion={appVersion}
            contextWindowLimit={contextWindowLimit}
            modelOptions={activeProvider?.models ?? []}
            onModelChange={handleActiveModelChange}
            onProviderChange={handleActiveProviderChange}
            onReasoningEffortChange={handleReasoningEffortChange}
            onRuntimeSettingsSave={saveRuntimeSettings}
            providers={providers}
            reasoningEffort={reasoningEffort}
            selectedModel={selectedModel}
            selectedProviderId={selectedProviderId}
          />
        </Suspense>
      </TabsContent>
    </AppShell>
  );
}

function App() {
  return (
    <FlowentToastProvider>
      <FlowentApp />
    </FlowentToastProvider>
  );
}

export default App;
