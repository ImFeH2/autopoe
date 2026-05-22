import { Plus } from "lucide-react";

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
  navigationLabelClassName,
  stableScrollbarClassName,
} from "@/components/flowent/styles";
import type { Channel } from "@/components/flowent/types";
import { cn } from "@/lib/utils";

export function ChannelsView({
  activeChannel,
  isCreatingChannel,
  onChannelSelect,
  onNewChannel,
  onSaveChannel,
  onUpdateChannel,
  channels,
}: {
  activeChannel: Channel;
  isCreatingChannel: boolean;
  onChannelSelect: (channel: Channel) => void;
  onNewChannel: () => void;
  onSaveChannel: () => void;
  onUpdateChannel: (updates: Partial<Channel>) => void;
  channels: Channel[];
}) {
  return (
    <section
      className="grid h-full min-h-0 bg-black max-[900px]:h-auto max-[900px]:min-h-[calc(100vh-126px)]"
      aria-label="Channels"
    >
      <div className="grid h-full min-h-0 grid-cols-[260px_minmax(0,1fr)] max-[900px]:h-auto max-[900px]:grid-cols-1">
        <ChannelSidebar
          activeChannel={activeChannel}
          channels={channels}
          isCreatingChannel={isCreatingChannel}
          onChannelSelect={onChannelSelect}
          onNewChannel={onNewChannel}
        />
        <ChannelDetails
          activeChannel={activeChannel}
          onSaveChannel={onSaveChannel}
          onUpdateChannel={onUpdateChannel}
        />
      </div>
    </section>
  );
}

function ChannelSidebar({
  activeChannel,
  channels,
  isCreatingChannel,
  onChannelSelect,
  onNewChannel,
}: {
  activeChannel: Channel;
  channels: Channel[];
  isCreatingChannel: boolean;
  onChannelSelect: (channel: Channel) => void;
  onNewChannel: () => void;
}) {
  return (
    <aside
      className={cn(
        "flex min-h-0 min-w-0 flex-col overflow-auto border-r border-white/10 bg-black p-4 max-[900px]:max-h-64 max-[900px]:border-r-0 max-[900px]:border-b",
        stableScrollbarClassName,
      )}
      aria-label="Channel list"
    >
      <Button
        aria-pressed={isCreatingChannel}
        className="h-8 w-full border-dashed border-white/20 bg-input/30 text-xs text-white shadow-none hover:bg-input/50"
        onClick={onNewChannel}
        size="sm"
        type="button"
        variant="outline"
      >
        <Plus aria-hidden="true" />
        New
      </Button>
      <div className="mt-4 -mx-2.5 grid gap-0">
        {channels.length === 0 ? (
          <p className={emptyStateClassName}>No channels</p>
        ) : null}
        {channels.map((channel) => {
          const isActive =
            !isCreatingChannel && activeChannel.id === channel.id;

          return (
            <Button
              aria-label={channel.name}
              aria-pressed={isActive}
              className={cn(
                "grid h-9 w-full cursor-pointer grid-cols-[minmax(0,1fr)_auto] justify-start gap-2 rounded-[10px] border border-transparent bg-transparent px-2.5 py-1.5 text-left text-white shadow-none transition-colors duration-100 hover:bg-[#171717]",
                navigationLabelClassName,
                isActive && "bg-[#2f2f2f]",
              )}
              key={channel.id}
              onClick={() => onChannelSelect(channel)}
              size="sm"
              type="button"
              variant="ghost"
            >
              <span className="overflow-hidden text-ellipsis whitespace-nowrap">
                {channel.name}
              </span>
              <span className="text-xs text-[#9b9b9b]">
                {channelStatusLabel(channel.status)}
              </span>
            </Button>
          );
        })}
      </div>
    </aside>
  );
}

function ChannelDetails({
  activeChannel,
  onSaveChannel,
  onUpdateChannel,
}: {
  activeChannel: Channel;
  onSaveChannel: () => void;
  onUpdateChannel: (updates: Partial<Channel>) => void;
}) {
  return (
    <form
      className={cn(
        "grid min-h-0 w-full content-start gap-7 overflow-auto px-12 py-8 max-[900px]:overflow-visible max-[900px]:px-5 max-[900px]:py-5",
        stableScrollbarClassName,
      )}
      aria-label="Channel details"
      onSubmit={(event) => {
        event.preventDefault();
        onSaveChannel();
      }}
    >
      <section className="grid gap-3">
        <h3 className="text-base font-semibold text-white">Details</h3>
        <div className={dashedPanelClassName}>
          <ChannelFields
            activeChannel={activeChannel}
            onUpdateChannel={onUpdateChannel}
          />
        </div>
      </section>
      {activeChannel.error ? (
        <p className="m-0 text-xs leading-[1.4] text-destructive">
          {activeChannel.error}
        </p>
      ) : null}
      <div className={cn(formActionsClassName, "mt-0")}>
        <Button type="submit">Save</Button>
      </div>
    </form>
  );
}

function ChannelFields({
  activeChannel,
  onUpdateChannel,
}: {
  activeChannel: Channel;
  onUpdateChannel: (updates: Partial<Channel>) => void;
}) {
  return (
    <>
      <div className={dataRowClassName}>
        <Label
          className={cn(fieldLabelClassName, dataRowLabelClassName)}
          htmlFor="channel-name"
        >
          Channel name
        </Label>
        <Input
          className={fieldInputClassName}
          id="channel-name"
          onChange={(event) => onUpdateChannel({ name: event.target.value })}
          value={activeChannel.name}
        />
      </div>
      <div className={dataRowClassName}>
        <Label
          className={cn(fieldLabelClassName, dataRowLabelClassName)}
          htmlFor="channel-type"
        >
          Channel type
        </Label>
        <Select
          value={activeChannel.type}
          onValueChange={(value) =>
            onUpdateChannel({ type: value as Channel["type"] })
          }
        >
          <SelectTrigger
            className={fieldTriggerClassName}
            id="channel-type"
            aria-label="Channel type"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="telegram_bot">Telegram Bot</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className={dataRowClassName}>
        <Label
          className={cn(fieldLabelClassName, dataRowLabelClassName)}
          htmlFor="channel-status"
        >
          Status
        </Label>
        <div
          className={cn("text-[13px] leading-5 text-white", mutedTextClassName)}
          id="channel-status"
        >
          {channelStatusLabel(activeChannel.status)}
        </div>
      </div>
      <div className={dataRowClassName}>
        <Label
          className={cn(fieldLabelClassName, dataRowLabelClassName)}
          htmlFor="channel-enabled"
        >
          Enabled
        </Label>
        <Select
          value={activeChannel.enabled ? "true" : "false"}
          onValueChange={(value) =>
            onUpdateChannel({ enabled: value === "true" })
          }
        >
          <SelectTrigger
            className={fieldTriggerClassName}
            id="channel-enabled"
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
          htmlFor="channel-bot-token"
        >
          Bot secret
        </Label>
        <Input
          className={fieldInputClassName}
          id="channel-bot-token"
          onChange={(event) =>
            onUpdateChannel({ botToken: event.target.value })
          }
          type="password"
          value={activeChannel.botToken}
        />
      </div>
      <div className={dataRowClassName}>
        <Label
          className={cn(fieldLabelClassName, dataRowLabelClassName)}
          htmlFor="channel-allowed-users"
        >
          Allowed users
        </Label>
        <Input
          className={fieldInputClassName}
          id="channel-allowed-users"
          onChange={(event) =>
            onUpdateChannel({
              allowedUserIds: splitListValue(event.target.value),
            })
          }
          value={activeChannel.allowedUserIds.join(", ")}
        />
      </div>
      <div className={dataRowClassName}>
        <Label
          className={cn(fieldLabelClassName, dataRowLabelClassName)}
          htmlFor="channel-allowed-chats"
        >
          Allowed chats
        </Label>
        <Input
          className={fieldInputClassName}
          id="channel-allowed-chats"
          onChange={(event) =>
            onUpdateChannel({
              allowedChatIds: splitListValue(event.target.value),
            })
          }
          value={activeChannel.allowedChatIds.join(", ")}
        />
      </div>
      <div className={dataRowClassName}>
        <Label
          className={cn(fieldLabelClassName, dataRowLabelClassName)}
          htmlFor="channel-pairing-code"
        >
          Pairing
        </Label>
        <Input
          className={fieldInputClassName}
          id="channel-pairing-code"
          onChange={(event) =>
            onUpdateChannel({ pairingCode: event.target.value })
          }
          value={activeChannel.pairingCode}
        />
      </div>
    </>
  );
}

function splitListValue(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function channelStatusLabel(status: Channel["status"]): string {
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
