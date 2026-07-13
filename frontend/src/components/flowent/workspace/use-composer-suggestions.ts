import { useEffect, useMemo, useRef, useState } from "react";

import type { WorkspaceCommand } from "@/features/workspace/model/command-types";
import type { Skill } from "@/features/skills/model/skill-types";

export function useComposerSuggestions({
  commands,
  draft,
  isSending,
  onDraftChange,
  skills,
}: {
  commands: WorkspaceCommand[];
  draft: string;
  isSending: boolean;
  onDraftChange: (value: string) => void;
  skills: Skill[];
}) {
  const preserveCommandDismissalRef = useRef(false);
  const preserveSkillDismissalRef = useRef(false);
  const [isCommandMenuDismissed, setCommandMenuDismissed] = useState(false);
  const [isSkillMenuDismissed, setSkillMenuDismissed] = useState(false);
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

  useEffect(() => {
    if (preserveCommandDismissalRef.current) {
      preserveCommandDismissalRef.current = false;
      return;
    }

    setCommandMenuDismissed(false);
    setSelectedCommandIndex(0);
  }, [draft]);

  useEffect(() => {
    if (preserveSkillDismissalRef.current) {
      preserveSkillDismissalRef.current = false;
      return;
    }

    setSkillMenuDismissed(false);
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

  const dismissCommandMenu = () => setCommandMenuDismissed(true);
  const dismissSkillMenu = () => setSkillMenuDismissed(true);

  const prepareHistoryNavigation = () => {
    preserveCommandDismissalRef.current = true;
    preserveSkillDismissalRef.current = true;
    dismissCommandMenu();
    dismissSkillMenu();
  };

  const completeCommand = (command: WorkspaceCommand) => {
    preserveCommandDismissalRef.current = true;
    onDraftChange(command.label);
    dismissCommandMenu();
  };

  const insertSkill = (skill: Skill) => {
    const nextDraft = draft.replace(/(?:^|\s)\$([a-z0-9-]*)$/i, (match) => {
      const prefix = match.startsWith(" ") ? " " : "";
      return `${prefix}$${skill.slug} `;
    });
    preserveSkillDismissalRef.current = true;
    onDraftChange(nextDraft);
    dismissSkillMenu();
  };

  return {
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
  };
}
