import { useMemo, useRef } from "react";
import { ArrowUp, Square } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type {
  WorkspaceCommand,
  WorkspaceCommandId,
} from "@/features/workspace/model/command-types";
import type { ContextUsageInfo } from "@/features/workspace/model/context-usage-types";
import type { Message } from "@/features/workspace/model/message-types";
import { contextCapacityFromMessages } from "@/components/flowent/workspace/context-capacity";
import { ContextCapacityTray } from "@/components/flowent/workspace/context-capacity-tray";
import { shouldHandleSoftKeyboardSubmit } from "@/components/flowent/workspace/composer-history";
import {
  CommandMenu,
  SkillMenu,
} from "@/components/flowent/workspace/composer-menus";
import {
  PlanTray,
  type WorkspacePlan,
} from "@/components/flowent/workspace/plan-tray";
import { useComposerOffset } from "@/components/flowent/workspace/use-composer-offset";
import { useComposerSuggestions } from "@/components/flowent/workspace/use-composer-suggestions";
import { usePromptHistoryNavigation } from "@/components/flowent/workspace/use-prompt-history-navigation";
import { useSoftKeyboardSubmit } from "@/components/flowent/workspace/use-soft-keyboard-submit";
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
  const composerRef = useComposerOffset(onOffsetChange);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const {
    canSubmitCommand,
    commandName,
    completeCommand,
    dismissCommandMenu,
    dismissSkillMenu,
    insertSkill,
    isCommandDraft,
    matchingCommands,
    matchingSkills,
    prepareHistoryNavigation,
    selectedCommandIndex,
    selectedSkillIndex,
    setCommandMenuDismissed,
    setSelectedCommandIndex,
    setSelectedSkillIndex,
    showCommandMenu,
    showSkillMenu,
  } = useComposerSuggestions({
    commands,
    draft,
    isSending,
    onDraftChange,
    skills,
  });
  const currentDraft = () => textareaRef.current?.value ?? draft;
  const handlesSoftKeyboardSubmit = shouldHandleSoftKeyboardSubmit();
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

  const { navigatePromptHistory, rememberPromptHistory } =
    usePromptHistoryNavigation({
      draft,
      messages,
      onBeforeNavigate: prepareHistoryNavigation,
      onDraftChange,
      textareaRef,
    });

  const runCommand = (command: WorkspaceCommand) => {
    const commandAccepted = onCommand(command.id);
    if (!commandAccepted) {
      dismissCommandMenu();
      return;
    }
    rememberPromptHistory(command.label);
    onDraftChange("");
    setCommandMenuDismissed(false);
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
      setCommandMenuDismissed(false);
      onCommandError("Command not found.");
      return;
    }

    if (!canSubmit) {
      return;
    }

    rememberPromptHistory(submittedDraft);
    onSendMessage(submittedDraft);
  };

  const trackSoftKeyboardLineBreak = useSoftKeyboardSubmit({
    isEnabled: handlesSoftKeyboardSubmit,
    onSubmit: handleSubmit,
    textareaRef,
  });

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
                trackSoftKeyboardLineBreak(event);

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
                    dismissSkillMenu();
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
                      completeCommand(command);
                    }
                    return;
                  }

                  if (event.key === "Escape") {
                    event.preventDefault();
                    dismissCommandMenu();
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
