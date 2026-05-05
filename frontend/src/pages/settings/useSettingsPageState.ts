import { useAccess } from "@/context/useAccess";
import { fetchSettingsBootstrap, saveSettings } from "@/lib/api";
import {
  buildSettingsSavePayload,
  findProviderById,
  findRoleByName,
  getActiveProviderModels,
  getEffectiveContextWindowTokens,
  getEffectiveModelCapabilities,
  getKnownSafeInputTokens,
  getSelectedCatalogModel,
  type UserSettings,
  validateAutoCompactTokenLimit,
} from "@/pages/settings/lib";
import { toast } from "sonner";
import { useCallback, useEffect, useMemo, useState } from "react";
import useSWR from "swr";

export interface AccessDraft {
  confirmCode: string;
  newCode: string;
}

export type UpdateAccessDraft = (
  updater: (draft: AccessDraft) => AccessDraft,
) => void;
export type UpdateSettings = (
  updater: (settings: UserSettings) => UserSettings,
) => void;

export function useSettingsPageState() {
  const { requireReauth } = useAccess();
  const {
    data: bootstrapData,
    isLoading: loading,
    mutate: mutateSettings,
  } = useSWR("settingsBootstrap", () => fetchSettingsBootstrap<UserSettings>());

  const [localSettings, setLocalSettings] = useState<UserSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [accessDraft, setAccessDraft] = useState<AccessDraft>({
    newCode: "",
    confirmCode: "",
  });

  const providers = useMemo(
    () => bootstrapData?.providers ?? [],
    [bootstrapData?.providers],
  );
  const roles = useMemo(
    () => bootstrapData?.roles ?? [],
    [bootstrapData?.roles],
  );
  const appVersion = bootstrapData?.version ?? null;

  useEffect(() => {
    if (bootstrapData?.settings && !localSettings) {
      setLocalSettings(bootstrapData.settings);
    }
  }, [bootstrapData?.settings, localSettings]);

  const settings = localSettings ?? bootstrapData?.settings ?? null;

  const updateSettings = useCallback<UpdateSettings>(
    (updater) => {
      setLocalSettings((current) => {
        const base = current ?? bootstrapData?.settings ?? null;
        return base ? updater(base) : current;
      });
    },
    [bootstrapData?.settings],
  );

  const updateAccessDraft = useCallback<UpdateAccessDraft>((updater) => {
    setAccessDraft((current) => updater(current));
  }, []);

  const activeProvider = useMemo(() => {
    if (!settings) {
      return null;
    }
    return findProviderById(providers, settings.model.active_provider_id);
  }, [providers, settings]);

  const assistantRole = useMemo(() => {
    if (!settings) {
      return null;
    }
    return findRoleByName(roles, settings.assistant.role_name);
  }, [roles, settings]);

  const activeProviderModels = useMemo(
    () => getActiveProviderModels(activeProvider),
    [activeProvider],
  );

  const availableActiveProviderModels = activeProviderModels;

  const selectedCatalogModel = useMemo(() => {
    if (!settings) {
      return null;
    }
    return getSelectedCatalogModel(
      activeProviderModels,
      settings.model.active_model,
    );
  }, [activeProviderModels, settings]);

  const effectiveContextWindowTokens = useMemo(() => {
    if (!settings) {
      return null;
    }
    return getEffectiveContextWindowTokens(settings, selectedCatalogModel);
  }, [selectedCatalogModel, settings]);

  const effectiveModelCapabilities = useMemo(
    () =>
      settings
        ? getEffectiveModelCapabilities(settings, selectedCatalogModel)
        : { input_image: false, output_image: false, structured_output: false },
    [selectedCatalogModel, settings],
  );

  const knownSafeInputTokens = useMemo(() => {
    if (!settings) {
      return null;
    }
    return getKnownSafeInputTokens(
      effectiveContextWindowTokens,
      settings.model.params,
    );
  }, [effectiveContextWindowTokens, settings]);

  const leaderRole = useMemo(() => {
    if (!settings) {
      return null;
    }
    return findRoleByName(roles, settings.leader.role_name);
  }, [roles, settings]);

  const accessDraftError = useMemo(() => {
    if (!accessDraft.newCode && !accessDraft.confirmCode) {
      return null;
    }
    if (!accessDraft.newCode.trim()) {
      return "New Access Code must not be empty.";
    }
    if (accessDraft.confirmCode !== accessDraft.newCode) {
      return "Confirm Access Code must exactly match New Access Code.";
    }
    return null;
  }, [accessDraft.confirmCode, accessDraft.newCode]);

  const handleSave = useCallback(async () => {
    if (!settings) {
      return;
    }
    if (accessDraftError) {
      toast.error(accessDraftError);
      return;
    }
    if (!settings.working_dir.trim()) {
      toast.error("Working Directory must not be empty");
      return;
    }
    if (
      settings.model.retry_max_delay_seconds <
      settings.model.retry_initial_delay_seconds
    ) {
      toast.error("Max Delay must be greater than or equal to Initial Delay");
      return;
    }

    const autoCompactTokenLimitError = validateAutoCompactTokenLimit(
      settings.model.auto_compact_token_limit,
      knownSafeInputTokens,
    );
    if (autoCompactTokenLimitError) {
      toast.error(autoCompactTokenLimitError);
      return;
    }

    setSaving(true);
    try {
      const payload = buildSettingsSavePayload(settings, accessDraft);
      const saveResult = await saveSettings<UserSettings>(payload);
      const savedSettings = saveResult.settings;

      setLocalSettings(savedSettings);
      setAccessDraft({ newCode: "", confirmCode: "" });
      void mutateSettings(
        (current) =>
          current ? { ...current, settings: savedSettings } : current,
        false,
      );

      if (saveResult.reauthRequired) {
        toast.success("Access code updated. Sign in again with the new code.");
        requireReauth();
        return;
      }

      toast.success("Settings saved");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to save settings",
      );
    } finally {
      setSaving(false);
    }
  }, [
    accessDraft,
    accessDraftError,
    knownSafeInputTokens,
    mutateSettings,
    requireReauth,
    settings,
  ]);

  return {
    accessDraft,
    accessDraftError,
    activeProvider,
    activeProviderModels,
    availableActiveProviderModels,
    appVersion,
    assistantRole,
    effectiveContextWindowTokens,
    effectiveModelCapabilities,
    handleSave,
    knownSafeInputTokens,
    leaderRole,
    loading,
    providers,
    roles,
    saving,
    settings,
    updateAccessDraft,
    updateSettings,
  };
}
