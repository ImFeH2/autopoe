export type TelegramBotStatus = "disabled" | "error" | "running" | "starting";

export type TelegramSessionStatus = "approved" | "pending";

export type TelegramSession = {
  chatId: string;
  displayName: string;
  recentMessage: string;
  status: TelegramSessionStatus;
  updatedAt: number;
  userId: string;
  username: string;
};

export type TelegramBot = {
  botSecret: string;
  enabled: boolean;
  error: string;
  hasBotSecret: boolean;
  sessions: TelegramSession[];
  status: TelegramBotStatus;
};
