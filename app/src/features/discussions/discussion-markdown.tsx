import { memo, type ReactNode } from "react";
import Markdown from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import type { Member, MentionReference } from "@/lib/backend";
import { codePointRangeToUtf16 } from "@/lib/mention-normalization";

function isUnsafeUrlCharacter(character: string): boolean {
  const codePoint = character.codePointAt(0) ?? 0;
  return (
    codePoint <= 0x20 ||
    codePoint === 0x7f ||
    /[\p{C}\p{Z}]/u.test(character) ||
    character.trim() === ""
  );
}

export function safeDiscussionLink(value: string | undefined): string | null {
  if (!value) {
    return null;
  }
  if (
    value !== value.trim() ||
    [...value].some(isUnsafeUrlCharacter) ||
    !/^https?:\/\//iu.test(value)
  ) {
    return null;
  }

  let decodedValue: string;
  try {
    decodedValue = decodeURI(value);
  } catch {
    return null;
  }
  if ([...decodedValue].some(isUnsafeUrlCharacter)) {
    return null;
  }

  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.href
      : null;
  } catch {
    return null;
  }
}

function OmittedImage({ alt }: { alt?: string }) {
  return (
    <span className="message-markdown-image-omitted">
      {alt ? `[Image omitted: ${alt}]` : "[Image omitted]"}
    </span>
  );
}

function SafeLink({ children, href }: { children?: ReactNode; href?: string }) {
  const safeHref = safeDiscussionLink(href);
  return safeHref ? (
    <a href={safeHref} rel="noopener noreferrer" target="_blank">
      {children}
    </a>
  ) : (
    children
  );
}

type MdastNode = {
  type?: string;
  value?: string;
  children?: MdastNode[];
  position?: { start?: { offset?: number }; end?: { offset?: number } };
  data?: {
    hName?: string;
    hProperties?: Record<string, unknown>;
  };
};

function referenceClassName(reference: MentionReference): string {
  return [
    "mention-reference",
    reference.notified
      ? "mention-reference--notified"
      : reference.in_discussion
        ? "mention-reference--in-discussion"
        : "mention-reference--group-out",
    reference.deleted ? "mention-reference--deleted" : "",
  ]
    .filter(Boolean)
    .join(" ");
}

export function mentionReferenceTriggerKey(
  messageId: number,
  referenceIndex: number,
  start: number,
  end: number,
): string {
  return `discussion-message:${messageId}:reference:${referenceIndex}:${start}:${end}`;
}

export function createMentionReferencePlugin(
  body: string,
  references: MentionReference[],
  members: readonly Pick<Member, "id" | "name">[],
  messageId?: number,
) {
  const activeMembersById = new Map(
    members.map((member) => [member.id, member] as const),
  );
  const positioned = references
    .flatMap((reference, referenceIndex) => {
      if (reference.start === null || reference.end === null) {
        return [];
      }
      const range = codePointRangeToUtf16(body, reference.start, reference.end);
      return range
        ? [
            {
              ...reference,
              ...range,
              referenceEnd: reference.end,
              referenceIndex,
              referenceStart: reference.start,
            },
          ]
        : [];
    })
    .sort((left, right) => left.start - right.start || left.end - right.end);

  return () => (tree: MdastNode) => {
    function visit(node: MdastNode) {
      if (!node.children) {
        return;
      }
      const nextChildren: MdastNode[] = [];
      for (const child of node.children) {
        const nodeStart = child.position?.start?.offset;
        const nodeEnd = child.position?.end?.offset;
        if (
          child.type !== "text" ||
          typeof child.value !== "string" ||
          typeof nodeStart !== "number" ||
          typeof nodeEnd !== "number" ||
          body.slice(nodeStart, nodeEnd) !== child.value
        ) {
          visit(child);
          nextChildren.push(child);
          continue;
        }
        const matches = positioned.filter(
          (reference) =>
            reference.start >= nodeStart && reference.end <= nodeEnd,
        );
        if (matches.length === 0) {
          nextChildren.push(child);
          continue;
        }
        let cursor = 0;
        for (const reference of matches) {
          const start = reference.start - nodeStart;
          const end = reference.end - nodeStart;
          if (start < cursor || end > child.value.length) {
            continue;
          }
          if (start > cursor) {
            nextChildren.push({
              type: "text",
              value: child.value.slice(cursor, start),
            });
          }
          const activeMember = activeMembersById.get(reference.member_id);
          const active = !reference.deleted && Boolean(activeMember);
          const displayName = activeMember?.name ?? reference.name;
          const triggerKey =
            messageId === undefined
              ? undefined
              : mentionReferenceTriggerKey(
                  messageId,
                  reference.referenceIndex,
                  reference.referenceStart,
                  reference.referenceEnd,
                );
          const stateLabel = reference.notified
            ? "Notified"
            : reference.in_discussion
              ? "In Discussion · Not notified"
              : "Not in Discussion · Not notified";
          nextChildren.push({
            type: "text",
            value: active ? `@${displayName}` : child.value.slice(start, end),
            data: {
              hName: active ? "button" : "mark",
              hProperties: {
                className: `${referenceClassName(reference)}${
                  !active && !reference.deleted
                    ? " mention-reference--unavailable"
                    : ""
                }`,
                title: `@${displayName} · ${stateLabel}${
                  reference.deleted
                    ? " · Deleted member"
                    : !active
                      ? " · Member unavailable"
                      : ""
                }`,
                ...(active
                  ? {
                      "aria-label": `Open ${displayName} in Members`,
                      "data-member-id": reference.member_id,
                      ...(triggerKey
                        ? { "data-member-navigation-key": triggerKey }
                        : {}),
                      type: "button",
                    }
                  : reference.deleted
                    ? { "aria-label": `@${reference.name}, Deleted member` }
                    : {
                        "aria-label": `@${reference.name}, Member unavailable`,
                      }),
              },
            },
          });
          cursor = end;
        }
        if (cursor < child.value.length) {
          nextChildren.push({ type: "text", value: child.value.slice(cursor) });
        }
      }
      node.children = nextChildren;
    }
    visit(tree);
  };
}

export type DiscussionMarkdownProps = {
  body: string;
  members?: readonly Pick<Member, "id" | "name">[];
  messageId?: number;
  onOpenMember?: (memberId: number, triggerKey: string) => void;
  references: MentionReference[];
};

export function areDiscussionMarkdownPropsEqual(
  previous: DiscussionMarkdownProps,
  next: DiscussionMarkdownProps,
) {
  return (
    previous.body === next.body &&
    previous.onOpenMember === next.onOpenMember &&
    previous.messageId === next.messageId &&
    (previous.members?.length ?? 0) === (next.members?.length ?? 0) &&
    (previous.members ?? []).every((member, index) => {
      const candidate = next.members?.[index];
      return member.id === candidate?.id && member.name === candidate?.name;
    }) &&
    previous.references.length === next.references.length &&
    previous.references.every((reference, index) => {
      const candidate = next.references[index];
      return (
        reference.member_id === candidate.member_id &&
        reference.name === candidate.name &&
        reference.start === candidate.start &&
        reference.end === candidate.end &&
        reference.in_discussion === candidate.in_discussion &&
        reference.notified === candidate.notified &&
        reference.deleted === candidate.deleted
      );
    })
  );
}

export const DiscussionMarkdown = memo(function DiscussionMarkdown({
  body,
  members = [],
  messageId,
  onOpenMember,
  references,
}: DiscussionMarkdownProps) {
  return (
    <div className="message-markdown">
      <Markdown
        allowElement={(element) => !element.properties.dataFootnotes}
        components={{
          a: ({ children, href }) => (
            <SafeLink href={href}>{children}</SafeLink>
          ),
          button: ({ children, node, ...props }) => {
            const memberId = Number(node?.properties["data-member-id"]);
            const triggerKey = String(
              node?.properties["data-member-navigation-key"] ?? "",
            );
            return (
              <button
                {...props}
                onClick={() => {
                  if (Number.isSafeInteger(memberId) && triggerKey) {
                    onOpenMember?.(memberId, triggerKey);
                  }
                }}
              >
                {children}
              </button>
            );
          },
          img: ({ alt }) => <OmittedImage alt={alt} />,
          table: ({ children, node: _node, ...props }) => (
            <div className="message-markdown-table-scroll">
              <table {...props}>{children}</table>
            </div>
          ),
        }}
        disallowedElements={["sup"]}
        remarkPlugins={[
          remarkGfm,
          remarkBreaks,
          createMentionReferencePlugin(body, references, members, messageId),
        ]}
        skipHtml
        urlTransform={(value) => safeDiscussionLink(value) ?? ""}
      >
        {body}
      </Markdown>
    </div>
  );
}, areDiscussionMarkdownPropsEqual);
