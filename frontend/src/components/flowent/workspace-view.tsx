import {
  Fragment,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  Check,
  ChevronRight,
  Copy,
  Pencil,
  RotateCcw,
  Save,
  SendHorizontal,
  Sparkles,
  TriangleAlert,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { TooltipProvider } from "@/components/ui/tooltip";
import { MarkdownMessage } from "@/components/flowent/markdown-message";
import { stableScrollbarClassName } from "@/components/flowent/styles";
import type {
  AssistantOutputGroup,
  ContextUsageInfo,
  Message,
  MessageActionRequest,
  MessageErrorRetryRequest,
  WorkspaceCommand,
  WorkspaceCommandId,
} from "@/components/flowent/types";
import {
  AssistantOutputTimeline,
  AssistantWaitingIndicator,
} from "@/components/flowent/workspace/assistant-output";
import { assistantOutputGroups } from "@/components/flowent/workspace/assistant-output-state";
import { ChatComposer } from "@/components/flowent/workspace/chat-composer";
import { MessageIconButton } from "@/components/flowent/workspace/message-icon-button";
import { MessageShortcutRail } from "@/components/flowent/workspace/message-shortcut-rail";
import { latestPlanFromMessages } from "@/components/flowent/workspace/plan-state";
import type { Skill } from "@/features/skills/model/skill-types";
import { cn } from "@/lib/utils";

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
            onRetryError={onRetryError}
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
  onRetryError,
  onRetryMessage,
}: {
  composerOffset: number;
  isResponding: boolean;
  messages: Message[];
  onEditMessage: (request: MessageActionRequest) => void;
  onRetryError: (request: MessageErrorRetryRequest) => void;
  onRetryMessage: (messageId: string) => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const initialPositionedMessageIdRef = useRef("");
  const hasPositionedInitialHistoryRef = useRef(false);
  const shouldFollowRef = useRef(true);
  const shouldSkipNextFollowScrollRef = useRef(false);
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

  useLayoutEffect(() => {
    if (
      hasPositionedInitialHistoryRef.current ||
      displayMessages.length === 0
    ) {
      return;
    }

    const list = listRef.current;
    if (!list) {
      return;
    }

    hasPositionedInitialHistoryRef.current = true;
    initialPositionedMessageIdRef.current = latestMessageId;
    shouldFollowRef.current = true;
    shouldSkipNextFollowScrollRef.current = true;
    list.scrollTop = Math.max(0, list.scrollHeight - list.clientHeight);
  }, [displayMessages.length, latestMessageId]);

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
    if (shouldSkipNextFollowScrollRef.current) {
      shouldSkipNextFollowScrollRef.current = false;
      return;
    }
    if (initialPositionedMessageIdRef.current === latestMessageId) {
      return;
    }
    scrollMarkerRef.current?.scrollIntoView({
      block: "end",
      behavior: "smooth",
    });
  }, [displayMessages, latestMessageAuthor, latestMessageId]);

  useEffect(() => {
    if (
      !latestMessageId ||
      initialPositionedMessageIdRef.current !== latestMessageId
    ) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      if (initialPositionedMessageIdRef.current === latestMessageId) {
        initialPositionedMessageIdRef.current = "";
      }
    }, 0);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [latestMessageId]);

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
                onRetryError={onRetryError}
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

function SystemMessage({ message }: { message: Message }) {
  const [isOpen, setIsOpen] = useState(false);
  const shouldReduceMotion = useReducedMotion();
  const isCompactContextMessage =
    message.content === "Context compacted" ||
    message.content === "Context optimized";
  const Icon =
    message.content === "Context optimized"
      ? Sparkles
      : message.content === "Context compacted"
        ? Check
        : null;

  if (isCompactContextMessage) {
    const summaryId = `${message.id}-summary`;

    return (
      <div className="mx-auto flex w-full max-w-4xl py-3">
        <div className="w-full overflow-hidden rounded-xl border border-white/10 bg-input/20 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
          <Button
            aria-controls={summaryId}
            aria-expanded={isOpen}
            className="h-auto w-full justify-between rounded-xl border-0 bg-transparent px-4 py-3 text-left text-base leading-5 text-white/80 shadow-none hover:bg-input/30 hover:text-white focus-visible:ring-2 focus-visible:ring-white/20"
            onClick={() => setIsOpen((current) => !current)}
            type="button"
            variant="ghost"
          >
            <span className="flex min-w-0 items-center gap-2">
              {Icon ? (
                <Icon
                  aria-hidden="true"
                  className="size-4 shrink-0 text-white/55"
                />
              ) : null}
              <span className="truncate font-medium">{message.content}</span>
            </span>
            <ChevronRight
              aria-hidden="true"
              className={cn(
                "size-4 shrink-0 text-white/45 transition-transform duration-200",
                isOpen && "rotate-90",
              )}
            />
          </Button>
          <AnimatePresence initial={false}>
            {isOpen ? (
              <motion.div
                animate={{ height: "auto", opacity: 1 }}
                className="overflow-hidden"
                exit={
                  shouldReduceMotion
                    ? { opacity: 0 }
                    : { height: 0, opacity: 0 }
                }
                initial={
                  shouldReduceMotion
                    ? { opacity: 0 }
                    : { height: 0, opacity: 0 }
                }
                transition={{ duration: 0.18, ease: [0.32, 0.72, 0, 1] }}
              >
                <div
                  aria-label={`${message.content} summary`}
                  className="border-t border-white/10 px-4 py-3 text-sm leading-6 text-white/80"
                  id={summaryId}
                  role="region"
                >
                  <MarkdownMessage content={message.summary ?? ""} />
                </div>
              </motion.div>
            ) : null}
          </AnimatePresence>
        </div>
      </div>
    );
  }

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
  onRetryError,
  onRetryMessage,
}: {
  isPending: boolean;
  isResponding: boolean;
  isStreaming: boolean;
  message: Message;
  onEditMessage: (request: MessageActionRequest) => void;
  onRetryError: (request: MessageErrorRetryRequest) => void;
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
                  disableErrorRetry={isRetryUnavailable}
                  isStreaming={isStreaming}
                  message={message}
                  onRetryError={(errorId) =>
                    onRetryError({ errorId, messageId: message.id })
                  }
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

function AssistantMessageContent({
  assistantGroups,
  disableErrorRetry,
  isStreaming,
  message,
  onRetryError,
  showWaitingAfterOutput,
}: {
  assistantGroups: AssistantOutputGroup[];
  disableErrorRetry: boolean;
  isStreaming: boolean;
  message: Message;
  onRetryError: (errorId: string) => void;
  showWaitingAfterOutput: boolean;
}) {
  if (message.author === "assistant") {
    return (
      <div className="flowent-markdown-message min-w-0 break-words">
        <AssistantOutputTimeline
          disableErrorRetry={disableErrorRetry}
          groups={assistantGroups}
          isStreaming={isStreaming}
          onRetryError={onRetryError}
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
