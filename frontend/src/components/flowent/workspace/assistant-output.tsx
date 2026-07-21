import { Fragment, useState } from "react";
import { ChevronRight, Circle, RotateCcw, TriangleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { MarkdownMessage } from "@/components/flowent/markdown-message";
import type {
  AssistantOutputGroup,
  AssistantOutputItem,
} from "@/features/workspace/model/message-types";
import { AnimatedExpandableContent } from "@/components/flowent/workspace/animated-expandable-content";
import { MessageIconButton } from "@/components/flowent/workspace/message-icon-button";
import { ToolProcessItem } from "@/components/flowent/workspace/tool-process";
import { enWorkspace } from "@/i18n/locales/en/workspace";
import { zhCNWorkspace } from "@/i18n/locales/zh-CN/workspace";
import { cn } from "@/lib/utils";

export function AssistantOutputTimeline({
  disableErrorRetry,
  groups,
  isStreaming,
  onRetryError,
  showWaitingAfterOutput,
}: {
  disableErrorRetry: boolean;
  groups: AssistantOutputGroup[];
  isStreaming: boolean;
  onRetryError: (errorId: string) => void;
  showWaitingAfterOutput: boolean;
}) {
  const { t } = useTranslation();
  const lastTextItemId = groups
    .flatMap((group) => group.items)
    .reverse()
    .find((item) => item.type === "text")?.id;

  return (
    <div
      className="flex min-w-0 flex-col"
      aria-label={t("workspace.assistant.response")}
    >
      {groups.map((group, index) => (
        <Fragment key={group.id}>
          {index > 0 ? <AssistantOutputSeparator /> : null}
          <div className="flex min-w-0 flex-col gap-1.5">
            {group.items.map((item) =>
              item.type === "tool" ? (
                <ToolProcessItem key={item.id} tool={item.tool} />
              ) : item.type === "thinking" ? (
                <ThinkingProcessItem
                  key={item.id}
                  content={item.content}
                  isStreaming={item.isStreaming === true}
                />
              ) : item.type === "error" ? (
                <AssistantErrorItem
                  disabled={disableErrorRetry}
                  key={item.id}
                  item={item}
                  onRetry={() => onRetryError(item.id)}
                />
              ) : (
                <MarkdownMessage
                  key={item.id}
                  content={item.content}
                  isStreaming={isStreaming && item.id === lastTextItemId}
                />
              ),
            )}
          </div>
        </Fragment>
      ))}
      {showWaitingAfterOutput ? (
        <div className="mt-3">
          <AssistantWaitingIndicator />
        </div>
      ) : null}
    </div>
  );
}

export function AssistantWaitingIndicator() {
  const { t } = useTranslation();

  return (
    <div
      aria-label={t("workspace.assistant.thinking")}
      className="flex h-6 items-center gap-1.5"
      role="status"
    >
      <span className="flowent-thinking-dot" />
      <span className="flowent-thinking-dot" />
      <span className="flowent-thinking-dot" />
    </div>
  );
}

function AssistantErrorItem({
  disabled,
  item,
  onRetry,
}: {
  disabled: boolean;
  item: Extract<AssistantOutputItem, { type: "error" }>;
  onRetry: () => void;
}) {
  const { t } = useTranslation();
  const title =
    item.title === enWorkspace.errors.requestFailedTitle ||
    item.title === zhCNWorkspace.errors.requestFailedTitle
      ? t("workspace.errors.requestFailedTitle")
      : item.title === enWorkspace.errors.responseInterrupted ||
          item.title === zhCNWorkspace.errors.responseInterrupted
        ? t("workspace.errors.responseInterrupted")
        : item.title;
  const message =
    item.message === enWorkspace.errors.requestFailedMessage ||
    item.message === zhCNWorkspace.errors.requestFailedMessage
      ? t("workspace.errors.requestFailedMessage")
      : item.message === enWorkspace.errors.contextCouldNotBeCompacted ||
          item.message === zhCNWorkspace.errors.contextCouldNotBeCompacted
        ? t("workspace.errors.contextCouldNotBeCompacted")
        : item.message === enWorkspace.errors.contextCouldNotBeOptimized ||
            item.message === zhCNWorkspace.errors.contextCouldNotBeOptimized
          ? t("workspace.errors.contextCouldNotBeOptimized")
          : item.message === enWorkspace.errors.messageCouldNotBeSent ||
              item.message === zhCNWorkspace.errors.messageCouldNotBeSent
            ? t("workspace.errors.messageCouldNotBeSent")
            : item.message === enWorkspace.errors.messageCouldNotBeUpdated ||
                item.message === zhCNWorkspace.errors.messageCouldNotBeUpdated
              ? t("workspace.errors.messageCouldNotBeUpdated")
              : item.message === enWorkspace.errors.responseInProgress ||
                  item.message === zhCNWorkspace.errors.responseInProgress
                ? t("workspace.errors.responseInProgress")
                : item.message;

  return (
    <div
      className="flex items-start gap-3 rounded-lg border border-red-500/15 bg-red-500/[0.06] p-3 text-base leading-5 text-red-100/90"
      role="alert"
    >
      <TriangleAlert
        aria-hidden="true"
        className="mt-0.5 size-4 shrink-0 text-red-400"
      />
      <div className="min-w-0 flex-1">
        <div className="font-semibold text-red-100/95">{title}</div>
        <div className="mt-1 text-red-100/75">{message}</div>
        {item.detail ? (
          <div className="mt-2 break-words text-xs leading-5 text-red-100/55">
            {item.detail}
          </div>
        ) : null}
      </div>
      <MessageIconButton
        className="shrink-0 text-red-100/55 hover:bg-red-400/10 hover:text-red-50 disabled:text-red-100/25"
        disabled={disabled}
        label={t("workspace.messageActions.retry")}
        onClick={onRetry}
      >
        <RotateCcw aria-hidden="true" className="size-4" />
      </MessageIconButton>
    </div>
  );
}

function AssistantOutputSeparator() {
  return (
    <div
      aria-hidden="true"
      className="my-3 h-px w-full bg-white/10"
      data-testid="assistant-output-separator"
    />
  );
}

function ThinkingProcessItem({
  content,
  isStreaming,
}: {
  content: string;
  isStreaming: boolean;
}) {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const isExpanded = isStreaming || isOpen;

  return (
    <div className="max-w-full text-base leading-5 text-white">
      <Button
        aria-expanded={isExpanded}
        className="h-8 w-full justify-start gap-2 rounded-lg border-0 bg-transparent px-2 text-base text-white/75 shadow-none hover:bg-input/30 hover:text-white"
        onClick={() => setIsOpen((current) => !current)}
        type="button"
        variant="ghost"
      >
        <ChevronRight
          aria-hidden="true"
          className={cn(
            "size-3.5 shrink-0 transition-transform",
            isExpanded ? "rotate-90" : "",
          )}
        />
        <Circle
          aria-hidden="true"
          className={cn(
            "size-3.5 shrink-0 text-white/70",
            isStreaming ? "animate-pulse" : "",
          )}
        />
        <span className="min-w-0 flex-1 truncate text-left">
          {isStreaming
            ? t("workspace.assistant.thinkingInProgress")
            : t("workspace.assistant.thoughtProcess")}
        </span>
      </Button>
      <AnimatedExpandableContent isOpen={isExpanded}>
        <div className="py-1">
          <div className="whitespace-pre-wrap break-words text-base leading-5 text-white/60">
            {content}
          </div>
        </div>
      </AnimatedExpandableContent>
    </div>
  );
}
