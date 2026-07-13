import { useCallback, useEffect, useRef, useState } from "react";

import { errorNotificationKeysFromState } from "@/app/api/mappers";
import { fetchAbout, fetchAppState } from "@/app/api/state-requests";
import type { ApiState } from "@/app/api/types";
import { telegramBotFromApi } from "@/features/channels/api/channel-mappers";
import type { TelegramBot } from "@/features/channels/model/channel-types";
import { mcpServerFromApi } from "@/features/mcp/api/mcp-mappers";
import type { McpServer } from "@/features/mcp/model/mcp-types";
import { writablePathFromApi } from "@/features/permissions/api/permission-mappers";
import type { WritablePath } from "@/features/permissions/model/permission-types";
import { providerFromApi } from "@/features/providers/api/provider-mappers";
import type { Provider } from "@/features/providers/model/provider-types";
import type { RuntimeSettings } from "@/features/settings/model/runtime-settings-types";
import type { Skill } from "@/features/skills/model/skill-types";
import { workflowFromApi } from "@/features/workflows/api/workflow-mappers";
import type { Workflow } from "@/features/workflows/model/workflow-types";

type LoadWorkspaceState = (
  state: ApiState,
  options?: { reconnectIfResponding?: boolean },
) => void;

type UseAppHydrationOptions = {
  loadWorkspaceState: LoadWorkspaceState;
  mcpServers: McpServer[];
  replaceMcpServers: (servers: McpServer[]) => void;
  replaceProviders: (providers: Provider[]) => void;
  replaceRuntimeSettings: (settings: RuntimeSettings) => void;
  replaceSkills: (skills: Skill[]) => void;
  replaceTelegramBot: (telegramBot: TelegramBot) => void;
  replaceWorkflows: (workflows: Workflow[]) => void;
  replaceWritablePaths: (writablePaths: WritablePath[]) => void;
  showError: (message: string) => void;
  skills: Skill[];
  telegramBot: TelegramBot;
};

export function useAppHydration({
  loadWorkspaceState,
  mcpServers,
  replaceMcpServers,
  replaceProviders,
  replaceRuntimeSettings,
  replaceSkills,
  replaceTelegramBot,
  replaceWorkflows,
  replaceWritablePaths,
  showError,
  skills,
  telegramBot,
}: UseAppHydrationOptions) {
  const [appVersion, setAppVersion] = useState("");
  const errorNotificationKeysRef = useRef<Set<string>>(new Set());
  const hasLoadedStateRef = useRef(false);

  useEffect(() => {
    const nextNotificationKeys = new Set<string>();

    const notifyOnce = (key: string, message: string) => {
      nextNotificationKeys.add(key);
      if (errorNotificationKeysRef.current.has(key)) {
        return;
      }
      showError(message);
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
  }, [mcpServers, showError, skills, telegramBot]);

  const applyLoadedState = useCallback(
    (state: ApiState) => {
      const loadedProviders = state.providers.map(providerFromApi);
      replaceProviders(loadedProviders);
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
      loadWorkspaceState(state, {
        reconnectIfResponding: !hasLoadedStateRef.current,
      });
      if (!hasLoadedStateRef.current) {
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
      loadWorkspaceState,
      replaceMcpServers,
      replaceProviders,
      replaceRuntimeSettings,
      replaceSkills,
      replaceTelegramBot,
      replaceWorkflows,
      replaceWritablePaths,
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
        return;
      }
    };

    void loadState();

    return () => {
      isMounted = false;
    };
  }, [refreshAppState]);

  return {
    appVersion,
    refreshAppState,
  };
}
