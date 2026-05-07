import {
  memo,
  type ReactNode,
  type RefObject,
  type UIEventHandler,
  useState,
} from "react";
import {
  AlertCircle,
  Brain,
  ChevronRight,
  LoaderCircle,
  MessageSquare,
  RotateCcw,
  Send,
  Sparkles,
  Wrench,
} from "lucide-react";
import { CopyButton } from "@/components/CopyButton";
import {
  RichContentBlock,
  type AssistantRunningHintState,
} from "@/components/assistant/shared";
import { Button } from "@/components/ui/button";
import { contentPartsToText, normalizeContentParts } from "@/lib/contentParts";
import { formatJsonOutput } from "@/lib/formatJsonOutput";
import { getNodeLabel } from "@/lib/nodeLabel";
import { cn } from "@/lib/utils";
import type {
  AssistantChatItem,
  ContentPart,
  HistoryEntry,
  Node,
} from "@/types";

interface AssistantChatMessagesProps {
  allowHumanMessageRetry?: boolean;
  bottomInset?: number;
  emptyDescription?: string;
  scrollRef: RefObject<HTMLDivElement | null>;
  items: AssistantChatItem[];
  nodes?: Map<string, Node>;
  onRetryHumanMessage?: (messageId: string) => void;
  onScroll: UIEventHandler<HTMLDivElement>;
  retryImageInputEnabled?: boolean;
  retryingMessageId?: string | null;
  runningHint?: AssistantRunningHintState | null;
}

export const AssistantChatMessages = memo(function AssistantChatMessages({
  allowHumanMessageRetry = true,
  bottomInset = 0,
  emptyDescription = "Ask the Assistant to plan tasks, summarize progress, or coordinate next steps.",
  scrollRef,
  items,
  nodes,
  onRetryHumanMessage,
  onScroll,
  retryImageInputEnabled = true,
  retryingMessageId = null,
  runningHint = null,
}: AssistantChatMessagesProps) {
  const baseBottomPadding = 14;
  const visibleItems = items.filter(
    (item) => item.type !== "SystemEntry" && item.type !== "StateEntry",
  );

  return (
    <div
      ref={scrollRef}
      onScroll={onScroll}
      style={{
        paddingBottom: `${baseBottomPadding + bottomInset}px`,
        scrollPaddingBottom: `${baseBottomPadding + bottomInset}px`,
      }}
      className="flex-1 overflow-y-auto px-3 pt-3"
    >
      <div className="mx-auto w-full max-w-3xl space-y-2.5">
        {visibleItems.length === 0 && !runningHint ? (
          <WorkspaceEmptyState description={emptyDescription} />
        ) : null}

        {visibleItems.map((item, index) => (
          <div
            key={getTimelineItemKey(item, index)}
            className="[content-visibility:auto] [contain-intrinsic-size:auto_100px]"
          >
            <TimelineItem
              allowHumanMessageRetry={allowHumanMessageRetry}
              item={item}
              nodes={nodes}
              onRetryHumanMessage={onRetryHumanMessage}
              retryImageInputEnabled={retryImageInputEnabled}
              retryingMessageId={retryingMessageId}
            />
          </div>
        ))}

        {runningHint ? (
          <div>
            <AssistantRunningHint
              label={runningHint.label}
              toolName={runningHint.toolName}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
});

function AssistantRunningHint({
  label,
  toolName,
}: {
  label: string;
  toolName?: string | null;
}) {
  return (
    <div className="flex min-w-0 items-center">
      <div className="inline-flex max-w-full items-center gap-2 rounded-full border border-border bg-accent/25 px-3 py-1.5 text-[11px] text-muted-foreground/82">
        <span className="flex items-center gap-1.5">
          {[0, 1, 2].map((index) => (
            <span
              key={index}
              className="size-1.5 animate-pulse rounded-full bg-muted-foreground/80"
              style={{ animationDelay: `${index * 140}ms` }}
            />
          ))}
        </span>
        <span>{label}</span>
        {toolName ? (
          <span className="truncate rounded-full border border-border bg-background/40 px-2 py-0.5 font-mono text-[10px] text-foreground/80">
            {toolName}
          </span>
        ) : null}
      </div>
    </div>
  );
}

const TimelineItem = memo(function TimelineItem({
  allowHumanMessageRetry,
  item,
  nodes,
  onRetryHumanMessage,
  retryImageInputEnabled,
  retryingMessageId,
}: {
  allowHumanMessageRetry?: boolean;
  item: AssistantChatItem;
  nodes?: Map<string, Node>;
  onRetryHumanMessage?: (messageId: string) => void;
  retryImageInputEnabled?: boolean;
  retryingMessageId?: string | null;
}) {
  if (item.type === "PendingHumanMessage") {
    return (
      <HumanBubble
        content={item.content}
        parts={item.parts}
        retrying={false}
        pending
      />
    );
  }

  switch (item.type) {
    case "ReceivedMessage":
      if (normalizeContentParts(item.parts, item.content).length === 0) {
        return null;
      }
      if (item.from_id === "human") {
        const messageParts = normalizeContentParts(item.parts, item.content);
        const retryBlocked =
          messageParts.some((part) => part.type === "image") &&
          !retryImageInputEnabled;
        return (
          <HumanBubble
            allowRetry={allowHumanMessageRetry}
            content={contentPartsToText(item.parts, item.content)}
            retryDisabled={retryBlocked}
            retryDisabledReason={
              retryBlocked
                ? "Current model does not support image input"
                : undefined
            }
            messageId={item.message_id ?? null}
            onRetry={
              item.message_id && onRetryHumanMessage && !retryBlocked
                ? () => onRetryHumanMessage(item.message_id as string)
                : undefined
            }
            parts={item.parts}
            retrying={retryingMessageId === item.message_id}
          />
        );
      }
      return (
        <MessageActivityCard
          content={contentPartsToText(item.parts, item.content)}
          parts={item.parts}
          icon={<MessageSquare className="size-3.5 text-foreground/68" />}
          label={`From ${getNodeLabel(item.from_id ?? "", nodes)}`}
          tone="received"
          streaming={item.streaming}
        />
      );
    case "AssistantText":
      if (normalizeContentParts(item.parts, item.content).length === 0) {
        return null;
      }
      return (
        <AssistantBubble
          content={contentPartsToText(item.parts, item.content)}
          parts={item.parts}
          streaming={item.streaming}
        />
      );
    case "SentMessage":
      if (normalizeContentParts(item.parts, item.content).length === 0) {
        return null;
      }
      return (
        <MessageActivityCard
          content={contentPartsToText(item.parts, item.content)}
          parts={item.parts}
          icon={<Send className="size-3.5 text-foreground/58" />}
          label={`To ${
            (item.to_id
              ? [item.to_id]
              : (item.to_ids ?? []).filter((id): id is string => Boolean(id))
            )
              .map((id) => getNodeLabel(id, nodes))
              .join(", ") || "Unknown"
          }`}
          tone="sent"
          streaming={item.streaming}
        />
      );
    case "AssistantThinking":
      return (
        <ThinkingCard
          item={item as HistoryEntry & { type: "AssistantThinking" }}
        />
      );
    case "ToolCall":
      return (
        <ToolCallCard item={item as HistoryEntry & { type: "ToolCall" }} />
      );
    case "CommandResultEntry":
      return (
        <CommandResultCard
          item={item as HistoryEntry & { type: "CommandResultEntry" }}
        />
      );
    case "ErrorEntry":
      return <ErrorCard content={item.content ?? ""} />;
    default:
      return null;
  }
});

function HumanBubble({
  allowRetry = true,
  content,
  messageId,
  onRetry,
  parts,
  retryDisabled,
  retryDisabledReason,
  retrying,
  pending = false,
}: {
  allowRetry?: boolean;
  content: string;
  messageId?: string | null;
  onRetry?: () => void;
  parts?: ContentPart[] | null;
  retryDisabled?: boolean;
  retryDisabledReason?: string;
  retrying?: boolean;
  pending?: boolean;
}) {
  const showRetry =
    allowRetry &&
    !pending &&
    Boolean(messageId) &&
    (Boolean(onRetry) || retryDisabled);

  return (
    <div className="group mt-2 flex min-w-0 flex-col items-end">
      <div
        className={cn(
          "min-w-0 overflow-hidden px-2.5 py-1.5 text-[13px] [overflow-wrap:anywhere]",
          "max-w-[84%] rounded-lg border border-border bg-accent/80 text-accent-foreground",
          pending && "opacity-80",
        )}
      >
        <div className="flex min-w-0 flex-col gap-2">
          <RichContentBlock
            content={content}
            layout="human-attachments-top"
            parts={parts}
            markdownClassName="text-sm text-accent-foreground"
            preClassName="text-accent-foreground/90"
          />
          {pending ? (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-accent/70 px-2 py-0.5 text-[10px] font-medium text-accent-foreground">
              <LoaderCircle className="size-3 animate-spin" />
              Sending
            </span>
          ) : null}
        </div>
      </div>
      <div className="mt-1 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
        <CopyButton text={content} />
        {showRetry ? (
          <Button
            type="button"
            variant="ghost"
            size="xs"
            onClick={onRetry}
            disabled={retrying || retryDisabled}
            title={retryDisabledReason}
            className={cn(
              "h-auto rounded-full border border-border px-2.5 py-1 text-[11px] text-muted-foreground hover:bg-accent/45 hover:text-foreground disabled:opacity-45",
              "bg-accent/35",
            )}
          >
            {retrying ? (
              <LoaderCircle className="size-3 animate-spin" />
            ) : (
              <RotateCcw className="size-3" />
            )}
            <span>{retrying ? "Retrying..." : "Retry"}</span>
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function AssistantBubble({
  content,
  parts,
  streaming,
}: {
  content: string;
  parts?: ContentPart[] | null;
  streaming?: boolean;
}) {
  return (
    <div className="group min-w-0 w-full">
      <RichContentBlock
        content={content}
        parts={parts}
        streaming={streaming}
        markdownClassName="text-sm text-foreground"
        preClassName="text-foreground/90"
      />
      <div className="mt-1 opacity-0 transition-opacity group-hover:opacity-100">
        <CopyButton text={content} />
      </div>
    </div>
  );
}

function MessageActivityCard({
  content,
  parts,
  icon,
  label,
  tone,
  streaming,
}: {
  content: string;
  parts?: ContentPart[] | null;
  icon: ReactNode;
  label: string;
  tone: "received" | "sent";
  streaming?: boolean;
}) {
  const [open, setOpen] = useState(Boolean(streaming));

  return (
    <div
      className={cn(
        "min-w-0 w-full px-2 py-1.5",
        "border-l border-border pl-3",
        tone === "received" && "border-border bg-accent/20",
        tone === "sent" && "border-border bg-background/24",
      )}
    >
      <div className="flex w-full items-center gap-2 text-left">
        <Button
          type="button"
          variant="ghost"
          aria-expanded={open}
          onClick={() => setOpen((current) => !current)}
          className="h-auto min-w-0 flex-1 justify-start gap-2 rounded-md bg-transparent px-0 py-0 text-left text-inherit shadow-none hover:bg-transparent hover:text-inherit focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <span className="flex size-5 shrink-0 translate-y-px items-center justify-center text-current">
            {icon}
          </span>
          <span className="min-w-0 flex-1 truncate text-[11px] font-semibold leading-none text-foreground/88">
            {label}
          </span>
          {streaming ? (
            <span className="inline-flex size-5 items-center justify-center">
              <span className="relative flex size-2.5 items-center justify-center">
                <span className="absolute inline-flex size-2.5 animate-ping rounded-full bg-ring/28" />
                <span className="relative inline-flex size-2 rounded-full bg-ring/82" />
              </span>
              <span className="sr-only">Live</span>
            </span>
          ) : null}
          <ChevronRight
            className={cn(
              "size-4 shrink-0 text-muted-foreground transition-transform",
              open && "rotate-90",
            )}
          />
        </Button>
        <span className="shrink-0">
          <CopyButton text={content} />
        </span>
      </div>
      {open ? (
        <div className="mt-2 min-w-0">
          <RichContentBlock
            content={content}
            parts={parts}
            streaming={streaming}
            markdownClassName="text-[12px] text-foreground/78"
            preClassName="text-foreground/74"
          />
        </div>
      ) : null}
    </div>
  );
}

function ThinkingCard({
  item,
}: {
  item: HistoryEntry & { type: "AssistantThinking" };
}) {
  return (
    <ActivityDisclosure
      label="Thinking"
      icon={<Brain className="size-3.5 text-foreground/72" />}
      streaming={item.streaming}
      defaultOpen={item.streaming ?? false}
    >
      <RichContentBlock
        content={item.content}
        streaming={item.streaming}
        markdownClassName="text-[13px] text-foreground/80"
        preClassName="text-foreground/75"
      />
    </ActivityDisclosure>
  );
}

function ToolCallCard({ item }: { item: HistoryEntry & { type: "ToolCall" } }) {
  const isIdleTool = item.tool_name === "idle";
  const displayStreaming = Boolean(item.streaming) && !isIdleTool;
  const formattedArguments = formatJsonOutput(item.arguments) ?? "";
  const formattedResult = formatJsonOutput(item.result);

  return (
    <ActivityDisclosure
      label={formatToolLabel(item.tool_name)}
      icon={<Wrench className="size-3.5 text-muted-foreground" />}
      streaming={displayStreaming}
      defaultOpen={displayStreaming}
    >
      <div className="space-y-4">
        <div className="space-y-1.5">
          <div className="text-[10px] font-medium text-muted-foreground/80">
            Arguments
          </div>
          <pre className="select-text whitespace-pre-wrap break-words rounded-xl border border-border bg-background/40 px-3.5 py-3 text-[11px] font-mono leading-relaxed text-foreground/78">
            {formattedArguments}
          </pre>
        </div>
        {item.result || !isIdleTool ? (
          <div className="space-y-1.5">
            <div className="text-[10px] font-medium text-muted-foreground/80">
              Result
            </div>
            {item.result ? (
              <RichContentBlock
                content={formattedResult ?? item.result}
                streaming={displayStreaming}
                markdownClassName="text-[12px] leading-relaxed text-foreground/80"
                preClassName="text-foreground/74"
              />
            ) : (
              <div className="rounded-xl border border-border bg-accent/15 px-3.5 py-3 text-[12px] italic text-muted-foreground">
                {displayStreaming ? "Running..." : "No result"}
              </div>
            )}
          </div>
        ) : null}
      </div>
    </ActivityDisclosure>
  );
}

function CommandResultCard({
  item,
}: {
  item: HistoryEntry & { type: "CommandResultEntry" };
}) {
  return (
    <div className="min-w-0 w-full space-y-3 border-l border-graph-status-running/30 bg-graph-status-running/[0.08] px-3 py-2.5">
      <div className="flex items-center gap-2">
        <Sparkles className="size-4 text-graph-status-running" />
        <span className="text-[11px] font-medium text-graph-status-running/90">
          Command Result
        </span>
        {item.command_name ? (
          <span className="rounded-full border border-graph-status-running/14 bg-background/35 px-2 py-0.5 font-mono text-[10px] text-graph-status-running/80">
            {item.command_name}
          </span>
        ) : null}
        <span className="ml-auto">
          <CopyButton
            text={item.content ?? ""}
            className="text-graph-status-running/72 hover:bg-graph-status-running/[0.1] hover:text-graph-status-running"
            iconClassName="text-current"
            copiedClassName="text-graph-status-running"
          />
        </span>
      </div>
      <RichContentBlock
        content={item.content}
        markdownClassName="text-[13px] text-foreground"
        preClassName="text-foreground/90"
      />
    </div>
  );
}

function ErrorCard({ content }: { content: string }) {
  return (
    <div className="min-w-0 w-full space-y-3 border-l-2 border-graph-status-error/40 bg-graph-status-error/[0.1] px-3 py-2.5">
      <div className="flex items-center gap-2">
        <AlertCircle className="size-4 text-graph-status-error" />
        <span className="text-[11px] font-medium text-graph-status-error">
          Error
        </span>
        <span className="ml-auto">
          <CopyButton
            text={content}
            className="text-graph-status-error/72 hover:bg-graph-status-error/[0.1] hover:text-graph-status-error"
            iconClassName="text-current"
            copiedClassName="text-graph-status-error"
          />
        </span>
      </div>
      <p className="select-text whitespace-pre-wrap break-words text-[13px] leading-relaxed text-graph-status-error/82">
        {content}
      </p>
    </div>
  );
}

function ActivityDisclosure({
  label,
  icon,
  streaming,
  defaultOpen,
  children,
}: {
  label: string;
  icon: ReactNode;
  streaming?: boolean;
  defaultOpen: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="min-w-0 w-full border-l border-border py-1.5 pl-3 transition-all duration-300">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => setOpen((current) => !current)}
        className="h-auto w-full justify-start gap-2 px-0 py-0 text-left hover:bg-transparent hover:text-inherit"
      >
        <span className="flex size-5 shrink-0 translate-y-px items-center justify-center text-muted-foreground">
          {icon}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[11px] font-medium text-muted-foreground">
            {label}
          </span>
        </span>
        {streaming ? (
          <span className="ml-auto inline-flex size-5 items-center justify-center">
            <span className="relative flex size-2.5 items-center justify-center">
              <span className="absolute inline-flex size-2.5 animate-ping rounded-full bg-ring/30" />
              <span className="relative inline-flex size-2 rounded-full bg-ring/82" />
            </span>
            <span className="sr-only">Live</span>
          </span>
        ) : null}
        <ChevronRight
          className={cn(
            "size-3.5 shrink-0 text-muted-foreground/70 transition-transform duration-200",
            open && "rotate-90",
          )}
        />
      </Button>

      {open ? <div className="mt-3 min-w-0">{children}</div> : null}
    </div>
  );
}

function formatToolLabel(value: string | null | undefined) {
  if (!value) {
    return "Tool Call";
  }

  return value
    .split("_")
    .map((segment) =>
      segment.length > 0
        ? `${segment[0].toUpperCase()}${segment.slice(1)}`
        : segment,
    )
    .join(" ");
}

function getTimelineItemKey(item: AssistantChatItem, index: number) {
  if (item.type === "PendingHumanMessage") {
    return item.id;
  }

  return `${item.type}-${item.timestamp}-${item.message_id ?? ""}-${item.tool_call_id ?? ""}-${index}`;
}

function WorkspaceEmptyState({ description }: { description: string }) {
  return (
    <div className="flex h-full items-center justify-center px-4">
      <div className="max-w-[220px] space-y-3 text-center">
        <div className="mx-auto flex size-11 items-center justify-center">
          <MessageSquare className="size-5 text-primary" />
        </div>
        <div className="space-y-1">
          <p className="text-sm font-medium">Start a conversation</p>
          <p className="text-[11px] text-muted-foreground">{description}</p>
        </div>
      </div>
    </div>
  );
}
