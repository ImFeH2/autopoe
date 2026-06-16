import type { ApiTelegramBot, ApiTelegramSession } from "@/app/api-types";
import {
  telegramBotFromApi,
  telegramBotToApi,
  telegramSessionFromApi,
} from "@/app/api-mappers";
import type { TelegramBot } from "@/components/flowent/types";

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
