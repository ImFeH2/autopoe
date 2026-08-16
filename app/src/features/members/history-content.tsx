import type { ReactNode } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

function parseJson(content: string): unknown | null {
  const trimmed = content.trim();
  if (!trimmed || (!trimmed.startsWith("{") && !trimmed.startsWith("["))) {
    return null;
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

const jsonTokenPattern =
  /("(?:\\.|[^"\\])*")(?=\s*:)|"(?:\\.|[^"\\])*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|\b(?:true|false|null)\b/g;

function jsonTokenClass(token: string, isKey: boolean) {
  if (isKey) {
    return "agent-history-json-key";
  }
  if (token.startsWith('"')) {
    return "agent-history-json-string";
  }
  if (token === "true" || token === "false") {
    return "agent-history-json-boolean";
  }
  if (token === "null") {
    return "agent-history-json-null";
  }
  return "agent-history-json-number";
}

export function JsonContent({ value }: { value: unknown }) {
  const source = JSON.stringify(value, null, 2);
  const nodes: ReactNode[] = [];
  let cursor = 0;
  let match = jsonTokenPattern.exec(source);
  while (match) {
    if (match.index > cursor) {
      nodes.push(source.slice(cursor, match.index));
    }
    const token = match[0];
    const remaining = source.slice(match.index + token.length);
    nodes.push(
      <span
        className={jsonTokenClass(token, /^\s*:/.test(remaining))}
        key={`${match.index}-${token}`}
      >
        {token}
      </span>,
    );
    cursor = match.index + token.length;
    match = jsonTokenPattern.exec(source);
  }
  if (cursor < source.length) {
    nodes.push(source.slice(cursor));
  }
  return <pre className="agent-history-json">{nodes}</pre>;
}

export function HistoryContent({ content }: { content: string }) {
  const json = parseJson(content);
  if (json !== null) {
    return <JsonContent value={json} />;
  }
  return (
    <div className="agent-history-markdown">
      <Markdown
        components={{
          a: ({ children, ...props }) => (
            <a {...props} rel="noreferrer" target="_blank">
              {children}
            </a>
          ),
          pre: ({ children }) => (
            <div className="agent-history-code-block">{children}</div>
          ),
          code: ({ children, className, ...props }) => {
            const language = className?.replace("language-", "");
            const source = String(children).replace(/\n$/, "");
            const codeJson = language === "json" ? parseJson(source) : null;
            return codeJson !== null ? (
              <JsonContent value={codeJson} />
            ) : (
              <code className={className} {...props}>
                {children}
              </code>
            );
          },
        }}
        remarkPlugins={[remarkGfm]}
      >
        {content}
      </Markdown>
    </div>
  );
}
