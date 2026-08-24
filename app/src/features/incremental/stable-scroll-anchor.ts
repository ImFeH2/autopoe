export type StableScrollAnchor = { messageId: number; offset: number };
export function captureStableScrollAnchor(
  viewport: HTMLElement,
): StableScrollAnchor | null {
  const viewportTop = viewport.getBoundingClientRect().top;
  const messages = [
    ...viewport.querySelectorAll<HTMLElement>("[data-message-id]"),
  ];
  const target = messages.find(
    (message) => message.getBoundingClientRect().bottom > viewportTop,
  );
  const messageId = Number(target?.dataset.messageId);
  return target && Number.isInteger(messageId)
    ? { messageId, offset: target.getBoundingClientRect().top - viewportTop }
    : null;
}
export function restoreStableScrollAnchor(
  viewport: HTMLElement,
  anchor: StableScrollAnchor,
): boolean {
  const target = viewport.querySelector<HTMLElement>(
    `[data-message-id="${anchor.messageId}"]`,
  );
  if (!target) return false;
  const nextOffset =
    target.getBoundingClientRect().top - viewport.getBoundingClientRect().top;
  viewport.scrollTop += nextOffset - anchor.offset;
  return true;
}
