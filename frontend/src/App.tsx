import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { ApiMessage, ApiState } from "@/app/api-types";
import {
  contextWindowFromLimit,
  createEmptyTelegramBot,
  errorNotificationKeysFromState,
  mcpServerFromApi,
  providerFromApi,
  telegramBotFromApi,
  writablePathFromApi,
  workflowFromApi,
} from "@/app/api-mappers";
import {
  approveTelegramSessionRequest,
  saveTelegramBotRequest,
} from "@/app/channel-requests";
import {
  addWritablePathRequest,
  removeWritablePathRequest,
} from "@/app/permission-requests";
import {
  fetchProviderModelsRequest,
  ProviderModelFetchError,
  removeProviderRequest,
  saveProviderRequest,
} from "@/app/provider-requests";
import {
  reloadSkillsRequest,
  updateSkillEnabledRequest,
} from "@/app/skill-requests";
import {
  fetchAbout,
  fetchAppState,
  saveRuntimeSettingsRequest,
} from "@/app/state-requests";
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
import { AppShell } from "@/components/flowent/app-shell";
import { ChannelsView } from "@/components/flowent/channels-view";
import { McpView } from "@/components/flowent/mcp-view";
import {
  createEmptyProvider,
  providerOptions,
} from "@/components/flowent/provider-options";
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
  Provider,
  ReasoningEffort,
  RuntimeSettings,
  Skill,
  TelegramBot,
  ViewId,
  WritablePath,
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
  const [agentPrompt, setAgentPrompt] = useState("");
  const [selectedProviderId, setSelectedProviderId] = useState("");
  const [selectedModel, setSelectedModel] = useState("");
  const [contextWindowLimit, setContextWindowLimit] = useState<number | null>(
    null,
  );
  const [reasoningEffort, setReasoningEffort] =
    useState<ReasoningEffort>("default");
  const [appVersion, setAppVersion] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [usageInfo, setUsageInfo] = useState<ContextUsageInfo | null>(null);
  const usageInfoRef = useRef<ContextUsageInfo | null>(null);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [activeSkillId, setActiveSkillId] = useState("");
  const [telegramBot, setTelegramBot] = useState<TelegramBot>(() =>
    createEmptyTelegramBot(),
  );
  const [providerEditorId, setProviderEditorId] = useState("new");
  const [providerDraft, setProviderDraft] = useState<Provider>(() =>
    createEmptyProvider(),
  );
  const [isFetchingModels, setIsFetchingModels] = useState(false);
  const [isResponding, setIsResponding] = useState(false);
  const [isRefiningContext, setIsRefiningContext] = useState(false);
  const [writablePaths, setWritablePaths] = useState<WritablePath[]>([]);
  const [responseError, setResponseError] = useState("");
  const responseAbortRef = useRef<AbortController | null>(null);
  const responseEventIndexRef = useRef(0);
  const messagesRef = useRef<Message[]>([]);
  const responseRunRef = useRef(0);
  const errorNotificationKeysRef = useRef<Set<string>>(new Set());
  const hasLoadedStateRef = useRef(false);
  const [streamReconnectKey, setStreamReconnectKey] = useState(0);
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

  const activeProvider = useMemo(
    () => providers.find((provider) => provider.id === selectedProviderId),
    [providers, selectedProviderId],
  );
  const isCreatingProvider = providerEditorId === "new";
  const activeSkill = useMemo(
    () => skills.find((skill) => skill.id === activeSkillId) ?? skills[0],
    [activeSkillId, skills],
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
      setProviders(loadedProviders);
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
      setSkills(loadedSkills);
      setActiveSkillId(loadedSkills[0]?.id ?? "");
      setAgentPrompt(state.settings.agent_prompt ?? "");
      setSelectedProviderId(state.settings.selected_provider_id);
      setSelectedModel(state.settings.selected_model);
      setContextWindowLimit(state.settings.context_window_limit ?? null);
      setReasoningEffort(state.settings.reasoning_effort ?? "default");
      const loadedTelegramBot = telegramBotFromApi(state.telegram_bot);
      setTelegramBot(loadedTelegramBot);
      setWritablePaths((state.writable_paths ?? []).map(writablePathFromApi));
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
    [replaceMcpServers, replaceWorkflows, setTrackedUsageInfo],
  );

  const refreshAppState = useCallback(async () => {
    const state = await fetchAppState();
    if (!state) {
      return null;
    }
    applyLoadedState(state);
    return state;
  }, [applyLoadedState]);

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

  const loadProviderEditor = (provider: Provider) => {
    setProviderEditorId(provider.id);
    setProviderDraft(provider);
  };

  const openNewProviderEditor = () => {
    setProviderEditorId("new");
    setProviderDraft(createEmptyProvider());
  };

  const updateTelegramBot = (updates: Partial<TelegramBot>) => {
    setTelegramBot((current) => ({ ...current, ...updates }));
  };

  const selectSkill = (skill: Skill) => {
    setActiveSkillId(skill.id);
  };

  const updateProviderDraft = (updates: Partial<Provider>) => {
    setProviderDraft((current) => ({ ...current, ...updates }));
  };

  const persistSettingsAndRefresh = async (settings: RuntimeSettings) => {
    await saveRuntimeSettingsRequest(settings);
    await refreshAppState();
  };

  const handleActiveProviderChange = (value: string) => {
    const nextProvider = providers.find((provider) => provider.id === value);
    if (!nextProvider) {
      setSelectedProviderId("");
      setSelectedModel("");
      void persistSettingsAndRefresh({
        agentPrompt,
        contextWindowLimit,
        reasoningEffort,
        selectedModel: "",
        selectedProviderId: "",
      });
      return;
    }

    setSelectedProviderId(nextProvider.id);
    setSelectedModel("");
    void persistSettingsAndRefresh({
      agentPrompt,
      contextWindowLimit,
      reasoningEffort,
      selectedModel: "",
      selectedProviderId: nextProvider.id,
    });
  };

  const handleActiveModelChange = (value: string) => {
    setSelectedModel(value);
    void persistSettingsAndRefresh({
      agentPrompt,
      contextWindowLimit,
      reasoningEffort,
      selectedModel: value,
      selectedProviderId,
    });
  };

  const handleReasoningEffortChange = (value: ReasoningEffort) => {
    setReasoningEffort(value);
    void saveRuntimeSettingsRequest({
      agentPrompt,
      contextWindowLimit,
      reasoningEffort: value,
      selectedModel,
      selectedProviderId,
    });
  };

  const saveRuntimeSettings = (settings: RuntimeSettings) => {
    setAgentPrompt(settings.agentPrompt);
    setContextWindowLimit(settings.contextWindowLimit);
    setTrackedUsageInfo((currentUsageInfo) =>
      contextWindowFromLimit(currentUsageInfo, settings.contextWindowLimit),
    );
    setReasoningEffort(settings.reasoningEffort);
    setSelectedModel(settings.selectedModel);
    setSelectedProviderId(settings.selectedProviderId);
    void persistSettingsAndRefresh(settings);
  };

  const fetchProviderModels = async () => {
    setIsFetchingModels(true);

    try {
      const models = await fetchProviderModelsRequest(providerDraft);
      updateProviderDraft({ models });

      if (models.length === 0) {
        toast.error({
          description: "No models available for this provider.",
          message: "No models found.",
        });
      }
    } catch (error) {
      if (error instanceof ProviderModelFetchError) {
        toast.error(error.notification);
      }
    } finally {
      setIsFetchingModels(false);
    }
  };

  const saveProvider = async () => {
    const savedProvider: Provider = {
      ...providerDraft,
      id: isCreatingProvider ? createClientId("provider") : providerDraft.id,
      name:
        providerDraft.name.trim() ||
        providerOptions.find((type) => type.id === providerDraft.type)?.label ||
        "Provider",
    };

    setProviders((currentProviders) => {
      if (isCreatingProvider) {
        return [...currentProviders, savedProvider];
      }
      return currentProviders.map((provider) =>
        provider.id === savedProvider.id ? savedProvider : provider,
      );
    });
    setProviderEditorId(savedProvider.id);
    setProviderDraft(savedProvider);

    if (!selectedProviderId) {
      setSelectedProviderId(savedProvider.id);
      setSelectedModel("");
      void saveRuntimeSettingsRequest({
        agentPrompt,
        contextWindowLimit,
        reasoningEffort,
        selectedModel: "",
        selectedProviderId: savedProvider.id,
      });
    }

    await saveProviderRequest(savedProvider);
  };

  const removeProvider = async () => {
    if (isCreatingProvider) {
      return;
    }

    const removedProviderId = providerDraft.id;
    const wasRemoved = await removeProviderRequest(removedProviderId);

    if (wasRemoved) {
      const removedIndex = providers.findIndex(
        (provider) => provider.id === removedProviderId,
      );
      const remainingProviders = providers.filter(
        (provider) => provider.id !== removedProviderId,
      );

      setProviders(remainingProviders);

      const nextProvider =
        remainingProviders[removedIndex] ||
        remainingProviders[removedIndex - 1];

      if (nextProvider) {
        loadProviderEditor(nextProvider);
      } else {
        openNewProviderEditor();
      }

      if (selectedProviderId === removedProviderId) {
        const nextId = nextProvider?.id ?? "";
        const nextModel = nextProvider?.models[0] ?? "";
        setSelectedProviderId(nextId);
        setSelectedModel(nextModel);
        void saveRuntimeSettingsRequest({
          agentPrompt,
          contextWindowLimit,
          reasoningEffort,
          selectedModel: nextModel,
          selectedProviderId: nextId,
        });
      }
    }
  };

  const saveTelegramBot = async () => {
    const result = await saveTelegramBotRequest(telegramBot);
    if (result) {
      setTelegramBot(result);
    }
  };

  const reloadSkills = async () => {
    const reloadedSkills = await reloadSkillsRequest();

    if (reloadedSkills) {
      setSkills(reloadedSkills);
      setActiveSkillId((currentSkillId) => {
        if (reloadedSkills.some((skill) => skill.id === currentSkillId)) {
          return currentSkillId;
        }
        return reloadedSkills[0]?.id ?? "";
      });
    }
  };

  const toggleSkill = async (skill: Skill, enabled: boolean) => {
    const updatedSkill = await updateSkillEnabledRequest(skill.id, enabled);

    if (updatedSkill) {
      setSkills((currentSkills) =>
        currentSkills.map((currentSkill) =>
          currentSkill.id === updatedSkill.id ? updatedSkill : currentSkill,
        ),
      );
    }
  };

  const approveTelegramSession = async (chatId: string) => {
    const result = await approveTelegramSessionRequest(chatId);

    if (result) {
      setTelegramBot((current) => ({
        ...current,
        sessions: current.sessions.map((session) =>
          session.chatId === result.chatId ? result : session,
        ),
      }));
    }
  };

  const removeWritablePath = async (path: string) => {
    const writablePaths = await removeWritablePathRequest(path);

    if (writablePaths) {
      setWritablePaths(writablePaths);
    }
  };

  const addWritablePath = async (path: string) => {
    const savedWritablePath = await addWritablePathRequest(path);
    setWritablePaths((currentWritablePaths) => {
      if (
        currentWritablePaths.some(
          (writablePath) => writablePath.path === savedWritablePath.path,
        )
      ) {
        return currentWritablePaths;
      }
      return [...currentWritablePaths, savedWritablePath];
    });
  };

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
