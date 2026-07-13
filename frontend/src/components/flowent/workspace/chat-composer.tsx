import {
  type KeyboardEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ArrowUp, Square } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type {
  ContextUsageInfo,
  Message,
  WorkspaceCommand,
  WorkspaceCommandId,
} from "@/components/flowent/types";
import { contextCapacityFromMessages } from "@/components/flowent/workspace/context-capacity";
import { ContextCapacityTray } from "@/components/flowent/workspace/context-capacity-tray";
import {
  appendPromptHistoryEntry,
  isCaretOnFirstLine,
  isCaretOnLastLine,
  promptHistoryFromMessages,
  shouldHandleSoftKeyboardSubmit,
} from "@/components/flowent/workspace/composer-history";
import {
  CommandMenu,
  SkillMenu,
} from "@/components/flowent/workspace/composer-menus";
import {
  PlanTray,
  type WorkspacePlan,
} from "@/components/flowent/workspace/plan-tray";
import type { Skill } from "@/features/skills/model/skill-types";
import { cn } from "@/lib/utils";

export function ChatComposer({
  commands,
  contextWindowLimit,
  draft,
  isRefiningContext,
  isSending,
  messages,
  plan,
  usageInfo,
  onCommand,
  onCommandError,
  onDraftChange,
  onOffsetChange,
  onSendMessage,
  onStopResponse,
  skills,
}: {
  commands: WorkspaceCommand[];
  contextWindowLimit: number | null;
  draft: string;
  isRefiningContext: boolean;
  isSending: boolean;
  messages: Message[];
  plan: WorkspacePlan | null;
  usageInfo: ContextUsageInfo | null;
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
  const preserveHistoryNavigationRef = useRef(false);
  const preserveSkillMenuDismissalRef = useRef(false);
  const historyIndexRef = useRef<number | null>(null);
  const historyStagedDraftRef = useRef("");
  const [isCommandMenuDismissed, setIsCommandMenuDismissed] = useState(false);
  const [isSkillMenuDismissed, setIsSkillMenuDismissed] = useState(false);
  const [selectedCommandIndex, setSelectedCommandIndex] = useState(0);
  const [selectedSkillIndex, setSelectedSkillIndex] = useState(0);
  const [sessionPromptHistory, setSessionPromptHistory] = useState<string[]>(
    [],
  );
  const messagePromptHistory = useMemo(
    () => promptHistoryFromMessages(messages),
    [messages],
  );
  const messagePromptHistoryRef = useRef<string[]>(messagePromptHistory);
  const promptHistory =
    sessionPromptHistory.length > 0
      ? sessionPromptHistory
      : messagePromptHistory;
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
    currentDraft().length > 0 &&
    (!isSending || canSubmitCommand) &&
    !isRefiningContext;
  const showStopButton = isSending && !canSubmitCommand;
  const isSendUnavailable = !showStopButton && !canSubmit;
  const isSendDisabled = isSendUnavailable && !handlesSoftKeyboardSubmit;
  const capacity = useMemo(
    () =>
      contextCapacityFromMessages(
        messages,
        draft,
        usageInfo,
        contextWindowLimit,
      ),
    [contextWindowLimit, draft, messages, usageInfo],
  );

  useEffect(() => {
    if (messagePromptHistory.length > 0) {
      messagePromptHistoryRef.current = messagePromptHistory;
    }
  }, [messagePromptHistory]);

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
    if (preserveHistoryNavigationRef.current) {
      preserveHistoryNavigationRef.current = false;
      return;
    }

    historyIndexRef.current = null;
    historyStagedDraftRef.current = "";
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

  const rememberPromptHistory = (content: string) => {
    setSessionPromptHistory((currentHistory) =>
      appendPromptHistoryEntry(
        currentHistory.length > 0
          ? [...currentHistory]
          : [...messagePromptHistoryRef.current],
        content,
      ),
    );
  };

  const runCommand = (command: WorkspaceCommand) => {
    const commandAccepted = onCommand(command.id);
    if (!commandAccepted) {
      setIsCommandMenuDismissed(true);
      return;
    }
    rememberPromptHistory(command.label);
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

  const setDraftFromPromptHistory = (value: string) => {
    preserveCommandMenuDismissalRef.current = true;
    preserveSkillMenuDismissalRef.current = true;
    preserveHistoryNavigationRef.current = true;
    setIsCommandMenuDismissed(true);
    setIsSkillMenuDismissed(true);
    onDraftChange(value);
    window.requestAnimationFrame(() => {
      const textarea = textareaRef.current;
      if (!textarea) {
        return;
      }
      textarea.focus();
      textarea.setSelectionRange(value.length, value.length);
    });
  };

  const navigatePromptHistory = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (
      promptHistory.length === 0 ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey ||
      event.nativeEvent.isComposing
    ) {
      return false;
    }

    const textarea = event.currentTarget;

    if (event.key === "ArrowUp") {
      if (!isCaretOnFirstLine(textarea)) {
        return false;
      }

      event.preventDefault();
      const currentIndex = historyIndexRef.current;
      const nextIndex =
        currentIndex === null
          ? promptHistory.length - 1
          : Math.max(currentIndex - 1, 0);

      if (currentIndex === null) {
        historyStagedDraftRef.current = textarea.value;
      }
      historyIndexRef.current = nextIndex;
      setDraftFromPromptHistory(promptHistory[nextIndex]);
      return true;
    }

    if (event.key !== "ArrowDown") {
      return false;
    }

    if (!isCaretOnLastLine(textarea)) {
      return false;
    }

    const currentIndex = historyIndexRef.current;
    if (currentIndex === null) {
      return false;
    }

    event.preventDefault();
    const nextIndex = currentIndex + 1;
    if (nextIndex >= promptHistory.length) {
      historyIndexRef.current = null;
      setDraftFromPromptHistory(historyStagedDraftRef.current);
      historyStagedDraftRef.current = "";
      return true;
    }

    historyIndexRef.current = nextIndex;
    setDraftFromPromptHistory(promptHistory[nextIndex]);
    return true;
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

    if (!canSubmit) {
      return;
    }

    rememberPromptHistory(submittedDraft);
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
          <CommandMenu
            commands={matchingCommands}
            selectedIndex={selectedCommandIndex}
            onCommand={runCommand}
            onSelectIndex={setSelectedCommandIndex}
          />
        ) : null}
        {showSkillMenu ? (
          <SkillMenu
            selectedIndex={selectedSkillIndex}
            skills={matchingSkills}
            onSelectIndex={setSelectedSkillIndex}
            onSkill={insertSkill}
          />
        ) : null}
        <form
          aria-label="Workspace composer"
          className="flex flex-col-reverse overflow-clip rounded-[14px] border border-zinc-800 bg-zinc-950 shadow-[0_16px_44px_rgba(0,0,0,0.42),inset_0_0_1px_rgba(255,255,255,0.2)] transition-colors focus-within:border-zinc-700"
          onSubmit={(event) => {
            event.preventDefault();
            handleSubmit();
          }}
        >
          <ContextCapacityTray
            capacity={capacity}
            isRefining={isRefiningContext}
          />
          <div className="grid min-h-14 w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-2 bg-[#212121] p-2.5">
            <Textarea
              aria-label="Message Flowent"
              className="flowent-composer-textarea max-h-[216px] min-h-9 resize-none overflow-y-auto border-0 bg-transparent px-2 py-1.5 text-white shadow-none placeholder:text-[#9b9b9b] focus-visible:border-transparent focus-visible:ring-0 dark:bg-transparent"
              enterKeyHint="send"
              rows={1}
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
                  navigatePromptHistory(event) ||
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
          </div>
          <PlanTray isHidden={showCommandMenu || showSkillMenu} plan={plan} />
        </form>
      </div>
    </div>
  );
}
