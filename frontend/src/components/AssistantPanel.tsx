import { useState } from "react";
import { toast } from "sonner";
import {
  AssistantChatComposer,
  AssistantChatMessages,
} from "@/components/AssistantChatContent";
import { Button } from "@/components/ui/button";
import { useAgentNodesRuntime } from "@/context/AgentContext";
import { useMeasuredHeight } from "@/hooks/useMeasuredHeight";
import { useAssistantChat } from "@/hooks/useAssistantChat";
import { cn } from "@/lib/utils";

interface AssistantPanelProps {
  onOpenDetails?: () => void;
}

export function AssistantPanel({ onOpenDetails }: AssistantPanelProps) {
  const { agents } = useAgentNodesRuntime();
  const [stopping, setStopping] = useState(false);
  const { height: composerHeight, ref: composerRef } =
    useMeasuredHeight<HTMLDivElement>();
  const {
    addImages = async () => {},
    assistantActivity = { running: false, runningHint: null },
    clearChat,
    clearing = false,
    connected,
    draftImages = [],
    handleKeyDown,
    hasUploadingImages = false,
    input,
    isBrowsingInputHistory,
    navigateInputHistory,
    onMessagesScroll,
    removeImage = () => {},
    retryMessage,
    retryingMessageId,
    scrollRef,
    sending,
    sendMessage,
    setInput,
    stopAssistant,
    supportsInputImage = false,
    timelineItems,
  } = useAssistantChat({ bottomInset: composerHeight });
  const assistantRoleName =
    Array.from(agents.values()).find((agent) => agent.node_type === "assistant")
      ?.role_name ?? null;

  return (
    <div
      className={cn(
        "relative flex h-full flex-col overflow-hidden bg-surface-overlay text-foreground",
      )}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{ background: "var(--shell-surface-sweep)" }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-px"
        style={{ background: "var(--shell-hairline)" }}
      />
      <div
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute inset-0 z-20 border transition-[opacity,border-color,box-shadow] duration-300",
          assistantActivity.running
            ? "animate-pulse shadow-lg shadow-ring/5"
            : "opacity-0",
          assistantActivity.running &&
            "border-ring/25 opacity-100 shadow-ring/10",
        )}
      />
      <PanelHeader
        connected={connected}
        onClearChat={() => void clearChat()}
        onOpenDetails={onOpenDetails}
        roleName={assistantRoleName}
        clearing={clearing}
      />
      <div className="relative flex min-h-0 flex-1 flex-col">
        <AssistantChatMessages
          allowHumanMessageRetry
          bottomInset={composerHeight}
          items={timelineItems}
          nodes={agents}
          onRetryHumanMessage={(messageId) => void retryMessage(messageId)}
          onScroll={onMessagesScroll}
          retryImageInputEnabled={supportsInputImage}
          retryingMessageId={retryingMessageId}
          runningHint={assistantActivity.runningHint}
          scrollRef={scrollRef}
        />
        <div
          ref={composerRef}
          style={{
            paddingBottom: "calc(10px + env(safe-area-inset-bottom, 0px))",
          }}
          className="pointer-events-none absolute inset-x-0 bottom-0 z-10 bg-gradient-to-b from-transparent via-background/70 to-background/95 px-2.5 pt-8"
        >
          <div className="mx-auto w-full max-w-3xl">
            <AssistantChatComposer
              busy={assistantActivity.running}
              disabled={
                (!input.trim() && draftImages.length === 0) ||
                hasUploadingImages ||
                sending
              }
              commandsEnabled
              images={draftImages}
              imageInputEnabled={supportsInputImage}
              input={input}
              onAddImages={(files) => void addImages(files)}
              onChange={setInput}
              onNavigateHistory={navigateInputHistory}
              onKeyDown={handleKeyDown}
              onRemoveImage={removeImage}
              onSend={() => void sendMessage()}
              onStop={() => {
                setStopping(true);
                void stopAssistant()
                  .catch((error) => {
                    toast.error(
                      error instanceof Error
                        ? error.message
                        : "Failed to stop Assistant",
                    );
                  })
                  .finally(() => {
                    setStopping(false);
                  });
              }}
              overlay
              stopping={stopping}
              suppressCommandNavigation={isBrowsingInputHistory}
              targetLabel="Assistant"
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function PanelHeader({
  clearing,
  connected,
  onClearChat,
  onOpenDetails,
  roleName,
}: {
  clearing: boolean;
  connected: boolean;
  onClearChat: () => void;
  onOpenDetails?: () => void;
  roleName?: string | null;
}) {
  return (
    <div className="relative z-10 flex flex-wrap items-center gap-2.5 border-b border-border px-3.5 py-2.5">
      <div className="flex min-w-[220px] flex-1 items-center gap-2">
        <div className="shrink-0 text-[14px] font-semibold leading-6 text-foreground">
          Assistant
        </div>
        {roleName ? (
          <span className="min-w-0 truncate rounded-full border border-border bg-accent/35 px-2 py-0.5 text-[10px] font-medium leading-4 text-muted-foreground/78">
            Role: {roleName}
          </span>
        ) : null}
        <StatusBadge connected={connected} />
      </div>
      <div className="flex items-center gap-1.5">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={clearing}
          onClick={onClearChat}
        >
          {clearing ? "Clearing..." : "Clear Chat"}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={!onOpenDetails}
          onClick={onOpenDetails}
        >
          Assistant Details
        </Button>
      </div>
    </div>
  );
}

function StatusBadge({ connected }: { connected: boolean }) {
  return (
    <span
      className={cn(
        "rounded-full border px-2.5 py-0.5 text-[9px] font-medium transition-colors",
        connected
          ? "border-graph-status-running/18 bg-graph-status-running/[0.12] text-graph-status-running"
          : "border-graph-status-idle/18 bg-graph-status-idle/[0.12] text-graph-status-idle",
      )}
    >
      {connected ? "Online" : "Connecting..."}
    </span>
  );
}
