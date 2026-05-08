import { AnimatePresence, motion } from "motion/react";
import { useState, useCallback, memo, type ReactNode } from "react";
import {
  ChevronRight,
  MessageSquare,
  Send,
  Brain,
  Wrench,
  Terminal,
  Bot,
  AlertCircle,
  Workflow,
  GitBranch,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { HistoryEntry, Node } from "@/types";
import { CopyButton } from "@/components/CopyButton";
import { ImageAssetPreview } from "@/components/ImageAssetPreview";
import { MarkdownContent } from "@/components/MarkdownContent";
import { Button } from "@/components/ui/button";
import { getNodeLabel } from "@/lib/nodeLabel";
import { formatJsonOutput } from "@/lib/formatJsonOutput";
import { contentPartsToText, normalizeContentParts } from "@/lib/contentParts";

interface HistoryViewProps {
  agentLabel?: string;
  history: HistoryEntry[];
  nodes?: Map<string, Node>;
}

export const HistoryView = memo(function HistoryView({
  agentLabel = "Agent",
  history,
  nodes,
}: HistoryViewProps) {
  return (
    <div className="space-y-1.5 p-2.5">
      {history.map((entry, index) => (
        <div
          key={`${index}-${entry.timestamp}-${entry.type}-${entry.message_id ?? ""}-${entry.tool_call_id ?? ""}`}
          className="[content-visibility:auto] [contain-intrinsic-size:auto_100px]"
        >
          <HistoryItem agentLabel={agentLabel} entry={entry} nodes={nodes} />
        </div>
      ))}
    </div>
  );
});

function MarkdownOrJsonBlock({
  content,
  markdownClassName,
  preClassName,
  streaming,
}: {
  content: string | null | undefined;
  markdownClassName?: string;
  preClassName?: string;
  streaming?: boolean;
}) {
  const formattedJson = formatJsonOutput(content);

  if (formattedJson) {
    return (
      <pre
        className={cn(
          "select-text text-[11px] whitespace-pre-wrap break-words leading-relaxed",
          preClassName,
        )}
      >
        <StreamingText text={formattedJson} streaming={streaming} />
      </pre>
    );
  }

  if (streaming) {
    return (
      <pre
        className={cn(
          "select-text text-[11px] whitespace-pre-wrap break-words leading-relaxed",
          preClassName,
        )}
      >
        <StreamingText text={content ?? ""} streaming />
      </pre>
    );
  }

  return (
    <MarkdownContent
      content={content ?? ""}
      className={cn("text-[11px] leading-relaxed", markdownClassName)}
    />
  );
}

function StreamingText({
  text,
  streaming,
}: {
  text: string | null | undefined;
  streaming?: boolean;
}) {
  return (
    <>
      {text}
      {streaming && <span className="streaming-cursor" />}
    </>
  );
}

function MessageContent({
  entry,
  markdownClassName,
  preClassName,
}: {
  entry: HistoryEntry;
  markdownClassName?: string;
  preClassName?: string;
}) {
  const parts = normalizeContentParts(entry.parts, entry.content);

  if (parts.length === 0) {
    return null;
  }

  if (parts.every((part) => part.type === "text")) {
    return (
      <MarkdownOrJsonBlock
        content={contentPartsToText(parts)}
        streaming={entry.streaming}
        markdownClassName={markdownClassName}
        preClassName={preClassName}
      />
    );
  }

  return (
    <div className="space-y-2">
      {parts.map((part, index) =>
        part.type === "text" ? (
          <MarkdownOrJsonBlock
            key={`${index}-${part.type}`}
            content={part.text}
            markdownClassName={markdownClassName}
            preClassName={preClassName}
          />
        ) : (
          <ImageAssetPreview
            key={`${index}-${part.type}-${part.asset_id}`}
            alt={part.alt}
            assetId={part.asset_id}
            compact
            height={part.height}
            mimeType={part.mime_type}
            width={part.width}
          />
        ),
      )}
    </div>
  );
}

function formatPortPath(entry: HistoryEntry): string {
  if (!entry.from_output_port_key || !entry.to_input_port_key) {
    return "";
  }
  return ` · ${entry.from_output_port_key} to ${entry.to_input_port_key}`;
}

function formatPortValue(entry: HistoryEntry): string {
  if (entry.value_summary) {
    return entry.value_summary;
  }
  if (entry.content) {
    return entry.content;
  }
  if (entry.value === undefined) {
    return "";
  }
  if (typeof entry.value === "string") {
    return entry.value;
  }
  try {
    return JSON.stringify(entry.value);
  } catch {
    return String(entry.value);
  }
}

const HistoryItem = memo(function HistoryItem({
  agentLabel,
  entry,
  nodes,
}: {
  agentLabel: string;
  entry: HistoryEntry;
  nodes?: Map<string, Node>;
}) {
  switch (entry.type) {
    case "SystemEntry":
      return (
        <CollapsibleBlock
          label="System"
          icon={<Terminal className="size-3 text-muted-foreground" />}
          className="border-border/40 bg-surface-1/24"
          defaultOpen={false}
        >
          <MarkdownOrJsonBlock
            content={entry.content}
            markdownClassName="text-muted-foreground"
            preClassName="text-muted-foreground leading-relaxed"
          />
        </CollapsibleBlock>
      );

    case "ReceivedMessage":
      return (
        <CollapsibleBlock
          label={`From ${getNodeLabel(entry.from_id ?? "", nodes)}${formatPortPath(entry)}`}
          icon={<MessageSquare className="size-3 text-foreground/70" />}
          className="border-border bg-accent/20"
          labelClassName="text-foreground/70"
          actions={
            <CopyButton text={contentPartsToText(entry.parts, entry.content)} />
          }
          defaultOpen={entry.streaming ?? false}
        >
          <MessageContent
            entry={entry}
            markdownClassName="text-foreground/90"
            preClassName="text-foreground/90 leading-relaxed"
          />
        </CollapsibleBlock>
      );

    case "AssistantThinking":
      return (
        <CollapsibleBlock
          label="Thinking"
          icon={<Brain className="size-3 text-foreground/72" />}
          className="border-border bg-surface-1/28"
          labelClassName="text-foreground/72"
          defaultOpen={false}
        >
          <MarkdownOrJsonBlock
            content={entry.content}
            streaming={entry.streaming}
            markdownClassName="text-foreground/82"
            preClassName="text-foreground/82 leading-relaxed"
          />
        </CollapsibleBlock>
      );

    case "StateEntry":
      return (
        <CollapsibleBlock
          label={entry.state ? `State ${entry.state.toUpperCase()}` : "State"}
          icon={<Workflow className="size-3 text-foreground/62" />}
          className="border-border bg-background/28"
          labelClassName="text-foreground/72"
          defaultOpen={false}
        >
          <div className="space-y-1 text-[11px] leading-relaxed text-foreground/84">
            <p className="select-text font-mono uppercase tracking-[0.08em] text-foreground/78">
              {entry.state ?? "unknown"}
            </p>
            {entry.reason ? (
              <p className="select-text text-muted-foreground">
                {entry.reason}
              </p>
            ) : null}
          </div>
        </CollapsibleBlock>
      );

    case "SentMessage": {
      const targetIds =
        entry.to_id != null
          ? [entry.to_id]
          : (entry.to_ids ?? []).filter((id): id is string => Boolean(id));
      const targets = targetIds.map((id) => getNodeLabel(id, nodes));
      return (
        <CollapsibleBlock
          label={`To ${targets.join(", ") || "Unknown"}${formatPortPath(entry)}`}
          icon={<Send className="size-3 text-foreground/58" />}
          className="border-border bg-background/24"
          labelClassName="text-foreground/72"
          actions={
            <CopyButton text={contentPartsToText(entry.parts, entry.content)} />
          }
          defaultOpen={entry.streaming ?? false}
        >
          <MessageContent
            entry={entry}
            markdownClassName="text-foreground/86"
            preClassName="text-foreground/86 leading-relaxed"
          />
        </CollapsibleBlock>
      );
    }

    case "PortInboundEntry":
      return (
        <CollapsibleBlock
          label={`Input from ${entry.source_label || getNodeLabel(entry.from_id ?? "", nodes)}${formatPortPath(entry)}`}
          icon={<GitBranch className="size-3 text-foreground/66" />}
          className="border-border bg-surface-1/24"
          labelClassName="text-foreground/72"
          actions={<CopyButton text={formatPortValue(entry)} />}
          defaultOpen={false}
        >
          <div className="space-y-2">
            {entry.port_type ? (
              <span className="inline-flex rounded-md border border-border bg-background/40 px-2 py-0.5 font-mono text-[10px] text-muted-foreground">
                {entry.port_type}
              </span>
            ) : null}
            <MarkdownOrJsonBlock
              content={formatPortValue(entry)}
              markdownClassName="text-foreground/86"
              preClassName="text-foreground/86 leading-relaxed"
            />
          </div>
        </CollapsibleBlock>
      );

    case "AssistantText":
      return (
        <CollapsibleBlock
          label={agentLabel}
          icon={<Bot className="size-3 text-foreground/84" />}
          className="border-border bg-surface-2/62"
          labelClassName="text-foreground/84"
          actions={<CopyButton text={entry.content ?? ""} />}
          defaultOpen={false}
        >
          <MessageContent
            entry={entry}
            markdownClassName="text-foreground/88"
            preClassName="text-foreground/88 leading-relaxed"
          />
        </CollapsibleBlock>
      );

    case "ToolCall": {
      const formattedArguments = formatJsonOutput(entry.arguments) ?? "";
      const formattedResult = formatJsonOutput(entry.result);
      return (
        <CollapsibleBlock
          label={entry.tool_name ?? "tool"}
          icon={<Wrench className="size-3 text-foreground/66" />}
          className="border-border bg-surface-1/20"
          labelClassName="text-foreground/72"
          defaultOpen={false}
        >
          <div className="space-y-2">
            <div>
              <div className="text-[10px] text-muted-foreground mb-1">
                Arguments
              </div>
              <pre className="select-text text-[11px] whitespace-pre-wrap break-words leading-relaxed text-foreground/78">
                {formattedArguments}
              </pre>
            </div>
            {entry.result && (
              <div>
                <div className="text-[10px] text-muted-foreground mb-1">
                  Result
                </div>
                <MarkdownOrJsonBlock
                  content={formattedResult ?? entry.result}
                  streaming={entry.streaming}
                  markdownClassName="text-muted-foreground"
                  preClassName="text-muted-foreground leading-relaxed"
                />
              </div>
            )}
          </div>
        </CollapsibleBlock>
      );
    }

    case "ErrorEntry":
      return (
        <CollapsibleBlock
          label="Error"
          icon={<AlertCircle className="size-3 text-graph-status-error/84" />}
          className="border-graph-status-error/16 bg-graph-status-error/[0.038]"
          labelClassName="text-graph-status-error/78"
          actions={
            <CopyButton
              text={entry.content ?? ""}
              className="text-graph-status-error/84 hover:text-graph-status-error/84"
              iconClassName="text-graph-status-error/84"
              copiedClassName="text-graph-status-error/84"
            />
          }
          defaultOpen={false}
        >
          <MarkdownOrJsonBlock
            content={entry.content}
            markdownClassName="text-graph-status-error/84"
            preClassName="text-graph-status-error/84 leading-relaxed"
          />
        </CollapsibleBlock>
      );

    default:
      return null;
  }
});

function CollapsibleBlock({
  actions,
  label,
  labelClassName,
  icon,
  className,
  contentClassName,
  defaultOpen = false,
  children,
}: {
  actions?: ReactNode;
  label: string;
  labelClassName?: string;
  icon: ReactNode;
  className?: string;
  contentClassName?: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const toggle = useCallback(() => setOpen((v) => !v), []);

  return (
    <div
      className={cn(
        "rounded-xl border transition-colors hover:bg-accent/20",
        className,
      )}
    >
      <div className="flex items-center gap-2 px-3 py-2 select-none">
        <Button
          type="button"
          variant="ghost"
          aria-expanded={open}
          onClick={toggle}
          className="h-auto min-w-0 flex-1 justify-start gap-2 rounded-md bg-transparent px-0 py-0 text-left text-inherit shadow-none hover:bg-transparent hover:text-inherit focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <span className="shrink-0 flex items-center justify-center">
            {icon}
          </span>
          <span
            className={cn(
              "min-w-0 flex-1 truncate text-[11px] font-medium",
              labelClassName || "text-muted-foreground",
            )}
          >
            {label}
          </span>
          <ChevronRight
            className={cn(
              "ml-2 size-3.5 shrink-0 text-muted-foreground/70 transition-transform duration-200",
              open && "rotate-90",
            )}
          />
        </Button>
        {actions ? (
          <span className="shrink-0 flex items-center leading-none">
            {actions}
          </span>
        ) : null}
      </div>
      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden"
          >
            <div className={cn("px-3 pb-3 pt-1", contentClassName)}>
              {children}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
