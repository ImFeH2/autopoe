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
