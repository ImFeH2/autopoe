import { useEffect, useMemo, useRef, useState } from "react";

import { AppShell } from "@/components/flowent/app-shell";
import {
  createEmptyProvider,
  providerOptions,
} from "@/components/flowent/provider-options";
import { ProvidersView } from "@/components/flowent/providers-view";
import { SettingsView } from "@/components/flowent/settings-view";
import { viewPanelClassName } from "@/components/flowent/styles";
import type {
  AssistantOutputGroup,
  AssistantOutputItem,
  Message,
  Provider,
  ReasoningEffort,
  ToolItem,
  ViewId,
  WorkspaceCommand,
  WorkspaceCommandId,
} from "@/components/flowent/types";
import { WorkspaceView } from "@/components/flowent/workspace-view";
import { TabsContent } from "@/components/ui/tabs";

type ApiProvider = {
  api_key: string;
  base_url: string;
  id: string;
  models: string[];
  name: string;
  type: Provider["type"];
};

type ApiMessage = Message;

type ApiState = {
  messages: ApiMessage[];
  providers: ApiProvider[];
  settings: {
    reasoning_effort?: ReasoningEffort;
    selected_model: string;
    selected_provider_id: string;
  };
};

type ApiAbout = {
  version?: string;
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
        message: string;
      };
      event: "error";
    };

type WorkspaceStreamHandlers = {
  onDelta: (content: string) => void;
  onDone: (message: ApiMessage) => void;
  onOutputStart: (index: number) => void;
  onStart: (id: string) => void;
  onThinkingDelta: (content: string) => void;
  onToolDone: (
    tool: Pick<ToolItem, "id" | "status"> & Partial<ToolItem>,
  ) => void;
  onToolStart: (tool: ToolItem) => void;
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

function App() {
  const [activeView, setActiveView] = useState<ViewId>("workspace");
  const [draft, setDraft] = useState("");
  const [selectedProviderId, setSelectedProviderId] = useState("");
  const [selectedModel, setSelectedModel] = useState("");
  const [reasoningEffort, setReasoningEffort] =
    useState<ReasoningEffort>("default");
  const [appVersion, setAppVersion] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [providerEditorId, setProviderEditorId] = useState("new");
  const [providerDraft, setProviderDraft] = useState<Provider>(() =>
    createEmptyProvider(),
  );
  const [isFetchingModels, setIsFetchingModels] = useState(false);
  const [fetchError, setFetchError] = useState("");
  const [isResponding, setIsResponding] = useState(false);
  const [responseError, setResponseError] = useState("");
  const responseAbortRef = useRef<AbortController | null>(null);
  const responseRunRef = useRef(0);

  const activeProvider = useMemo(
    () => providers.find((provider) => provider.id === selectedProviderId),
    [providers, selectedProviderId],
  );
  const isCreatingProvider = providerEditorId === "new";

  useEffect(() => {
    let isMounted = true;

    const loadState = async () => {
      try {
        const [stateResponse, aboutResponse] = await Promise.all([
          fetch("/api/state"),
          fetch("/api/about"),
        ]);
        if (!stateResponse.ok) {
          return;
        }

        const state = (await stateResponse.json()) as ApiState;
        const about = aboutResponse.ok
          ? ((await aboutResponse.json()) as ApiAbout)
          : {};
        if (!isMounted) {
          return;
        }

        const loadedProviders = state.providers.map(providerFromApi);
        setProviders(loadedProviders);
        setMessages(state.messages);
        setSelectedProviderId(state.settings.selected_provider_id);
        setSelectedModel(state.settings.selected_model);
        setReasoningEffort(state.settings.reasoning_effort ?? "default");
        setAppVersion(typeof about.version === "string" ? about.version : "");
      } catch {
        // Keep the local empty state when persistence is unavailable.
      }
    };

    void loadState();

    return () => {
      isMounted = false;
    };
  }, []);

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

  const updateProviderDraft = (updates: Partial<Provider>) => {
    setProviderDraft((current) => ({ ...current, ...updates }));
    setFetchError("");
  };

  const persistSettings = async (
    providerId: string,
    model: string,
    nextReasoningEffort = reasoningEffort,
  ) => {
    await fetch("/api/settings", {
      body: JSON.stringify({
        reasoning_effort: nextReasoningEffort,
        selected_model: model,
        selected_provider_id: providerId,
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
      void persistSettings("", "");
      return;
    }

    setSelectedProviderId(nextProvider.id);
    setSelectedModel("");
    void persistSettings(nextProvider.id, "");
  };

  const handleActiveModelChange = (value: string) => {
    setSelectedModel(value);
    void persistSettings(selectedProviderId, value);
  };

  const handleReasoningEffortChange = (value: ReasoningEffort) => {
    setReasoningEffort(value);
    void persistSettings(selectedProviderId, selectedModel, value);
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
      id: isCreatingProvider ? crypto.randomUUID() : providerDraft.id,
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
      void persistSettings(savedProvider.id, "");
    }

    await fetch("/api/providers", {
      body: JSON.stringify(providerToApi(savedProvider)),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
  };

  const saveMessages = async (nextMessages: Message[]) => {
    await fetch("/api/workspace/messages", {
      body: JSON.stringify({ messages: nextMessages }),
      headers: { "Content-Type": "application/json" },
      method: "PUT",
    });
  };

  const responseErrorFromApi = async (response: Response) => {
    try {
      const result = (await response.json()) as { detail?: unknown };
      if (typeof result.detail === "string") {
        return result.detail;
      }
    } catch {
      return "Message could not be sent.";
    }
    return "Message could not be sent.";
  };

  const parseWorkspaceStreamEvent = (
    rawEvent: string,
  ): WorkspaceStreamEvent => {
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
  };

  const readWorkspaceStream = async (
    response: Response,
    handlers: WorkspaceStreamHandlers,
  ) => {
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
          throw new Error(streamEvent.data.message);
        }
      }

      if (done) {
        break;
      }
    }

    throw new Error("Message could not be sent.");
  };

  const requestWorkspaceResponse = async (
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

    try {
      const response = await fetch("/api/workspace/compact", {
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });

      if (!response.ok) {
        throw new Error(await responseErrorFromApi(response));
      }

      const result = (await response.json()) as { message: ApiMessage };
      setMessages((currentMessages) => [...currentMessages, result.message]);
    } catch (error) {
      setResponseError(
        error instanceof Error
          ? error.message
          : "Context could not be compacted.",
      );
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
    responseAbortRef.current?.abort();
    responseAbortRef.current = null;
    responseRunRef.current += 1;
    setResponseError("");
    setIsResponding(false);
  };

  const sendMessage = async () => {
    if (draft.length === 0 || isResponding) {
      return;
    }

    const responseRun = responseRunRef.current + 1;
    const responseAbortController = new AbortController();
    responseAbortRef.current = responseAbortController;
    responseRunRef.current = responseRun;
    const userContent = draft;
    const nextMessages: Message[] = [
      ...messages,
      {
        author: "user",
        content: userContent,
        id: crypto.randomUUID(),
      },
    ];
    setResponseError("");
    setIsResponding(true);
    setMessages(nextMessages);
    setDraft("");

    try {
      let assistantMessage: Message | null = null;
      let assistantContent = "";
      let assistantId = "";
      let assistantThinking = "";
      let assistantThinkingItemId = "";
      let assistantThinkingItemIndex = 0;
      let assistantTextItemId = "";
      let assistantTextItemIndex = 0;
      let assistantGroups: AssistantOutputGroup[] = [];
      let assistantIsStreamingThinking = false;
      let assistantIsStreamingText = false;
      let assistantTools: ToolItem[] = [];
      const isCurrentResponse = () => responseRunRef.current === responseRun;
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
        };
        setMessages([...nextMessages, assistantMessage]);
      };
      const createAssistantGroup = (index: number) => {
        const groupId = `${assistantId}-group-${index}`;
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
      await requestWorkspaceResponse(
        userContent,
        {
          onDelta: (content) => {
            if (!isCurrentResponse()) {
              return;
            }
            appendAssistantText(content);
          },
          onDone: (message) => {
            if (!isCurrentResponse()) {
              return;
            }
            assistantId = message.id;
            assistantContent = message.content;
            const messageThinking = message.thinking ?? "";
            assistantThinking = messageThinking || assistantThinking;
            finishAssistantThinking();
            const streamedThinking = assistantGroupsThinking();
            if (messageThinking && streamedThinking !== messageThinking) {
              const missingThinking = messageThinking.startsWith(
                streamedThinking,
              )
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
            };
            setMessages([...nextMessages, assistantMessage]);
          },
          onStart: (id) => {
            if (!isCurrentResponse()) {
              return;
            }
            assistantId = id;
            updateAssistantMessage();
          },
          onOutputStart: (index) => {
            if (!isCurrentResponse()) {
              return;
            }
            createAssistantGroup(index);
            updateAssistantMessage();
          },
          onThinkingDelta: (content) => {
            if (!isCurrentResponse()) {
              return;
            }
            appendAssistantThinking(content);
          },
          onToolDone: (tool) => {
            if (!isCurrentResponse()) {
              return;
            }
            finishAssistantThinking();
            assistantTextItemId = "";
            assistantIsStreamingText = false;
            assistantTools = assistantTools.map((currentTool) =>
              currentTool.id === tool.id
                ? { ...currentTool, ...tool }
                : currentTool,
            );
            assistantGroups = assistantGroups.map((group) => ({
              ...group,
              items: group.items.map((item) =>
                item.type === "tool" && item.tool.id === tool.id
                  ? { ...item, tool: { ...item.tool, ...tool } }
                  : item,
              ),
            }));
            updateAssistantMessage();
          },
          onToolStart: (tool) => {
            if (!isCurrentResponse()) {
              return;
            }
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
        },
        responseAbortController.signal,
      );
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
      if (responseRunRef.current === responseRun) {
        responseAbortRef.current = null;
        setIsResponding(false);
      }
    }
  };

  const clearMessages = async () => {
    const previousMessages = messages;

    responseAbortRef.current?.abort();
    responseAbortRef.current = null;
    responseRunRef.current += 1;
    setMessages([]);
    setResponseError("");
    setIsResponding(false);

    try {
      await saveMessages([]);
    } catch {
      setMessages(previousMessages);
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
          isResponding={isResponding}
          messages={messages}
          commands={workspaceCommands}
          onClearMessages={() => {
            void clearMessages();
          }}
          onCommand={runWorkspaceCommand}
          onCommandError={handleWorkspaceCommandError}
          onDraftChange={setDraft}
          onSendMessage={() => {
            void sendMessage();
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
      <TabsContent value="settings" className={viewPanelClassName}>
        <SettingsView
          appVersion={appVersion}
          modelOptions={activeProvider?.models ?? []}
          onModelChange={handleActiveModelChange}
          onProviderChange={handleActiveProviderChange}
          onReasoningEffortChange={handleReasoningEffortChange}
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
