import type {
  TelegramBot,
  TelegramSession,
} from "@/features/channels/model/channel-types";

export type ApiTelegramSession = {
  chat_id: string;
  display_name: string;
  recent_message: string;
  status: TelegramSession["status"];
  updated_at?: number;
  user_id: string;
  username: string;
};

export type ApiTelegramBot = {
  enabled: boolean;
  error?: string;
  has_bot_token: boolean;
  sessions?: ApiTelegramSession[];
  status?: TelegramBot["status"];
};

export type ApiTelegramBotSaveRequest = {
  bot_token?: string;
  enabled: boolean;
};
