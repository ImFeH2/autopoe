import { useEffect, useRef, useState } from "react";
import {
  Check,
  Copy,
  Pencil,
  RotateCcw,
  Save,
  SendHorizontal,
  TriangleAlert,
  X,
} from "lucide-react";

import {
  AssistantOutputTimeline,
  AssistantWaitingIndicator,
} from "@/components/flowent/workspace/assistant-output";
import { assistantOutputGroups } from "@/components/flowent/workspace/assistant-output-state";
import { MessageIconButton } from "@/components/flowent/workspace/message-icon-button";
import { Textarea } from "@/components/ui/textarea";
import type {
  AssistantOutputGroup,
  Message,
  MessageActionRequest,
  MessageErrorRetryRequest,
} from "@/features/workspace/model/message-types";
import { cn } from "@/lib/utils";

export function WorkspaceMessageRow({
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
