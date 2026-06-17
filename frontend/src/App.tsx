import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { ApiMessage, ApiState } from "@/app/api-types";
import {
  contextWindowFromLimit,
  errorNotificationKeysFromState,
  mcpServerFromApi,
  providerFromApi,
  telegramBotFromApi,
  writablePathFromApi,
  workflowFromApi,
} from "@/app/api-mappers";
import { fetchAbout, fetchAppState } from "@/app/state-requests";
import { createWorkspaceStreamHandlers as createWorkspaceStreamHandlersForResponse } from "@/app/workspace-stream-handlers";
import {
  clearWorkspace,
  compactWorkspaceRequest,
  editWorkspaceMessage,
  requestWorkspaceResponse,
  retryWorkspaceError,
  stopWorkspaceResponse,
  streamWorkspaceResponse,
} from "@/app/workspace-requests";
import {
  createWorkspaceErrorMessage,
  createWorkspaceStreamErrorMessage,
  isAbortError,
  latestUsageInfoFromMessages,
  messagesIncludeErrorBlockFrom,
  previousUserMessage,
  trimAssistantMessageAtError,
  WorkspaceRequestError,
  WorkspaceStreamError,
} from "@/app/workspace-messages";
import {
  readWorkspaceStream,
  type WorkspaceStreamHandlers,
} from "@/app/workspace-stream";
import { useWorkflows } from "@/app/use-workflows";
import { useMcpServers } from "@/app/use-mcp-servers";
import { useSetupSections } from "@/app/use-setup-sections";
import { useProviderSettings } from "@/app/use-provider-settings";
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
import type {
  Message,
  ContextUsageInfo,
  MessageActionRequest,
  MessageErrorRetryRequest,
  ViewId,
  WorkspaceCommand,
  WorkspaceCommandId,
} from "@/components/flowent/types";
import { WorkflowsView } from "@/components/flowent/workflows-view";
import { WorkspaceView } from "@/components/flowent/workspace-view";
import { TabsContent } from "@/components/ui/tabs";
import { createClientId } from "@/lib/utils";

function FlowentApp() {
  const toast = useFlowentToast();
  const [activeView, setActiveView] = useState<ViewId>("workspace");
  const [draft, setDraft] = useState("");
  const [appVersion, setAppVersion] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [usageInfo, setUsageInfo] = useState<ContextUsageInfo | null>(null);
  const usageInfoRef = useRef<ContextUsageInfo | null>(null);
  const [isResponding, setIsResponding] = useState(false);
  const [isRefiningContext, setIsRefiningContext] = useState(false);
  const [responseError, setResponseError] = useState("");
  const responseAbortRef = useRef<AbortController | null>(null);
  const responseEventIndexRef = useRef(0);
  const messagesRef = useRef<Message[]>([]);
  const responseRunRef = useRef(0);
  const errorNotificationKeysRef = useRef<Set<string>>(new Set());
  const hasLoadedStateRef = useRef(false);
  const [streamReconnectKey, setStreamReconnectKey] = useState(0);
  const refreshAppStateRef = useRef<(() => Promise<ApiState | null>) | null>(
    null,
  );
  const setTrackedUsageInfo = useCallback(
    (
      nextUsageInfo:
        | ContextUsageInfo
        | null
        | ((
            currentUsageInfo: ContextUsageInfo | null,
          ) => ContextUsageInfo | null),
    ) => {
      if (typeof nextUsageInfo !== "function") {
        usageInfoRef.current = nextUsageInfo;
        setUsageInfo(nextUsageInfo);
        return;
      }
      setUsageInfo((currentUsageInfo) => {
        const resolvedUsageInfo = nextUsageInfo(currentUsageInfo);
        usageInfoRef.current = resolvedUsageInfo;
        return resolvedUsageInfo;
      });
    },
    [],
  );
  const refreshProviderSettingsState = useCallback(async () => {
    await refreshAppStateRef.current?.();
  }, []);
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
    onContextWindowLimitChange: (nextContextWindowLimit) => {
      setTrackedUsageInfo((currentUsageInfo) =>
        contextWindowFromLimit(currentUsageInfo, nextContextWindowLimit),
      );
    },
    refreshAppState: refreshProviderSettingsState,
    showError: toast.error,
  });
  const {
    activeSkill,
    addWritablePath,
    approveTelegramSession,
    reloadSkills,
    removeWritablePath,
    replaceSkills,
    replaceTelegramBot,
    replaceWritablePaths,
    saveTelegramBot,
    selectSkill,
    skills,
    telegramBot,
    toggleSkill,
    updateTelegramBot,
    writablePaths,
  } = useSetupSections();
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
    runWorkflow,
    runningWorkflowId,
    saveWorkflow,
    workflowRunResult,
    workflows,
  } = useWorkflows({ setActiveView });

  useEffect(() => {
    const nextNotificationKeys = new Set<string>();

    const notifyOnce = (key: string, message: string) => {
      nextNotificationKeys.add(key);
      if (errorNotificationKeysRef.current.has(key)) {
        return;
      }
      toast.error(message);
    };

    if (telegramBot.status === "error" && telegramBot.error) {
      notifyOnce(`channel:telegram:${telegramBot.error}`, telegramBot.error);
    }

    for (const server of mcpServers) {
      if (server.status !== "error" || !server.error) {
        continue;
      }
      notifyOnce(`mcp:${server.id}:${server.error}`, server.error);
    }

    for (const skill of skills) {
      if (!skill.enabled || !skill.error) {
        continue;
      }
      notifyOnce(`skill:${skill.id}:${skill.error}`, skill.error);
    }

    errorNotificationKeysRef.current = nextNotificationKeys;
  }, [mcpServers, skills, telegramBot, toast]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  const applyLoadedState = useCallback(
    (state: ApiState) => {
      const loadedProviders = state.providers.map(providerFromApi);
      replaceProviders(loadedProviders);
      setMessages(state.messages);
      setTrackedUsageInfo(
        contextWindowFromLimit(
          state.usage_info ?? latestUsageInfoFromMessages(state.messages),
          state.settings.context_window_limit ?? null,
        ),
      );
      const loadedMcpServers = (state.mcp_servers ?? []).map(mcpServerFromApi);
      replaceMcpServers(loadedMcpServers);
      const loadedSkills = state.skills ?? [];
      replaceSkills(loadedSkills);
      replaceRuntimeSettings({
        agentPrompt: state.settings.agent_prompt ?? "",
        contextWindowLimit: state.settings.context_window_limit ?? null,
        reasoningEffort: state.settings.reasoning_effort ?? "default",
        selectedModel: state.settings.selected_model,
        selectedProviderId: state.settings.selected_provider_id,
      });
      const loadedTelegramBot = telegramBotFromApi(state.telegram_bot);
      replaceTelegramBot(loadedTelegramBot);
      replaceWritablePaths(
        (state.writable_paths ?? []).map(writablePathFromApi),
      );
      replaceWorkflows((state.workflows ?? []).map(workflowFromApi));
      const shouldResumeResponse = Boolean(state.is_responding);
      responseEventIndexRef.current = state.response_event_index ?? 0;
      setIsResponding(shouldResumeResponse);
      setIsRefiningContext(Boolean(state.is_compacting));
      if (!hasLoadedStateRef.current) {
        if (shouldResumeResponse) {
          setStreamReconnectKey((current) => current + 1);
        }
        errorNotificationKeysRef.current = new Set(
          errorNotificationKeysFromState(
            loadedTelegramBot,
            loadedMcpServers,
            loadedSkills,
          ),
        );
        hasLoadedStateRef.current = true;
      }
    },
    [
      replaceMcpServers,
      replaceProviders,
      replaceRuntimeSettings,
      replaceSkills,
      replaceTelegramBot,
      replaceWorkflows,
      replaceWritablePaths,
      setTrackedUsageInfo,
    ],
  );

  const refreshAppState = useCallback(async () => {
    const state = await fetchAppState();
    if (!state) {
      return null;
    }
    applyLoadedState(state);
    return state;
  }, [applyLoadedState]);
  refreshAppStateRef.current = refreshAppState;

  useEffect(() => {
    let isMounted = true;

    const loadState = async () => {
      try {
        const [state, about] = await Promise.all([
          refreshAppState(),
          fetchAbout(),
        ]);
        if (!state) {
          return;
        }
        if (!isMounted) {
          return;
        }

        setAppVersion(typeof about.version === "string" ? about.version : "");
      } catch {
        // Keep the local empty state when persistence is unavailable.
      }
    };

    void loadState();

    return () => {
      isMounted = false;
    };
  }, [refreshAppState]);

  useEffect(() => {
    if (!isRefiningContext) {
      return;
    }

    const intervalId = window.setInterval(() => {
      void refreshAppState().catch(() => undefined);
    }, 1000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [isRefiningContext, refreshAppState]);

  const showWorkspaceNotification = useCallback(
    (message: string) => {
      toast.error(message);
    },
    [toast],
  );

  const createWorkspaceStreamHandlers = useCallback(
    (baseMessages: Message[], responseRun: number): WorkspaceStreamHandlers =>
      createWorkspaceStreamHandlersForResponse({
        baseMessages,
        messagesRef,
        responseEventIndexRef,
        responseRun,
        responseRunRef,
        setIsResponding,
        setMessages,
        setTrackedUsageInfo,
        usageInfoRef,
      }),
    [setTrackedUsageInfo],
  );

  useEffect(() => {
    if (streamReconnectKey === 0) {
      return;
    }

    const responseRun = responseRunRef.current || 1;
    responseRunRef.current = responseRun;
    const responseAbortController = new AbortController();
    responseAbortRef.current = responseAbortController;
    setIsResponding(true);
    setResponseError("");

    const streamCurrentResponse = async () => {
      const handlers = createWorkspaceStreamHandlers(
        messagesRef.current,
        responseRun,
      );
      try {
        await streamWorkspaceResponse({
          after: responseEventIndexRef.current,
          handlers,
          signal: responseAbortController.signal,
        });
      } catch (error) {
        if (
          responseRunRef.current !== responseRun ||
          responseAbortController.signal.aborted
        ) {
          return;
        }
        const state = await refreshAppState().catch(() => null);
        if (state?.is_responding) {
          setStreamReconnectKey((current) => current + 1);
          return;
        }
        responseEventIndexRef.current = 0;
        setIsResponding(false);
        setResponseError(
          error instanceof Error ? error.message : "Message could not be sent.",
        );
      } finally {
        if (responseRunRef.current === responseRun) {
          responseAbortRef.current = null;
        }
      }
    };

    void streamCurrentResponse();

    return () => {
      responseAbortController.abort();
    };
  }, [createWorkspaceStreamHandlers, refreshAppState, streamReconnectKey]);

  const compactWorkspace = async () => {
    setResponseError("");
    setIsRefiningContext(true);
    const compactErrorStartIndex = messages.length;

    const appendCompactMessage = (message: ApiMessage) => {
      setMessages((currentMessages) =>
        currentMessages.some(
          (currentMessage) => currentMessage.id === message.id,
        )
          ? currentMessages
          : [...currentMessages, message],
      );
    };
    const appendCompactSnapshot = (message: ApiMessage) => {
      setMessages((currentMessages) => {
        const messageIndex = currentMessages.findIndex(
          (currentMessage) => currentMessage.id === message.id,
        );
        if (messageIndex >= 0) {
          return currentMessages.map((currentMessage, index) =>
            index === messageIndex ? message : currentMessage,
          );
        }
        return [...currentMessages, message];
      });
    };

    try {
      const response = await compactWorkspaceRequest();

      await readWorkspaceStream(response, {
        onEventIndex: () => undefined,
        onContextOptimized: appendCompactMessage,
        onDelta: () => undefined,
        onDone: appendCompactMessage,
        onError: () => undefined,
        onOutputDone: () => undefined,
        onOutputStart: () => undefined,
        onSnapshot: appendCompactSnapshot,
        onStart: () => undefined,
        onThinkingDelta: () => undefined,
        onToolDone: () => undefined,
        onToolStart: () => undefined,
        onUsage: setTrackedUsageInfo,
      });
      setIsRefiningContext(false);
    } catch (error) {
      if (isAbortError(error)) {
        void refreshAppState().catch(() => undefined);
        return;
      }
      if (error instanceof WorkspaceStreamError) {
        setIsRefiningContext(false);
        return;
      }
      const detail =
        error instanceof Error
          ? error.message
          : "Context could not be compacted.";
      setMessages((currentMessages) =>
        messagesIncludeErrorBlockFrom(currentMessages, compactErrorStartIndex)
          ? currentMessages
          : [...currentMessages, createWorkspaceErrorMessage(detail)],
      );
      setIsRefiningContext(false);
    }
  };

  const workspaceCommands: WorkspaceCommand[] = useMemo(
    () => [
      {
        description: "Clear the conversation",
        id: "clear",
        label: "/clear",
        name: "clear",
      },
      {
        description: "Compact context",
        id: "compact",
        label: "/compact",
        name: "compact",
      },
    ],
    [],
  );

  const runWorkspaceCommand = (commandId: WorkspaceCommandId) => {
    if (commandId === "clear") {
      void clearMessages();
      return true;
    }
    if (commandId === "compact") {
      if (isResponding) {
        showWorkspaceNotification(
          "Compact is unavailable while Flowent is responding.",
        );
        return false;
      }
      void compactWorkspace();
      return true;
    }
    return false;
  };

  const handleWorkspaceCommandError = (message: string) => {
    showWorkspaceNotification(message);
  };

  const workspaceErrorDetail = (error: unknown, fallback: string) =>
    error instanceof Error ? error.message : fallback;

  const appendWorkspaceErrorMessage = (
    baseMessages: Message[],
    error: unknown,
    fallback: string,
  ) => [
    ...baseMessages,
    createWorkspaceErrorMessage(workspaceErrorDetail(error, fallback)),
  ];

  const stopResponse = () => {
    if (isResponding) {
      void stopWorkspaceResponse();
    }
    responseRunRef.current += 1;
    responseEventIndexRef.current = 0;
    responseAbortRef.current?.abort();
    responseAbortRef.current = null;
    setResponseError("");
    setIsResponding(false);
  };

  const sendMessage = async (
    submittedDraft = draft,
    baseMessages = messages,
    options: { clearDraft?: boolean } = {},
  ) => {
    if (submittedDraft.length === 0 || isResponding || isRefiningContext) {
      return;
    }
    const shouldClearDraft = options.clearDraft ?? baseMessages === messages;

    const responseRun = responseRunRef.current + 1;
    const responseAbortController = new AbortController();
    responseAbortRef.current = responseAbortController;
    responseRunRef.current = responseRun;
    responseEventIndexRef.current = 0;
    const userContent = submittedDraft;
    const userMessageId = createClientId("message");
    const nextMessages: Message[] = [
      ...baseMessages,
      {
        author: "user",
        content: userContent,
        id: userMessageId,
      },
    ];
    setResponseError("");
    setIsResponding(true);
    setMessages(nextMessages);
    if (shouldClearDraft) {
      setDraft("");
    }

    try {
      const handlers = createWorkspaceStreamHandlers(nextMessages, responseRun);
      await requestWorkspaceResponse({
        content: userContent,
        handlers,
        messageId: userMessageId,
        signal: responseAbortController.signal,
      });
    } catch (error) {
      if (responseRunRef.current !== responseRun) {
        return;
      }
      if (
        error instanceof DOMException &&
        error.name === "AbortError" &&
        responseAbortController.signal.aborted
      ) {
        return;
      }
      if (error instanceof Error && error.message === "Response in progress") {
        setMessages(baseMessages);
        if (shouldClearDraft) {
          setDraft(userContent);
        }
        setIsResponding(false);
        showWorkspaceNotification(error.message);
        return;
      }
      if (!(error instanceof WorkspaceRequestError)) {
        const state = await refreshAppState().catch(() => null);
        if (state?.is_responding) {
          setStreamReconnectKey((current) => current + 1);
          return;
        }
        if (
          state?.messages &&
          messagesIncludeErrorBlockFrom(state.messages, baseMessages.length)
        ) {
          setMessages(state.messages);
          setIsResponding(false);
          return;
        }
      }
      if (error instanceof WorkspaceStreamError) {
        setMessages([
          ...nextMessages,
          error.errorMessage ??
            createWorkspaceStreamErrorMessage(error.outputError),
        ]);
        setIsResponding(false);
        return;
      }
      setMessages((currentMessages) =>
        messagesIncludeErrorBlockFrom(currentMessages, baseMessages.length)
          ? currentMessages
          : appendWorkspaceErrorMessage(
              nextMessages,
              error,
              "Message could not be sent.",
            ),
      );
      setIsResponding(false);
    } finally {
      if (responseRunRef.current === responseRun) {
        responseAbortRef.current = null;
      }
    }
  };

  const startEditedResponse = (nextMessages: Message[]) => {
    responseRunRef.current += 1;
    responseEventIndexRef.current = 0;
    setMessages(nextMessages);
    setIsResponding(true);
    setStreamReconnectKey((current) => current + 1);
  };

  const retryMessage = async (messageId: string) => {
    if (isResponding) {
      return;
    }

    const messageIndex = messages.findIndex(
      (message) => message.id === messageId,
    );
    if (messageIndex < 0) {
      return;
    }

    const message = messages[messageIndex];
    const userMessage =
      message.author === "user"
        ? message
        : previousUserMessage(messages, messageIndex - 1);
    if (!userMessage) {
      return;
    }
    const userMessageIndex = messages.findIndex(
      (currentMessage) => currentMessage.id === userMessage.id,
    );

    setResponseError("");
    setIsResponding(true);

    try {
      const result = await editWorkspaceMessage({
        action: "resend",
        content: userMessage.content,
        messageId: userMessage.id,
      });
      if (!result.is_responding) {
        throw new Error("Message could not be sent.");
      }
      startEditedResponse(result.messages);
    } catch (error) {
      setMessages(
        appendWorkspaceErrorMessage(
          messages.slice(0, userMessageIndex + 1),
          error,
          "Message could not be updated.",
        ),
      );
      setIsResponding(false);
    }
  };

  const retryError = async ({
    errorId,
    messageId,
  }: MessageErrorRetryRequest) => {
    if (isResponding) {
      return;
    }

    const messageIndex = messages.findIndex(
      (message) => message.id === messageId,
    );
    if (messageIndex < 0 || messages[messageIndex].author !== "assistant") {
      return;
    }

    const trimmedMessage = trimAssistantMessageAtError(
      messages[messageIndex],
      errorId,
    );
    if (!trimmedMessage) {
      return;
    }

    const optimisticMessages = [
      ...messages.slice(0, messageIndex),
      trimmedMessage,
    ];
    setResponseError("");
    setIsResponding(true);
    setMessages(optimisticMessages);

    try {
      const result = await retryWorkspaceError({ errorId, messageId });
      if (!result.is_responding) {
        throw new Error("Message could not be sent.");
      }
      startEditedResponse(result.messages);
    } catch (error) {
      setMessages(
        appendWorkspaceErrorMessage(
          optimisticMessages,
          error,
          "Message could not be sent.",
        ),
      );
      setIsResponding(false);
    }
  };

  const editMessage = async ({
    action,
    content,
    messageId,
  }: MessageActionRequest) => {
    if (isResponding) {
      return;
    }

    const messageIndex = messages.findIndex(
      (message) => message.id === messageId,
    );
    if (messageIndex < 0 || messages[messageIndex].author !== "user") {
      return;
    }

    const previousMessages = messages;
    setResponseError("");
    if (action === "resend") {
      setIsResponding(true);
    }

    try {
      const result = await editWorkspaceMessage({ action, content, messageId });
      if (action === "resend") {
        if (!result.is_responding) {
          throw new Error("Message could not be sent.");
        }
        startEditedResponse(result.messages);
        return;
      }
      setMessages(result.messages);
    } catch (error) {
      setMessages(
        action === "resend"
          ? appendWorkspaceErrorMessage(
              [
                ...previousMessages.slice(0, messageIndex),
                {
                  ...previousMessages[messageIndex],
                  content,
                },
              ],
              error,
              "Message could not be updated.",
            )
          : previousMessages,
      );
      if (action === "resend") {
        setIsResponding(false);
      }
      if (action !== "resend") {
        showWorkspaceNotification(
          workspaceErrorDetail(error, "Message could not be updated."),
        );
      }
    }
  };

  const clearMessages = async () => {
    const previousMessages = messages;
    const previousUsageInfo = usageInfo;

    responseAbortRef.current?.abort();
    responseAbortRef.current = null;
    responseEventIndexRef.current = 0;
    responseRunRef.current += 1;
    setMessages([]);
    setTrackedUsageInfo(null);
    setResponseError("");
    setIsResponding(false);

    try {
      const clearedState = await clearWorkspace();
      if (Array.isArray(clearedState.messages)) {
        setMessages(clearedState.messages);
      }
      setTrackedUsageInfo(clearedState.usage_info ?? null);
    } catch {
      setMessages(previousMessages);
      setTrackedUsageInfo(previousUsageInfo);
      showWorkspaceNotification("Conversation could not be cleared.");
    }
  };

  return (
    <AppShell
      activeProviderName={activeProvider?.name}
      activeView={activeView}
      activeWorkflowId={activeWorkflowId}
      onNewWorkflow={openNewWorkflow}
      onViewChange={setActiveView}
      onWorkflowSelect={openWorkflow}
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
          errorMessage={responseError}
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
          isRunningWorkflow={Boolean(runningWorkflowId)}
          newWorkflowKey={newWorkflowKey}
          onCloseEditor={closeWorkflowEditor}
          onDeleteWorkflow={deleteWorkflow}
          onRunWorkflow={runWorkflow}
          onSaveWorkflow={saveWorkflow}
          runningWorkflowId={runningWorkflowId}
          workflowRunResult={workflowRunResult}
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
