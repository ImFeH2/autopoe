import {
  type KeyboardEvent,
  type RefObject,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  appendPromptHistoryEntry,
  isCaretOnFirstLine,
  isCaretOnLastLine,
  promptHistoryFromMessages,
} from "@/components/flowent/workspace/composer-history";
import type { Message } from "@/features/workspace/model/message-types";

export function usePromptHistoryNavigation({
  draft,
  messages,
  onBeforeNavigate,
  onDraftChange,
  textareaRef,
}: {
  draft: string;
  messages: Message[];
  onBeforeNavigate: () => void;
  onDraftChange: (value: string) => void;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
}) {
  const preserveNavigationRef = useRef(false);
  const historyIndexRef = useRef<number | null>(null);
  const stagedDraftRef = useRef("");
  const [sessionHistory, setSessionHistory] = useState<string[]>([]);
  const messageHistory = useMemo(
    () => promptHistoryFromMessages(messages),
    [messages],
  );
  const messageHistoryRef = useRef<string[]>(messageHistory);
  const promptHistory =
    sessionHistory.length > 0 ? sessionHistory : messageHistory;

  useEffect(() => {
    if (messageHistory.length > 0) {
      messageHistoryRef.current = messageHistory;
    }
  }, [messageHistory]);

  useEffect(() => {
    if (preserveNavigationRef.current) {
      preserveNavigationRef.current = false;
      return;
    }

    historyIndexRef.current = null;
    stagedDraftRef.current = "";
  }, [draft]);

  const rememberPromptHistory = (content: string) => {
    setSessionHistory((currentHistory) =>
      appendPromptHistoryEntry(
        currentHistory.length > 0
          ? [...currentHistory]
          : [...messageHistoryRef.current],
        content,
      ),
    );
  };

  const setDraftFromHistory = (value: string) => {
    preserveNavigationRef.current = true;
    onBeforeNavigate();
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
        stagedDraftRef.current = textarea.value;
      }
      historyIndexRef.current = nextIndex;
      setDraftFromHistory(promptHistory[nextIndex]);
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
      setDraftFromHistory(stagedDraftRef.current);
      stagedDraftRef.current = "";
      return true;
    }

    historyIndexRef.current = nextIndex;
    setDraftFromHistory(promptHistory[nextIndex]);
    return true;
  };

  return { navigatePromptHistory, rememberPromptHistory };
}
