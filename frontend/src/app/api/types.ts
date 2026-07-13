import type { ApiTelegramBot } from "@/features/channels/api/channel-api-types";
import type { ApiMcpServer } from "@/features/mcp/api/mcp-api-types";
import type { ApiWritablePath } from "@/features/permissions/api/permission-api-types";
import type { ApiProvider } from "@/features/providers/api/provider-api-types";
import type { ReasoningEffort } from "@/features/settings/model/runtime-settings-types";
import type { ApiSkill } from "@/features/skills/api/skill-api-types";
import type { ApiWorkflow } from "@/features/workflows/api/workflow-api-types";
import type { ContextUsageInfo } from "@/features/workspace/model/context-usage-types";
import type { Message } from "@/features/workspace/model/message-types";

export type ApiMessage = Message;

export type ApiState = {
  is_responding?: boolean;
  is_compacting?: boolean;
  mcp_servers?: ApiMcpServer[];
  messages: ApiMessage[];
  providers: ApiProvider[];
  settings: {
    agent_prompt?: string;
    context_window_limit?: number | null;
    reasoning_effort?: ReasoningEffort;
    selected_model: string;
    selected_provider_id: string;
  };
  skills?: ApiSkill[];
  telegram_bot?: ApiTelegramBot;
  usage_info?: ContextUsageInfo | null;
  response_event_index?: number;
  writable_paths?: ApiWritablePath[];
  workflows?: ApiWorkflow[];
};

export type ApiAbout = {
  version?: string;
};

export type WorkspaceMessageEditResponse = {
  is_responding?: boolean;
  messages: ApiMessage[];
};
