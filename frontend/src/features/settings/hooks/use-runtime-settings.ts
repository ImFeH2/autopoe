import { useCallback, useMemo, useState } from "react";

import type { Provider } from "@/features/providers/model/provider-types";
import { saveRuntimeSettingsRequest } from "@/features/settings/api/runtime-settings-requests";
import type {
  ReasoningEffort,
  RuntimeSettings,
} from "@/features/settings/model/runtime-settings-types";

export const useRuntimeSettings = ({
  onContextWindowLimitChange,
  providers,
  refreshAppState,
}: {
  onContextWindowLimitChange: (contextWindowLimit: number | null) => void;
  providers: Provider[];
  refreshAppState: () => Promise<void>;
}) => {
  const [agentPrompt, setAgentPrompt] = useState("");
  const [selectedProviderId, setSelectedProviderId] = useState("");
  const [selectedModel, setSelectedModel] = useState("");
  const [contextWindowLimit, setContextWindowLimit] = useState<number | null>(
    null,
  );
  const [reasoningEffort, setReasoningEffort] =
    useState<ReasoningEffort>("default");

  const activeProvider = useMemo(
    () => providers.find((provider) => provider.id === selectedProviderId),
    [providers, selectedProviderId],
  );

  const replaceRuntimeSettings = useCallback((settings: RuntimeSettings) => {
    setAgentPrompt(settings.agentPrompt);
    setSelectedProviderId(settings.selectedProviderId);
    setSelectedModel(settings.selectedModel);
    setContextWindowLimit(settings.contextWindowLimit);
    setReasoningEffort(settings.reasoningEffort);
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
      const nextProviderId = nextProvider?.id ?? "";

      setSelectedProviderId(nextProviderId);
      setSelectedModel("");
      void persistSettingsAndRefresh({
        agentPrompt,
        contextWindowLimit,
        reasoningEffort,
        selectedModel: "",
        selectedProviderId: nextProviderId,
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

  const handleProviderSaved = useCallback(
    (providerId: string) => {
      if (selectedProviderId) {
        return;
      }

      setSelectedProviderId(providerId);
      setSelectedModel("");
      void saveRuntimeSettingsRequest({
        agentPrompt,
        contextWindowLimit,
        reasoningEffort,
        selectedModel: "",
        selectedProviderId: providerId,
      });
    },
    [agentPrompt, contextWindowLimit, reasoningEffort, selectedProviderId],
  );

  const handleProviderRemoved = useCallback(
    (removedProviderId: string, nextProvider?: Provider) => {
      if (selectedProviderId !== removedProviderId) {
        return;
      }

      const nextProviderId = nextProvider?.id ?? "";
      const nextModel = nextProvider?.models[0] ?? "";
      setSelectedProviderId(nextProviderId);
      setSelectedModel(nextModel);
      void saveRuntimeSettingsRequest({
        agentPrompt,
        contextWindowLimit,
        reasoningEffort,
        selectedModel: nextModel,
        selectedProviderId: nextProviderId,
      });
    },
    [agentPrompt, contextWindowLimit, reasoningEffort, selectedProviderId],
  );

  return {
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
  };
};
