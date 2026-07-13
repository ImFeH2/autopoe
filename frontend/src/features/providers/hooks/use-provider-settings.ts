import { useCallback, useMemo, useState } from "react";

import {
  fetchProviderModelsRequest,
  ProviderModelFetchError,
  removeProviderRequest,
  saveProviderRequest,
} from "@/features/providers/api/provider-requests";
import { saveRuntimeSettingsRequest } from "@/app/api/state-requests";
import {
  createEmptyProvider,
  providerOptions,
} from "@/features/providers/model/provider-options";
import type { Provider } from "@/features/providers/model/provider-types";
import type {
  ReasoningEffort,
  RuntimeSettings,
} from "@/components/flowent/types";
import { createClientId } from "@/lib/utils";
import type { FlowentToastInput } from "@/components/flowent/toast-context";

export const useProviderSettings = ({
  onContextWindowLimitChange,
  refreshAppState,
  showError,
}: {
  onContextWindowLimitChange: (contextWindowLimit: number | null) => void;
  refreshAppState: () => Promise<void>;
  showError: (input: FlowentToastInput) => void;
}) => {
  const [agentPrompt, setAgentPrompt] = useState("");
  const [selectedProviderId, setSelectedProviderId] = useState("");
  const [selectedModel, setSelectedModel] = useState("");
  const [contextWindowLimit, setContextWindowLimit] = useState<number | null>(
    null,
  );
  const [reasoningEffort, setReasoningEffort] =
    useState<ReasoningEffort>("default");
  const [providers, setProviders] = useState<Provider[]>([]);
  const [providerEditorId, setProviderEditorId] = useState("new");
  const [providerDraft, setProviderDraft] = useState<Provider>(() =>
    createEmptyProvider(),
  );
  const [isFetchingModels, setIsFetchingModels] = useState(false);

  const activeProvider = useMemo(
    () => providers.find((provider) => provider.id === selectedProviderId),
    [providers, selectedProviderId],
  );
  const isCreatingProvider = providerEditorId === "new";

  const replaceProviders = useCallback((nextProviders: Provider[]) => {
    setProviders(nextProviders);
  }, []);

  const replaceRuntimeSettings = useCallback((settings: RuntimeSettings) => {
    setAgentPrompt(settings.agentPrompt);
    setSelectedProviderId(settings.selectedProviderId);
    setSelectedModel(settings.selectedModel);
    setContextWindowLimit(settings.contextWindowLimit);
    setReasoningEffort(settings.reasoningEffort);
  }, []);

  const loadProviderEditor = useCallback((provider: Provider) => {
    setProviderEditorId(provider.id);
    setProviderDraft({ ...provider, apiKey: "" });
  }, []);

  const openNewProviderEditor = useCallback(() => {
    setProviderEditorId("new");
    setProviderDraft(createEmptyProvider());
  }, []);

  const updateProviderDraft = useCallback((updates: Partial<Provider>) => {
    setProviderDraft((current) => ({ ...current, ...updates }));
  }, []);

  const persistSettingsAndRefresh = useCallback(
    async (settings: RuntimeSettings) => {
      replaceRuntimeSettings(settings);
      await saveRuntimeSettingsRequest(settings);
      await refreshAppState();
    },
    [refreshAppState, replaceRuntimeSettings],
  );

  const handleActiveProviderChange = useCallback(
    (value: string) => {
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
    },
    [
      agentPrompt,
      contextWindowLimit,
      persistSettingsAndRefresh,
      providers,
      reasoningEffort,
    ],
  );

  const handleActiveModelChange = useCallback(
    (value: string) => {
      setSelectedModel(value);
      void persistSettingsAndRefresh({
        agentPrompt,
        contextWindowLimit,
        reasoningEffort,
        selectedModel: value,
        selectedProviderId,
      });
    },
    [
      agentPrompt,
      contextWindowLimit,
      persistSettingsAndRefresh,
      reasoningEffort,
      selectedProviderId,
    ],
  );

  const handleReasoningEffortChange = useCallback(
    (value: ReasoningEffort) => {
      setReasoningEffort(value);
      void saveRuntimeSettingsRequest({
        agentPrompt,
        contextWindowLimit,
        reasoningEffort: value,
        selectedModel,
        selectedProviderId,
      });
    },
    [agentPrompt, contextWindowLimit, selectedModel, selectedProviderId],
  );

  const saveRuntimeSettings = useCallback(
    (settings: RuntimeSettings) => {
      replaceRuntimeSettings(settings);
      onContextWindowLimitChange(settings.contextWindowLimit);
      void persistSettingsAndRefresh(settings);
    },
    [
      onContextWindowLimitChange,
      persistSettingsAndRefresh,
      replaceRuntimeSettings,
    ],
  );

  const fetchProviderModels = useCallback(async () => {
    setIsFetchingModels(true);

    try {
      const models = await fetchProviderModelsRequest(providerDraft);
      updateProviderDraft({ models });

      if (models.length === 0) {
        showError({
          description: "No models available for this provider.",
          message: "No models found.",
        });
      }
    } catch (error) {
      if (error instanceof ProviderModelFetchError) {
        showError(error.notification);
      }
    } finally {
      setIsFetchingModels(false);
    }
  }, [providerDraft, showError, updateProviderDraft]);

  const saveProvider = useCallback(async () => {
    const savedProvider: Provider = {
      ...providerDraft,
      id: isCreatingProvider ? createClientId("provider") : providerDraft.id,
      name:
        providerDraft.name.trim() ||
        providerOptions.find((type) => type.id === providerDraft.type)?.label ||
        "Provider",
    };

    const persistedProvider = await saveProviderRequest(savedProvider);
    if (!persistedProvider) {
      return;
    }

    setProviders((currentProviders) => {
      if (isCreatingProvider) {
        return [...currentProviders, persistedProvider];
      }
      return currentProviders.map((provider) =>
        provider.id === persistedProvider.id ? persistedProvider : provider,
      );
    });
    setProviderEditorId(persistedProvider.id);
    setProviderDraft(persistedProvider);

    if (!selectedProviderId) {
      void saveRuntimeSettingsRequest({
        agentPrompt,
        contextWindowLimit,
        reasoningEffort,
        selectedModel: "",
        selectedProviderId: persistedProvider.id,
      });
      setSelectedProviderId(persistedProvider.id);
      setSelectedModel("");
    }
  }, [
    agentPrompt,
    contextWindowLimit,
    isCreatingProvider,
    providerDraft,
    reasoningEffort,
    selectedProviderId,
  ]);

  const removeProvider = useCallback(async () => {
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
  }, [
    agentPrompt,
    contextWindowLimit,
    isCreatingProvider,
    loadProviderEditor,
    openNewProviderEditor,
    providerDraft.id,
    providers,
    reasoningEffort,
    selectedProviderId,
  ]);

  return {
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
  };
};
