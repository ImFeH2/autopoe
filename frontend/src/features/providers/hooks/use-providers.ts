import { useCallback, useState } from "react";

import {
  fetchProviderModelsRequest,
  ProviderModelFetchError,
  type ProviderNotification,
  removeProviderRequest,
  saveProviderRequest,
} from "@/features/providers/api/provider-requests";
import {
  createEmptyProvider,
  providerOptions,
} from "@/features/providers/model/provider-options";
import type { Provider } from "@/features/providers/model/provider-types";
import i18n from "@/i18n/i18n";
import { createClientId } from "@/lib/utils";

export type RemovedProviderResult = {
  nextProvider?: Provider;
  removedProviderId: string;
};

export const useProviders = ({
  showError,
}: {
  showError: (notification: ProviderNotification) => void;
}) => {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [providerEditorId, setProviderEditorId] = useState("new");
  const [providerDraft, setProviderDraft] = useState<Provider>(() =>
    createEmptyProvider(),
  );
  const [isFetchingModels, setIsFetchingModels] = useState(false);

  const isCreatingProvider = providerEditorId === "new";

  const replaceProviders = useCallback((nextProviders: Provider[]) => {
    setProviders(nextProviders);
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

  const fetchProviderModels = useCallback(async () => {
    setIsFetchingModels(true);

    try {
      const models = await fetchProviderModelsRequest(providerDraft);
      updateProviderDraft({ models });

      if (models.length === 0) {
        showError({
          description: i18n.t("setup.providers.errors.noModels.description"),
          message: i18n.t("setup.providers.errors.noModels.message"),
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
      return null;
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
    return persistedProvider;
  }, [isCreatingProvider, providerDraft]);

  const removeProvider = useCallback(async () => {
    if (isCreatingProvider) {
      return null;
    }

    const removedProviderId = providerDraft.id;
    const wasRemoved = await removeProviderRequest(removedProviderId);
    if (!wasRemoved) {
      return null;
    }

    const removedIndex = providers.findIndex(
      (provider) => provider.id === removedProviderId,
    );
    const remainingProviders = providers.filter(
      (provider) => provider.id !== removedProviderId,
    );
    const nextProvider =
      remainingProviders[removedIndex] || remainingProviders[removedIndex - 1];

    setProviders(remainingProviders);

    if (nextProvider) {
      loadProviderEditor(nextProvider);
    } else {
      openNewProviderEditor();
    }

    return { nextProvider, removedProviderId } satisfies RemovedProviderResult;
  }, [
    isCreatingProvider,
    loadProviderEditor,
    openNewProviderEditor,
    providerDraft.id,
    providers,
  ]);

  return {
    fetchProviderModels,
    isCreatingProvider,
    isFetchingModels,
    loadProviderEditor,
    openNewProviderEditor,
    providerDraft,
    providers,
    removeProvider,
    replaceProviders,
    saveProvider,
    updateProviderDraft,
  };
};
