import { vi } from "vitest";

import {
  emptyTelegramBotState,
  selectedProviderState,
  type TestTelegramBot,
} from "@/test/app-fixtures";

type ChannelsAppHarnessOptions = {
  initialBot?: TestTelegramBot;
};

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status,
  });

const requestUrl = (input: RequestInfo | URL) => {
  if (typeof input === "string") {
    return input;
  }
  if (input instanceof URL) {
    return input.toString();
  }
  return input.url;
};

export const mockChannelsAppRequests = ({
  initialBot = emptyTelegramBotState(),
}: ChannelsAppHarnessOptions = {}) => {
  let telegramBot = initialBot;

  return vi.spyOn(window, "fetch").mockImplementation(async (input, init) => {
    const url = requestUrl(input);

    if (url === "/api/state") {
      return jsonResponse({
        ...selectedProviderState(),
        telegram_bot: telegramBot,
      });
    }

    if (url === "/api/about") {
      return jsonResponse({ version: "test" });
    }

    if (url === "/api/telegram-bot" && init?.method === "PUT") {
      const request = JSON.parse(String(init.body)) as {
        bot_token?: string;
        enabled: boolean;
      };
      telegramBot = {
        ...telegramBot,
        enabled: request.enabled,
        error: "",
        has_bot_token: Boolean(request.bot_token) || telegramBot.has_bot_token,
        status: request.enabled ? "running" : "disabled",
      };
      return jsonResponse(telegramBot);
    }

    if (url === "/api/telegram-bot/approve" && init?.method === "POST") {
      const request = JSON.parse(String(init.body)) as { chat_id: string };
      const session = telegramBot.sessions.find(
        (currentSession) => currentSession.chat_id === request.chat_id,
      );
      const approvedSession = {
        ...(session ?? {
          chat_id: request.chat_id,
          display_name: "",
          recent_message: "",
          updated_at: 0,
          user_id: "",
          username: "",
        }),
        status: "approved" as const,
      };
      telegramBot = {
        ...telegramBot,
        sessions: telegramBot.sessions.map((currentSession) =>
          currentSession.chat_id === approvedSession.chat_id
            ? approvedSession
            : currentSession,
        ),
      };
      return jsonResponse(approvedSession);
    }

    return jsonResponse({ detail: "Not found" }, 404);
  });
};
