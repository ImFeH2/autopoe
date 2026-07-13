import type {
  ApiTelegramBot,
  ApiTelegramSession,
} from "@/features/channels/api/channel-api-types";
import {
  telegramBotFromApi,
  telegramBotToApi,
  telegramSessionFromApi,
} from "@/features/channels/api/channel-mappers";
import type { TelegramBot } from "@/features/channels/model/channel-types";

export const saveTelegramBotRequest = async (telegramBot: TelegramBot) => {
  const response = await fetch("/api/telegram-bot", {
    body: JSON.stringify(telegramBotToApi(telegramBot)),
    headers: { "Content-Type": "application/json" },
    method: "PUT",
  });

  if (!response.ok) {
    return null;
  }
  return telegramBotFromApi((await response.json()) as ApiTelegramBot);
};

export const approveTelegramSessionRequest = async (chatId: string) => {
  const response = await fetch("/api/telegram-bot/approve", {
    body: JSON.stringify({ chat_id: chatId }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });

  if (!response.ok) {
    return null;
  }
  return telegramSessionFromApi((await response.json()) as ApiTelegramSession);
};
