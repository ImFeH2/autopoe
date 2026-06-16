import type { Message } from "@/components/flowent/types";

export function promptHistoryFromMessages(messages: Message[]) {
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
