import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { TooltipProvider } from "@/components/ui/tooltip";
import type {
  WorkspaceCommand,
  WorkspaceCommandId,
} from "@/features/workspace/model/command-types";
import type { ContextUsageInfo } from "@/features/workspace/model/context-usage-types";
import type {
  Message,
  MessageActionRequest,
  MessageErrorRetryRequest,
} from "@/features/workspace/model/message-types";
import { ChatComposer } from "@/components/flowent/workspace/chat-composer";
import { latestPlanFromMessages } from "@/components/flowent/workspace/plan-state";
import { WorkspaceMessageList } from "@/components/flowent/workspace/workspace-message-list";
import type { Skill } from "@/features/skills/model/skill-types";

export function WorkspaceView({
  commands,
  contextWindowLimit,
  draft,
  isRefiningContext,
  isResponding,
  messages,
  usageInfo,
  onCommand,
  onCommandError,
  onDraftChange,
  onEditMessage,
  onRetryError,
  onRetryMessage,
  onSendMessage,
  onStopResponse,
  skills,
}: {
  commands: WorkspaceCommand[];
  contextWindowLimit: number | null;
  draft: string;
  isRefiningContext: boolean;
  isResponding: boolean;
  messages: Message[];
  usageInfo: ContextUsageInfo | null;
  onCommand: (commandId: WorkspaceCommandId) => boolean;
  onCommandError: (message: string) => void;
  onDraftChange: (value: string) => void;
  onEditMessage: (request: MessageActionRequest) => void;
  onRetryError: (request: MessageErrorRetryRequest) => void;
  onRetryMessage: (messageId: string) => void;
  onSendMessage: (content: string) => void;
  onStopResponse: () => void;
  skills: Skill[];
}) {
  const { t } = useTranslation();
  const [composerOffset, setComposerOffset] = useState(112);
  const plan = useMemo(() => latestPlanFromMessages(messages), [messages]);

  return (
    <section
      className="h-full min-h-0 bg-black"
      aria-label={t("workspace.pageLabel")}
    >
      <TooltipProvider delayDuration={500}>
        <div className="relative h-full min-h-0 min-w-0 overflow-hidden">
          <ChatComposer
            commands={commands}
            contextWindowLimit={contextWindowLimit}
            draft={draft}
            isRefiningContext={isRefiningContext}
            isSending={isResponding}
            messages={messages}
            plan={plan}
            usageInfo={usageInfo}
            onCommand={onCommand}
            onCommandError={onCommandError}
            onDraftChange={onDraftChange}
            onSendMessage={onSendMessage}
            onStopResponse={onStopResponse}
            onOffsetChange={setComposerOffset}
            skills={skills}
          />
          <WorkspaceMessageList
            composerOffset={composerOffset}
            isResponding={isResponding}
            messages={messages}
            onEditMessage={onEditMessage}
            onRetryError={onRetryError}
            onRetryMessage={onRetryMessage}
          />
        </div>
      </TooltipProvider>
    </section>
  );
}
