import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import type { Message } from "@/features/workspace/model/message-types";
import { cn } from "@/lib/utils";

export function MessageShortcutRail({
  messageListRef,
  messages,
}: {
  messageListRef: { current: HTMLDivElement | null };
  messages: Message[];
}) {
  const { t } = useTranslation();
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
      aria-label={t("workspace.conversation.shortcuts")}
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
        className="pointer-events-auto flowent-hidden-scrollbar flex max-h-[min(78vh,620px)] flex-col items-end gap-1.5 overflow-x-hidden overflow-y-auto overscroll-contain rounded-2xl bg-black/20 p-2 shadow-[0_16px_44px_rgba(0,0,0,0.2)] backdrop-blur-sm transition-colors duration-200 group-hover/shortcut-rail:bg-black/70"
        ref={railRef}
      >
        {messages.map((message) => {
          const isHovered = hoveredMessageId === message.id;
          const summary = messageShortcutSummary(
            message.content,
            t("workspace.conversation.message"),
          );
          const actor =
            message.author === "user"
              ? t("workspace.conversation.you")
              : t("workspace.conversation.flowent");
          const showSummary = isRailActive || isRailFocused || isHovered;

          return (
            <Button
              aria-label={t("workspace.conversation.jumpTo", {
                actor,
                summary,
              })}
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

function messageShortcutSummary(content: string, fallback: string) {
  const summary = content
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0)
    ?.replace(/\s+/g, " ");

  if (!summary) {
    return fallback;
  }
  if (summary.length <= 64) {
    return summary;
  }

  return `${summary.slice(0, 61)}…`;
}
