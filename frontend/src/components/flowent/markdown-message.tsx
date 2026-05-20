import type { ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { cn } from "@/lib/utils";

type MarkdownProps<T> = T & {
  node?: MarkdownNode;
};

type MarkdownNode = {
  children?: MarkdownNode[];
  tagName?: string;
  position?: {
    end?: {
      line?: number;
      offset?: number;
    };
    start?: {
      line?: number;
    };
  };
  type?: string;
};

const cleanMarkdownProps = <T,>(props: MarkdownProps<T>) => {
  const nextProps = { ...props };
  delete nextProps.node;
  return nextProps;
};

const Cursor = () => (
  <span
    aria-hidden="true"
    className="flowent-response-cursor"
    data-testid="response-cursor"
  />
);

const nodeEndOffset = (node?: MarkdownNode) =>
  node?.position?.end?.offset ?? -1;

const lastContentOffset = (node?: MarkdownNode): number => {
  if (!node) {
    return -1;
  }

  const ownOffset = nodeEndOffset(node);
  const childOffsets = (node.children ?? []).map(lastContentOffset);

  return Math.max(ownOffset, ...childOffsets);
};

const blockChildTags = new Set([
  "blockquote",
  "h1",
  "h2",
  "h3",
  "ol",
  "p",
  "pre",
  "table",
  "ul",
]);

const hasBlockElementChild = (node?: MarkdownNode) =>
  (node?.children ?? []).some(
    (child) =>
      child.type === "element" &&
      child.tagName !== undefined &&
      blockChildTags.has(child.tagName),
  );

const isBlockCodeNode = (node?: MarkdownNode) =>
  typeof node?.position?.start?.line === "number" &&
  typeof node.position.end?.line === "number" &&
  node.position.start.line !== node.position.end.line;

const shouldShowCursor = (node: MarkdownNode | undefined, lastOffset: number) =>
  lastOffset >= 0 && lastContentOffset(node) === lastOffset;

const withCursor = (children: ReactNode, showCursor: boolean) => (
  <>
    {children}
    {showCursor ? <Cursor /> : null}
  </>
);

export function MarkdownMessage({
  content,
  isStreaming = false,
}: {
  content: string;
  isStreaming?: boolean;
}) {
  const lastOffset = isStreaming ? content.trimEnd().length : -1;

  return (
    <ReactMarkdown
      components={{
        a: ({ className, ...props }) => (
          <a
            className={cn("text-white underline underline-offset-4", className)}
            rel="noreferrer"
            target="_blank"
            {...cleanMarkdownProps(props)}
          />
        ),
        blockquote: ({ className, ...props }) => (
          <blockquote
            className={cn(
              "my-3 border-l border-white/20 pl-4 text-white/80",
              className,
            )}
            {...cleanMarkdownProps(props)}
          />
        ),
        code: ({ className, children, node, ...props }) => {
          const isBlockCode = isBlockCodeNode(node);

          return (
            <code
              className={cn(
                "font-mono text-[0.92em] text-white",
                !isBlockCode && "rounded bg-white/10 px-1.5 py-0.5",
                className,
              )}
              {...cleanMarkdownProps(props)}
            >
              {withCursor(
                children,
                shouldShowCursor(node, lastOffset) && isBlockCode,
              )}
            </code>
          );
        },
        h1: ({ className, children, node, ...props }) => (
          <h1
            className={cn(
              "mb-3 mt-5 text-2xl font-semibold text-white",
              className,
            )}
            {...cleanMarkdownProps(props)}
          >
            {withCursor(children, shouldShowCursor(node, lastOffset))}
          </h1>
        ),
        h2: ({ className, children, node, ...props }) => (
          <h2
            className={cn(
              "mb-2.5 mt-5 text-xl font-semibold text-white",
              className,
            )}
            {...cleanMarkdownProps(props)}
          >
            {withCursor(children, shouldShowCursor(node, lastOffset))}
          </h2>
        ),
        h3: ({ className, children, node, ...props }) => (
          <h3
            className={cn(
              "mb-2 mt-4 text-lg font-semibold text-white",
              className,
            )}
            {...cleanMarkdownProps(props)}
          >
            {withCursor(children, shouldShowCursor(node, lastOffset))}
          </h3>
        ),
        hr: ({ className, ...props }) => (
          <hr
            className={cn("my-4 border-white/10", className)}
            {...cleanMarkdownProps(props)}
          />
        ),
        li: ({ className, children, node, ...props }) => (
          <li className={cn("pl-1", className)} {...cleanMarkdownProps(props)}>
            {withCursor(
              children,
              shouldShowCursor(node, lastOffset) && !hasBlockElementChild(node),
            )}
          </li>
        ),
        ol: ({ className, ...props }) => (
          <ol
            className={cn("my-3 list-decimal space-y-1 pl-6", className)}
            {...cleanMarkdownProps(props)}
          />
        ),
        p: ({ className, children, node, ...props }) => (
          <p
            className={cn("my-3 first:mt-0 last:mb-0", className)}
            {...cleanMarkdownProps(props)}
          >
            {withCursor(children, shouldShowCursor(node, lastOffset))}
          </p>
        ),
        pre: ({ className, ...props }) => (
          <pre
            className={cn(
              "my-3 overflow-x-auto rounded-lg border border-white/10 bg-white/[0.045] p-3 text-sm leading-6 text-white",
              className,
            )}
            {...cleanMarkdownProps(props)}
          />
        ),
        table: ({ className, ...props }) => (
          <div className="my-3 overflow-x-auto">
            <table
              className={cn(
                "w-full border-collapse text-left text-sm",
                className,
              )}
              {...cleanMarkdownProps(props)}
            />
          </div>
        ),
        tbody: ({ className, ...props }) => (
          <tbody
            className={cn("divide-y divide-white/10", className)}
            {...cleanMarkdownProps(props)}
          />
        ),
        td: ({ className, ...props }) => (
          <td
            className={cn(
              "border border-white/10 px-3 py-2 align-top",
              className,
            )}
            {...cleanMarkdownProps(props)}
          />
        ),
        th: ({ className, ...props }) => (
          <th
            className={cn(
              "border border-white/10 bg-white/[0.04] px-3 py-2 font-medium",
              className,
            )}
            {...cleanMarkdownProps(props)}
          />
        ),
        thead: ({ className, ...props }) => (
          <thead
            className={cn("text-white", className)}
            {...cleanMarkdownProps(props)}
          />
        ),
        ul: ({ className, ...props }) => (
          <ul
            className={cn("my-3 list-disc space-y-1 pl-6", className)}
            {...cleanMarkdownProps(props)}
          />
        ),
      }}
      remarkPlugins={[remarkGfm]}
    >
      {content}
    </ReactMarkdown>
  );
}
