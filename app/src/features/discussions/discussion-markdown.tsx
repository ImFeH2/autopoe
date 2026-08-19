import { memo, type ReactNode } from "react";
import Markdown from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";

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

export type DiscussionMarkdownProps = {
  body: string;
};

export function areDiscussionMarkdownPropsEqual(
  previous: DiscussionMarkdownProps,
  next: DiscussionMarkdownProps,
) {
  return previous.body === next.body;
}

export const DiscussionMarkdown = memo(function DiscussionMarkdown({
  body,
}: DiscussionMarkdownProps) {
  return (
    <div className="message-markdown">
      <Markdown
        allowElement={(element) => !element.properties.dataFootnotes}
        components={{
          a: ({ children, href }) => (
            <SafeLink href={href}>{children}</SafeLink>
          ),
          img: ({ alt }) => <OmittedImage alt={alt} />,
          table: ({ children, node: _node, ...props }) => (
            <div className="message-markdown-table-scroll">
              <table {...props}>{children}</table>
            </div>
          ),
        }}
        disallowedElements={["sup"]}
        remarkPlugins={[remarkGfm, remarkBreaks]}
        skipHtml
        urlTransform={(value) => safeDiscussionLink(value) ?? ""}
      >
        {body}
      </Markdown>
    </div>
  );
}, areDiscussionMarkdownPropsEqual);
