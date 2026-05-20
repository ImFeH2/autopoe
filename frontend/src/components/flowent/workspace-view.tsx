import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUp,
  Check,
  Circle,
  Search,
  Terminal,
  Trash2,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { MarkdownMessage } from "@/components/flowent/markdown-message";
import type {
  AssistantOutputGroup,
  AssistantOutputItem,
  Message,
  ToolItem,
} from "@/components/flowent/types";
import { cn } from "@/lib/utils";

export function WorkspaceView({
  draft,
  errorMessage,
  isResponding,
  messages,
  onClearMessages,
  onDraftChange,
  onSendMessage,
}: {
  draft: string;
  errorMessage: string;
  isResponding: boolean;
  messages: Message[];
  onClearMessages: () => void;
  onDraftChange: (value: string) => void;
  onSendMessage: () => void;
}) {
  const [composerOffset, setComposerOffset] = useState(112);

  return (
    <section
      className="h-full min-h-0 bg-black max-[900px]:h-[calc(100vh-126px)] max-[900px]:min-h-[calc(100vh-126px)]"
      aria-label="Workspace"
    >
      <div className="relative h-full min-h-0 min-w-0 overflow-hidden">
        <WorkspaceControls onClearMessages={onClearMessages} />
        <MessageList
          composerOffset={composerOffset}
          isResponding={isResponding}
          messages={messages}
        />
        <ChatComposer
          draft={draft}
          errorMessage={errorMessage}
          isSending={isResponding}
          onDraftChange={onDraftChange}
          onSendMessage={onSendMessage}
          onOffsetChange={setComposerOffset}
        />
      </div>
    </section>
  );
}

function WorkspaceControls({
  onClearMessages,
}: {
  onClearMessages: () => void;
}) {
  return (
    <div
      aria-label="Workspace controls"
      className="pointer-events-none absolute right-6 top-5 z-20 flex items-center gap-1 max-[900px]:right-4 max-[900px]:top-4"
    >
      <Button
        className="pointer-events-auto h-8 rounded-lg border-white/10 bg-input/30 px-2.5 text-[13px] text-white shadow-[0_12px_28px_rgba(0,0,0,0.32)] hover:bg-input/50 hover:text-white"
        onClick={onClearMessages}
        type="button"
        variant="outline"
      >
        <Trash2 aria-hidden="true" className="size-3.5" />
        Clear
      </Button>
    </div>
  );
}

function MessageList({
  composerOffset,
  isResponding,
  messages,
}: {
  composerOffset: number;
  isResponding: boolean;
  messages: Message[];
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const shouldFollowRef = useRef(true);
  const scrollMarkerRef = useRef<HTMLDivElement>(null);
  const displayMessages = useMemo(() => {
    if (!isResponding || messages.at(-1)?.author === "assistant") {
      return messages;
    }
    return [
      ...messages,
      {
        author: "assistant" as const,
        content: "",
        id: "assistant-pending",
      },
    ];
  }, [isResponding, messages]);
  const streamingMessageId =
    isResponding && messages.at(-1)?.author === "assistant"
      ? messages.at(-1)?.id
      : "";

  useEffect(() => {
    if (!shouldFollowRef.current) {
      return;
    }
    scrollMarkerRef.current?.scrollIntoView({
      block: "end",
      behavior: "smooth",
    });
  }, [displayMessages]);

  const updateFollowState = () => {
    const list = listRef.current;
    if (!list) {
      return;
    }
    const distanceFromBottom =
      list.scrollHeight - list.scrollTop - list.clientHeight;
    shouldFollowRef.current = distanceFromBottom < 96;
  };

  return (
    <div
      aria-live="polite"
      className="absolute inset-0 flex min-h-0 flex-col overflow-auto bg-black px-6 pt-12 max-[900px]:px-4"
      onScroll={updateFollowState}
      ref={listRef}
      style={{
        paddingBottom: composerOffset,
        scrollPaddingBottom: composerOffset,
      }}
    >
      {displayMessages.length === 0 ? (
        <div className="mx-auto grid min-h-full w-full max-w-[640px] place-items-center pb-24">
          <h1 className="m-0 text-center text-[28px] font-medium leading-[1.2] text-white max-[560px]:text-2xl">
            Where should we begin?
          </h1>
        </div>
      ) : null}
      {displayMessages.map((message) => (
        <MessageRow
          key={message.id}
          isStreaming={
            isResponding &&
            message.id === streamingMessageId &&
            message.author === "assistant" &&
            message.isStreamingText === true
          }
          isPending={
            message.id === "assistant-pending" ||
            (isResponding &&
              message.author === "assistant" &&
              message.id === streamingMessageId &&
              message.isStreamingText !== true)
          }
          message={message}
        />
      ))}
      <div aria-hidden="true" ref={scrollMarkerRef} />
    </div>
  );
}

function MessageRow({
  isPending,
  isStreaming,
  message,
}: {
  isPending: boolean;
  isStreaming: boolean;
  message: Message;
}) {
  const assistantGroups =
    message.author === "assistant" ? assistantOutputGroups(message) : [];
  const isWaiting = isPending && assistantGroups.length === 0;
  const shouldShowWaitingAfterOutput =
    isPending && assistantGroups.length > 0 && !isStreaming;

  return (
    <article
      className={cn(
        "flowent-message-row mx-auto flex w-full max-w-[640px] py-3",
        message.author === "user" ? "justify-end" : "justify-start",
      )}
    >
      <div
        className={cn(
          "min-w-0 text-base leading-6 text-white",
          message.author === "user"
            ? "flowent-user-message-bubble max-w-[70%] rounded-[22px] px-4 py-2.5"
            : "w-full max-w-full",
        )}
      >
        {isWaiting ? (
          <AssistantWaitingIndicator />
        ) : (
          <AssistantMessageContent
            assistantGroups={assistantGroups}
            isStreaming={isStreaming}
            message={message}
            showWaitingAfterOutput={shouldShowWaitingAfterOutput}
          />
        )}
      </div>
    </article>
  );
}

function assistantOutputGroups(message: Message): AssistantOutputGroup[] {
  if (message.groups?.length) {
    return message.groups.filter((group) => group.items.length > 0);
  }

  if (message.items?.length) {
    return [
      {
        id: `${message.id}-items`,
        items: message.items,
      },
    ];
  }

  const toolItems: AssistantOutputItem[] = (message.tools ?? []).map(
    (tool) => ({
      id: `tool-${tool.id}`,
      tool,
      type: "tool",
    }),
  );
  const groups: AssistantOutputGroup[] = [];

  if (toolItems.length) {
    groups.push({
      id: `${message.id}-tools`,
      items: toolItems,
    });
  }

  if (message.content) {
    groups.push({
      id: `${message.id}-content`,
      items: [
        {
          content: message.content,
          id: `${message.id}-content`,
          type: "text",
        },
      ],
    });
  }

  return groups;
}

function AssistantMessageContent({
  assistantGroups,
  isStreaming,
  message,
  showWaitingAfterOutput,
}: {
  assistantGroups: AssistantOutputGroup[];
  isStreaming: boolean;
  message: Message;
  showWaitingAfterOutput: boolean;
}) {
  if (message.author === "assistant") {
    return (
      <div className="flowent-markdown-message min-w-0 break-words">
        <AssistantOutputTimeline
          groups={assistantGroups}
          isStreaming={isStreaming}
          showWaitingAfterOutput={showWaitingAfterOutput}
        />
      </div>
    );
  }

  return (
    <div className="flowent-markdown-message min-w-0 break-words">
      <p className="m-0 whitespace-pre-wrap break-words">{message.content}</p>
    </div>
  );
}

function AssistantOutputTimeline({
  groups,
  isStreaming,
  showWaitingAfterOutput,
}: {
  groups: AssistantOutputGroup[];
  isStreaming: boolean;
  showWaitingAfterOutput: boolean;
}) {
  const lastTextItemId = groups
    .flatMap((group) => group.items)
    .reverse()
    .find((item) => item.type === "text")?.id;

  return (
    <div className="flex min-w-0 flex-col" aria-label="Assistant response">
      {groups.map((group, index) => (
        <Fragment key={group.id}>
          {index > 0 ? <AssistantOutputSeparator /> : null}
          <div className="flex min-w-0 flex-col gap-1.5">
            {group.items.map((item) =>
              item.type === "tool" ? (
                <ToolProcessItem key={item.id} tool={item.tool} />
              ) : (
                <MarkdownMessage
                  key={item.id}
                  content={item.content}
                  isStreaming={isStreaming && item.id === lastTextItemId}
                />
              ),
            )}
          </div>
        </Fragment>
      ))}
      {showWaitingAfterOutput ? (
        <div className="mt-3">
          <AssistantWaitingIndicator />
        </div>
      ) : null}
    </div>
  );
}

function AssistantOutputSeparator() {
  return (
    <div
      aria-hidden="true"
      className="my-3 h-px w-full bg-white/10"
      data-testid="assistant-output-separator"
    />
  );
}

function ToolProcessItem({ tool }: { tool: ToolItem }) {
  const statusLabel =
    tool.status === "running"
      ? "Running"
      : tool.status === "success"
        ? "Done"
        : "Failed";

  return (
    <div className="flex max-w-full items-center gap-2 rounded-lg border border-white/10 bg-input/30 px-2.5 py-1.5 text-sm leading-5 text-white">
      <ToolProcessIcon tool={tool} />
      <span className="min-w-0 flex-1 truncate">{tool.title}</span>
      <span className="shrink-0 text-xs text-white/55">{statusLabel}</span>
    </div>
  );
}

function ToolProcessIcon({ tool }: { tool: ToolItem }) {
  const className = cn(
    "size-3.5 shrink-0",
    tool.status === "failed" ? "text-red-300" : "text-white/80",
    tool.status === "running" ? "animate-pulse" : "",
  );

  if (tool.status === "success") {
    return <Check aria-hidden="true" className={className} />;
  }
  if (tool.status === "failed") {
    return <X aria-hidden="true" className={className} />;
  }
  if (tool.name === "web_search" || tool.name === "grep_files") {
    return <Search aria-hidden="true" className={className} />;
  }
  if (tool.name === "shell_command") {
    return <Terminal aria-hidden="true" className={className} />;
  }
  return <Circle aria-hidden="true" className={className} />;
}

function AssistantWaitingIndicator() {
  return (
    <div
      aria-label="Thinking"
      className="flex h-6 items-center gap-1.5"
      role="status"
    >
      <span className="flowent-thinking-dot" />
      <span className="flowent-thinking-dot" />
      <span className="flowent-thinking-dot" />
    </div>
  );
}

function ChatComposer({
  draft,
  errorMessage,
  isSending,
  onDraftChange,
  onOffsetChange,
  onSendMessage,
}: {
  draft: string;
  errorMessage: string;
  isSending: boolean;
  onDraftChange: (value: string) => void;
  onOffsetChange: (value: number) => void;
  onSendMessage: () => void;
}) {
  const composerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const composer = composerRef.current;
    if (!composer) {
      return;
    }

    const updateOffset = () => {
      const measuredBottomOffset = Number.parseFloat(
        getComputedStyle(composer).bottom,
      );
      const bottomOffset = Number.isFinite(measuredBottomOffset)
        ? measuredBottomOffset
        : 0;

      onOffsetChange(composer.offsetHeight + bottomOffset + 24);
    };

    updateOffset();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", updateOffset);

      return () => window.removeEventListener("resize", updateOffset);
    }

    const resizeObserver = new ResizeObserver(updateOffset);
    resizeObserver.observe(composer);

    return () => resizeObserver.disconnect();
  }, [onOffsetChange]);

  return (
    <div
      className="pointer-events-none absolute inset-x-0 bottom-6 z-10 px-6 max-[900px]:px-4"
      ref={composerRef}
    >
      <div className="pointer-events-auto mx-auto w-full max-w-[640px]">
        {errorMessage ? (
          <p className="mb-2 rounded-md bg-black/80 px-3 py-2 text-sm leading-5 text-red-300 shadow-[0_12px_32px_rgba(0,0,0,0.45)]">
            {errorMessage}
          </p>
        ) : null}
        <form
          className="grid min-h-14 w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-2 overflow-clip rounded-[28px] bg-[#212121] p-2.5 shadow-[0_16px_44px_rgba(0,0,0,0.42),inset_0_0_1px_rgba(255,255,255,0.22)] transition-colors"
          aria-label="Workspace composer"
          onSubmit={(event) => {
            event.preventDefault();
            onSendMessage();
          }}
        >
          <Textarea
            aria-label="Message Flowent"
            className="flowent-composer-textarea max-h-[216px] min-h-9 resize-none overflow-y-auto border-0 bg-transparent px-2 py-1.5 text-white shadow-none placeholder:text-[#9b9b9b] focus-visible:border-transparent focus-visible:ring-0 dark:bg-transparent"
            value={draft}
            onChange={(event) => onDraftChange(event.target.value)}
            onKeyDown={(event) => {
              if (
                event.key !== "Enter" ||
                event.shiftKey ||
                event.nativeEvent.isComposing
              ) {
                return;
              }

              event.preventDefault();
              onSendMessage();
            }}
            placeholder="Message Flowent"
          />
          <Button
            aria-label="Send message"
            className="size-9 rounded-full bg-white text-black shadow-none hover:bg-[#e5e5e5] disabled:bg-transparent disabled:text-white/35 disabled:opacity-100 [&_svg]:size-5"
            disabled={draft.length === 0 || isSending}
            size="icon-lg"
            type="submit"
          >
            <ArrowUp aria-hidden="true" />
          </Button>
        </form>
      </div>
    </div>
  );
}
