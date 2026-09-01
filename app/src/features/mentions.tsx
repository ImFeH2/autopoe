import type { ReactNode } from "react";
import type { Member } from "../lib/backend";

export function highlightMentions(
  body: string,
  members: Member[],
): ReactNode[] {
  const names = members
    .map((member) => member.name)
    .sort((a, b) => b.length - a.length);
  const nodes: ReactNode[] = [];
  let index = 0;
  let key = 0;

  while (index < body.length) {
    const at = body.indexOf("@", index);
    if (at < 0) break;

    const before = at > 0 ? body[at - 1] : "";
    if (before && /[\p{L}\p{N}]/u.test(before)) {
      index = at + 1;
      continue;
    }

    const matched = names.find((name) => {
      const end = at + 1 + name.length;
      if (body.slice(at + 1, end).toLowerCase() !== name.toLowerCase())
        return false;
      const after = body[end];
      return !after || !/[\p{L}\p{N}]/u.test(after);
    });

    if (!matched) {
      index = at + 1;
      continue;
    }

    if (at > index) nodes.push(body.slice(index, at));
    nodes.push(
      <mark key={`m${key++}`}>{body.slice(at, at + 1 + matched.length)}</mark>,
    );
    index = at + 1 + matched.length;
  }

  if (index < body.length) nodes.push(body.slice(index));
  return nodes.length > 0 ? nodes : [body];
}

const MAX_NAME_LENGTH = 64;

export type MentionQuery = { start: number; query: string };

export function mentionQuery(text: string, caret: number): MentionQuery | null {
  if (caret <= 0) return null;
  const from = Math.max(0, caret - MAX_NAME_LENGTH - 1);
  const at = text.lastIndexOf("@", caret - 1);
  if (at < 0 || at < from) return null;

  const before = at > 0 ? text[at - 1] : "";
  if (before && /[\p{L}\p{N}]/u.test(before)) return null;

  const query = text.slice(at + 1, caret);
  if (query.includes("@") || /[\n\r]/.test(query)) return null;
  return { start: at, query };
}

export function matchMembers(members: Member[], query: string): Member[] {
  const needle = query.trim().toLowerCase();
  return members
    .filter((member) => member.name.toLowerCase().startsWith(needle))
    .sort((a, b) => a.name.length - b.name.length);
}

export function completeMention(
  text: string,
  mention: MentionQuery,
  caret: number,
  name: string,
): { text: string; caret: number } {
  const head = `${text.slice(0, mention.start)}@${name} `;
  return { text: head + text.slice(caret), caret: head.length };
}

export function formatTime(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
