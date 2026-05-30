import { Check, MessageCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  dashedPanelClassName,
  dataRowClassName,
  dataRowLabelClassName,
  emptyStateClassName,
  fieldInputClassName,
  fieldLabelClassName,
  fieldTriggerClassName,
  formActionsClassName,
  mutedTextClassName,
  stableScrollbarClassName,
  subtleButtonClassName,
} from "@/components/flowent/styles";
import type { TelegramBot, TelegramSession } from "@/components/flowent/types";
import { cn } from "@/lib/utils";

export function ChannelsView({
  onApproveSession,
  onSaveTelegramBot,
  onUpdateTelegramBot,
  telegramBot,
}: {
  onApproveSession: (chatId: string) => void;
  onSaveTelegramBot: () => void;
  onUpdateTelegramBot: (updates: Partial<TelegramBot>) => void;
  telegramBot: TelegramBot;
}) {
  const pendingSessions = telegramBot.sessions.filter(
    (session) => session.status === "pending",
  );
  const approvedSessions = telegramBot.sessions.filter(
    (session) => session.status === "approved",
  );

  return (
    <section className="grid h-full min-h-0 bg-black" aria-label="Channels">
      <form
        className={cn(
          "grid min-h-0 w-full content-start gap-7 overflow-auto px-12 py-8 max-[900px]:px-5 max-[900px]:py-5",
          stableScrollbarClassName,
        )}
        aria-label="Telegram Bot"
        onSubmit={(event) => {
          event.preventDefault();
          onSaveTelegramBot();
        }}
      >
        <section className="grid gap-3">
          <h3 className="text-base font-semibold text-white">Telegram Bot</h3>
          <div className={dashedPanelClassName}>
            <div className={dataRowClassName}>
              <Label
                className={cn(fieldLabelClassName, dataRowLabelClassName)}
                htmlFor="telegram-status"
              >
                Status
              </Label>
              <div
                className={cn(
                  "text-[13px] leading-5 text-white",
                  mutedTextClassName,
                )}
                id="telegram-status"
              >
                {telegramStatusLabel(telegramBot.status)}
              </div>
            </div>
            <div className={dataRowClassName}>
              <Label
                className={cn(fieldLabelClassName, dataRowLabelClassName)}
                htmlFor="telegram-enabled"
              >
                Enabled
              </Label>
              <Select
                value={telegramBot.enabled ? "true" : "false"}
                onValueChange={(value) =>
                  onUpdateTelegramBot({ enabled: value === "true" })
                }
              >
                <SelectTrigger
                  className={fieldTriggerClassName}
                  id="telegram-enabled"
                  aria-label="Enabled"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="false">Off</SelectItem>
                  <SelectItem value="true">On</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className={dataRowClassName}>
              <Label
                className={cn(fieldLabelClassName, dataRowLabelClassName)}
                htmlFor="telegram-bot-secret"
              >
                Bot secret
              </Label>
              <Input
                className={fieldInputClassName}
                id="telegram-bot-secret"
                onChange={(event) =>
                  onUpdateTelegramBot({ botSecret: event.target.value })
                }
                type="password"
                value={telegramBot.botSecret}
              />
            </div>
          </div>
          {telegramBot.error ? (
            <p className="m-0 text-xs leading-[1.4] text-destructive">
              {telegramBot.error}
            </p>
          ) : null}
          <div className={cn(formActionsClassName, "mt-0")}>
            <Button type="submit">Save</Button>
          </div>
        </section>

        <ConversationList
          emptyText="No requests"
          onApproveSession={onApproveSession}
          sessions={pendingSessions}
          title="Pending"
        />
        <ConversationList
          emptyText="No conversations"
          sessions={approvedSessions}
          title="Approved"
        />
      </form>
    </section>
  );
}

function ConversationList({
  emptyText,
  onApproveSession,
  sessions,
  title,
}: {
  emptyText: string;
  onApproveSession?: (chatId: string) => void;
  sessions: TelegramSession[];
  title: string;
}) {
  return (
    <section className="grid gap-3">
      <h3 className="text-base font-semibold text-white">{title}</h3>
      {sessions.length === 0 ? (
        <p className={emptyStateClassName}>{emptyText}</p>
      ) : (
        <div className={dashedPanelClassName}>
          {sessions.map((session) => (
            <ConversationRow
              key={session.chatId}
              onApproveSession={onApproveSession}
              session={session}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function ConversationRow({
  onApproveSession,
  session,
}: {
  onApproveSession?: (chatId: string) => void;
  session: TelegramSession;
}) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 border-b border-white/10 px-3 py-3 last:border-b-0 max-[640px]:grid-cols-1">
      <div className="grid min-w-0 gap-1">
        <div className="flex min-w-0 items-center gap-2 text-sm font-medium text-white">
          <MessageCircle className="size-4 shrink-0 text-[#9b9b9b]" />
          <span className="truncate">{sessionTitle(session)}</span>
        </div>
        <p className={cn("m-0 text-xs leading-[1.4]", mutedTextClassName)}>
          Chat {session.chatId}
          {session.userId ? ` · User ${session.userId}` : ""}
          {session.username ? ` · @${session.username}` : ""}
        </p>
        {session.recentMessage ? (
          <p className="m-0 max-w-3xl truncate text-[13px] leading-[1.45] text-white">
            {session.recentMessage}
          </p>
        ) : null}
      </div>
      {session.status === "pending" && onApproveSession ? (
        <Button
          className={cn(subtleButtonClassName, "shrink-0")}
          onClick={() => onApproveSession(session.chatId)}
          size="sm"
          type="button"
          variant="outline"
        >
          <Check aria-hidden="true" />
          Approve
        </Button>
      ) : (
        <span
          className={cn(
            "flex h-8 items-center text-xs leading-none",
            mutedTextClassName,
          )}
        >
          Approved
        </span>
      )}
    </div>
  );
}

function sessionTitle(session: TelegramSession): string {
  if (session.displayName) {
    return session.displayName;
  }
  if (session.username) {
    return `@${session.username}`;
  }
  return session.chatId;
}

function telegramStatusLabel(status: TelegramBot["status"]): string {
  if (status === "running") {
    return "Running";
  }
  if (status === "starting") {
    return "Starting";
  }
  if (status === "error") {
    return "Error";
  }
  return "Disabled";
}
