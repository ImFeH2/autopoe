import type { TelegramBot } from "@/features/channels/model/channel-types";
import type { McpServer } from "@/features/mcp/model/mcp-types";
import type { Skill } from "@/features/skills/model/skill-types";
import type { ContextUsageInfo } from "@/features/workspace/model/context-usage-types";

export const errorNotificationKeysFromState = (
  telegramBot: TelegramBot,
  mcpServers: McpServer[],
  skills: Skill[],
) => {
  const keys: string[] = [];
  if (telegramBot.status === "error" && telegramBot.error) {
    keys.push(`channel:telegram:${telegramBot.error}`);
  }
  for (const server of mcpServers) {
    if (server.status === "error" && server.error) {
      keys.push(`mcp:${server.id}:${server.error}`);
    }
  }
  for (const skill of skills) {
    if (skill.enabled && skill.error) {
      keys.push(`skill:${skill.id}:${skill.error}`);
    }
  }
  return keys;
};

export const contextWindowFromLimit = (
  usageInfo: ContextUsageInfo | null,
  contextWindowLimit: number | null,
) => {
  if (usageInfo === null || contextWindowLimit === null) {
    return usageInfo;
  }
  return {
    ...usageInfo,
    model_context_window: contextWindowLimit,
  };
};
