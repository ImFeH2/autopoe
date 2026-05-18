import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { cn } from "@/lib/utils";

type MarkdownProps<T> = T & {
  node?: unknown;
};

const cleanMarkdownProps = <T,>(props: MarkdownProps<T>) => {
  const nextProps = { ...props };
  delete nextProps.node;
  return nextProps;
};

export function MarkdownMessage({ content }: { content: string }) {
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
        code: ({ className, children, ...props }) => (
          <code
            className={cn(
              "rounded bg-white/10 px-1.5 py-0.5 font-mono text-[0.92em] text-white",
              className,
            )}
            {...cleanMarkdownProps(props)}
          >
            {children}
          </code>
        ),
        h1: ({ className, ...props }) => (
          <h1
            className={cn(
              "mb-3 mt-5 text-2xl font-semibold text-white",
              className,
            )}
            {...cleanMarkdownProps(props)}
          />
        ),
        h2: ({ className, ...props }) => (
          <h2
            className={cn(
              "mb-2.5 mt-5 text-xl font-semibold text-white",
              className,
            )}
            {...cleanMarkdownProps(props)}
          />
        ),
        h3: ({ className, ...props }) => (
          <h3
            className={cn(
              "mb-2 mt-4 text-lg font-semibold text-white",
              className,
            )}
            {...cleanMarkdownProps(props)}
          />
        ),
        hr: ({ className, ...props }) => (
          <hr
            className={cn("my-4 border-white/10", className)}
            {...cleanMarkdownProps(props)}
          />
        ),
        li: ({ className, ...props }) => (
          <li
            className={cn("pl-1", className)}
            {...cleanMarkdownProps(props)}
          />
        ),
        ol: ({ className, ...props }) => (
          <ol
            className={cn("my-3 list-decimal space-y-1 pl-6", className)}
            {...cleanMarkdownProps(props)}
          />
        ),
        p: ({ className, ...props }) => (
          <p
            className={cn("my-3 first:mt-0 last:mb-0", className)}
            {...cleanMarkdownProps(props)}
          />
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
