import { useMemo, useState } from "react";
import useSWR from "swr";
import { Check, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  approveTelegramChat,
  deletePendingTelegramChat,
  deleteTelegramChat,
  fetchTelegramSettings,
  updateTelegramSettings,
} from "@/lib/api";
import { SecretInput } from "@/components/form/FormControls";
import {
  PageScaffold,
  PageTitleBar,
  SoftPanel,
} from "@/components/layout/PageScaffold";
import { PageLoadingState } from "@/components/layout/PageLoadingState";
import { Button } from "@/components/ui/button";
import { PanelCard, StatusChip } from "@/components/ui/surface";
import { formatLocalTimestamp } from "@/lib/datetime";
import type {
  TelegramApprovedChat,
  TelegramPendingChat,
  TelegramSettings,
} from "@/types";

function formatTimestamp(timestampSeconds: number): string {
  return timestampSeconds
    ? formatLocalTimestamp(timestampSeconds, {
        fallback: "—",
        unit: "seconds",
      })
    : "—";
}

function getChatLabel(
  chat: TelegramPendingChat | TelegramApprovedChat,
): string {
  if (chat.display_name.trim()) {
    return chat.display_name.trim();
  }
  if (chat.username?.trim()) {
    return `@${chat.username.trim()}`;
  }
  return "Unknown chat";
}

export function ChannelsPage() {
  const {
    data: settings,
    isLoading: loading,
    mutate,
  } = useSWR("telegramSettings", fetchTelegramSettings);

  const [saving, setSaving] = useState(false);
  const [tokenInput, setTokenInput] = useState("");
  const [tokenDirty, setTokenDirty] = useState(false);

  const configured = useMemo(
    () => Boolean(settings?.bot_token),
    [settings?.bot_token],
  );

  const handleSave = async () => {
    if (!settings) {
      return;
    }

    setSaving(true);
    try {
      const payload: Partial<Pick<TelegramSettings, "bot_token">> = {};
      if (tokenDirty) {
        payload.bot_token = tokenInput.trim();
      }

      const result = await updateTelegramSettings(payload);
      void mutate(result.telegram, false);
      setTokenInput("");
      setTokenDirty(false);
      toast.success("Telegram settings saved");
    } catch {
      toast.error("Failed to save Telegram settings");
    } finally {
      setSaving(false);
    }
  };

  const handleApprove = async (chatId: number) => {
    try {
      const result = await approveTelegramChat(chatId);
      void mutate(result.telegram, false);
      toast.success("Telegram chat approved");
    } catch {
      toast.error("Failed to approve Telegram chat");
    }
  };

  const handleReject = async (chatId: number) => {
    try {
      const result = await deletePendingTelegramChat(chatId);
      void mutate(result.telegram, false);
      toast.success("Pending Telegram chat removed");
    } catch {
      toast.error("Failed to remove pending Telegram chat");
    }
  };

  const handleRevoke = async (chatId: number) => {
    try {
      const result = await deleteTelegramChat(chatId);
      void mutate(result.telegram, false);
      toast.success("Approved Telegram chat removed");
    } catch {
      toast.error("Failed to remove approved Telegram chat");
    }
  };

  if (loading || !settings) {
    return (
      <PageLoadingState
        label="Loading channels..."
        textClassName="text-[13px]"
      />
    );
  }

  return (
    <PageScaffold>
      <div className="h-full min-h-0 overflow-y-auto pr-2 scrollbar-none pt-6">
        <div className="mx-auto max-w-[680px] pb-10">
          <PageTitleBar title="Channels" />
          <SoftPanel className="mt-6 space-y-8">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-medium text-foreground">
                  Telegram
                </h2>
              </div>
              <StatusChip tone={configured ? "running" : "idle"}>
                {configured ? "Configured" : "Not configured"}
              </StatusChip>
            </div>

            <section>
              <div className="flex flex-wrap items-center gap-3">
                <label className="text-[13px] font-medium text-foreground/80">
                  Bot Token
                </label>
                <span className="text-[11px] text-muted-foreground">
                  Leave empty to keep the current token
                </span>
              </div>
              <div className="mt-3">
                <SecretInput
                  value={tokenInput}
                  onChange={(event) => {
                    setTokenInput(event.target.value);
                    setTokenDirty(true);
                  }}
                  placeholder={settings.bot_token || "Enter Telegram bot token"}
                  mono
                  showLabel="Show Telegram bot token"
                  hideLabel="Hide Telegram bot token"
                />
              </div>
            </section>

            <section className="border-t border-border pt-8">
              <div className="flex flex-wrap items-center gap-3">
                <label className="text-[13px] font-medium text-foreground/80">
                  Pending Private Chats
                </label>
                <StatusChip tone="muted" className="px-2 py-0.5">
                  {settings.pending_chats.length} waiting
                </StatusChip>
              </div>
              {settings.pending_chats.length === 0 ? (
                <p className="mt-4 text-[13px] text-muted-foreground">
                  No pending chats.
                </p>
              ) : (
                <div className="mt-4 space-y-2">
                  {settings.pending_chats.map((chat) => (
                    <PanelCard
                      as="div"
                      key={chat.chat_id}
                      padding="sm"
                      className="px-4 py-3.5 transition-colors hover:bg-accent/20"
                    >
                      <div className="flex items-center justify-between gap-4">
                        <div className="min-w-0">
                          <p className="text-[13px] font-medium text-foreground">
                            {getChatLabel(chat)}
                          </p>
                          <div className="mt-1 flex items-center gap-3 text-[11px] text-muted-foreground">
                            <span className="font-mono">
                              ID: {chat.chat_id}
                            </span>
                            {chat.username ? (
                              <span>@{chat.username}</span>
                            ) : null}
                            <span>
                              First seen: {formatTimestamp(chat.first_seen_at)}
                            </span>
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-1.5">
                          <Button
                            type="button"
                            variant="outline"
                            size="xs"
                            onClick={() => void handleApprove(chat.chat_id)}
                            className="border-border bg-accent/20 text-foreground hover:bg-accent/35"
                          >
                            <Check className="size-3.5" />
                            Approve
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-xs"
                            onClick={() => void handleReject(chat.chat_id)}
                            className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                          >
                            <Trash2 className="size-3.5" />
                          </Button>
                        </div>
                      </div>
                    </PanelCard>
                  ))}
                </div>
              )}
            </section>

            <section className="border-t border-border pt-8">
              <div className="flex flex-wrap items-center gap-3">
                <label className="text-[13px] font-medium text-foreground/80">
                  Approved Private Chats
                </label>
                <StatusChip tone="muted" className="px-2 py-0.5">
                  {settings.approved_chats.length} active
                </StatusChip>
              </div>
              {settings.approved_chats.length === 0 ? (
                <p className="mt-4 text-[13px] text-muted-foreground">
                  No approved chats yet.
                </p>
              ) : (
                <div className="mt-4 space-y-2">
                  {settings.approved_chats.map((chat) => (
                    <PanelCard
                      as="div"
                      key={chat.chat_id}
                      padding="sm"
                      className="group px-4 py-3.5 transition-colors hover:bg-accent/20"
                    >
                      <div className="flex items-center justify-between gap-4">
                        <div className="min-w-0">
                          <p className="text-[13px] font-medium text-foreground">
                            {getChatLabel(chat)}
                          </p>
                          <div className="mt-1 flex items-center gap-3 text-[11px] text-muted-foreground">
                            <span className="font-mono">
                              ID: {chat.chat_id}
                            </span>
                            {chat.username ? (
                              <span>@{chat.username}</span>
                            ) : null}
                            <span>
                              Approved: {formatTimestamp(chat.approved_at)}
                            </span>
                          </div>
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-xs"
                          onClick={() => void handleRevoke(chat.chat_id)}
                          className="shrink-0 text-muted-foreground opacity-0 transition-all hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100 focus:opacity-100"
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </div>
                    </PanelCard>
                  ))}
                </div>
              )}
            </section>

            <div className="flex justify-end border-t border-border pt-6">
              <Button
                type="button"
                size="sm"
                onClick={() => void handleSave()}
                disabled={saving}
                className="text-[13px]"
              >
                <Save className="size-4" />
                {saving ? "Saving..." : "Save Changes"}
              </Button>
            </div>
          </SoftPanel>
        </div>
      </div>
    </PageScaffold>
  );
}
