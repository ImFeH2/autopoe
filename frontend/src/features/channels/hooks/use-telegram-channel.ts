import { useCallback, useState } from "react";

import {
  approveTelegramSessionRequest,
  saveTelegramBotRequest,
} from "@/features/channels/api/channel-requests";
import { createEmptyTelegramBot } from "@/features/channels/api/channel-mappers";
import type { TelegramBot } from "@/features/channels/model/channel-types";

export const useTelegramChannel = () => {
  const [telegramBot, setTelegramBot] = useState<TelegramBot>(() =>
    createEmptyTelegramBot(),
  );

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

  return {
    approveTelegramSession,
    replaceTelegramBot,
    saveTelegramBot,
    telegramBot,
    updateTelegramBot,
  };
};
