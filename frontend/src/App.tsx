import { useCallback, useEffect, useMemo, useRef, useState } from "react";

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
import type {
  AssistantOutputGroup,
  AssistantOutputItem,
  McpImportSource,
  McpServer,
  McpTool,
  Message,
  ContextUsageInfo,
  Provider,
  ReasoningEffort,
  RuntimeSettings,
  Skill,
  TelegramBot,
  TelegramSession,
  ToolItem,
  ViewId,
  WritablePath,
  WorkspaceCommand,
  WorkspaceCommandId,
} from "@/components/flowent/types";
import { WorkspaceView } from "@/components/flowent/workspace-view";
import { TabsContent } from "@/components/ui/tabs";
import { createClientId } from "@/lib/utils";

type ApiProvider = {
  api_key: string;
  base_url: string;
  id: string;
  models: string[];
  name: string;
  type: Provider["type"];
};

type ApiTelegramSession = {
  chat_id: string;
  display_name: string;
  recent_message: string;
  status: TelegramSession["status"];
  updated_at?: number;
  user_id: string;
  username: string;
};

type ApiTelegramBot = {
  bot_token: string;
  enabled: boolean;
  error?: string;
  sessions?: ApiTelegramSession[];
  status?: TelegramBot["status"];
};

type ApiMcpTool = {
  description?: string;
  input_schema?: Record<string, unknown>;
  name: string;
  output_schema?: Record<string, unknown> | null;
};

type ApiMcpServer = {
  args: string[];
  command: string;
  config?: Record<string, unknown>;
  enabled: boolean;
  error?: string;
  id: string;
  name: string;
  status?: McpServer["status"];
  tools?: ApiMcpTool[];
  type: McpServer["type"];
  url: string;
};

type ApiMcpImportPreview = {
  servers?: ApiMcpServer[];
};

type ApiSkill = Skill;

type ApiWritablePath = {
  created_at: number;
  path: string;
};

type ApiMessage = Message;

type ApiState = {
  active_run_event_index?: number;
  active_run_id?: string | null;
  mcp_servers?: ApiMcpServer[];
  messages: ApiMessage[];
  providers: ApiProvider[];
  settings: {
    agent_prompt?: string;
    reasoning_effort?: ReasoningEffort;
    selected_model: string;
    selected_provider_id: string;
  };
  skills?: ApiSkill[];
  telegram_bot?: ApiTelegramBot;
  usage_info?: ContextUsageInfo | null;
  writable_paths?: ApiWritablePath[];
};

type ApiAbout = {
  version?: string;
};

type WorkspaceRunResponse = {
  run_id: string;
};

type WorkspaceStreamEvent =
  | {
      data: {
        id: string;
      };
      event: "start";
    }
  | {
      data: {
        index: number;
      };
      event: "output_start";
    }
  | {
      data: {
        content: string;
      };
      event: "delta";
    }
  | {
      data: {
        content: string;
      };
      event: "thinking_delta";
    }
  | {
      data: {
        message: ApiMessage;
      };
      event: "done";
    }
  | {
      data: {
        message: ApiMessage;
        usage_info?: ContextUsageInfo;
      };
      event: "context_optimized";
    }
  | {
      data: {
        usage_info: ContextUsageInfo;
      };
      event: "usage";
    }
  | {
      data: {
        tool: ToolItem;
      };
      event: "tool_start";
    }
  | {
      data: {
        content?: string;
        data?: Record<string, unknown>;
        id: string;
        status: ToolItem["status"];
        title?: string;
      };
      event: "tool_done" | "tool_error";
    }
  | {
      data: {
        error?: Extract<AssistantOutputItem, { type: "error" }>;
        message: string;
      };
      event: "error";
    };

type WorkspaceStreamHandlers = {
  onContextOptimized: (message: ApiMessage) => void;
  onDelta: (content: string) => void;
  onDone: (message: ApiMessage) => void;
  onError: (error: Extract<AssistantOutputItem, { type: "error" }>) => void;
  onOutputStart: (index: number) => void;
  onStart: (id: string) => void;
  onThinkingDelta: (content: string) => void;
  onToolDone: (
    tool: Pick<ToolItem, "id" | "status"> & Partial<ToolItem>,
  ) => void;
  onToolStart: (tool: ToolItem) => void;
  onUsage: (usageInfo: ContextUsageInfo) => void;
};

const providerFromApi = (provider: ApiProvider): Provider => ({
  apiKey: provider.api_key,
  baseUrl: provider.base_url,
  id: provider.id,
  models: provider.models,
  name: provider.name,
  type: provider.type,
});

const providerToApi = (provider: Provider): ApiProvider => ({
  api_key: provider.apiKey,
  base_url: provider.baseUrl,
  id: provider.id,
  models: provider.models,
  name: provider.name,
  type: provider.type,
});

const telegramSessionFromApi = (
  session: ApiTelegramSession,
): TelegramSession => ({
  chatId: session.chat_id,
  displayName: session.display_name,
  recentMessage: session.recent_message,
  status: session.status,
  updatedAt: session.updated_at ?? 0,
  userId: session.user_id,
  username: session.username,
});

const telegramSessionToApi = (
  session: TelegramSession,
): ApiTelegramSession => ({
  chat_id: session.chatId,
  display_name: session.displayName,
  recent_message: session.recentMessage,
  status: session.status,
  updated_at: session.updatedAt,
  user_id: session.userId,
  username: session.username,
});

const createEmptyTelegramBot = (): TelegramBot => ({
  botSecret: "",
  enabled: false,
  error: "",
  sessions: [],
  status: "disabled",
});

const telegramBotFromApi = (telegramBot?: ApiTelegramBot): TelegramBot => ({
  botSecret: telegramBot?.bot_token ?? "",
  enabled: telegramBot?.enabled ?? false,
  error: telegramBot?.error ?? "",
  sessions: (telegramBot?.sessions ?? []).map(telegramSessionFromApi),
  status: telegramBot?.status ?? "disabled",
});

const telegramBotToApi = (telegramBot: TelegramBot): ApiTelegramBot => ({
  bot_token: telegramBot.botSecret,
  enabled: telegramBot.enabled,
  error: telegramBot.error,
  sessions: telegramBot.sessions.map(telegramSessionToApi),
  status: telegramBot.status,
});

const writablePathFromApi = (writablePath: ApiWritablePath): WritablePath => ({
  createdAt: writablePath.created_at,
  path: writablePath.path,
});

const mcpCommandLine = (server: Pick<McpServer, "args" | "command">) =>
  [server.command, ...server.args].filter(Boolean).join(" ");

const mcpToolFromApi = (tool: ApiMcpTool): McpTool => ({
  description: tool.description ?? "",
  inputSchema: tool.input_schema ?? {},
  name: tool.name,
  outputSchema: tool.output_schema ?? null,
});

const mcpServerFromApi = (server: ApiMcpServer): McpServer => ({
  args: server.args ?? [],
  command: server.command ?? "",
  commandLine: mcpCommandLine({
    args: server.args ?? [],
    command: server.command ?? "",
  }),
  config: server.config ?? {},
  enabled: server.enabled,
  error: server.error ?? "",
  id: server.id,
  name: server.name,
  status: server.status ?? "disabled",
  tools: (server.tools ?? []).map(mcpToolFromApi),
  type: server.type,
  url: server.url ?? "",
});

const mcpServerToApi = (server: McpServer): ApiMcpServer => ({
  args: server.args,
  command: server.command,
  config: server.config,
  enabled: server.enabled,
  error: server.error,
  id: server.id,
  name: server.name,
  status: server.status,
  tools: server.tools.map((tool) => ({
    description: tool.description,
    input_schema: tool.inputSchema,
    name: tool.name,
    output_schema: tool.outputSchema,
  })),
  type: server.type,
  url: server.url,
});

const createEmptyMcpServer = (): McpServer => ({
  args: [],
  command: "",
  commandLine: "",
  config: {},
  enabled: true,
  error: "",
  id: "new",
  name: "",
  status: "disabled",
  tools: [],
  type: "command",
  url: "",
});

const parseCommandLine = (commandLine: string) => {
  const parts: string[] = [];
  let current = "";
  let quote: "'" | '"' | "" = "";
  let isEscaped = false;

  for (const character of commandLine) {
    if (isEscaped) {
      current += character;
      isEscaped = false;
      continue;
    }
    if (character === "\\") {
      isEscaped = true;
      continue;
    }
    if (quote) {
      if (character === quote) {
        quote = "";
      } else {
        current += character;
      }
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }
    if (/\s/.test(character)) {
      if (current) {
        parts.push(current);
        current = "";
      }
      continue;
    }
    current += character;
  }

  if (current) {
    parts.push(current);
  }

  return {
    args: parts.slice(1),
    command: parts[0] ?? "",
  };
};

const mcpServerId = (name: string) => {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug ? `mcp-${slug}` : createClientId("mcp");
};

const assistantGroupsFromMessage = (
  message: Message,
): AssistantOutputGroup[] => {
  if (message.groups?.length) {
    return message.groups;
  }

  const thinkingItem: AssistantOutputItem | null = message.thinking
    ? {
        content: message.thinking,
        id: `${message.id}-thinking-existing`,
        isStreaming: false,
        type: "thinking",
      }
    : null;
  const toolItems: AssistantOutputItem[] = (message.tools ?? []).map(
    (tool) => ({
      id: `tool-${tool.id}`,
      tool,
      type: "tool",
    }),
  );
  const groups: AssistantOutputGroup[] = [];
  const processItems = [...(thinkingItem ? [thinkingItem] : []), ...toolItems];

  if (processItems.length) {
    groups.push({
      id: `${message.id}-process-existing`,
      items: processItems,
    });
  }
  if (message.content) {
    groups.push({
      id: `${message.id}-content-existing`,
      items: [
        {
          content: message.content,
          id: `${message.id}-text-existing`,
          type: "text",
        },
      ],
    });
  }

  return groups;
};

const streamErrorFromMessage = (
  message: string,
  assistantId: string,
): Extract<AssistantOutputItem, { type: "error" }> => ({
  id: `${assistantId || "assistant"}-error-1`,
  message,
  title: "Response interrupted",
  type: "error",
});

const latestUsageInfoFromMessages = (
  messages: Message[],
): ContextUsageInfo | null => {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const currentUsageInfo = messages[index]?.usage_info;
    if (currentUsageInfo) {
      return currentUsageInfo;
    }
  }
  return null;
};

function App() {
  const [activeView, setActiveView] = useState<ViewId>("workspace");
  const [draft, setDraft] = useState("");
  const [agentPrompt, setAgentPrompt] = useState("");
  const [selectedProviderId, setSelectedProviderId] = useState("");
  const [selectedModel, setSelectedModel] = useState("");
  const [reasoningEffort, setReasoningEffort] =
    useState<ReasoningEffort>("default");
  const [appVersion, setAppVersion] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [usageInfo, setUsageInfo] = useState<ContextUsageInfo | null>(null);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [mcpServers, setMcpServers] = useState<McpServer[]>([]);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [activeSkillId, setActiveSkillId] = useState("");
  const [mcpEditorId, setMcpEditorId] = useState("new");
  const [mcpDraft, setMcpDraft] = useState<McpServer>(() =>
    createEmptyMcpServer(),
  );
  const [isMcpImportOpen, setIsMcpImportOpen] = useState(false);
  const [mcpImportPreview, setMcpImportPreview] = useState<McpServer[]>([]);
  const [mcpImportSource, setMcpImportSource] =
    useState<McpImportSource>("claude_code");
  const [isPreviewingMcpImport, setIsPreviewingMcpImport] = useState(false);
  const [importingMcpServerId, setImportingMcpServerId] = useState("");
  const [mcpImportError, setMcpImportError] = useState("");
  const [telegramBot, setTelegramBot] = useState<TelegramBot>(() =>
    createEmptyTelegramBot(),
  );
  const [providerEditorId, setProviderEditorId] = useState("new");
  const [providerDraft, setProviderDraft] = useState<Provider>(() =>
    createEmptyProvider(),
  );
  const [isFetchingModels, setIsFetchingModels] = useState(false);
  const [fetchError, setFetchError] = useState("");
  const [isResponding, setIsResponding] = useState(false);
  const [isRefiningContext, setIsRefiningContext] = useState(false);
  const [writablePaths, setWritablePaths] = useState<WritablePath[]>([]);
  const [activeRunId, setActiveRunId] = useState("");
  const [responseError, setResponseError] = useState("");
  const responseAbortRef = useRef<AbortController | null>(null);
  const activeRunIdRef = useRef("");
  const activeRunEventIndexRef = useRef(0);
  const messagesRef = useRef<Message[]>([]);
  const responseRunRef = useRef(0);
  const [streamReconnectKey, setStreamReconnectKey] = useState(0);

  const activeProvider = useMemo(
    () => providers.find((provider) => provider.id === selectedProviderId),
    [providers, selectedProviderId],
  );
  const isCreatingProvider = providerEditorId === "new";
  const isCreatingMcpServer = mcpEditorId === "new";
  const activeSkill = useMemo(
    () => skills.find((skill) => skill.id === activeSkillId) ?? skills[0],
    [activeSkillId, skills],
  );
  const hasStartingMcpServer = useMemo(
    () => mcpServers.some((server) => server.status === "starting"),
    [mcpServers],
  );

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  const applyLoadedState = useCallback((state: ApiState) => {
    const loadedProviders = state.providers.map(providerFromApi);
    setProviders(loadedProviders);
    setMessages(state.messages);
    setUsageInfo(
      state.usage_info ?? latestUsageInfoFromMessages(state.messages),
    );
    const loadedMcpServers = (state.mcp_servers ?? []).map(mcpServerFromApi);
    setMcpServers(loadedMcpServers);
    if (loadedMcpServers[0]) {
      setMcpEditorId(loadedMcpServers[0].id);
      setMcpDraft(loadedMcpServers[0]);
    }
    setSkills(state.skills ?? []);
    setActiveSkillId((state.skills ?? [])[0]?.id ?? "");
    setAgentPrompt(state.settings.agent_prompt ?? "");
    setSelectedProviderId(state.settings.selected_provider_id);
    setSelectedModel(state.settings.selected_model);
    setReasoningEffort(state.settings.reasoning_effort ?? "default");
    setTelegramBot(telegramBotFromApi(state.telegram_bot));
    setWritablePaths((state.writable_paths ?? []).map(writablePathFromApi));
    activeRunEventIndexRef.current = state.active_run_event_index ?? 0;
    activeRunIdRef.current = state.active_run_id ?? "";
    setActiveRunId(state.active_run_id ?? "");
    setIsResponding(Boolean(state.active_run_id));
  }, []);

  const refreshAppState = useCallback(async () => {
    const response = await fetch("/api/state");
    if (!response.ok) {
      return null;
    }
    const state = (await response.json()) as ApiState;
    applyLoadedState(state);
    return state;
  }, [applyLoadedState]);

  useEffect(() => {
    let isMounted = true;

    const loadState = async () => {
      try {
        const [state, aboutResponse] = await Promise.all([
          refreshAppState(),
          fetch("/api/about"),
        ]);
        if (!state) {
          return;
        }
        const about = aboutResponse.ok
          ? ((await aboutResponse.json()) as ApiAbout)
          : {};
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
    if (!hasStartingMcpServer) {
      return;
    }

    let isMounted = true;
    const refreshMcpServers = async () => {
      try {
        const response = await fetch("/api/state");
        if (!response.ok || !isMounted) {
          return;
        }
        const state = (await response.json()) as ApiState;
        if (!isMounted) {
          return;
        }
        const loadedMcpServers = (state.mcp_servers ?? []).map(
          mcpServerFromApi,
        );
        setMcpServers(loadedMcpServers);
        setMcpDraft((currentDraft) => {
          const refreshedServer = loadedMcpServers.find(
            (server) => server.id === currentDraft.id,
          );
          if (!refreshedServer) {
            return currentDraft;
          }
          return {
            ...currentDraft,
            error: refreshedServer.error,
            status: refreshedServer.status,
            tools: refreshedServer.tools,
          };
        });
      } catch {
        // Keep showing the optimistic status until the next poll succeeds.
      }
    };

    void refreshMcpServers();
    const intervalId = window.setInterval(() => {
      void refreshMcpServers();
    }, 1000);

    return () => {
      isMounted = false;
      window.clearInterval(intervalId);
    };
  }, [hasStartingMcpServer]);

  const loadProviderEditor = (provider: Provider) => {
    setProviderEditorId(provider.id);
    setProviderDraft(provider);
    setFetchError("");
  };

  const openNewProviderEditor = () => {
    setProviderEditorId("new");
    setProviderDraft(createEmptyProvider());
    setFetchError("");
  };

  const updateTelegramBot = (updates: Partial<TelegramBot>) => {
    setTelegramBot((current) => ({ ...current, ...updates }));
  };

  const loadMcpEditor = (server: McpServer) => {
    setIsMcpImportOpen(false);
    setMcpEditorId(server.id);
    setMcpDraft(server);
  };

  const openNewMcpEditor = () => {
    setIsMcpImportOpen(false);
    setMcpEditorId("new");
    setMcpDraft(createEmptyMcpServer());
  };

  const openMcpImport = () => {
    setIsMcpImportOpen(true);
    setMcpImportError("");
    setMcpImportPreview([]);
    setMcpImportSource("claude_code");
    void previewMcpImport("claude_code");
  };

  const selectSkill = (skill: Skill) => {
    setActiveSkillId(skill.id);
  };

  const updateMcpDraft = (updates: Partial<McpServer>) => {
    setMcpDraft((current) => ({ ...current, ...updates }));
  };

  const previewMcpImport = async (source = mcpImportSource) => {
    setIsPreviewingMcpImport(true);
    setMcpImportError("");
    try {
      const response = await fetch("/api/mcp/import/preview", {
        body: JSON.stringify({ source }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      if (!response.ok) {
        throw new Error("Scan could not be completed.");
      }
      const result = (await response.json()) as ApiMcpImportPreview;
      const servers = (result.servers ?? []).map((server) =>
        mcpServerFromApi(server),
      );
      setMcpImportPreview(servers);
    } catch {
      setMcpImportPreview([]);
      setMcpImportError("Scan could not be completed.");
    } finally {
      setIsPreviewingMcpImport(false);
    }
  };

  const importMcpServer = async (serverId: string) => {
    if (!mcpImportPreview.some((server) => server.id === serverId)) {
      setMcpImportError("No servers found.");
      return;
    }

    setImportingMcpServerId(serverId);
    setMcpImportError("");
    try {
      const response = await fetch("/api/mcp/import", {
        body: JSON.stringify({
          server_id: serverId,
          source: mcpImportSource,
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      if (!response.ok) {
        throw new Error("Import could not be completed.");
      }
      const result = (await response.json()) as ApiMcpServer[];
      const importedServers = result.map((server) => mcpServerFromApi(server));
      setMcpServers(importedServers);
      const nextServer =
        importedServers.find((server) => server.id === serverId) ??
        importedServers[0];
      if (nextServer) {
        setIsMcpImportOpen(false);
        setMcpEditorId(nextServer.id);
        setMcpDraft(nextServer);
      }
    } catch {
      setMcpImportError("Import could not be completed.");
    } finally {
      setImportingMcpServerId("");
    }
  };

  const updateMcpImportSource = (source: McpImportSource) => {
    setMcpImportSource(source);
    setMcpImportError("");
    setMcpImportPreview([]);
    void previewMcpImport(source);
  };

  const updateProviderDraft = (updates: Partial<Provider>) => {
    setProviderDraft((current) => ({ ...current, ...updates }));
    setFetchError("");
  };

  const persistSettings = async (settings: RuntimeSettings) => {
    await fetch("/api/settings", {
      body: JSON.stringify({
        agent_prompt: settings.agentPrompt,
        reasoning_effort: settings.reasoningEffort,
        selected_model: settings.selectedModel,
        selected_provider_id: settings.selectedProviderId,
      }),
      headers: { "Content-Type": "application/json" },
      method: "PUT",
    });
  };

  const handleActiveProviderChange = (value: string) => {
    const nextProvider = providers.find((provider) => provider.id === value);
    if (!nextProvider) {
      setSelectedProviderId("");
      setSelectedModel("");
      void persistSettings({
        agentPrompt,
        reasoningEffort,
        selectedModel: "",
        selectedProviderId: "",
      });
      return;
    }

    setSelectedProviderId(nextProvider.id);
    setSelectedModel("");
    void persistSettings({
      agentPrompt,
      reasoningEffort,
      selectedModel: "",
      selectedProviderId: nextProvider.id,
    });
  };

  const handleActiveModelChange = (value: string) => {
    setSelectedModel(value);
    void persistSettings({
      agentPrompt,
      reasoningEffort,
      selectedModel: value,
      selectedProviderId,
    });
  };

  const handleReasoningEffortChange = (value: ReasoningEffort) => {
    setReasoningEffort(value);
    void persistSettings({
      agentPrompt,
      reasoningEffort: value,
      selectedModel,
      selectedProviderId,
    });
  };

  const saveRuntimeSettings = (settings: RuntimeSettings) => {
    setAgentPrompt(settings.agentPrompt);
    setReasoningEffort(settings.reasoningEffort);
    setSelectedModel(settings.selectedModel);
    setSelectedProviderId(settings.selectedProviderId);
    void persistSettings(settings);
  };

  const fetchProviderModels = async () => {
    setIsFetchingModels(true);
    setFetchError("");

    try {
      const response = await fetch("/api/providers/models", {
        body: JSON.stringify({
          base_url: providerDraft.baseUrl,
          provider: providerDraft.type,
          secret_reference: providerDraft.apiKey,
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });

      if (!response.ok) {
        throw new Error("Models could not be fetched.");
      }

      const result = (await response.json()) as { models?: string[] };
      updateProviderDraft({ models: result.models ?? [] });
    } catch {
      setFetchError("Models could not be fetched.");
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
      void persistSettings({
        agentPrompt,
        reasoningEffort,
        selectedModel: "",
        selectedProviderId: savedProvider.id,
      });
    }

    await fetch("/api/providers", {
      body: JSON.stringify(providerToApi(savedProvider)),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
  };

  const saveTelegramBot = async () => {
    const response = await fetch("/api/telegram-bot", {
      body: JSON.stringify(telegramBotToApi(telegramBot)),
      headers: { "Content-Type": "application/json" },
      method: "PUT",
    });

    if (response.ok) {
      const result = telegramBotFromApi(
        (await response.json()) as ApiTelegramBot,
      );
      setTelegramBot(result);
    }
  };

  const saveMcpServer = async () => {
    const parsedCommand =
      mcpDraft.type === "command"
        ? parseCommandLine(mcpDraft.commandLine)
        : { args: [], command: "" };
    const nextServer: McpServer = {
      ...mcpDraft,
      args: parsedCommand.args,
      command: parsedCommand.command,
      id:
        isCreatingMcpServer || mcpDraft.id === "new"
          ? mcpServerId(mcpDraft.name)
          : mcpDraft.id,
      name: mcpDraft.name.trim() || "Server",
      tools: isCreatingMcpServer ? [] : mcpDraft.tools,
      url: mcpDraft.type === "url" ? mcpDraft.url : "",
    };
    const response = await fetch("/api/mcp/servers", {
      body: JSON.stringify(mcpServerToApi(nextServer)),
      headers: { "Content-Type": "application/json" },
      method: "PUT",
    });

    if (response.ok) {
      const savedServer = mcpServerFromApi(
        (await response.json()) as ApiMcpServer,
      );
      setMcpServers((currentServers) => {
        if (isCreatingMcpServer) {
          return [...currentServers, savedServer];
        }
        return currentServers.map((server) =>
          server.id === savedServer.id ? savedServer : server,
        );
      });
      setMcpEditorId(savedServer.id);
      setMcpDraft(savedServer);
    }
  };

  const reconnectMcpServer = async () => {
    if (isCreatingMcpServer) {
      return;
    }
    const response = await fetch(`/api/mcp/servers/${mcpDraft.id}/reconnect`, {
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });

    if (response.ok) {
      const updatedServer = mcpServerFromApi(
        (await response.json()) as ApiMcpServer,
      );
      setMcpServers((currentServers) =>
        currentServers.map((server) =>
          server.id === updatedServer.id ? updatedServer : server,
        ),
      );
      setMcpDraft(updatedServer);
    }
  };

  const removeMcpServer = async () => {
    if (isCreatingMcpServer) {
      return;
    }
    const response = await fetch(`/api/mcp/servers/${mcpDraft.id}`, {
      headers: { "Content-Type": "application/json" },
      method: "DELETE",
    });

    if (response.ok) {
      const remainingServers = mcpServers.filter(
        (server) => server.id !== mcpDraft.id,
      );
      setMcpServers(remainingServers);
      const nextServer = remainingServers[0];
      if (nextServer) {
        setMcpEditorId(nextServer.id);
        setMcpDraft(nextServer);
      } else {
        openNewMcpEditor();
      }
    }
  };

  const reloadSkills = async () => {
    const response = await fetch("/api/skills/reload", {
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });

    if (response.ok) {
      const reloadedSkills = (await response.json()) as Skill[];
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
    const response = await fetch(
      `/api/skills/${encodeURIComponent(skill.id)}`,
      {
        body: JSON.stringify({ enabled }),
        headers: { "Content-Type": "application/json" },
        method: "PUT",
      },
    );

    if (response.ok) {
      const updatedSkill = (await response.json()) as Skill;
      setSkills((currentSkills) =>
        currentSkills.map((currentSkill) =>
          currentSkill.id === updatedSkill.id ? updatedSkill : currentSkill,
        ),
      );
    }
  };

  const approveTelegramSession = async (chatId: string) => {
    const response = await fetch("/api/telegram-bot/approve", {
      body: JSON.stringify({ chat_id: chatId }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });

    if (response.ok) {
      const result = telegramSessionFromApi(
        (await response.json()) as ApiTelegramSession,
      );
      setTelegramBot((current) => ({
        ...current,
        sessions: current.sessions.map((session) =>
          session.chatId === result.chatId ? result : session,
        ),
      }));
    }
  };

  const removeWritablePath = async (path: string) => {
    const response = await fetch("/api/permissions/writable-paths", {
      body: JSON.stringify({ path }),
      headers: { "Content-Type": "application/json" },
      method: "DELETE",
    });

    if (response.ok) {
      const result = (await response.json()) as {
        writable_paths?: ApiWritablePath[];
      };
      setWritablePaths((result.writable_paths ?? []).map(writablePathFromApi));
    }
  };

  const saveMessages = async (nextMessages: Message[]) => {
    await fetch("/api/workspace/messages", {
      body: JSON.stringify({ messages: nextMessages }),
      headers: { "Content-Type": "application/json" },
      method: "PUT",
    });
  };

  const responseErrorFromApi = useCallback(async (response: Response) => {
    try {
      const result = (await response.json()) as { detail?: unknown };
      if (typeof result.detail === "string") {
        return result.detail;
      }
    } catch {
      return "Message could not be sent.";
    }
    return "Message could not be sent.";
  }, []);

  const parseWorkspaceStreamEvent = useCallback(
    (rawEvent: string): WorkspaceStreamEvent => {
      const lines = rawEvent.split("\n");
      const event = lines
        .find((line) => line.startsWith("event: "))
        ?.slice("event: ".length);
      const data = lines
        .find((line) => line.startsWith("data: "))
        ?.slice("data: ".length);

      if (!event || !data) {
        throw new Error("Message could not be sent.");
      }

      return {
        data: JSON.parse(data) as WorkspaceStreamEvent["data"],
        event,
      } as WorkspaceStreamEvent;
    },
    [],
  );

  const readWorkspaceStream = useCallback(
    async (response: Response, handlers: WorkspaceStreamHandlers) => {
      if (!response.body) {
        throw new Error("Message could not be sent.");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });
        const events = buffer.split("\n\n");
        buffer = events.pop() ?? "";

        for (const rawEvent of events) {
          if (!rawEvent.trim()) {
            continue;
          }

          const streamEvent = parseWorkspaceStreamEvent(rawEvent);
          if (streamEvent.event === "start") {
            handlers.onStart(streamEvent.data.id);
          }
          if (streamEvent.event === "output_start") {
            handlers.onOutputStart(streamEvent.data.index);
          }
          if (streamEvent.event === "delta") {
            handlers.onDelta(streamEvent.data.content);
          }
          if (streamEvent.event === "thinking_delta") {
            handlers.onThinkingDelta(streamEvent.data.content);
          }
          if (streamEvent.event === "context_optimized") {
            if (streamEvent.data.usage_info) {
              handlers.onUsage(streamEvent.data.usage_info);
            }
            handlers.onContextOptimized(streamEvent.data.message);
          }
          if (streamEvent.event === "usage") {
            handlers.onUsage(streamEvent.data.usage_info);
          }
          if (streamEvent.event === "done") {
            handlers.onDone(streamEvent.data.message);
            return;
          }
          if (streamEvent.event === "tool_start") {
            handlers.onToolStart(streamEvent.data.tool);
          }
          if (
            streamEvent.event === "tool_done" ||
            streamEvent.event === "tool_error"
          ) {
            handlers.onToolDone(streamEvent.data);
          }
          if (streamEvent.event === "error") {
            handlers.onError(
              streamEvent.data.error ??
                streamErrorFromMessage(streamEvent.data.message, ""),
            );
            throw new Error(streamEvent.data.message);
          }
        }

        if (done) {
          break;
        }
      }

      throw new Error("Message could not be sent.");
    },
    [parseWorkspaceStreamEvent],
  );

  const createWorkspaceStreamHandlers = useCallback(
    (baseMessages: Message[], responseRun: number): WorkspaceStreamHandlers => {
      const latestMessage = baseMessages.at(-1);
      const existingAssistant =
        latestMessage?.author === "assistant" ? latestMessage : null;
      let assistantMessage: Message | null = existingAssistant;
      let assistantContent = existingAssistant?.content ?? "";
      let assistantId = existingAssistant?.id ?? "";
      let assistantThinking = existingAssistant?.thinking ?? "";
      let assistantThinkingItemId = "";
      let assistantThinkingItemIndex = 0;
      let assistantGroups: AssistantOutputGroup[] = existingAssistant
        ? assistantGroupsFromMessage(existingAssistant)
        : [];
      let assistantTextItemId =
        assistantGroups
          .flatMap((group) => group.items)
          .reverse()
          .find((item) => item.type === "text")?.id ?? "";
      let assistantTextItemIndex = 0;
      let assistantIsStreamingThinking = false;
      let assistantIsStreamingText = false;
      let assistantTools: ToolItem[] = existingAssistant?.tools ?? [];
      let latestUsageInfo = usageInfo;
      const nextMessages = existingAssistant
        ? baseMessages.slice(0, -1)
        : baseMessages;
      const isCurrentResponse = () => responseRunRef.current === responseRun;
      const appendSystemMessage = (message: ApiMessage) => {
        if (!isCurrentResponse()) {
          return;
        }
        activeRunEventIndexRef.current += 1;
        nextMessages.push(message);
        if (assistantMessage) {
          setMessages([...nextMessages, assistantMessage]);
          return;
        }
        setMessages([...nextMessages]);
      };
      const updateAssistantMessage = () => {
        if (!assistantId || !isCurrentResponse()) {
          return;
        }
        assistantMessage = {
          author: "assistant",
          content: assistantContent,
          id: assistantId,
          groups: assistantGroups,
          thinking: assistantThinking,
          isStreamingThinking: assistantIsStreamingThinking,
          tools: assistantTools,
          isStreamingText: assistantIsStreamingText,
          usage_info: latestUsageInfo,
        };
        setMessages([...nextMessages, assistantMessage]);
      };
      const finishAssistantThinking = () => {
        if (!assistantIsStreamingThinking) {
          return;
        }
        assistantIsStreamingThinking = false;
        assistantGroups = assistantGroups.map((group) => ({
          ...group,
          items: group.items.map((item) =>
            item.type === "thinking" ? { ...item, isStreaming: false } : item,
          ),
        }));
      };
      const createAssistantGroup = (index: number) => {
        const groupId = `${assistantId || "assistant"}-group-${index}`;
        if (assistantGroups.at(-1)?.id === groupId) {
          return;
        }
        finishAssistantThinking();
        assistantTextItemId = "";
        assistantIsStreamingText = false;
        assistantGroups = [...assistantGroups, { id: groupId, items: [] }];
      };
      const ensureAssistantGroup = () => {
        if (assistantGroups.length === 0) {
          createAssistantGroup(1);
        }
      };
      const updateCurrentAssistantGroupItems = (
        updater: (items: AssistantOutputItem[]) => AssistantOutputItem[],
      ) => {
        ensureAssistantGroup();
        const currentGroupIndex = assistantGroups.length - 1;
        assistantGroups = assistantGroups.map((group, index) =>
          index === currentGroupIndex
            ? { ...group, items: updater(group.items) }
            : group,
        );
      };
      const appendAssistantThinking = (content: string) => {
        if (!assistantThinkingItemId) {
          assistantThinkingItemIndex += 1;
          assistantThinkingItemId = `${assistantId}-thinking-${assistantThinkingItemIndex}`;
          updateCurrentAssistantGroupItems((items) => [
            ...items,
            {
              content: "",
              id: assistantThinkingItemId,
              isStreaming: true,
              type: "thinking",
            },
          ]);
        }

        assistantThinking += content;
        assistantIsStreamingThinking = true;
        updateCurrentAssistantGroupItems((items) =>
          items.map((item) =>
            item.type === "thinking" && item.id === assistantThinkingItemId
              ? {
                  ...item,
                  content: item.content + content,
                  isStreaming: true,
                }
              : item,
          ),
        );
        updateAssistantMessage();
      };
      const appendAssistantText = (content: string) => {
        finishAssistantThinking();
        if (!assistantTextItemId) {
          assistantTextItemIndex += 1;
          assistantTextItemId = `${assistantId}-text-${assistantTextItemIndex}`;
          updateCurrentAssistantGroupItems((items) => [
            ...items,
            {
              content: "",
              id: assistantTextItemId,
              type: "text",
            },
          ]);
        }

        assistantContent += content;
        updateCurrentAssistantGroupItems((items) =>
          items.map((item) =>
            item.type === "text" && item.id === assistantTextItemId
              ? { ...item, content: item.content + content }
              : item,
          ),
        );
        assistantIsStreamingText = true;
        updateAssistantMessage();
      };
      const appendAssistantError = (
        error: Extract<AssistantOutputItem, { type: "error" }>,
      ) => {
        finishAssistantThinking();
        assistantTextItemId = "";
        assistantIsStreamingText = false;
        updateCurrentAssistantGroupItems((items) => [...items, error]);
        updateAssistantMessage();
      };
      const assistantGroupsThinking = () =>
        assistantGroups
          .flatMap((group) => group.items)
          .filter((item) => item.type === "thinking")
          .map((item) => item.content)
          .join("");
      const assistantGroupsText = () =>
        assistantGroups
          .flatMap((group) => group.items)
          .filter((item) => item.type === "text")
          .map((item) => item.content)
          .join("");
      const updateAssistantTool = (
        toolId: string,
        updater: (tool: ToolItem) => ToolItem,
      ) => {
        assistantTools = assistantTools.map((currentTool) =>
          currentTool.id === toolId ? updater(currentTool) : currentTool,
        );
        assistantGroups = assistantGroups.map((group) => ({
          ...group,
          items: group.items.map((item) =>
            item.type === "tool" && item.tool.id === toolId
              ? { ...item, tool: updater(item.tool) }
              : item,
          ),
        }));
      };

      return {
        onContextOptimized: appendSystemMessage,
        onDelta: (content) => {
          if (!isCurrentResponse()) {
            return;
          }
          activeRunEventIndexRef.current += 1;
          appendAssistantText(content);
        },
        onDone: (message) => {
          if (!isCurrentResponse()) {
            return;
          }
          activeRunEventIndexRef.current += 1;
          assistantId = message.id;
          assistantContent = message.content;
          const messageThinking = message.thinking ?? "";
          assistantThinking = messageThinking || assistantThinking;
          finishAssistantThinking();
          const streamedThinking = assistantGroupsThinking();
          if (messageThinking && streamedThinking !== messageThinking) {
            const missingThinking = messageThinking.startsWith(streamedThinking)
              ? messageThinking.slice(streamedThinking.length)
              : messageThinking;
            assistantThinkingItemIndex += 1;
            updateCurrentAssistantGroupItems((items) => [
              ...items,
              {
                content: missingThinking,
                id: `${message.id}-thinking-${assistantThinkingItemIndex}`,
                isStreaming: false,
                type: "thinking",
              },
            ]);
          }
          const streamedText = assistantGroupsText();
          if (message.content && streamedText !== message.content) {
            assistantTextItemIndex += 1;
            updateCurrentAssistantGroupItems((items) => [
              ...items,
              {
                content: message.content.slice(streamedText.length),
                id: `${message.id}-text-${assistantTextItemIndex}`,
                type: "text",
              },
            ]);
          }
          assistantMessage = {
            ...message,
            groups: assistantGroups,
            thinking: assistantThinking,
            tools: assistantTools,
            isStreamingThinking: false,
            isStreamingText: false,
            usage_info: message.usage_info ?? latestUsageInfo,
          };
          setMessages([...nextMessages, assistantMessage]);
          activeRunIdRef.current = "";
          activeRunEventIndexRef.current = 0;
          setActiveRunId("");
          setIsResponding(false);
        },
        onError: (error) => {
          if (!isCurrentResponse()) {
            return;
          }
          activeRunEventIndexRef.current += 1;
          appendAssistantError(
            error.id ? error : { ...error, id: `${assistantId}-error-1` },
          );
        },
        onOutputStart: (index) => {
          if (!isCurrentResponse()) {
            return;
          }
          activeRunEventIndexRef.current += 1;
          createAssistantGroup(index);
          updateAssistantMessage();
        },
        onStart: (id) => {
          if (!isCurrentResponse()) {
            return;
          }
          activeRunEventIndexRef.current += 1;
          assistantId = id;
          updateAssistantMessage();
        },
        onThinkingDelta: (content) => {
          if (!isCurrentResponse()) {
            return;
          }
          activeRunEventIndexRef.current += 1;
          appendAssistantThinking(content);
        },
        onToolDone: (tool) => {
          if (!isCurrentResponse()) {
            return;
          }
          activeRunEventIndexRef.current += 1;
          finishAssistantThinking();
          assistantTextItemId = "";
          assistantIsStreamingText = false;
          updateAssistantTool(tool.id, (currentTool) => ({
            ...currentTool,
            ...tool,
          }));
          updateAssistantMessage();
        },
        onToolStart: (tool) => {
          if (!isCurrentResponse()) {
            return;
          }
          activeRunEventIndexRef.current += 1;
          finishAssistantThinking();
          assistantTextItemId = "";
          assistantIsStreamingText = false;
          assistantTools = [...assistantTools, tool];
          updateCurrentAssistantGroupItems((items) => [
            ...items,
            {
              id: `tool-${tool.id}`,
              tool,
              type: "tool",
            },
          ]);
          updateAssistantMessage();
        },
        onUsage: (nextUsageInfo) => {
          if (!isCurrentResponse()) {
            return;
          }
          activeRunEventIndexRef.current += 1;
          latestUsageInfo = nextUsageInfo;
          setUsageInfo(nextUsageInfo);
          updateAssistantMessage();
        },
      };
    },
    [usageInfo],
  );

  const requestWorkspaceRun = useCallback(
    async (content: string) => {
      const response = await fetch("/api/workspace/runs", {
        body: JSON.stringify({ content }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });

      if (!response.ok) {
        throw new Error(await responseErrorFromApi(response));
      }

      const result = (await response.json()) as Partial<WorkspaceRunResponse>;
      if (typeof result.run_id !== "string" || result.run_id.length === 0) {
        throw new SyntaxError("Run was not returned.");
      }
      return result.run_id;
    },
    [responseErrorFromApi],
  );

  const streamWorkspaceRun = useCallback(
    async (
      runId: string,
      handlers: WorkspaceStreamHandlers,
      after: number,
      signal?: AbortSignal,
    ) => {
      const response = await fetch(
        `/api/workspace/runs/${encodeURIComponent(runId)}/stream?after=${after}`,
        {
          headers: { "Content-Type": "text/event-stream" },
          method: "GET",
          signal,
        },
      );

      if (!response.ok) {
        throw new Error(await responseErrorFromApi(response));
      }

      await readWorkspaceStream(response, handlers);
    },
    [readWorkspaceStream, responseErrorFromApi],
  );

  useEffect(() => {
    if (!activeRunId) {
      return;
    }

    const responseRun = responseRunRef.current || 1;
    responseRunRef.current = responseRun;
    const responseAbortController = new AbortController();
    responseAbortRef.current = responseAbortController;
    setIsResponding(true);
    setResponseError("");

    const streamCurrentRun = async () => {
      const handlers = createWorkspaceStreamHandlers(
        messagesRef.current,
        responseRun,
      );
      try {
        await streamWorkspaceRun(
          activeRunId,
          handlers,
          activeRunEventIndexRef.current,
          responseAbortController.signal,
        );
      } catch (error) {
        if (
          responseRunRef.current !== responseRun ||
          responseAbortController.signal.aborted
        ) {
          return;
        }
        const state = await refreshAppState().catch(() => null);
        if (state?.active_run_id) {
          setStreamReconnectKey((current) => current + 1);
          return;
        }
        activeRunIdRef.current = "";
        activeRunEventIndexRef.current = 0;
        setActiveRunId("");
        setIsResponding(false);
        setResponseError(
          error instanceof Error ? error.message : "Message could not be sent.",
        );
      } finally {
        if (
          responseRunRef.current === responseRun &&
          activeRunIdRef.current !== activeRunId
        ) {
          responseAbortRef.current = null;
        }
      }
    };

    void streamCurrentRun();

    return () => {
      responseAbortController.abort();
    };
  }, [
    activeRunId,
    createWorkspaceStreamHandlers,
    refreshAppState,
    streamReconnectKey,
    streamWorkspaceRun,
  ]);

  const requestLegacyWorkspaceResponse = async (
    content: string,
    handlers: WorkspaceStreamHandlers,
    signal?: AbortSignal,
  ) => {
    const response = await fetch("/api/workspace/respond", {
      body: JSON.stringify({ content }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
      signal,
    });

    if (!response.ok) {
      throw new Error(await responseErrorFromApi(response));
    }

    await readWorkspaceStream(response, handlers);
  };

  const compactWorkspace = async () => {
    setResponseError("");
    setIsRefiningContext(true);

    try {
      const response = await fetch("/api/workspace/compact", {
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });

      if (!response.ok) {
        throw new Error(await responseErrorFromApi(response));
      }

      const result = (await response.json()) as {
        message: ApiMessage;
        usage_info?: ContextUsageInfo;
      };
      if (result.usage_info) {
        setUsageInfo(result.usage_info);
      }
      setMessages((currentMessages) => [...currentMessages, result.message]);
    } catch (error) {
      setResponseError(
        error instanceof Error
          ? error.message
          : "Context could not be compacted.",
      );
    } finally {
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
        setResponseError("Compact is unavailable while Flowent is responding.");
        return false;
      }
      void compactWorkspace();
      return true;
    }
    return false;
  };

  const handleWorkspaceCommandError = (message: string) => {
    setResponseError(message);
  };

  const stopResponse = () => {
    const runId = activeRunIdRef.current;
    if (runId) {
      void fetch(`/api/workspace/runs/${encodeURIComponent(runId)}/stop`, {
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
    }
    responseRunRef.current += 1;
    activeRunIdRef.current = "";
    activeRunEventIndexRef.current = 0;
    responseAbortRef.current?.abort();
    responseAbortRef.current = null;
    setResponseError("");
    setActiveRunId("");
    setIsResponding(false);
  };

  const sendMessage = async (submittedDraft = draft) => {
    if (submittedDraft.length === 0 || isResponding) {
      return;
    }

    const responseRun = responseRunRef.current + 1;
    const responseAbortController = new AbortController();
    responseAbortRef.current = responseAbortController;
    responseRunRef.current = responseRun;
    activeRunEventIndexRef.current = 0;
    const userContent = submittedDraft;
    const nextMessages: Message[] = [
      ...messages,
      {
        author: "user",
        content: userContent,
        id: createClientId("message"),
      },
    ];
    setResponseError("");
    setIsResponding(true);
    setMessages(nextMessages);
    setDraft("");

    try {
      try {
        const runId = await requestWorkspaceRun(userContent);
        activeRunIdRef.current = runId;
        activeRunEventIndexRef.current = 0;
        setActiveRunId(runId);
      } catch (error) {
        if (error instanceof SyntaxError) {
          const handlers = createWorkspaceStreamHandlers(
            nextMessages,
            responseRun,
          );
          await requestLegacyWorkspaceResponse(
            userContent,
            handlers,
            responseAbortController.signal,
          );
          return;
        }
        throw error;
      }
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
      setResponseError(
        error instanceof Error ? error.message : "Message could not be sent.",
      );
    } finally {
      if (responseRunRef.current === responseRun && !activeRunIdRef.current) {
        responseAbortRef.current = null;
        setIsResponding(false);
      }
    }
  };

  const clearMessages = async () => {
    const previousMessages = messages;
    const previousUsageInfo = usageInfo;

    responseAbortRef.current?.abort();
    responseAbortRef.current = null;
    activeRunIdRef.current = "";
    activeRunEventIndexRef.current = 0;
    responseRunRef.current += 1;
    setMessages([]);
    setUsageInfo(null);
    setResponseError("");
    setActiveRunId("");
    setIsResponding(false);

    try {
      await saveMessages([]);
    } catch {
      setMessages(previousMessages);
      setUsageInfo(previousUsageInfo);
      setResponseError("Conversation could not be cleared.");
    }
  };

  return (
    <AppShell
      activeProviderName={activeProvider?.name}
      activeView={activeView}
      onViewChange={setActiveView}
    >
      <TabsContent value="workspace" className={viewPanelClassName}>
        <WorkspaceView
          draft={draft}
          errorMessage={responseError}
          isRefiningContext={isRefiningContext}
          isResponding={isResponding}
          messages={messages}
          usageInfo={usageInfo}
          commands={workspaceCommands}
          skills={skills}
          onClearMessages={() => {
            void clearMessages();
          }}
          onCommand={runWorkspaceCommand}
          onCommandError={handleWorkspaceCommandError}
          onDraftChange={setDraft}
          onSendMessage={(content) => {
            void sendMessage(content);
          }}
          onStopResponse={stopResponse}
        />
      </TabsContent>
      <TabsContent value="providers" className={viewPanelClassName}>
        <ProvidersView
          activeProvider={providerDraft}
          fetchError={fetchError}
          isFetchingModels={isFetchingModels}
          isCreatingProvider={isCreatingProvider}
          onFetchModels={fetchProviderModels}
          onNewProvider={openNewProviderEditor}
          onProviderSelect={loadProviderEditor}
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
          importError={mcpImportError}
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

export default App;
