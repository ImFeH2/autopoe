import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowUp } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { Message } from "@/components/flowent/types";
import { cn } from "@/lib/utils";

const ASSISTANT_REVEAL_STEP_MS = 16;
const ASSISTANT_REVEAL_MIN_CHARS = 3;
const ASSISTANT_REVEAL_TARGET_FRAMES = 140;

export function WorkspaceView({
  animatedAssistantMessageId,
  draft,
  errorMessage,
  isResponding,
  messages,
  onAssistantAnimationComplete,
  onDraftChange,
  onSendMessage,
}: {
  animatedAssistantMessageId: string;
  draft: string;
  errorMessage: string;
  isResponding: boolean;
  messages: Message[];
  onAssistantAnimationComplete: () => void;
  onDraftChange: (value: string) => void;
  onSendMessage: () => void;
}) {
  return (
    <section
      className="h-full min-h-0 bg-black max-[900px]:h-[calc(100vh-126px)] max-[900px]:min-h-[calc(100vh-126px)]"
      aria-label="Workspace"
    >
      <div className="relative h-full min-h-0 min-w-0 overflow-hidden">
        <MessageList
          animatedAssistantMessageId={animatedAssistantMessageId}
          isResponding={isResponding}
          messages={messages}
          onAssistantAnimationComplete={onAssistantAnimationComplete}
        />
        <ChatComposer
          draft={draft}
          errorMessage={errorMessage}
          isSending={isResponding || Boolean(animatedAssistantMessageId)}
          onDraftChange={onDraftChange}
          onSendMessage={onSendMessage}
        />
      </div>
    </section>
  );
}

function MessageList({
  animatedAssistantMessageId,
  isResponding,
  messages,
  onAssistantAnimationComplete,
}: {
  animatedAssistantMessageId: string;
  isResponding: boolean;
  messages: Message[];
  onAssistantAnimationComplete: () => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const shouldFollowRef = useRef(true);
  const scrollMarkerRef = useRef<HTMLDivElement>(null);
  const displayMessages = useMemo(() => {
    if (!isResponding) {
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

  useEffect(() => {
    if (!shouldFollowRef.current) {
      return;
    }
    scrollMarkerRef.current?.scrollIntoView({
      block: "end",
      behavior: "smooth",
    });
  }, [displayMessages, animatedAssistantMessageId]);

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
      className="absolute inset-0 flex min-h-0 flex-col overflow-auto bg-black px-6 pb-40 pt-12 max-[900px]:px-4"
      onScroll={updateFollowState}
      ref={listRef}
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
          isAnimating={message.id === animatedAssistantMessageId}
          isPending={message.id === "assistant-pending"}
          key={message.id}
          message={message}
          onAnimationComplete={onAssistantAnimationComplete}
          onRevealFrame={() => {
            if (!shouldFollowRef.current) {
              return;
            }
            scrollMarkerRef.current?.scrollIntoView({
              block: "end",
              behavior: "smooth",
            });
          }}
        />
      ))}
      <div aria-hidden="true" ref={scrollMarkerRef} />
    </div>
  );
}

function MessageRow({
  isAnimating,
  isPending,
  message,
  onAnimationComplete,
  onRevealFrame,
}: {
  isAnimating: boolean;
  isPending: boolean;
  message: Message;
  onAnimationComplete: () => void;
  onRevealFrame: () => void;
}) {
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
            : "max-w-full",
        )}
      >
        {isPending ? (
          <AssistantWaitingIndicator />
        ) : (
          <AssistantMessageContent
            isAnimating={isAnimating}
            message={message}
            onAnimationComplete={onAnimationComplete}
            onRevealFrame={onRevealFrame}
          />
        )}
      </div>
    </article>
  );
}

function AssistantMessageContent({
  isAnimating,
  message,
  onAnimationComplete,
  onRevealFrame,
}: {
  isAnimating: boolean;
  message: Message;
  onAnimationComplete: () => void;
  onRevealFrame: () => void;
}) {
  const visibleContent = useRevealedText({
    content: message.content,
    isActive: isAnimating && message.author === "assistant",
    onComplete: onAnimationComplete,
    onRevealFrame,
  });
  const isRevealing =
    isAnimating &&
    message.author === "assistant" &&
    visibleContent.length < message.content.length;

  return (
    <p className="m-0 whitespace-pre-wrap break-words">
      {visibleContent}
      {isRevealing ? (
        <span aria-hidden="true" className="flowent-response-cursor" />
      ) : null}
    </p>
  );
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

function useRevealedText({
  content,
  isActive,
  onComplete,
  onRevealFrame,
}: {
  content: string;
  isActive: boolean;
  onComplete: () => void;
  onRevealFrame: () => void;
}) {
  const [visibleLength, setVisibleLength] = useState(content.length);

  useEffect(() => {
    if (!isActive) {
      setVisibleLength(content.length);
      return;
    }

    setVisibleLength(0);
  }, [content, isActive]);

  useEffect(() => {
    if (!isActive) {
      return;
    }
    if (visibleLength >= content.length) {
      onComplete();
      return;
    }

    const timeout = window.setTimeout(() => {
      setVisibleLength((currentLength) =>
        Math.min(
          content.length,
          currentLength +
            Math.max(
              ASSISTANT_REVEAL_MIN_CHARS,
              Math.ceil(content.length / ASSISTANT_REVEAL_TARGET_FRAMES),
            ),
        ),
      );
      onRevealFrame();
    }, ASSISTANT_REVEAL_STEP_MS);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [content.length, isActive, onComplete, onRevealFrame, visibleLength]);

  return content.slice(0, visibleLength);
}

function ChatComposer({
  draft,
  errorMessage,
  isSending,
  onDraftChange,
  onSendMessage,
}: {
  draft: string;
  errorMessage: string;
  isSending: boolean;
  onDraftChange: (value: string) => void;
  onSendMessage: () => void;
}) {
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-6 z-10 px-6 max-[900px]:px-4">
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
