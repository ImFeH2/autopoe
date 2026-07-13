import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { ApiState } from "@/app/api/types";
import { useAppHydration } from "@/app/controllers/use-app-hydration";
import { useWorkflows } from "@/app/controllers/use-workflows";
import { useWorkspaceController } from "@/app/controllers/use-workspace-controller";
import {
  readNavigationState,
  writeNavigationState,
} from "@/app/navigation-state";
import { AppShell } from "@/components/flowent/app-shell";
import { ChannelsView } from "@/components/flowent/channels-view";
import { McpView } from "@/components/flowent/mcp-view";
import { PermissionsView } from "@/components/flowent/permissions-view";
import { ProvidersView } from "@/components/flowent/providers-view";
import { SettingsView } from "@/components/flowent/settings-view";
import { SkillsView } from "@/components/flowent/skills-view";
import { viewPanelClassName } from "@/components/flowent/styles";
import { FlowentToastProvider } from "@/components/flowent/toast";
import { useFlowentToast } from "@/components/flowent/toast-context";
import type { ViewId } from "@/components/flowent/types";
import { WorkflowsView } from "@/components/flowent/workflows-view";
import { WorkspaceView } from "@/components/flowent/workspace-view";
import { TabsContent } from "@/components/ui/tabs";
import { useTelegramChannel } from "@/features/channels/hooks/use-telegram-channel";
import { useMcpServers } from "@/features/mcp/hooks/use-mcp-servers";
import { useWritablePaths } from "@/features/permissions/hooks/use-writable-paths";
import { useProviderSettings } from "@/features/providers/hooks/use-provider-settings";
import { useSkills } from "@/features/skills/hooks/use-skills";

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
    activeProvider,
    agentPrompt,
    contextWindowLimit,
    fetchProviderModels,
    handleActiveModelChange,
    handleActiveProviderChange,
    handleReasoningEffortChange,
    isCreatingProvider,
    isFetchingModels,
    loadProviderEditor,
    openNewProviderEditor,
    providerDraft,
    providers,
    reasoningEffort,
    removeProvider,
    replaceProviders,
    replaceRuntimeSettings,
    saveProvider,
    saveRuntimeSettings,
    selectedModel,
    selectedProviderId,
    updateProviderDraft,
  } = useProviderSettings({
    onContextWindowLimitChange: handleWorkspaceContextWindowLimitChange,
    refreshAppState: refreshProviderSettingsState,
    showError: toast.error,
  });
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
  } = useMcpServers({ showError: toast.error });
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
      </TabsContent>
      <TabsContent value="workflows" className={viewPanelClassName}>
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
      </TabsContent>
      <TabsContent value="providers" className={viewPanelClassName}>
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
      </TabsContent>
      <TabsContent value="channels" className={viewPanelClassName}>
        <ChannelsView
          onApproveSession={approveTelegramSession}
          onSaveTelegramBot={saveTelegramBot}
          onUpdateTelegramBot={updateTelegramBot}
          telegramBot={telegramBot}
        />
      </TabsContent>
      <TabsContent value="permissions" className={viewPanelClassName}>
        <PermissionsView
          onAddWritablePath={addWritablePath}
          onRemoveWritablePath={(path) => {
            void removeWritablePath(path);
          }}
          writablePaths={writablePaths}
        />
      </TabsContent>
      <TabsContent value="mcp" className={viewPanelClassName}>
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
      </TabsContent>
      <TabsContent value="skills" className={viewPanelClassName}>
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
      </TabsContent>
      <TabsContent value="settings" className={viewPanelClassName}>
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
