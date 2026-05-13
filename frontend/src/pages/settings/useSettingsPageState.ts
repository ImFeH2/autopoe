import { useAccess } from "@/context/useAccess";
import { fetchSettingsBootstrap, saveSettings } from "@/lib/api";
import {
  buildAccessCodeUpdatePayload,
  buildSettingsAutoSavePayload,
  findProviderById,
  findRoleByName,
  getActiveProviderModels,
  getEffectiveContextWindowTokens,
  getEffectiveModelCapabilities,
  getKnownSafeInputTokens,
  getSelectedCatalogModel,
  validateAutoSaveSettings,
  type SettingsAutoSaveKey,
  type SettingsSaveState,
  type UserSettings,
} from "@/pages/settings/lib";
import { toast } from "sonner";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
export type CommitSettingsChange = (
  saveKey: SettingsAutoSaveKey,
  updater: (settings: UserSettings) => UserSettings,
) => Promise<void>;
export type SaveSettingsChange = (
  saveKey: SettingsAutoSaveKey,
  nextSettings: UserSettings,
) => Promise<void>;

const DEFAULT_SAVE_STATE: SettingsSaveState = { status: "idle" };

function getSaveErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Failed to save changes";
}

export function useSettingsPageState() {
  const { requireReauth } = useAccess();
  const {
    data: bootstrapData,
    isLoading: loading,
    mutate: mutateSettings,
  } = useSWR("settingsBootstrap", () => fetchSettingsBootstrap<UserSettings>());

  const [localSettings, setLocalSettings] = useState<UserSettings | null>(null);
  const savedSettingsRef = useRef<UserSettings | null>(null);
  const [saveStates, setSaveStates] = useState<
    Partial<Record<SettingsAutoSaveKey | "access", SettingsSaveState>>
  >({});
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
      savedSettingsRef.current = bootstrapData.settings;
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

  const setSaveState = useCallback(
    (saveKey: SettingsAutoSaveKey | "access", state: SettingsSaveState) => {
      setSaveStates((current) => ({
        ...current,
        [saveKey]: state,
      }));
    },
    [],
  );

  const saveSettingsChange = useCallback<SaveSettingsChange>(
    async (saveKey, nextSettings) => {
      const validationError = validateAutoSaveSettings(
        saveKey,
        nextSettings,
        knownSafeInputTokens,
      );
      if (validationError) {
        setSaveState(saveKey, { status: "error", message: validationError });
        return;
      }

      setSaveState(saveKey, { status: "saving" });
      try {
        const payload = buildSettingsAutoSavePayload(saveKey, nextSettings);
        const saveResult = await saveSettings<UserSettings>(payload);
        const savedSettings = saveResult.settings;

        savedSettingsRef.current = savedSettings;
        setLocalSettings(savedSettings);
        void mutateSettings(
          (current) =>
            current ? { ...current, settings: savedSettings } : current,
          false,
        );
        setSaveState(saveKey, { status: "saved", message: "Saved" });
      } catch (error) {
        const message = getSaveErrorMessage(error);
        setLocalSettings(savedSettingsRef.current);
        setSaveState(saveKey, { status: "error", message });
        toast.error(message);
      }
    },
    [knownSafeInputTokens, mutateSettings, setSaveState],
  );

  const commitSettingsChange = useCallback<CommitSettingsChange>(
    async (saveKey, updater) => {
      if (!settings) {
        return;
      }
      const nextSettings = updater(settings);
      setLocalSettings(nextSettings);
      await saveSettingsChange(saveKey, nextSettings);
    },
    [saveSettingsChange, settings],
  );

  const handleAccessCodeUpdate = useCallback(async () => {
    if (accessDraftError) {
      setSaveState("access", {
        status: "error",
        message: accessDraftError,
      });
      toast.error(accessDraftError);
      return;
    }
    if (!accessDraft.newCode.trim() || !accessDraft.confirmCode.trim()) {
      return;
    }

    setSaveState("access", { status: "saving" });
    try {
      const payload = buildAccessCodeUpdatePayload(accessDraft);
      const saveResult = await saveSettings<UserSettings>(payload);
      const savedSettings = saveResult.settings;

      savedSettingsRef.current = savedSettings;
      setLocalSettings(savedSettings);
      setAccessDraft({ newCode: "", confirmCode: "" });
      void mutateSettings(
        (current) =>
          current ? { ...current, settings: savedSettings } : current,
        false,
      );

      if (saveResult.reauthRequired) {
        setSaveState("access", { status: "saved", message: "Updated" });
        toast.success("Access code updated. Sign in again with the new code.");
        requireReauth();
        return;
      }

      setSaveState("access", { status: "saved", message: "Updated" });
    } catch (error) {
      const message = getSaveErrorMessage(error);
      setSaveState("access", { status: "error", message });
      toast.error(message);
    }
  }, [
    accessDraft,
    accessDraftError,
    mutateSettings,
    requireReauth,
    setSaveState,
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
    handleAccessCodeUpdate,
    knownSafeInputTokens,
    leaderRole,
    loading,
    providers,
    roles,
    saveSettingsChange,
    saveStateFor: (saveKey: SettingsAutoSaveKey | "access") =>
      saveStates[saveKey] ?? DEFAULT_SAVE_STATE,
    settings,
    commitSettingsChange,
    updateAccessDraft,
    updateSettings,
  };
}
