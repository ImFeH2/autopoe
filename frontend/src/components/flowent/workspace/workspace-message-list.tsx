import { Fragment, useEffect, useLayoutEffect, useMemo, useRef } from "react";

import { stableScrollbarClassName } from "@/components/flowent/styles";
import { MessageShortcutRail } from "@/components/flowent/workspace/message-shortcut-rail";
import { WorkspaceMessageRow } from "@/components/flowent/workspace/workspace-message-row";
import { WorkspaceSystemMessage } from "@/components/flowent/workspace/workspace-system-message";
import type {
  Message,
  MessageActionRequest,
  MessageErrorRetryRequest,
} from "@/features/workspace/model/message-types";
import { cn } from "@/lib/utils";

export function WorkspaceMessageList({
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
              <WorkspaceSystemMessage message={message} />
            ) : (
              <WorkspaceMessageRow
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
