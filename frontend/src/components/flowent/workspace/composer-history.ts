import type { Message } from "@/features/workspace/model/message-types";

export function promptHistoryFromMessages(messages: Message[]) {
  const history: string[] = [];

  for (const message of messages) {
    if (message.author !== "user") {
      continue;
    }
    appendPromptHistoryEntry(history, message.content);
  }

  return history;
}

export function appendPromptHistoryEntry(history: string[], content: string) {
  if (content.trim().length === 0) {
    return history;
  }
  if (history.at(-1) === content) {
    return history;
  }
  history.push(content);
  return history;
}

export function isCaretOnFirstLine(textarea: HTMLTextAreaElement) {
  return !textarea.value.slice(0, textarea.selectionStart).includes("\n");
}

export function isCaretOnLastLine(textarea: HTMLTextAreaElement) {
  return !textarea.value.slice(textarea.selectionEnd).includes("\n");
}

export function shouldHandleSoftKeyboardSubmit() {
  if (typeof navigator === "undefined") {
    return false;
  }

  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}
