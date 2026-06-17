import { useCallback, useMemo, useState } from "react";

import { createEmptyTelegramBot } from "@/app/api/mappers";
import {
  approveTelegramSessionRequest,
  saveTelegramBotRequest,
} from "@/app/api/channel-requests";
import {
  addWritablePathRequest,
  removeWritablePathRequest,
} from "@/app/api/permission-requests";
import {
  reloadSkillsRequest,
  updateSkillEnabledRequest,
} from "@/app/api/skill-requests";
import type {
  Skill,
  TelegramBot,
  WritablePath,
} from "@/components/flowent/types";

export const useSetupSections = () => {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [activeSkillId, setActiveSkillId] = useState("");
  const [telegramBot, setTelegramBot] = useState<TelegramBot>(() =>
    createEmptyTelegramBot(),
  );
  const [writablePaths, setWritablePaths] = useState<WritablePath[]>([]);

  const activeSkill = useMemo(
    () => skills.find((skill) => skill.id === activeSkillId) ?? skills[0],
    [activeSkillId, skills],
  );

  const replaceSkills = useCallback((nextSkills: Skill[]) => {
    setSkills(nextSkills);
    setActiveSkillId(nextSkills[0]?.id ?? "");
  }, []);

  const selectSkill = useCallback((skill: Skill) => {
    setActiveSkillId(skill.id);
  }, []);

  const reloadSkills = useCallback(async () => {
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
  }, []);

  const toggleSkill = useCallback(async (skill: Skill, enabled: boolean) => {
    const updatedSkill = await updateSkillEnabledRequest(skill.id, enabled);

    if (updatedSkill) {
      setSkills((currentSkills) =>
        currentSkills.map((currentSkill) =>
          currentSkill.id === updatedSkill.id ? updatedSkill : currentSkill,
        ),
      );
    }
  }, []);

  const replaceTelegramBot = useCallback((nextTelegramBot: TelegramBot) => {
    setTelegramBot(nextTelegramBot);
  }, []);

  const updateTelegramBot = useCallback((updates: Partial<TelegramBot>) => {
    setTelegramBot((current) => ({ ...current, ...updates }));
  }, []);

  const saveTelegramBot = useCallback(async () => {
    const result = await saveTelegramBotRequest(telegramBot);
    if (result) {
      setTelegramBot(result);
    }
  }, [telegramBot]);

  const approveTelegramSession = useCallback(async (chatId: string) => {
    const result = await approveTelegramSessionRequest(chatId);

    if (result) {
      setTelegramBot((current) => ({
        ...current,
        sessions: current.sessions.map((session) =>
          session.chatId === result.chatId ? result : session,
        ),
      }));
    }
  }, []);

  const replaceWritablePaths = useCallback(
    (nextWritablePaths: WritablePath[]) => {
      setWritablePaths(nextWritablePaths);
    },
    [],
  );

  const removeWritablePath = useCallback(async (path: string) => {
    const nextWritablePaths = await removeWritablePathRequest(path);

    if (nextWritablePaths) {
      setWritablePaths(nextWritablePaths);
    }
  }, []);

  const addWritablePath = useCallback(async (path: string) => {
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
  }, []);

  return {
    activeSkill,
    addWritablePath,
    approveTelegramSession,
    reloadSkills,
    removeWritablePath,
    replaceSkills,
    replaceTelegramBot,
    replaceWritablePaths,
    saveTelegramBot,
    selectSkill,
    skills,
    telegramBot,
    toggleSkill,
    updateTelegramBot,
    writablePaths,
  };
};
