import type {
  ApiTelegramBot,
  ApiTelegramBotSaveRequest,
  ApiTelegramSession,
} from "@/features/channels/api/channel-api-types";
import type {
  TelegramBot,
  TelegramSession,
} from "@/features/channels/model/channel-types";

export const telegramSessionFromApi = (
  session: ApiTelegramSession,
): TelegramSession => ({
  chatId: session.chat_id,
  displayName: session.display_name,
  recentMessage: session.recent_message,
  status: session.status,
  updatedAt: session.updated_at ?? 0,
  userId: session.user_id,
  username: session.username,
});

export const createEmptyTelegramBot = (): TelegramBot => ({
  botSecret: "",
  enabled: false,
  error: "",
  hasBotSecret: false,
  sessions: [],
  status: "disabled",
});

export const telegramBotFromApi = (
  telegramBot?: ApiTelegramBot,
): TelegramBot => ({
  botSecret: "",
  enabled: telegramBot?.enabled ?? false,
  error: telegramBot?.error ?? "",
  hasBotSecret: telegramBot?.has_bot_token ?? false,
  sessions: (telegramBot?.sessions ?? []).map(telegramSessionFromApi),
  status: telegramBot?.status ?? "disabled",
});

export const telegramBotToApi = (
  telegramBot: TelegramBot,
): ApiTelegramBotSaveRequest => ({
  enabled: telegramBot.enabled,
  ...(telegramBot.botSecret ? { bot_token: telegramBot.botSecret } : {}),
});
