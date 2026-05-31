import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUp,
  Check,
  ChevronRight,
  Circle,
  Search,
  Sparkles,
  Square,
  Terminal,
  Trash2,
  TriangleAlert,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { MarkdownMessage } from "@/components/flowent/markdown-message";
import { stableScrollbarClassName } from "@/components/flowent/styles";
import type {
  AssistantOutputGroup,
  AssistantOutputItem,
  Message,
  Skill,
  ToolItem,
  WorkspaceCommand,
  WorkspaceCommandId,
} from "@/components/flowent/types";
import { cn } from "@/lib/utils";

export function WorkspaceView({
  commands,
  draft,
  errorMessage,
  isResponding,
  messages,
  onCommand,
  onCommandError,
  onClearMessages,
  onDraftChange,
  onSendMessage,
  onStopResponse,
  skills,
}: {
  commands: WorkspaceCommand[];
  draft: string;
  errorMessage: string;
  isResponding: boolean;
  messages: Message[];
  onCommand: (commandId: WorkspaceCommandId) => boolean;
  onCommandError: (message: string) => void;
  onClearMessages: () => void;
  onDraftChange: (value: string) => void;
  onSendMessage: (content: string) => void;
  onStopResponse: () => void;
  skills: Skill[];
}) {
  const [composerOffset, setComposerOffset] = useState(112);

  return (
    <section className="h-full min-h-0 bg-black" aria-label="Workspace">
      <div className="relative h-full min-h-0 min-w-0 overflow-hidden">
        <WorkspaceControls onClearMessages={onClearMessages} />
        <MessageList
          composerOffset={composerOffset}
          isResponding={isResponding}
          messages={messages}
        />
        <ChatComposer
          commands={commands}
          draft={draft}
          errorMessage={errorMessage}
          isSending={isResponding}
          onCommand={onCommand}
          onCommandError={onCommandError}
          onDraftChange={onDraftChange}
          onSendMessage={onSendMessage}
          onStopResponse={onStopResponse}
          onOffsetChange={setComposerOffset}
          skills={skills}
        />
      </div>
    </section>
  );
}

function WorkspaceControls({
  onClearMessages,
}: {
  onClearMessages: () => void;
}) {
  return (
    <div
      aria-label="Workspace controls"
      className="pointer-events-none absolute right-6 top-5 z-20 flex items-center gap-1 max-[900px]:right-4 max-[900px]:top-4"
    >
      <Button
        className="pointer-events-auto h-8 rounded-lg border-white/10 bg-input/30 px-2.5 text-base text-white shadow-[0_12px_28px_rgba(0,0,0,0.32)] hover:bg-input/50 hover:text-white"
        onClick={onClearMessages}
        type="button"
        variant="outline"
      >
        <Trash2 aria-hidden="true" className="size-3.5" />
        Clear
      </Button>
    </div>
  );
}

function MessageList({
  composerOffset,
  isResponding,
  messages,
}: {
  composerOffset: number;
  isResponding: boolean;
  messages: Message[];
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const shouldFollowRef = useRef(true);
  const scrollMarkerRef = useRef<HTMLDivElement>(null);
  const latestMessage = messages.at(-1);
  const latestMessageAuthor = latestMessage?.author ?? "";
  const latestMessageId = latestMessage?.id ?? "";
  const lastMessageIdRef = useRef(latestMessageId);
  const displayMessages = useMemo(() => {
    if (!isResponding || latestMessageAuthor === "assistant") {
      return messages;
    }
    return [
      ...messages,
      {
        author: "assistant" as const,
        content: "",
        id: "assistant-pending",
      },
    ];
  }, [isResponding, latestMessageAuthor, messages]);
  const streamingMessageId =
    isResponding && latestMessageAuthor === "assistant" ? latestMessageId : "";

  useEffect(() => {
    if (latestMessageId !== lastMessageIdRef.current) {
      lastMessageIdRef.current = latestMessageId;

      if (latestMessageAuthor === "user") {
        shouldFollowRef.current = true;
      }
    }

    if (!shouldFollowRef.current) {
      return;
    }
    scrollMarkerRef.current?.scrollIntoView({
      block: "end",
      behavior: "smooth",
    });
  }, [displayMessages, latestMessageAuthor, latestMessageId]);

  const updateFollowState = () => {
    const list = listRef.current;
    if (!list) {
      return;
    }
    const distanceFromBottom =
      list.scrollHeight - list.scrollTop - list.clientHeight;
    shouldFollowRef.current = distanceFromBottom < 96;
  };

  return (
    <div
      aria-live="polite"
      className={cn(
        "absolute inset-0 flex min-h-0 flex-col overflow-auto bg-black px-6 pt-12 max-[900px]:px-4",
        stableScrollbarClassName,
      )}
      onScroll={updateFollowState}
      ref={listRef}
      style={{
        paddingBottom: composerOffset,
        scrollPaddingBottom: composerOffset,
      }}
    >
      {displayMessages.length === 0 ? (
        <div className="mx-auto grid min-h-full w-full max-w-[640px] place-items-center pb-24">
          <h1 className="m-0 text-center text-[28px] font-medium leading-[1.2] text-white max-[560px]:text-2xl">
            Where should we begin?
          </h1>
        </div>
      ) : null}
      {displayMessages.map((message) => (
        <Fragment key={message.id}>
          {message.author === "system" ? (
            <SystemMessage message={message} />
          ) : (
            <MessageRow
              isStreaming={
                isResponding &&
                message.id === streamingMessageId &&
                message.author === "assistant" &&
                message.isStreamingText === true
              }
              isPending={
                message.id === "assistant-pending" ||
                (isResponding &&
                  message.author === "assistant" &&
                  message.id === streamingMessageId &&
                  message.isStreamingText !== true)
              }
              message={message}
            />
          )}
        </Fragment>
      ))}
      <div aria-hidden="true" ref={scrollMarkerRef} />
    </div>
  );
}

function SystemMessage({ message }: { message: Message }) {
  const Icon =
    message.content === "Context optimized"
      ? Sparkles
      : message.content === "Context compacted"
        ? Check
        : null;

  return (
    <div className="mx-auto flex w-full max-w-[640px] justify-center py-3">
      <div className="flex items-center gap-1.5 rounded-full border border-white/10 bg-input/30 px-3 py-1.5 text-base leading-5 text-white/70">
        {Icon ? (
          <Icon aria-hidden="true" className="size-3.5 text-white/50" />
        ) : null}
        {message.content}
      </div>
    </div>
  );
}

function MessageRow({
  isPending,
  isStreaming,
  message,
}: {
  isPending: boolean;
  isStreaming: boolean;
  message: Message;
}) {
  const assistantGroups =
    message.author === "assistant" ? assistantOutputGroups(message) : [];
  const isWaiting = isPending && assistantGroups.length === 0;
  const shouldShowWaitingAfterOutput =
    isPending && assistantGroups.length > 0 && !isStreaming;

  return (
    <article
      className={cn(
        "flowent-message-row mx-auto flex w-full max-w-[640px] py-3",
        message.author === "user" ? "justify-end" : "justify-start",
      )}
    >
      <div
        className={cn(
          "min-w-0 text-base leading-6 text-white",
          message.author === "user"
            ? "flowent-user-message-bubble max-w-[70%] rounded-[22px] px-4 py-2.5"
            : "w-full max-w-full",
        )}
      >
        {isWaiting ? (
          <AssistantWaitingIndicator />
        ) : (
          <AssistantMessageContent
            assistantGroups={assistantGroups}
            isStreaming={isStreaming}
            message={message}
            showWaitingAfterOutput={shouldShowWaitingAfterOutput}
          />
        )}
      </div>
    </article>
  );
}

function assistantOutputGroups(message: Message): AssistantOutputGroup[] {
  if (message.groups?.length) {
    return message.groups.filter((group) => group.items.length > 0);
  }

  if (message.items?.length) {
    return [
      {
        id: `${message.id}-items`,
        items: message.items,
      },
    ];
  }

  const toolItems: AssistantOutputItem[] = (message.tools ?? []).map(
    (tool) => ({
      id: `tool-${tool.id}`,
      tool,
      type: "tool",
    }),
  );
  const thinkingItem: AssistantOutputItem | null = message.thinking
    ? {
        content: message.thinking,
        id: `${message.id}-thinking`,
        isStreaming: message.isStreamingThinking,
        type: "thinking",
      }
    : null;
  const groups: AssistantOutputGroup[] = [];
  const processItems = [...(thinkingItem ? [thinkingItem] : []), ...toolItems];

  if (toolItems.length) {
    groups.push({
      id: `${message.id}-process`,
      items: processItems,
    });
  }

  if (message.content) {
    const contentItem: AssistantOutputItem = {
      content: message.content,
      id: `${message.id}-content`,
      type: "text",
    };
    if (toolItems.length) {
      groups.push({
        id: `${message.id}-content`,
        items: [contentItem],
      });
    } else {
      groups.push({
        id: `${message.id}-content`,
        items: [...processItems, contentItem],
      });
    }
  } else if (processItems.length && !toolItems.length) {
    groups.push({
      id: `${message.id}-process`,
      items: processItems,
    });
  }

  return groups;
}

function AssistantMessageContent({
  assistantGroups,
  isStreaming,
  message,
  showWaitingAfterOutput,
}: {
  assistantGroups: AssistantOutputGroup[];
  isStreaming: boolean;
  message: Message;
  showWaitingAfterOutput: boolean;
}) {
  if (message.author === "assistant") {
    return (
      <div className="flowent-markdown-message min-w-0 break-words">
        <AssistantOutputTimeline
          groups={assistantGroups}
          isStreaming={isStreaming}
          showWaitingAfterOutput={showWaitingAfterOutput}
        />
      </div>
    );
  }

  return (
    <div className="flowent-markdown-message min-w-0 break-words">
      <p className="m-0 whitespace-pre-wrap break-words">{message.content}</p>
    </div>
  );
}

function AssistantOutputTimeline({
  groups,
  isStreaming,
  showWaitingAfterOutput,
}: {
  groups: AssistantOutputGroup[];
  isStreaming: boolean;
  showWaitingAfterOutput: boolean;
}) {
  const lastTextItemId = groups
    .flatMap((group) => group.items)
    .reverse()
    .find((item) => item.type === "text")?.id;

  return (
    <div className="flex min-w-0 flex-col" aria-label="Assistant response">
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
                <AssistantErrorItem key={item.id} item={item} />
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

function AssistantErrorItem({
  item,
}: {
  item: Extract<AssistantOutputItem, { type: "error" }>;
}) {
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
        <div className="font-semibold text-red-100/95">{item.title}</div>
        <div className="mt-1 text-red-100/75">{item.message}</div>
        {item.detail ? (
          <div className="mt-2 break-words text-xs leading-5 text-red-100/55">
            {item.detail}
          </div>
        ) : null}
      </div>
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
          {isStreaming ? "Thinking..." : "Thought Process"}
        </span>
      </Button>
      {isExpanded ? (
        <div className="py-1">
          <div className="whitespace-pre-wrap break-words text-base leading-5 text-white/60">
            {content}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ToolProcessItem({ tool }: { tool: ToolItem }) {
  const [isOpen, setIsOpen] = useState(tool.status === "failed");
  const statusLabel =
    tool.status === "waiting"
      ? "Waiting"
      : tool.status === "running"
        ? "Running"
        : tool.status === "success"
          ? "Done"
          : "Failed";

  useEffect(() => {
    if (tool.status === "failed") {
      setIsOpen(true);
    }
  }, [tool.status]);

  return (
    <div className="max-w-full text-base leading-5 text-white">
      <Button
        aria-expanded={isOpen}
        className="h-8 w-full justify-start gap-2 rounded-lg border-0 bg-transparent px-2 text-base text-white shadow-none hover:bg-transparent hover:text-white aria-expanded:bg-transparent aria-expanded:text-white active:not-aria-[haspopup]:translate-y-0"
        onClick={() => setIsOpen((current) => !current)}
        type="button"
        variant="ghost"
      >
        <ChevronRight
          aria-hidden="true"
          className={cn(
            "size-3.5 shrink-0 text-white/55 transition-transform",
            isOpen ? "rotate-90" : "",
          )}
        />
        <ToolProcessIcon tool={tool} />
        <span className="min-w-0 flex-1 truncate text-left">{tool.title}</span>
        <span className="shrink-0 text-xs text-white/55">{statusLabel}</span>
      </Button>
      {isOpen ? <ToolProcessDetails tool={tool} /> : null}
    </div>
  );
}

function ToolProcessDetails({ tool }: { tool: ToolItem }) {
  const approval = toolApprovalData(tool.data);
  const hasArguments = hasToolObjectPayload(tool.arguments);
  const hasData = hasToolObjectPayload(tool.data);
  const hasContent = tool.content !== undefined;
  const hasResult = hasContent || hasData;

  if (!hasArguments && !hasResult) {
    return null;
  }

  return (
    <div className="flex min-w-0 flex-col gap-2 py-1">
      {hasArguments ? (
        <ToolProcessPayload
          label="ARGS"
          value={formatToolValue(tool.arguments)}
        />
      ) : null}
      {hasResult ? (
        <ToolProcessPayload label="RESULT" value={formatToolResult(tool)} />
      ) : null}
      {approval ? <ToolProcessApproval approval={approval} /> : null}
    </div>
  );
}

type ToolApprovalData = {
  action?: string;
  decision?: string;
  reason?: string;
  toolName?: string;
  writePaths?: string[];
};

function ToolProcessApproval({ approval }: { approval: ToolApprovalData }) {
  const decision = approval.decision === "denied" ? "Denied" : "Approved";

  return (
    <div className="min-w-0">
      <div className="mb-1 text-[11px] font-medium leading-4 text-white/45">
        REVIEW
      </div>
      <div className="grid gap-1 rounded-md border border-white/10 bg-black px-2.5 py-2 text-xs leading-5 text-white/70">
        <div className="font-medium text-white">{decision}</div>
        {approval.reason ? (
          <div className="break-words text-white/60">{approval.reason}</div>
        ) : null}
        {approval.writePaths?.length ? (
          <div className="grid gap-0.5 font-mono text-[11px] leading-4 text-white/50">
            {approval.writePaths.map((path) => (
              <span className="break-words" key={path}>
                {path}
              </span>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ToolProcessPayload({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="min-w-0">
      <div className="mb-1 text-[11px] font-medium leading-4 text-white/45">
        {label}
      </div>
      <pre className="max-h-64 overflow-auto rounded-md bg-input/20 px-2.5 py-2 font-mono text-xs leading-5 text-white/70">
        <code className="whitespace-pre-wrap break-words">{value}</code>
      </pre>
    </div>
  );
}

function formatToolValue(value: unknown) {
  if (typeof value === "string") {
    return value;
  }

  return JSON.stringify(value, null, 2);
}

function formatToolResult(tool: ToolItem) {
  const result: Record<string, unknown> = {};
  if (tool.content !== undefined) {
    result.content = tool.content;
  }
  const toolData = tool.data;
  if (hasToolObjectPayload(toolData)) {
    const data = Object.fromEntries(
      Object.entries(toolData).filter(([key]) => key !== "approval"),
    );
    if (Object.keys(data).length > 0) {
      result.data = data;
    }
  }
  return formatToolValue(result);
}

function hasToolObjectPayload(
  value: Record<string, unknown> | null | undefined,
): value is Record<string, unknown> {
  return value != null && Object.keys(value).length > 0;
}

function toolApprovalData(
  data: Record<string, unknown> | null | undefined,
): ToolApprovalData | null {
  const approval = data?.approval;
  if (!approval || typeof approval !== "object" || Array.isArray(approval)) {
    return null;
  }
  const value = approval as Record<string, unknown>;
  return {
    action: typeof value.action === "string" ? value.action : undefined,
    decision: typeof value.decision === "string" ? value.decision : undefined,
    reason: typeof value.reason === "string" ? value.reason : undefined,
    toolName: typeof value.tool_name === "string" ? value.tool_name : undefined,
    writePaths: Array.isArray(value.write_paths)
      ? value.write_paths.filter(
          (path): path is string => typeof path === "string",
        )
      : undefined,
  };
}

function ToolProcessIcon({ tool }: { tool: ToolItem }) {
  const className = cn(
    "size-3.5 shrink-0",
    tool.status === "failed" ? "text-red-300" : "text-white/80",
    tool.status === "running" ? "animate-pulse" : "",
    tool.status === "waiting" ? "text-amber-300" : "",
  );

  if (tool.status === "success") {
    return <Check aria-hidden="true" className={className} />;
  }
  if (tool.status === "failed") {
    return <X aria-hidden="true" className={className} />;
  }
  if (tool.status === "waiting") {
    return <TriangleAlert aria-hidden="true" className={className} />;
  }
  if (tool.name === "web_search" || tool.name === "grep_files") {
    return <Search aria-hidden="true" className={className} />;
  }
  if (tool.name === "shell_command") {
    return <Terminal aria-hidden="true" className={className} />;
  }
  return <Circle aria-hidden="true" className={className} />;
}

function AssistantWaitingIndicator() {
  return (
    <div
      aria-label="Thinking"
      className="flex h-6 items-center gap-1.5"
      role="status"
    >
      <span className="flowent-thinking-dot" />
      <span className="flowent-thinking-dot" />
      <span className="flowent-thinking-dot" />
    </div>
  );
}

function ChatComposer({
  commands,
  draft,
  errorMessage,
  isSending,
  onCommand,
  onCommandError,
  onDraftChange,
  onOffsetChange,
  onSendMessage,
  onStopResponse,
  skills,
}: {
  commands: WorkspaceCommand[];
  draft: string;
  errorMessage: string;
  isSending: boolean;
  onCommand: (commandId: WorkspaceCommandId) => boolean;
  onCommandError: (message: string) => void;
  onDraftChange: (value: string) => void;
  onOffsetChange: (value: number) => void;
  onSendMessage: (content: string) => void;
  onStopResponse: () => void;
  skills: Skill[];
}) {
  const composerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const allowNextLineBreakRef = useRef(false);
  const softKeyboardSubmitRef = useRef(() => {});
  const handlesSoftKeyboardSubmitRef = useRef(false);
  const preserveCommandMenuDismissalRef = useRef(false);
  const preserveSkillMenuDismissalRef = useRef(false);
  const [isCommandMenuDismissed, setIsCommandMenuDismissed] = useState(false);
  const [isSkillMenuDismissed, setIsSkillMenuDismissed] = useState(false);
  const [selectedCommandIndex, setSelectedCommandIndex] = useState(0);
  const [selectedSkillIndex, setSelectedSkillIndex] = useState(0);
  const firstLine = draft.split("\n")[0] ?? "";
  const commandName = firstLine.startsWith("/") ? firstLine.slice(1) : "";
  const isCommandDraft =
    firstLine.startsWith("/") &&
    !commandName.includes("/") &&
    !firstLine.includes(" ");
  const matchingCommands = useMemo(() => {
    if (!isCommandDraft) {
      return [];
    }
    const normalizedName = commandName.toLowerCase();

    return commands.filter((command) =>
      command.name.toLowerCase().startsWith(normalizedName),
    );
  }, [commandName, commands, isCommandDraft]);
  const showCommandMenu =
    isCommandDraft && !isCommandMenuDismissed && matchingCommands.length > 0;
  const skillTokenMatch = draft.match(/(?:^|\s)\$([a-z0-9-]*)$/i);
  const skillName = skillTokenMatch?.[1] ?? "";
  const isSkillDraft = Boolean(skillTokenMatch);
  const matchingSkills = useMemo(() => {
    if (!isSkillDraft) {
      return [];
    }
    const normalizedName = skillName.toLowerCase();

    return skills.filter(
      (skill) =>
        skill.enabled &&
        !skill.error &&
        skill.slug.toLowerCase().startsWith(normalizedName),
    );
  }, [isSkillDraft, skillName, skills]);
  const showSkillMenu =
    !showCommandMenu &&
    isSkillDraft &&
    !isSkillMenuDismissed &&
    matchingSkills.length > 0;
  const exactCommand = commands.find((command) => command.name === commandName);
  const canSubmitCommand =
    Boolean(isCommandDraft && exactCommand) &&
    (!isSending || exactCommand?.id === "clear");
  const currentDraft = () => textareaRef.current?.value ?? draft;
  const handlesSoftKeyboardSubmit = shouldHandleSoftKeyboardSubmit();
  handlesSoftKeyboardSubmitRef.current = handlesSoftKeyboardSubmit;
  const canSubmit =
    currentDraft().length > 0 && (!isSending || canSubmitCommand);
  const showStopButton = isSending && !canSubmitCommand;
  const isSendUnavailable = !showStopButton && !canSubmit;
  const isSendDisabled = isSendUnavailable && !handlesSoftKeyboardSubmit;

  useEffect(() => {
    if (preserveCommandMenuDismissalRef.current) {
      preserveCommandMenuDismissalRef.current = false;
      return;
    }

    setIsCommandMenuDismissed(false);
    setSelectedCommandIndex(0);
  }, [draft]);

  useEffect(() => {
    if (preserveSkillMenuDismissalRef.current) {
      preserveSkillMenuDismissalRef.current = false;
      return;
    }

    setIsSkillMenuDismissed(false);
    setSelectedSkillIndex(0);
  }, [draft]);

  useEffect(() => {
    setSelectedCommandIndex((current) =>
      Math.min(current, Math.max(matchingCommands.length - 1, 0)),
    );
  }, [matchingCommands.length]);

  useEffect(() => {
    setSelectedSkillIndex((current) =>
      Math.min(current, Math.max(matchingSkills.length - 1, 0)),
    );
  }, [matchingSkills.length]);

  useEffect(() => {
    const composer = composerRef.current;
    if (!composer) {
      return;
    }
    let animationFrameId = 0;

    const updateOffset = () => {
      animationFrameId = 0;
      const measuredBottomOffset = Number.parseFloat(
        getComputedStyle(composer).bottom,
      );
      const bottomOffset = Number.isFinite(measuredBottomOffset)
        ? measuredBottomOffset
        : 0;

      onOffsetChange(composer.offsetHeight + bottomOffset + 24);
    };

    const scheduleUpdateOffset = () => {
      if (animationFrameId !== 0) {
        window.cancelAnimationFrame(animationFrameId);
      }

      animationFrameId = window.requestAnimationFrame(updateOffset);
    };

    updateOffset();

    window.addEventListener("resize", scheduleUpdateOffset, {
      passive: true,
    });
    window.addEventListener("focusin", scheduleUpdateOffset, {
      passive: true,
    });
    window.addEventListener("focusout", scheduleUpdateOffset, {
      passive: true,
    });
    window.visualViewport?.addEventListener("resize", scheduleUpdateOffset, {
      passive: true,
    });
    window.visualViewport?.addEventListener("scroll", scheduleUpdateOffset, {
      passive: true,
    });

    if (typeof ResizeObserver === "undefined") {
      return () => {
        if (animationFrameId !== 0) {
          window.cancelAnimationFrame(animationFrameId);
        }
        window.removeEventListener("resize", scheduleUpdateOffset);
        window.removeEventListener("focusin", scheduleUpdateOffset);
        window.removeEventListener("focusout", scheduleUpdateOffset);
        window.visualViewport?.removeEventListener(
          "resize",
          scheduleUpdateOffset,
        );
        window.visualViewport?.removeEventListener(
          "scroll",
          scheduleUpdateOffset,
        );
      };
    }

    const resizeObserver = new ResizeObserver(scheduleUpdateOffset);
    resizeObserver.observe(composer);

    return () => {
      if (animationFrameId !== 0) {
        window.cancelAnimationFrame(animationFrameId);
      }
      window.removeEventListener("resize", scheduleUpdateOffset);
      window.removeEventListener("focusin", scheduleUpdateOffset);
      window.removeEventListener("focusout", scheduleUpdateOffset);
      window.visualViewport?.removeEventListener(
        "resize",
        scheduleUpdateOffset,
      );
      window.visualViewport?.removeEventListener(
        "scroll",
        scheduleUpdateOffset,
      );
      resizeObserver.disconnect();
    };
  }, [onOffsetChange]);

  const runCommand = (command: WorkspaceCommand) => {
    const commandAccepted = onCommand(command.id);
    if (!commandAccepted) {
      setIsCommandMenuDismissed(true);
      return;
    }
    onDraftChange("");
    setIsCommandMenuDismissed(false);
  };

  const runDraftCommand = () => {
    if (!isCommandDraft || commandName.length === 0) {
      return false;
    }

    const command = commands.find((item) => item.name === commandName);
    if (!command) {
      return false;
    }

    runCommand(command);
    return true;
  };

  const insertSkill = (skill: Skill) => {
    const nextDraft = draft.replace(/(?:^|\s)\$([a-z0-9-]*)$/i, (match) => {
      const prefix = match.startsWith(" ") ? " " : "";
      return `${prefix}$${skill.slug} `;
    });
    preserveSkillMenuDismissalRef.current = true;
    onDraftChange(nextDraft);
    setIsSkillMenuDismissed(true);
  };

  const handleSubmit = () => {
    const submittedDraft = currentDraft();

    if (showSkillMenu) {
      const skill = matchingSkills[selectedSkillIndex];
      if (skill) {
        insertSkill(skill);
        return;
      }
    }

    if (showCommandMenu) {
      const command = matchingCommands[selectedCommandIndex];
      if (command) {
        runCommand(command);
        return;
      }
    }

    if (runDraftCommand()) {
      return;
    }

    if (isCommandDraft && commandName.length > 0) {
      setIsCommandMenuDismissed(false);
      onCommandError("Command not found.");
      return;
    }

    onSendMessage(submittedDraft);
  };

  softKeyboardSubmitRef.current = () => {
    handleSubmit();
  };

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) {
      return;
    }

    const handleBeforeInput = (event: InputEvent) => {
      if (!handlesSoftKeyboardSubmitRef.current) {
        return;
      }
      if (allowNextLineBreakRef.current) {
        allowNextLineBreakRef.current = false;
        return;
      }
      if (
        event.inputType !== "insertLineBreak" &&
        event.inputType !== "insertParagraph"
      ) {
        return;
      }
      event.preventDefault();
      softKeyboardSubmitRef.current();
    };

    textarea.addEventListener("beforeinput", handleBeforeInput);

    return () => textarea.removeEventListener("beforeinput", handleBeforeInput);
  }, []);

  return (
    <div
      className="pointer-events-none absolute inset-x-0 bottom-[calc(1.5rem+var(--flowent-keyboard-offset))] z-10 px-6 max-[900px]:px-4"
      ref={composerRef}
    >
      <div className="pointer-events-auto mx-auto w-full max-w-[640px]">
        {showCommandMenu ? (
          <div
            aria-label="Commands"
            className="mb-2 overflow-hidden rounded-xl border border-white/10 bg-[#171717] p-1 shadow-[0_16px_44px_rgba(0,0,0,0.42)]"
            role="listbox"
          >
            {matchingCommands.map((command, index) => (
              <Button
                aria-selected={index === selectedCommandIndex}
                className={cn(
                  "flex h-auto w-full items-center justify-start gap-3 rounded-lg border-0 bg-transparent px-3 py-2 text-left text-base text-white shadow-none transition-colors hover:bg-input/50 hover:text-white",
                  index === selectedCommandIndex && "bg-input/40",
                )}
                key={command.id}
                onClick={() => runCommand(command)}
                onMouseEnter={() => setSelectedCommandIndex(index)}
                size="sm"
                role="option"
                type="button"
                variant="ghost"
              >
                <Terminal aria-hidden="true" className="size-4 text-white/75" />
                <span className="min-w-0 flex-1">
                  <span className="block font-medium leading-5">
                    {command.label}
                  </span>
                  <span className="block truncate text-xs leading-4 text-white/55">
                    {command.description}
                  </span>
                </span>
              </Button>
            ))}
          </div>
        ) : null}
        {showSkillMenu ? (
          <div
            aria-label="Skills"
            className="mb-2 overflow-hidden rounded-xl border border-white/10 bg-[#171717] p-1 shadow-[0_16px_44px_rgba(0,0,0,0.42)]"
            role="listbox"
          >
            {matchingSkills.map((skill, index) => (
              <Button
                aria-selected={index === selectedSkillIndex}
                className={cn(
                  "flex h-auto w-full items-center justify-start gap-3 rounded-lg border-0 bg-transparent px-3 py-2 text-left text-base text-white shadow-none transition-colors hover:bg-input/50 hover:text-white",
                  index === selectedSkillIndex && "bg-input/40",
                )}
                key={skill.id}
                onClick={() => insertSkill(skill)}
                onMouseEnter={() => setSelectedSkillIndex(index)}
                size="sm"
                role="option"
                type="button"
                variant="ghost"
              >
                <Sparkles aria-hidden="true" className="size-4 text-white/75" />
                <span className="min-w-0 flex-1">
                  <span className="block font-medium leading-5">
                    ${skill.slug}
                  </span>
                  <span className="block truncate text-xs leading-4 text-white/55">
                    {skill.description || skill.name}
                  </span>
                </span>
              </Button>
            ))}
          </div>
        ) : null}
        {errorMessage ? (
          <p className="mb-2 rounded-md bg-black/80 px-3 py-2 text-base leading-5 text-red-300 shadow-[0_12px_32px_rgba(0,0,0,0.45)]">
            {errorMessage}
          </p>
        ) : null}
        <form
          className="grid min-h-14 w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-2 overflow-clip rounded-[28px] bg-[#212121] p-2.5 shadow-[0_16px_44px_rgba(0,0,0,0.42),inset_0_0_1px_rgba(255,255,255,0.22)] transition-colors"
          aria-label="Workspace composer"
          onSubmit={(event) => {
            event.preventDefault();
            handleSubmit();
          }}
        >
          <Textarea
            aria-label="Message Flowent"
            className="flowent-composer-textarea max-h-[216px] min-h-9 resize-none overflow-y-auto border-0 bg-transparent px-2 py-1.5 text-white shadow-none placeholder:text-[#9b9b9b] focus-visible:border-transparent focus-visible:ring-0 dark:bg-transparent"
            enterKeyHint="send"
            ref={textareaRef}
            value={draft}
            onChange={(event) => onDraftChange(event.target.value)}
            onInput={(event) => onDraftChange(event.currentTarget.value)}
            onKeyDown={(event) => {
              allowNextLineBreakRef.current =
                event.key === "Enter" && event.shiftKey;

              if (showSkillMenu) {
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  setSelectedSkillIndex(
                    (selectedSkillIndex + 1) % matchingSkills.length,
                  );
                  return;
                }

                if (event.key === "ArrowUp") {
                  event.preventDefault();
                  setSelectedSkillIndex(
                    (selectedSkillIndex - 1 + matchingSkills.length) %
                      matchingSkills.length,
                  );
                  return;
                }

                if (event.key === "Tab") {
                  const skill = matchingSkills[selectedSkillIndex];
                  if (skill) {
                    event.preventDefault();
                    insertSkill(skill);
                  }
                  return;
                }

                if (event.key === "Escape") {
                  event.preventDefault();
                  setIsSkillMenuDismissed(true);
                  return;
                }
              }

              if (showCommandMenu) {
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  setSelectedCommandIndex(
                    (selectedCommandIndex + 1) % matchingCommands.length,
                  );
                  return;
                }

                if (event.key === "ArrowUp") {
                  event.preventDefault();
                  setSelectedCommandIndex(
                    (selectedCommandIndex - 1 + matchingCommands.length) %
                      matchingCommands.length,
                  );
                  return;
                }

                if (event.key === "Tab") {
                  const command = matchingCommands[selectedCommandIndex];
                  if (command) {
                    event.preventDefault();
                    preserveCommandMenuDismissalRef.current = true;
                    onDraftChange(command.label);
                    setIsCommandMenuDismissed(true);
                  }
                  return;
                }

                if (event.key === "Escape") {
                  event.preventDefault();
                  setIsCommandMenuDismissed(true);
                  return;
                }
              }

              if (
                event.key !== "Enter" ||
                event.shiftKey ||
                event.nativeEvent.isComposing
              ) {
                return;
              }

              event.preventDefault();
              handleSubmit();
            }}
            placeholder="Message Flowent"
          />
          <Button
            aria-label={showStopButton ? "Stop" : "Send message"}
            className={cn(
              "size-9 rounded-full shadow-none disabled:bg-transparent disabled:text-white/35 disabled:opacity-100 [&_svg]:size-5",
              showStopButton
                ? "bg-white text-black hover:bg-[#e5e5e5] [&_svg]:size-3.5"
                : "bg-white text-black hover:bg-[#e5e5e5]",
              isSendUnavailable &&
                "bg-transparent text-white/35 hover:bg-transparent",
            )}
            aria-disabled={isSendUnavailable}
            disabled={isSendDisabled}
            onClick={showStopButton ? onStopResponse : undefined}
            size="icon-lg"
            type={showStopButton ? "button" : "submit"}
          >
            {showStopButton ? (
              <Square aria-hidden="true" fill="currentColor" />
            ) : (
              <ArrowUp aria-hidden="true" />
            )}
          </Button>
        </form>
      </div>
    </div>
  );
}

function shouldHandleSoftKeyboardSubmit() {
  if (typeof navigator === "undefined") {
    return false;
  }

  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}
