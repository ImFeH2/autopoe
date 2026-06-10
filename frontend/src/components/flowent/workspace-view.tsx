import {
  Fragment,
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  Activity,
  ArrowUp,
  Check,
  ChevronRight,
  Circle,
  Copy,
  Pencil,
  RotateCcw,
  Save,
  SendHorizontal,
  Search,
  Sparkles,
  Square,
  Terminal,
  TriangleAlert,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { MarkdownMessage } from "@/components/flowent/markdown-message";
import { stableScrollbarClassName } from "@/components/flowent/styles";
import type {
  AssistantOutputGroup,
  AssistantOutputItem,
  ContextUsageInfo,
  Message,
  MessageActionRequest,
  Skill,
  ToolItem,
  WorkspaceCommand,
  WorkspaceCommandId,
} from "@/components/flowent/types";
import { cn } from "@/lib/utils";

export function WorkspaceView({
  commands,
  contextWindowLimit,
  draft,
  errorMessage,
  isRefiningContext,
  isResponding,
  messages,
  usageInfo,
  onCommand,
  onCommandError,
  onDraftChange,
  onEditMessage,
  onRetryMessage,
  onSendMessage,
  onStopResponse,
  skills,
}: {
  commands: WorkspaceCommand[];
  contextWindowLimit: number | null;
  draft: string;
  errorMessage: string;
  isRefiningContext: boolean;
  isResponding: boolean;
  messages: Message[];
  usageInfo: ContextUsageInfo | null;
  onCommand: (commandId: WorkspaceCommandId) => boolean;
  onCommandError: (message: string) => void;
  onDraftChange: (value: string) => void;
  onEditMessage: (request: MessageActionRequest) => void;
  onRetryMessage: (messageId: string) => void;
  onSendMessage: (content: string) => void;
  onStopResponse: () => void;
  skills: Skill[];
}) {
  const [composerOffset, setComposerOffset] = useState(112);
  const plan = useMemo(() => latestPlanFromMessages(messages), [messages]);

  return (
    <section className="h-full min-h-0 bg-black" aria-label="Workspace">
      <TooltipProvider delayDuration={500}>
        <div className="relative h-full min-h-0 min-w-0 overflow-hidden">
          <ChatComposer
            commands={commands}
            contextWindowLimit={contextWindowLimit}
            draft={draft}
            errorMessage={errorMessage}
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
          <MessageList
            composerOffset={composerOffset}
            isResponding={isResponding}
            messages={messages}
            onEditMessage={onEditMessage}
            onRetryMessage={onRetryMessage}
          />
        </div>
      </TooltipProvider>
    </section>
  );
}

function MessageList({
  composerOffset,
  isResponding,
  messages,
  onEditMessage,
  onRetryMessage,
}: {
  composerOffset: number;
  isResponding: boolean;
  messages: Message[];
  onEditMessage: (request: MessageActionRequest) => void;
  onRetryMessage: (messageId: string) => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const shouldFollowRef = useRef(true);
  const scrollMarkerRef = useRef<HTMLDivElement>(null);
  const latestMessage = messages.at(-1);
  const latestMessageAuthor = latestMessage?.author ?? "";
  const latestMessageId = latestMessage?.id ?? "";
  const lastMessageIdRef = useRef(latestMessageId);
  const displayMessages = useMemo(() => {
    if (!isResponding || latestMessageAuthor === "assistant") {
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
  }, [isResponding, latestMessageAuthor, messages]);
  const streamingMessageId =
    isResponding && latestMessageAuthor === "assistant" ? latestMessageId : "";

  useEffect(() => {
    if (latestMessageId !== lastMessageIdRef.current) {
      lastMessageIdRef.current = latestMessageId;

      if (latestMessageAuthor === "user") {
        shouldFollowRef.current = true;
      }
    }

    if (!shouldFollowRef.current) {
      return;
    }
    scrollMarkerRef.current?.scrollIntoView({
      block: "end",
      behavior: "smooth",
    });
  }, [displayMessages, latestMessageAuthor, latestMessageId]);

  const updateFollowState = () => {
    const list = listRef.current;
    if (!list) {
      return;
    }
    const distanceFromBottom =
      list.scrollHeight - list.scrollTop - list.clientHeight;
    shouldFollowRef.current = distanceFromBottom < 96;
  };
  const shortcutMessages = useMemo(
    () => conversationShortcutMessages(displayMessages),
    [displayMessages],
  );

  return (
    <>
      <div
        aria-label="Conversation messages"
        aria-live="polite"
        className={cn(
          "absolute inset-0 flex min-h-0 flex-col overflow-auto bg-black px-6 pt-12 max-[900px]:px-4",
          stableScrollbarClassName,
        )}
        onScroll={updateFollowState}
        ref={listRef}
        style={{
          paddingBottom: composerOffset,
          scrollPaddingBottom: composerOffset,
        }}
      >
        {displayMessages.length === 0 ? (
          <div className="mx-auto grid min-h-full w-full max-w-4xl place-items-center pb-24">
            <h1 className="m-0 text-center text-[28px] font-medium leading-[1.2] text-white max-[560px]:text-2xl">
              Where should we begin?
            </h1>
          </div>
        ) : null}
        {displayMessages.map((message) => (
          <Fragment key={message.id}>
            {message.author === "system" ? (
              <SystemMessage message={message} />
            ) : (
              <MessageRow
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
                isResponding={isResponding}
                message={message}
                onEditMessage={onEditMessage}
                onRetryMessage={onRetryMessage}
              />
            )}
          </Fragment>
        ))}
        <div aria-hidden="true" ref={scrollMarkerRef} />
      </div>
      <MessageShortcutRail
        messageListRef={listRef}
        messages={shortcutMessages}
      />
    </>
  );
}

function conversationShortcutMessages(messages: Message[]) {
  return messages.filter(
    (message) =>
      message.id !== "assistant-pending" &&
      (message.author === "user" || message.author === "assistant") &&
      message.content.trim().length > 0,
  );
}

function MessageShortcutRail({
  messageListRef,
  messages,
}: {
  messageListRef: { current: HTMLDivElement | null };
  messages: Message[];
}) {
  const [hoveredMessageId, setHoveredMessageId] = useState("");
  const [isRailActive, setIsRailActive] = useState(false);
  const [isRailFocused, setIsRailFocused] = useState(false);
  const railRef = useRef<HTMLDivElement>(null);
  const isShortcutSyncPausedRef = useRef(false);
  const syncFrameRef = useRef<number | null>(null);
  const syncTimeoutRef = useRef<number | null>(null);

  const syncShortcutScroll = useCallback(() => {
    const messageList = messageListRef.current;
    const shortcutList = railRef.current;

    if (!messageList || !shortcutList) {
      return;
    }

    const messageScrollableDistance =
      messageList.scrollHeight - messageList.clientHeight;
    const shortcutScrollableDistance =
      shortcutList.scrollHeight - shortcutList.clientHeight;

    if (messageScrollableDistance <= 0 || shortcutScrollableDistance <= 0) {
      shortcutList.scrollTop = 0;
      return;
    }

    const scrollRatio = Math.min(
      1,
      Math.max(0, messageList.scrollTop / messageScrollableDistance),
    );
    shortcutList.scrollTop = scrollRatio * shortcutScrollableDistance;
  }, [messageListRef]);

  useEffect(() => {
    const messageList = messageListRef.current;

    if (!messageList) {
      return;
    }

    const handleScroll = () => {
      if (isShortcutSyncPausedRef.current) {
        return;
      }
      syncShortcutScroll();
    };

    messageList.addEventListener("scroll", handleScroll, { passive: true });
    syncShortcutScroll();

    return () => {
      messageList.removeEventListener("scroll", handleScroll);
    };
  }, [messages.length, messageListRef, syncShortcutScroll]);

  useLayoutEffect(() => {
    syncShortcutScroll();

    if (isRailActive || isRailFocused) {
      return;
    }

    syncFrameRef.current = window.requestAnimationFrame(syncShortcutScroll);
    syncTimeoutRef.current = window.setTimeout(syncShortcutScroll, 220);

    return () => {
      if (syncFrameRef.current !== null) {
        window.cancelAnimationFrame(syncFrameRef.current);
        syncFrameRef.current = null;
      }
      if (syncTimeoutRef.current !== null) {
        window.clearTimeout(syncTimeoutRef.current);
        syncTimeoutRef.current = null;
      }
    };
  }, [isRailActive, isRailFocused, syncShortcutScroll]);

  if (messages.length === 0) {
    return null;
  }

  const scrollToMessage = (messageId: string) => {
    document.getElementById(messageId)?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  };

  return (
    <nav
      aria-label="Conversation shortcuts"
      className="group/shortcut-rail pointer-events-none fixed right-5 top-1/2 z-20 hidden -translate-y-1/2 items-center justify-end max-[1180px]:hidden min-[1181px]:flex"
      onBlurCapture={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) {
          return;
        }
        if (!isRailActive) {
          isShortcutSyncPausedRef.current = false;
        }
        setIsRailFocused(false);
      }}
      onFocusCapture={() => {
        isShortcutSyncPausedRef.current = true;
        setIsRailFocused(true);
      }}
      onMouseEnter={() => {
        isShortcutSyncPausedRef.current = true;
        setIsRailActive(true);
      }}
      onMouseLeave={() => {
        setHoveredMessageId("");
        setIsRailActive(false);
        if (!isRailFocused) {
          isShortcutSyncPausedRef.current = false;
        }
      }}
    >
      <div
        className="pointer-events-auto flowent-hidden-scrollbar flex max-h-[min(78vh,620px)] flex-col items-end gap-1.5 overflow-x-hidden overflow-y-auto overscroll-contain rounded-2xl border border-white/5 bg-black/20 p-2 shadow-[0_16px_44px_rgba(0,0,0,0.2)] backdrop-blur-sm transition-colors duration-200 group-hover/shortcut-rail:bg-black/70"
        ref={railRef}
      >
        {messages.map((message) => {
          const isHovered = hoveredMessageId === message.id;
          const summary = messageShortcutSummary(message.content);
          const actor = message.author === "user" ? "You" : "Flowent";
          const showSummary = isRailActive || isRailFocused || isHovered;

          return (
            <Button
              aria-label={`Jump to ${actor}: ${summary}`}
              className="group/shortcut h-auto max-w-[260px] cursor-pointer justify-end gap-2 rounded-full border-0 bg-transparent px-0 py-0 text-right text-xs text-white shadow-none transition-all duration-200 hover:bg-transparent hover:text-white focus-visible:ring-2 focus-visible:ring-white/20"
              key={message.id}
              onClick={() => scrollToMessage(message.id)}
              onMouseEnter={() => setHoveredMessageId(message.id)}
              size="sm"
              type="button"
              variant="ghost"
            >
              {showSummary ? (
                <span
                  className={cn(
                    "grid max-w-[220px] gap-0.5 overflow-hidden whitespace-nowrap opacity-70 transition-all duration-300 ease-out group-focus-visible/shortcut:opacity-100",
                    isHovered && "opacity-100",
                  )}
                >
                  <span className="text-[10px] font-semibold tracking-wider text-white/45 uppercase">
                    {actor}
                  </span>
                  <span className="truncate text-[11px] font-medium leading-4 text-white/85">
                    {summary}
                  </span>
                </span>
              ) : null}
              <span
                aria-hidden="true"
                className={cn(
                  "size-1.5 rounded-full bg-white/25 shadow-[0_0_0_1px_rgba(255,255,255,0.08)] transition-all duration-200 group-hover/shortcut-rail:size-2 group-hover/shortcut-rail:bg-white/35 group-hover/shortcut:scale-125",
                  message.author === "user" && "bg-white/45",
                  isHovered && "size-2.5 scale-150 bg-white",
                )}
              />
            </Button>
          );
        })}
      </div>
    </nav>
  );
}

function messageShortcutSummary(content: string) {
  const summary = content
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0)
    ?.replace(/\s+/g, " ");

  if (!summary) {
    return "Message";
  }
  if (summary.length <= 64) {
    return summary;
  }

  return `${summary.slice(0, 61)}…`;
}

function SystemMessage({ message }: { message: Message }) {
  const Icon =
    message.content === "Context optimized"
      ? Sparkles
      : message.content === "Context compacted"
        ? Check
        : null;

  return (
    <div className="mx-auto flex w-full max-w-4xl justify-center py-3">
      <div className="flex items-center gap-1.5 rounded-full border border-white/10 bg-input/30 px-3 py-1.5 text-base leading-5 text-white/70">
        {Icon ? (
          <Icon aria-hidden="true" className="size-3.5 text-white/50" />
        ) : null}
        {message.content}
      </div>
    </div>
  );
}

function MessageRow({
  isPending,
  isResponding,
  isStreaming,
  message,
  onEditMessage,
  onRetryMessage,
}: {
  isPending: boolean;
  isResponding: boolean;
  isStreaming: boolean;
  message: Message;
  onEditMessage: (request: MessageActionRequest) => void;
  onRetryMessage: (messageId: string) => void;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const assistantGroups =
    message.author === "assistant" ? assistantOutputGroups(message) : [];
  const latestAssistantItem = assistantGroups.at(-1)?.items.at(-1);
  const isWaiting = isPending && assistantGroups.length === 0;
  const shouldShowWaitingAfterOutput =
    isPending &&
    assistantGroups.length > 0 &&
    !isStreaming &&
    (latestAssistantItem?.type !== "tool" ||
      latestAssistantItem.tool.status !== "waiting");
  const isUserMessage = message.author === "user";
  const isRetryUnavailable = isResponding || message.id === "assistant-pending";
  const isEditUnavailable = isResponding || !isUserMessage;

  return (
    <article
      id={message.id}
      className={cn(
        "flowent-message-row group/message mx-auto flex w-full max-w-4xl scroll-mt-12 scroll-mb-40 py-3",
        message.author === "user" ? "justify-end" : "justify-start",
      )}
    >
      <div
        className={cn(
          "flex min-w-0 flex-col text-base leading-6 text-white",
          message.author === "user"
            ? "max-w-[70%] items-end"
            : "w-full max-w-full",
        )}
      >
        {isEditing ? (
          <MessageInlineEditor
            initialContent={message.content}
            isResponding={isResponding}
            onCancel={() => setIsEditing(false)}
            onSave={(content) => {
              onEditMessage({
                action: "save",
                content,
                messageId: message.id,
              });
              setIsEditing(false);
            }}
            onSaveAndRetry={(content) => {
              onEditMessage({
                action: "resend",
                content,
                messageId: message.id,
              });
              setIsEditing(false);
            }}
          />
        ) : (
          <>
            <div
              className={cn(
                "min-w-0",
                message.author === "user"
                  ? "flowent-user-message-bubble rounded-[22px] px-4 py-2.5"
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
            <MessageActionBar
              canEdit={isUserMessage}
              disableEdit={isEditUnavailable}
              disableRetry={isRetryUnavailable}
              message={message}
              onEdit={() => setIsEditing(true)}
              onRetry={() => onRetryMessage(message.id)}
            />
          </>
        )}
      </div>
    </article>
  );
}

function MessageInlineEditor({
  initialContent,
  isResponding,
  onCancel,
  onSave,
  onSaveAndRetry,
}: {
  initialContent: string;
  isResponding: boolean;
  onCancel: () => void;
  onSave: (content: string) => void;
  onSaveAndRetry: (content: string) => void;
}) {
  const [content, setContent] = useState(initialContent);
  const isSaveUnavailable = content.length === 0;
  const isResendUnavailable = isSaveUnavailable || isResponding;

  return (
    <div className="w-full min-w-[min(420px,70vw)] max-w-[min(720px,70vw)] rounded-[22px] border border-white/10 bg-input/30 p-2.5 shadow-[inset_0_0_1px_rgba(255,255,255,0.12)]">
      <Textarea
        aria-label="Edit message"
        autoFocus
        className="max-h-[240px] min-h-28 resize-none border-white/10 bg-black/30 px-3 py-2 text-base leading-6 text-white shadow-none focus-visible:border-white/20 focus-visible:ring-1 focus-visible:ring-white/20 dark:bg-black/30"
        value={content}
        onChange={(event) => setContent(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onCancel();
            return;
          }

          if (
            event.key === "Enter" &&
            (event.metaKey || event.ctrlKey) &&
            !isResendUnavailable
          ) {
            event.preventDefault();
            onSaveAndRetry(content);
          }
        }}
      />
      <div className="mt-2 flex items-center justify-end gap-1">
        <MessageIconButton label="Cancel" onClick={onCancel}>
          <X aria-hidden="true" className="size-4" />
        </MessageIconButton>
        <MessageIconButton
          disabled={isSaveUnavailable}
          label="Save"
          onClick={() => onSave(content)}
        >
          <Save aria-hidden="true" className="size-4" />
        </MessageIconButton>
        <MessageIconButton
          disabled={isResendUnavailable}
          label="Save and retry"
          onClick={() => onSaveAndRetry(content)}
        >
          <SendHorizontal aria-hidden="true" className="size-4" />
        </MessageIconButton>
      </div>
    </div>
  );
}

function MessageActionBar({
  canEdit,
  disableEdit,
  disableRetry,
  message,
  onEdit,
  onRetry,
}: {
  canEdit: boolean;
  disableEdit: boolean;
  disableRetry: boolean;
  message: Message;
  onEdit: () => void;
  onRetry: () => void;
}) {
  const [copyState, setCopyState] = useState<"copied" | "failed" | "idle">(
    "idle",
  );
  const copyTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current !== null) {
        window.clearTimeout(copyTimeoutRef.current);
      }
    };
  }, []);

  const setTimedCopyState = (state: "copied" | "failed") => {
    setCopyState(state);
    if (copyTimeoutRef.current !== null) {
      window.clearTimeout(copyTimeoutRef.current);
    }
    copyTimeoutRef.current = window.setTimeout(
      () => {
        setCopyState("idle");
        copyTimeoutRef.current = null;
      },
      state === "copied" ? 2000 : 1200,
    );
  };

  const copyMessage = async () => {
    const didCopy = await copyText(message.content);
    setTimedCopyState(didCopy ? "copied" : "failed");
  };

  const copyLabel =
    copyState === "copied"
      ? "Copied"
      : copyState === "failed"
        ? "Copy failed"
        : "Copy";

  return (
    <div
      className={cn(
        "mt-1 flex items-center gap-0.5 opacity-100 transition-opacity duration-150 hover-only:opacity-0 hover-only:group-hover/message:opacity-100 focus-within:opacity-100",
        message.author === "user" ? "justify-end pr-1" : "justify-start pl-1",
      )}
    >
      <MessageIconButton label={copyLabel} onClick={() => void copyMessage()}>
        {copyState === "copied" ? (
          <Check aria-hidden="true" className="size-4 text-white" />
        ) : copyState === "failed" ? (
          <TriangleAlert aria-hidden="true" className="size-4 text-amber-300" />
        ) : (
          <Copy aria-hidden="true" className="size-4" />
        )}
      </MessageIconButton>
      {canEdit ? (
        <MessageIconButton disabled={disableEdit} label="Edit" onClick={onEdit}>
          <Pencil aria-hidden="true" className="size-4" />
        </MessageIconButton>
      ) : null}
      <MessageIconButton
        disabled={disableRetry}
        label="Retry"
        onClick={onRetry}
      >
        <RotateCcw aria-hidden="true" className="size-4" />
      </MessageIconButton>
    </div>
  );
}

async function copyText(value: string) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    return fallbackCopyText(value);
  }

  return fallbackCopyText(value);
}

function fallbackCopyText(value: string) {
  if (typeof document.execCommand !== "function") {
    return false;
  }

  const previousFocus = document.activeElement;
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.top = "-9999px";
  textarea.style.left = "-9999px";
  textarea.style.width = "1px";
  textarea.style.height = "1px";
  textarea.style.opacity = "0";

  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();

  let didCopy = false;
  try {
    didCopy = document.execCommand("copy");
  } finally {
    textarea.remove();
    if (previousFocus instanceof HTMLElement) {
      previousFocus.focus({ preventScroll: true });
    }
  }

  return didCopy;
}

function MessageIconButton({
  children,
  className,
  disabled,
  label,
  onClick,
}: {
  children: ReactNode;
  className?: string;
  disabled?: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          aria-label={label}
          className={cn(
            "size-7 rounded-lg border-0 bg-transparent text-white/45 shadow-none transition-colors hover:bg-white/10 hover:text-white focus-visible:ring-2 focus-visible:ring-white/20 disabled:pointer-events-auto disabled:cursor-not-allowed disabled:text-white/20 disabled:opacity-100 disabled:hover:bg-transparent",
            className,
          )}
          disabled={disabled}
          onClick={onClick}
          size="icon-sm"
          type="button"
          variant="ghost"
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={6}>
        {label}
      </TooltipContent>
    </Tooltip>
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
  const thinkingItem: AssistantOutputItem | null = message.thinking
    ? {
        content: message.thinking,
        id: `${message.id}-thinking`,
        isStreaming: message.isStreamingThinking,
        type: "thinking",
      }
    : null;
  const groups: AssistantOutputGroup[] = [];
  const processItems = [...(thinkingItem ? [thinkingItem] : []), ...toolItems];

  if (toolItems.length) {
    groups.push({
      id: `${message.id}-process`,
      items: processItems,
    });
  }

  if (message.content) {
    const contentItem: AssistantOutputItem = {
      content: message.content,
      id: `${message.id}-content`,
      type: "text",
    };
    if (toolItems.length) {
      groups.push({
        id: `${message.id}-content`,
        items: [contentItem],
      });
    } else {
      groups.push({
        id: `${message.id}-content`,
        items: [...processItems, contentItem],
      });
    }
  } else if (processItems.length && !toolItems.length) {
    groups.push({
      id: `${message.id}-process`,
      items: processItems,
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
              ) : item.type === "thinking" ? (
                <ThinkingProcessItem
                  key={item.id}
                  content={item.content}
                  isStreaming={item.isStreaming === true}
                />
              ) : item.type === "error" ? (
                <AssistantErrorItem key={item.id} item={item} />
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

function AssistantErrorItem({
  item,
}: {
  item: Extract<AssistantOutputItem, { type: "error" }>;
}) {
  return (
    <div
      className="flex items-start gap-3 rounded-lg border border-red-500/15 bg-red-500/[0.06] p-3 text-base leading-5 text-red-100/90"
      role="alert"
    >
      <TriangleAlert
        aria-hidden="true"
        className="mt-0.5 size-4 shrink-0 text-red-400"
      />
      <div className="min-w-0 flex-1">
        <div className="font-semibold text-red-100/95">{item.title}</div>
        <div className="mt-1 text-red-100/75">{item.message}</div>
        {item.detail ? (
          <div className="mt-2 break-words text-xs leading-5 text-red-100/55">
            {item.detail}
          </div>
        ) : null}
      </div>
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

function ThinkingProcessItem({
  content,
  isStreaming,
}: {
  content: string;
  isStreaming: boolean;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const isExpanded = isStreaming || isOpen;

  return (
    <div className="max-w-full text-base leading-5 text-white">
      <Button
        aria-expanded={isExpanded}
        className="h-8 w-full justify-start gap-2 rounded-lg border-0 bg-transparent px-2 text-base text-white/75 shadow-none hover:bg-input/30 hover:text-white"
        onClick={() => setIsOpen((current) => !current)}
        type="button"
        variant="ghost"
      >
        <ChevronRight
          aria-hidden="true"
          className={cn(
            "size-3.5 shrink-0 transition-transform",
            isExpanded ? "rotate-90" : "",
          )}
        />
        <Circle
          aria-hidden="true"
          className={cn(
            "size-3.5 shrink-0 text-white/70",
            isStreaming ? "animate-pulse" : "",
          )}
        />
        <span className="min-w-0 flex-1 truncate text-left">
          {isStreaming ? "Thinking..." : "Thought Process"}
        </span>
      </Button>
      {isExpanded ? (
        <div className="py-1">
          <div className="whitespace-pre-wrap break-words text-base leading-5 text-white/60">
            {content}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ToolProcessItem({ tool }: { tool: ToolItem }) {
  const [isOpen, setIsOpen] = useState(false);
  const statusLabel =
    tool.status === "waiting"
      ? "Waiting"
      : tool.status === "running"
        ? "Running"
        : tool.status === "success"
          ? "Done"
          : "Failed";

  return (
    <div className="max-w-full text-base leading-5 text-white">
      <Button
        aria-expanded={isOpen}
        className="h-8 w-full justify-start gap-2 rounded-lg border-0 bg-transparent px-2 text-base text-white shadow-none hover:bg-transparent hover:text-white aria-expanded:bg-transparent aria-expanded:text-white active:not-aria-[haspopup]:translate-y-0"
        onClick={() => setIsOpen((current) => !current)}
        type="button"
        variant="ghost"
      >
        <ChevronRight
          aria-hidden="true"
          className={cn(
            "size-3.5 shrink-0 text-white/55 transition-transform",
            isOpen ? "rotate-90" : "",
          )}
        />
        <ToolProcessIcon tool={tool} />
        <span className="min-w-0 flex-1 truncate text-left">{tool.title}</span>
        <span className="shrink-0 text-xs text-white/55">{statusLabel}</span>
      </Button>
      {isOpen ? <ToolProcessDetails tool={tool} /> : null}
    </div>
  );
}

function ToolProcessDetails({ tool }: { tool: ToolItem }) {
  const approval = toolApprovalData(tool.data);
  const hasArguments = hasToolObjectPayload(tool.arguments);
  const hasData = hasToolObjectPayload(tool.data);
  const hasContent = tool.content !== undefined;
  const hasResult = hasContent || hasData;

  if (!hasArguments && !hasResult) {
    return null;
  }

  return (
    <div className="flex min-w-0 flex-col gap-2 py-1">
      {hasArguments ? (
        <ToolProcessPayload
          label="ARGS"
          value={formatToolValue(tool.arguments)}
        />
      ) : null}
      {hasResult ? (
        <ToolProcessPayload label="RESULT" value={formatToolResult(tool)} />
      ) : null}
      {approval ? <ToolProcessApproval approval={approval} /> : null}
    </div>
  );
}

type ToolApprovalData = {
  action?: string;
  decision?: string;
  reason?: string;
  toolResult?: string;
  toolName?: string;
  writePaths?: string[];
};

function ToolProcessApproval({ approval }: { approval: ToolApprovalData }) {
  const decision = approval.decision === "denied" ? "Denied" : "Approved";
  const firstFailureOutput = approval.toolResult?.trim()
    ? approval.toolResult
    : null;

  return (
    <div className="min-w-0">
      <div className="mb-1 text-[11px] font-medium leading-4 text-white/45">
        REVIEW
      </div>
      <div className="grid gap-1 rounded-md border border-white/10 bg-black px-2.5 py-2 text-xs leading-5 text-white/70">
        <div className="font-medium text-white">{decision}</div>
        {approval.reason ? (
          <div className="break-words text-white/60">{approval.reason}</div>
        ) : null}
        {firstFailureOutput ? (
          <div className="mt-1.5 border-t border-white/5 pt-1.5">
            <div className="mb-0.5 text-[10px] font-medium leading-4 text-white/40">
              FAILURE
            </div>
            <div className="whitespace-pre-wrap break-words font-mono text-[11px] leading-4 text-white/50">
              {firstFailureOutput}
            </div>
          </div>
        ) : null}
        {approval.writePaths?.length ? (
          <div className="grid gap-0.5 font-mono text-[11px] leading-4 text-white/50">
            {approval.writePaths.map((path) => (
              <span className="break-words" key={path}>
                {path}
              </span>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ToolProcessPayload({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="min-w-0">
      <div className="mb-1 text-[11px] font-medium leading-4 text-white/45">
        {label}
      </div>
      <pre className="max-h-64 overflow-auto rounded-md bg-input/20 px-2.5 py-2 font-mono text-xs leading-5 text-white/70">
        <code className="whitespace-pre-wrap break-words">{value}</code>
      </pre>
    </div>
  );
}

function formatToolValue(value: unknown) {
  if (typeof value === "string") {
    return value;
  }

  return JSON.stringify(value, null, 2);
}

function formatToolResult(tool: ToolItem) {
  const result: Record<string, unknown> = {};
  if (tool.content !== undefined) {
    result.content = tool.content;
  }
  const toolData = tool.data;
  if (hasToolObjectPayload(toolData)) {
    const data = Object.fromEntries(
      Object.entries(toolData).filter(([key]) => key !== "approval"),
    );
    if (Object.keys(data).length > 0) {
      result.data = data;
    }
  }
  return formatToolValue(result);
}

function hasToolObjectPayload(
  value: Record<string, unknown> | null | undefined,
): value is Record<string, unknown> {
  return value != null && Object.keys(value).length > 0;
}

function toolApprovalData(
  data: Record<string, unknown> | null | undefined,
): ToolApprovalData | null {
  const approval = data?.approval;
  if (!approval || typeof approval !== "object" || Array.isArray(approval)) {
    return null;
  }
  const value = approval as Record<string, unknown>;
  return {
    action: typeof value.action === "string" ? value.action : undefined,
    decision: typeof value.decision === "string" ? value.decision : undefined,
    reason: typeof value.reason === "string" ? value.reason : undefined,
    toolResult:
      typeof value.tool_result === "string" ? value.tool_result : undefined,
    toolName: typeof value.tool_name === "string" ? value.tool_name : undefined,
    writePaths: Array.isArray(value.write_paths)
      ? value.write_paths.filter(
          (path): path is string => typeof path === "string",
        )
      : undefined,
  };
}

function ToolProcessIcon({ tool }: { tool: ToolItem }) {
  const className = cn(
    "size-3.5 shrink-0",
    tool.status === "failed" ? "text-red-300" : "text-white/80",
    tool.status === "running" ? "animate-pulse" : "",
    tool.status === "waiting" ? "text-amber-300" : "",
  );

  if (tool.status === "success") {
    return <Check aria-hidden="true" className={className} />;
  }
  if (tool.status === "failed") {
    return <X aria-hidden="true" className={className} />;
  }
  if (tool.status === "waiting") {
    return <TriangleAlert aria-hidden="true" className={className} />;
  }
  if (tool.name === "web_search" || tool.name === "grep_files") {
    return <Search aria-hidden="true" className={className} />;
  }
  if (tool.name === "shell_command") {
    return <Terminal aria-hidden="true" className={className} />;
  }
  return <Circle aria-hidden="true" className={className} />;
}

type PlanItemStatus = "completed" | "in_progress" | "pending";

type WorkspacePlanItem = {
  status: PlanItemStatus;
  step: string;
};

type WorkspacePlan = {
  items: WorkspacePlanItem[];
};

function latestPlanFromMessages(messages: Message[]): WorkspacePlan | null {
  for (
    let messageIndex = messages.length - 1;
    messageIndex >= 0;
    messageIndex -= 1
  ) {
    const message = messages[messageIndex];
    if (message?.author !== "assistant") {
      continue;
    }

    const tools = message.tools ?? [];
    for (let toolIndex = tools.length - 1; toolIndex >= 0; toolIndex -= 1) {
      const tool = tools[toolIndex];
      if (tool.name !== "update_plan") {
        continue;
      }

      const items =
        planItemsFromToolPayload(tool.data) ??
        planItemsFromToolPayload(tool.arguments);
      if (items?.length) {
        return { items };
      }
    }
  }

  return null;
}

function planItemsFromToolPayload(
  payload: Record<string, unknown> | null | undefined,
) {
  const rawItems = payload?.items;
  if (!Array.isArray(rawItems)) {
    return null;
  }

  return rawItems.flatMap((item): WorkspacePlanItem[] => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return [];
    }
    const value = item as Record<string, unknown>;
    const step = typeof value.step === "string" ? value.step.trim() : "";
    if (!step) {
      return [];
    }
    return [
      {
        status: normalizePlanStatus(value.status),
        step,
      },
    ];
  });
}

function normalizePlanStatus(status: unknown): PlanItemStatus {
  if (
    status === "completed" ||
    status === "in_progress" ||
    status === "pending"
  ) {
    return status;
  }

  return "pending";
}

function PlanTray({
  isHidden,
  plan,
}: {
  isHidden: boolean;
  plan: WorkspacePlan | null;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const trayRef = useRef<HTMLDivElement>(null);
  const shouldReduceMotion = useReducedMotion();

  useEffect(() => {
    if (isHidden) {
      setIsOpen(false);
    }
  }, [isHidden]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (event.pointerType === "mouse") {
        return;
      }
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }
      if (trayRef.current?.contains(target)) {
        return;
      }
      setIsOpen(false);
    };
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    };

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  if (!plan || isHidden) {
    return null;
  }

  const completedCount = plan.items.filter(
    (item) => item.status === "completed",
  ).length;
  const summary = `Plan · ${completedCount}/${plan.items.length} done`;

  return (
    <div
      className="border-b border-zinc-800/50 bg-zinc-900/40 shadow-[inset_0_-1px_0_rgba(255,255,255,0.03)]"
      onPointerLeave={(event) => {
        if (event.pointerType === "mouse") {
          setIsOpen(false);
        }
      }}
      ref={trayRef}
    >
      <Button
        aria-expanded={isOpen}
        className="h-9 w-full justify-start gap-2 rounded-none border-0 bg-transparent px-3 text-xs font-medium text-zinc-300 shadow-none hover:bg-input/40 hover:text-white sm:text-sm"
        onClick={() => setIsOpen((current) => !current)}
        type="button"
        variant="ghost"
      >
        <ChevronRight
          aria-hidden="true"
          className={cn(
            "size-3.5 shrink-0 text-white/55 transition-transform",
            isOpen && "rotate-90",
          )}
        />
        <span className="min-w-0 flex-1 truncate text-left">{summary}</span>
      </Button>
      <AnimatePresence initial={false}>
        {isOpen ? (
          <motion.div
            animate={
              shouldReduceMotion
                ? { opacity: 1 }
                : { height: "auto", opacity: 1 }
            }
            className="overflow-hidden border-t border-zinc-800/50 bg-zinc-950/50"
            data-slot="plan-tasks-panel"
            exit={
              shouldReduceMotion ? { opacity: 1 } : { height: 0, opacity: 0 }
            }
            initial={shouldReduceMotion ? false : { height: 0, opacity: 0 }}
            key="plan-tasks-panel"
            transition={
              shouldReduceMotion
                ? { duration: 0 }
                : { duration: 0.18, ease: [0.32, 0.72, 0, 1] }
            }
          >
            <ol
              aria-label="Plan tasks"
              className="grid max-h-[150px] gap-1 overflow-auto p-1.5 sm:max-h-[25vh]"
            >
              {plan.items.map((item, index) => (
                <li
                  className={cn(
                    "grid min-w-0 grid-cols-[1.25rem_auto_minmax(0,1fr)_auto] items-start gap-2 rounded-lg px-2 py-1.5 text-sm leading-5",
                    item.status === "in_progress"
                      ? "bg-input/30 text-white"
                      : item.status === "completed"
                        ? "text-white/55"
                        : "text-white/75",
                  )}
                  key={`${index}-${item.step}`}
                >
                  <span className="text-right text-xs leading-5 text-white/35">
                    {index + 1}
                  </span>
                  <PlanStatusIcon status={item.status} />
                  <span className="min-w-0 break-words">{item.step}</span>
                  <span className="shrink-0 text-xs leading-5 text-white/45">
                    {planStatusLabel(item.status)}
                  </span>
                </li>
              ))}
            </ol>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

function PlanStatusIcon({ status }: { status: PlanItemStatus }) {
  const className = "mt-0.5 size-3.5 shrink-0";

  if (status === "completed") {
    return (
      <Check aria-hidden="true" className={cn(className, "text-white/65")} />
    );
  }
  if (status === "in_progress") {
    return (
      <Activity
        aria-hidden="true"
        className={cn(className, "animate-pulse text-white")}
      />
    );
  }

  return (
    <Circle aria-hidden="true" className={cn(className, "text-white/40")} />
  );
}

function planStatusLabel(status: PlanItemStatus) {
  if (status === "completed") {
    return "Done";
  }
  if (status === "in_progress") {
    return "Doing";
  }
  return "Pending";
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
  commands,
  contextWindowLimit,
  draft,
  errorMessage,
  isRefiningContext,
  isSending,
  messages,
  plan,
  usageInfo,
  onCommand,
  onCommandError,
  onDraftChange,
  onOffsetChange,
  onSendMessage,
  onStopResponse,
  skills,
}: {
  commands: WorkspaceCommand[];
  contextWindowLimit: number | null;
  draft: string;
  errorMessage: string;
  isRefiningContext: boolean;
  isSending: boolean;
  messages: Message[];
  plan: WorkspacePlan | null;
  usageInfo: ContextUsageInfo | null;
  onCommand: (commandId: WorkspaceCommandId) => boolean;
  onCommandError: (message: string) => void;
  onDraftChange: (value: string) => void;
  onOffsetChange: (value: number) => void;
  onSendMessage: (content: string) => void;
  onStopResponse: () => void;
  skills: Skill[];
}) {
  const composerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const allowNextLineBreakRef = useRef(false);
  const softKeyboardSubmitRef = useRef(() => {});
  const handlesSoftKeyboardSubmitRef = useRef(false);
  const preserveCommandMenuDismissalRef = useRef(false);
  const preserveHistoryNavigationRef = useRef(false);
  const preserveSkillMenuDismissalRef = useRef(false);
  const historyIndexRef = useRef<number | null>(null);
  const historyStagedDraftRef = useRef("");
  const [isCommandMenuDismissed, setIsCommandMenuDismissed] = useState(false);
  const [isSkillMenuDismissed, setIsSkillMenuDismissed] = useState(false);
  const [selectedCommandIndex, setSelectedCommandIndex] = useState(0);
  const [selectedSkillIndex, setSelectedSkillIndex] = useState(0);
  const promptHistory = useMemo(
    () => promptHistoryFromMessages(messages),
    [messages],
  );
  const firstLine = draft.split("\n")[0] ?? "";
  const commandName = firstLine.startsWith("/") ? firstLine.slice(1) : "";
  const isCommandDraft =
    firstLine.startsWith("/") &&
    !commandName.includes("/") &&
    !firstLine.includes(" ");
  const matchingCommands = useMemo(() => {
    if (!isCommandDraft) {
      return [];
    }
    const normalizedName = commandName.toLowerCase();

    return commands.filter((command) =>
      command.name.toLowerCase().startsWith(normalizedName),
    );
  }, [commandName, commands, isCommandDraft]);
  const showCommandMenu =
    isCommandDraft && !isCommandMenuDismissed && matchingCommands.length > 0;
  const skillTokenMatch = draft.match(/(?:^|\s)\$([a-z0-9-]*)$/i);
  const skillName = skillTokenMatch?.[1] ?? "";
  const isSkillDraft = Boolean(skillTokenMatch);
  const matchingSkills = useMemo(() => {
    if (!isSkillDraft) {
      return [];
    }
    const normalizedName = skillName.toLowerCase();

    return skills.filter(
      (skill) =>
        skill.enabled &&
        !skill.error &&
        skill.slug.toLowerCase().startsWith(normalizedName),
    );
  }, [isSkillDraft, skillName, skills]);
  const showSkillMenu =
    !showCommandMenu &&
    isSkillDraft &&
    !isSkillMenuDismissed &&
    matchingSkills.length > 0;
  const exactCommand = commands.find((command) => command.name === commandName);
  const canSubmitCommand =
    Boolean(isCommandDraft && exactCommand) &&
    (!isSending || exactCommand?.id === "clear");
  const currentDraft = () => textareaRef.current?.value ?? draft;
  const handlesSoftKeyboardSubmit = shouldHandleSoftKeyboardSubmit();
  handlesSoftKeyboardSubmitRef.current = handlesSoftKeyboardSubmit;
  const canSubmit =
    currentDraft().length > 0 && (!isSending || canSubmitCommand);
  const showStopButton = isSending && !canSubmitCommand;
  const isSendUnavailable = !showStopButton && !canSubmit;
  const isSendDisabled = isSendUnavailable && !handlesSoftKeyboardSubmit;
  const capacity = useMemo(
    () =>
      contextCapacityFromMessages(
        messages,
        draft,
        usageInfo,
        contextWindowLimit,
      ),
    [contextWindowLimit, draft, messages, usageInfo],
  );

  useEffect(() => {
    if (preserveCommandMenuDismissalRef.current) {
      preserveCommandMenuDismissalRef.current = false;
      return;
    }

    setIsCommandMenuDismissed(false);
    setSelectedCommandIndex(0);
  }, [draft]);

  useEffect(() => {
    if (preserveSkillMenuDismissalRef.current) {
      preserveSkillMenuDismissalRef.current = false;
      return;
    }

    setIsSkillMenuDismissed(false);
    setSelectedSkillIndex(0);
  }, [draft]);

  useEffect(() => {
    if (preserveHistoryNavigationRef.current) {
      preserveHistoryNavigationRef.current = false;
      return;
    }

    historyIndexRef.current = null;
    historyStagedDraftRef.current = "";
  }, [draft]);

  useEffect(() => {
    setSelectedCommandIndex((current) =>
      Math.min(current, Math.max(matchingCommands.length - 1, 0)),
    );
  }, [matchingCommands.length]);

  useEffect(() => {
    setSelectedSkillIndex((current) =>
      Math.min(current, Math.max(matchingSkills.length - 1, 0)),
    );
  }, [matchingSkills.length]);

  useEffect(() => {
    const composer = composerRef.current;
    if (!composer) {
      return;
    }
    let animationFrameId = 0;

    const updateOffset = () => {
      animationFrameId = 0;
      const measuredBottomOffset = Number.parseFloat(
        getComputedStyle(composer).bottom,
      );
      const bottomOffset = Number.isFinite(measuredBottomOffset)
        ? measuredBottomOffset
        : 0;

      onOffsetChange(composer.offsetHeight + bottomOffset + 24);
    };

    const scheduleUpdateOffset = () => {
      if (animationFrameId !== 0) {
        window.cancelAnimationFrame(animationFrameId);
      }

      animationFrameId = window.requestAnimationFrame(updateOffset);
    };

    updateOffset();

    window.addEventListener("resize", scheduleUpdateOffset, {
      passive: true,
    });
    window.addEventListener("focusin", scheduleUpdateOffset, {
      passive: true,
    });
    window.addEventListener("focusout", scheduleUpdateOffset, {
      passive: true,
    });
    window.visualViewport?.addEventListener("resize", scheduleUpdateOffset, {
      passive: true,
    });
    window.visualViewport?.addEventListener("scroll", scheduleUpdateOffset, {
      passive: true,
    });

    if (typeof ResizeObserver === "undefined") {
      return () => {
        if (animationFrameId !== 0) {
          window.cancelAnimationFrame(animationFrameId);
        }
        window.removeEventListener("resize", scheduleUpdateOffset);
        window.removeEventListener("focusin", scheduleUpdateOffset);
        window.removeEventListener("focusout", scheduleUpdateOffset);
        window.visualViewport?.removeEventListener(
          "resize",
          scheduleUpdateOffset,
        );
        window.visualViewport?.removeEventListener(
          "scroll",
          scheduleUpdateOffset,
        );
      };
    }

    const resizeObserver = new ResizeObserver(scheduleUpdateOffset);
    resizeObserver.observe(composer);

    return () => {
      if (animationFrameId !== 0) {
        window.cancelAnimationFrame(animationFrameId);
      }
      window.removeEventListener("resize", scheduleUpdateOffset);
      window.removeEventListener("focusin", scheduleUpdateOffset);
      window.removeEventListener("focusout", scheduleUpdateOffset);
      window.visualViewport?.removeEventListener(
        "resize",
        scheduleUpdateOffset,
      );
      window.visualViewport?.removeEventListener(
        "scroll",
        scheduleUpdateOffset,
      );
      resizeObserver.disconnect();
    };
  }, [onOffsetChange]);

  const runCommand = (command: WorkspaceCommand) => {
    const commandAccepted = onCommand(command.id);
    if (!commandAccepted) {
      setIsCommandMenuDismissed(true);
      return;
    }
    onDraftChange("");
    setIsCommandMenuDismissed(false);
  };

  const runDraftCommand = () => {
    if (!isCommandDraft || commandName.length === 0) {
      return false;
    }

    const command = commands.find((item) => item.name === commandName);
    if (!command) {
      return false;
    }

    runCommand(command);
    return true;
  };

  const insertSkill = (skill: Skill) => {
    const nextDraft = draft.replace(/(?:^|\s)\$([a-z0-9-]*)$/i, (match) => {
      const prefix = match.startsWith(" ") ? " " : "";
      return `${prefix}$${skill.slug} `;
    });
    preserveSkillMenuDismissalRef.current = true;
    onDraftChange(nextDraft);
    setIsSkillMenuDismissed(true);
  };

  const setDraftFromPromptHistory = (value: string) => {
    preserveHistoryNavigationRef.current = true;
    onDraftChange(value);
    window.requestAnimationFrame(() => {
      const textarea = textareaRef.current;
      if (!textarea) {
        return;
      }
      textarea.focus();
      textarea.setSelectionRange(value.length, value.length);
    });
  };

  const navigatePromptHistory = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (
      promptHistory.length === 0 ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey ||
      event.nativeEvent.isComposing
    ) {
      return false;
    }

    const textarea = event.currentTarget;

    if (event.key === "ArrowUp") {
      if (!isCaretOnFirstLine(textarea)) {
        return false;
      }

      event.preventDefault();
      const currentIndex = historyIndexRef.current;
      const nextIndex =
        currentIndex === null
          ? promptHistory.length - 1
          : Math.max(currentIndex - 1, 0);

      if (currentIndex === null) {
        historyStagedDraftRef.current = textarea.value;
      }
      historyIndexRef.current = nextIndex;
      setDraftFromPromptHistory(promptHistory[nextIndex]);
      return true;
    }

    if (event.key !== "ArrowDown") {
      return false;
    }

    if (!isCaretOnLastLine(textarea)) {
      return false;
    }

    const currentIndex = historyIndexRef.current;
    if (currentIndex === null) {
      return false;
    }

    event.preventDefault();
    const nextIndex = currentIndex + 1;
    if (nextIndex >= promptHistory.length) {
      historyIndexRef.current = null;
      setDraftFromPromptHistory(historyStagedDraftRef.current);
      historyStagedDraftRef.current = "";
      return true;
    }

    historyIndexRef.current = nextIndex;
    setDraftFromPromptHistory(promptHistory[nextIndex]);
    return true;
  };

  const handleSubmit = () => {
    const submittedDraft = currentDraft();

    if (showSkillMenu) {
      const skill = matchingSkills[selectedSkillIndex];
      if (skill) {
        insertSkill(skill);
        return;
      }
    }

    if (showCommandMenu) {
      const command = matchingCommands[selectedCommandIndex];
      if (command) {
        runCommand(command);
        return;
      }
    }

    if (runDraftCommand()) {
      return;
    }

    if (isCommandDraft && commandName.length > 0) {
      setIsCommandMenuDismissed(false);
      onCommandError("Command not found.");
      return;
    }

    onSendMessage(submittedDraft);
  };

  softKeyboardSubmitRef.current = () => {
    handleSubmit();
  };

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) {
      return;
    }

    const handleBeforeInput = (event: InputEvent) => {
      if (!handlesSoftKeyboardSubmitRef.current) {
        return;
      }
      if (allowNextLineBreakRef.current) {
        allowNextLineBreakRef.current = false;
        return;
      }
      if (
        event.inputType !== "insertLineBreak" &&
        event.inputType !== "insertParagraph"
      ) {
        return;
      }
      event.preventDefault();
      softKeyboardSubmitRef.current();
    };

    textarea.addEventListener("beforeinput", handleBeforeInput);

    return () => textarea.removeEventListener("beforeinput", handleBeforeInput);
  }, []);

  return (
    <div
      className="pointer-events-none absolute inset-x-0 bottom-[calc(1.5rem+var(--flowent-keyboard-offset))] z-10 px-6 max-[900px]:px-4"
      ref={composerRef}
    >
      <div className="pointer-events-auto mx-auto w-full max-w-[640px]">
        {showCommandMenu ? (
          <div
            aria-label="Commands"
            className="mb-2 overflow-hidden rounded-xl border border-white/10 bg-[#171717] p-1 shadow-[0_16px_44px_rgba(0,0,0,0.42)]"
            role="listbox"
          >
            {matchingCommands.map((command, index) => (
              <Button
                aria-selected={index === selectedCommandIndex}
                className={cn(
                  "flex h-auto w-full items-center justify-start gap-3 rounded-lg border-0 bg-transparent px-3 py-2 text-left text-base text-white shadow-none transition-colors hover:bg-input/50 hover:text-white",
                  index === selectedCommandIndex && "bg-input/40",
                )}
                key={command.id}
                onClick={() => runCommand(command)}
                onMouseEnter={() => setSelectedCommandIndex(index)}
                size="sm"
                role="option"
                type="button"
                variant="ghost"
              >
                <Terminal aria-hidden="true" className="size-4 text-white/75" />
                <span className="min-w-0 flex-1">
                  <span className="block font-medium leading-5">
                    {command.label}
                  </span>
                  <span className="block truncate text-xs leading-4 text-white/55">
                    {command.description}
                  </span>
                </span>
              </Button>
            ))}
          </div>
        ) : null}
        {showSkillMenu ? (
          <div
            aria-label="Skills"
            className="mb-2 overflow-hidden rounded-xl border border-white/10 bg-[#171717] p-1 shadow-[0_16px_44px_rgba(0,0,0,0.42)]"
            role="listbox"
          >
            {matchingSkills.map((skill, index) => (
              <Button
                aria-selected={index === selectedSkillIndex}
                className={cn(
                  "flex h-auto w-full items-center justify-start gap-3 rounded-lg border-0 bg-transparent px-3 py-2 text-left text-base text-white shadow-none transition-colors hover:bg-input/50 hover:text-white",
                  index === selectedSkillIndex && "bg-input/40",
                )}
                key={skill.id}
                onClick={() => insertSkill(skill)}
                onMouseEnter={() => setSelectedSkillIndex(index)}
                size="sm"
                role="option"
                type="button"
                variant="ghost"
              >
                <Sparkles aria-hidden="true" className="size-4 text-white/75" />
                <span className="min-w-0 flex-1">
                  <span className="block font-medium leading-5">
                    ${skill.slug}
                  </span>
                  <span className="block truncate text-xs leading-4 text-white/55">
                    {skill.description || skill.name}
                  </span>
                </span>
              </Button>
            ))}
          </div>
        ) : null}
        {errorMessage ? (
          <p className="mb-2 rounded-md bg-black/80 px-3 py-2 text-base leading-5 text-red-300 shadow-[0_12px_32px_rgba(0,0,0,0.45)]">
            {errorMessage}
          </p>
        ) : null}
        <form
          aria-label="Workspace composer"
          className="flex flex-col-reverse overflow-clip rounded-[14px] border border-zinc-800 bg-zinc-950 shadow-[0_16px_44px_rgba(0,0,0,0.42),inset_0_0_1px_rgba(255,255,255,0.2)] transition-colors focus-within:border-zinc-700"
          onSubmit={(event) => {
            event.preventDefault();
            handleSubmit();
          }}
        >
          <ContextCapacityTray
            capacity={capacity}
            isRefining={isRefiningContext}
          />
          <div className="grid min-h-14 w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-2 bg-[#212121] p-2.5">
            <Textarea
              aria-label="Message Flowent"
              className="flowent-composer-textarea max-h-[216px] min-h-9 resize-none overflow-y-auto border-0 bg-transparent px-2 py-1.5 text-white shadow-none placeholder:text-[#9b9b9b] focus-visible:border-transparent focus-visible:ring-0 dark:bg-transparent"
              enterKeyHint="send"
              ref={textareaRef}
              value={draft}
              onChange={(event) => onDraftChange(event.target.value)}
              onInput={(event) => onDraftChange(event.currentTarget.value)}
              onKeyDown={(event) => {
                allowNextLineBreakRef.current =
                  event.key === "Enter" && event.shiftKey;

                if (showSkillMenu) {
                  if (event.key === "ArrowDown") {
                    event.preventDefault();
                    setSelectedSkillIndex(
                      (selectedSkillIndex + 1) % matchingSkills.length,
                    );
                    return;
                  }

                  if (event.key === "ArrowUp") {
                    event.preventDefault();
                    setSelectedSkillIndex(
                      (selectedSkillIndex - 1 + matchingSkills.length) %
                        matchingSkills.length,
                    );
                    return;
                  }

                  if (event.key === "Tab") {
                    const skill = matchingSkills[selectedSkillIndex];
                    if (skill) {
                      event.preventDefault();
                      insertSkill(skill);
                    }
                    return;
                  }

                  if (event.key === "Escape") {
                    event.preventDefault();
                    setIsSkillMenuDismissed(true);
                    return;
                  }
                }

                if (showCommandMenu) {
                  if (event.key === "ArrowDown") {
                    event.preventDefault();
                    setSelectedCommandIndex(
                      (selectedCommandIndex + 1) % matchingCommands.length,
                    );
                    return;
                  }

                  if (event.key === "ArrowUp") {
                    event.preventDefault();
                    setSelectedCommandIndex(
                      (selectedCommandIndex - 1 + matchingCommands.length) %
                        matchingCommands.length,
                    );
                    return;
                  }

                  if (event.key === "Tab") {
                    const command = matchingCommands[selectedCommandIndex];
                    if (command) {
                      event.preventDefault();
                      preserveCommandMenuDismissalRef.current = true;
                      onDraftChange(command.label);
                      setIsCommandMenuDismissed(true);
                    }
                    return;
                  }

                  if (event.key === "Escape") {
                    event.preventDefault();
                    setIsCommandMenuDismissed(true);
                    return;
                  }
                }

                if (
                  navigatePromptHistory(event) ||
                  event.key !== "Enter" ||
                  event.shiftKey ||
                  event.nativeEvent.isComposing
                ) {
                  return;
                }

                event.preventDefault();
                handleSubmit();
              }}
              placeholder="Message Flowent"
            />
            <Button
              aria-label={showStopButton ? "Stop" : "Send message"}
              className={cn(
                "size-9 rounded-full shadow-none disabled:bg-transparent disabled:text-white/35 disabled:opacity-100 [&_svg]:size-5",
                showStopButton
                  ? "bg-white text-black hover:bg-[#e5e5e5] [&_svg]:size-3.5"
                  : "bg-white text-black hover:bg-[#e5e5e5]",
                isSendUnavailable &&
                  "bg-transparent text-white/35 hover:bg-transparent",
              )}
              aria-disabled={isSendUnavailable}
              disabled={isSendDisabled}
              onClick={showStopButton ? onStopResponse : undefined}
              size="icon-lg"
              type={showStopButton ? "button" : "submit"}
            >
              {showStopButton ? (
                <Square aria-hidden="true" fill="currentColor" />
              ) : (
                <ArrowUp aria-hidden="true" />
              )}
            </Button>
          </div>
          <PlanTray isHidden={showCommandMenu || showSkillMenu} plan={plan} />
        </form>
      </div>
    </div>
  );
}

function promptHistoryFromMessages(messages: Message[]) {
  const history: string[] = [];

  for (const message of messages) {
    if (message.author !== "user" || message.content.trim().length === 0) {
      continue;
    }
    if (history.at(-1) === message.content) {
      continue;
    }
    history.push(message.content);
  }

  return history;
}

function isCaretOnFirstLine(textarea: HTMLTextAreaElement) {
  return !textarea.value.slice(0, textarea.selectionStart).includes("\n");
}

function isCaretOnLastLine(textarea: HTMLTextAreaElement) {
  return !textarea.value.slice(textarea.selectionEnd).includes("\n");
}

const CONTEXT_CAPACITY_LIMIT = 120_000;
const CONTEXT_BASELINE_UNITS = 12_000;

type ContextCapacity = {
  percent: number;
  tone: "critical" | "neutral" | "warning";
  total: number;
  used: number;
};

function ContextCapacityTray({
  capacity,
  isRefining,
}: {
  capacity: ContextCapacity;
  isRefining: boolean;
}) {
  const toneClassName =
    capacity.tone === "critical"
      ? "bg-red-500"
      : capacity.tone === "warning"
        ? "bg-amber-500"
        : "bg-zinc-400";
  const textClassName =
    capacity.tone === "critical"
      ? "text-red-400"
      : capacity.tone === "warning"
        ? "text-amber-400"
        : "text-zinc-300";
  const capacityAmount = `${formatContextUnits(capacity.used)} / ${formatContextUnits(capacity.total)}`;

  return (
    <div
      aria-busy={isRefining}
      aria-live="polite"
      className="flex min-h-9 items-center justify-between gap-3 border-t border-zinc-800/50 bg-zinc-900/40 px-4 py-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] transition-colors"
    >
      <div className="flex min-w-0 items-center gap-2 text-[10px] font-semibold tracking-wider text-zinc-500 uppercase">
        <Activity
          aria-hidden="true"
          className={cn("size-3 shrink-0", isRefining && "animate-pulse")}
        />
        <span className="hidden sm:inline">Context</span>
      </div>
      <div className="flex min-w-0 items-center gap-2">
        <span
          className={cn(
            "text-[10px] font-semibold whitespace-nowrap",
            isRefining
              ? "animate-pulse text-zinc-300"
              : "text-zinc-500 uppercase",
          )}
        >
          {isRefining ? "Refining..." : capacityAmount}
        </span>
        <div
          aria-label="Context capacity status"
          aria-valuemax={100}
          aria-valuemin={0}
          aria-valuenow={capacity.percent}
          className="h-1 w-16 overflow-hidden rounded-full bg-zinc-800 sm:w-24"
          role="progressbar"
        >
          <div
            className={cn(
              "h-full rounded-full transition-all duration-500 ease-in-out",
              isRefining &&
                "flowent-context-refining-indicator w-1/3 opacity-80",
              toneClassName,
            )}
            style={{ width: isRefining ? undefined : `${capacity.percent}%` }}
          />
        </div>
        {!isRefining && (
          <span className={cn("text-[10px] font-semibold", textClassName)}>
            {capacity.percent}%
          </span>
        )}
      </div>
    </div>
  );
}

function contextCapacityFromMessages(
  messages: Message[],
  draft: string,
  usageInfo: ContextUsageInfo | null,
  contextWindowLimit: number | null,
): ContextCapacity {
  const latestUsageIndex = latestUsageInfoMessageIndex(messages);
  const latestUsageInfo =
    usageInfo ??
    (latestUsageIndex >= 0 ? messages[latestUsageIndex].usage_info : null);
  const baseUsed = latestUsageInfo?.last_token_usage.total_tokens;
  const countedMessages =
    latestUsageInfo && latestUsageIndex >= 0
      ? messages.slice(latestUsageIndex + 1)
      : latestUsageInfo
        ? []
        : messages;
  const used = [
    ...countedMessages.map((message) => message.content),
    draft,
  ].reduce(
    (total, content) => total + approximateContextUnits(content),
    Math.max(0, baseUsed ?? 0),
  );
  const total = Math.max(
    1,
    contextWindowLimit ??
      latestUsageInfo?.model_context_window ??
      CONTEXT_CAPACITY_LIMIT,
  );
  const percent = contextCapacityPercent(used, total);

  return {
    percent,
    tone: percent > 90 ? "critical" : percent >= 75 ? "warning" : "neutral",
    total,
    used,
  };
}

function latestUsageInfoMessageIndex(messages: Message[]) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].usage_info) {
      return index;
    }
  }
  return -1;
}

function formatContextUnits(units: number) {
  if (units >= 1000) {
    return `${Math.floor(units / 1000)}k`;
  }

  return units.toString();
}

function contextCapacityPercent(used: number, total: number) {
  if (total <= CONTEXT_BASELINE_UNITS) {
    return used > 0 ? 100 : 0;
  }

  const effectiveUsed = Math.max(0, used - CONTEXT_BASELINE_UNITS);
  const effectiveTotal = total - CONTEXT_BASELINE_UNITS;
  return Math.min(100, Math.floor((effectiveUsed / effectiveTotal) * 100));
}

function approximateContextUnits(content: string) {
  if (!content) {
    return 0;
  }
  return Math.max(1, Math.ceil(new TextEncoder().encode(content).length / 4));
}

function shouldHandleSoftKeyboardSubmit() {
  if (typeof navigator === "undefined") {
    return false;
  }

  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}
