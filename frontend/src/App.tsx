import { useEffect, useMemo, useState } from "react";

import { AppShell } from "@/components/flowent/app-shell";
import {
  createEmptyProvider,
  providerOptions,
} from "@/components/flowent/provider-options";
import { ProvidersView } from "@/components/flowent/providers-view";
import { SettingsView } from "@/components/flowent/settings-view";
import { viewPanelClassName } from "@/components/flowent/styles";
import type { Message, Provider, ViewId } from "@/components/flowent/types";
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
    selected_model: string;
    selected_provider_id: string;
  };
};

type ApiWorkspaceResponse = {
  message: ApiMessage;
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

const messageToApi = (message: Message): ApiMessage => message;

function App() {
  const [activeView, setActiveView] = useState<ViewId>("workspace");
  const [draft, setDraft] = useState("");
  const [selectedProviderId, setSelectedProviderId] = useState("");
  const [selectedModel, setSelectedModel] = useState("");
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
  const [animatedAssistantMessageId, setAnimatedAssistantMessageId] =
    useState("");

  const activeProvider = useMemo(
    () => providers.find((provider) => provider.id === selectedProviderId),
    [providers, selectedProviderId],
  );
  const isCreatingProvider = providerEditorId === "new";

  useEffect(() => {
    let isMounted = true;

    const loadState = async () => {
      try {
        const response = await fetch("/api/state");
        if (!response.ok) {
          return;
        }

        const state = (await response.json()) as ApiState;
        if (!isMounted) {
          return;
        }

        const loadedProviders = state.providers.map(providerFromApi);
        setProviders(loadedProviders);
        setMessages(state.messages);
        setSelectedProviderId(state.settings.selected_provider_id);
        setSelectedModel(state.settings.selected_model);
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

  const persistSettings = async (providerId: string, model: string) => {
    await fetch("/api/settings", {
      body: JSON.stringify({
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
      body: JSON.stringify({ messages: nextMessages.map(messageToApi) }),
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

  const requestWorkspaceResponse = async (nextMessages: Message[]) => {
    const response = await fetch("/api/workspace/respond", {
      body: JSON.stringify({ messages: nextMessages.map(messageToApi) }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });

    if (!response.ok) {
      throw new Error(await responseErrorFromApi(response));
    }

    return (await response.json()) as ApiWorkspaceResponse;
  };

  const sendMessage = async () => {
    if (draft.length === 0 || isResponding || animatedAssistantMessageId) {
      return;
    }

    const nextMessages: Message[] = [
      ...messages,
      {
        author: "user",
        content: draft,
        id: crypto.randomUUID(),
      },
    ];
    setResponseError("");
    setIsResponding(true);
    setMessages(nextMessages);
    setDraft("");

    try {
      await saveMessages(nextMessages);
      const response = await requestWorkspaceResponse(nextMessages);
      const completedMessages = [...nextMessages, response.message];
      setMessages(completedMessages);
      setIsResponding(false);
      setAnimatedAssistantMessageId(response.message.id);
      await saveMessages(completedMessages);
    } catch (error) {
      setResponseError(
        error instanceof Error ? error.message : "Message could not be sent.",
      );
    } finally {
      setIsResponding(false);
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
          animatedAssistantMessageId={animatedAssistantMessageId}
          draft={draft}
          errorMessage={responseError}
          isResponding={isResponding}
          messages={messages}
          onAssistantAnimationComplete={() => {
            setAnimatedAssistantMessageId("");
          }}
          onDraftChange={setDraft}
          onSendMessage={() => {
            void sendMessage();
          }}
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
          modelOptions={activeProvider?.models ?? []}
          onModelChange={handleActiveModelChange}
          onProviderChange={handleActiveProviderChange}
          providers={providers}
          selectedModel={selectedModel}
          selectedProviderId={selectedProviderId}
        />
      </TabsContent>
    </AppShell>
  );
}

export default App;
