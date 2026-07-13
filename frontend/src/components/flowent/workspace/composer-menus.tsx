import { Sparkles, Terminal } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { Skill } from "@/features/skills/model/skill-types";
import type { WorkspaceCommand } from "@/features/workspace/model/command-types";
import { cn } from "@/lib/utils";

export function CommandMenu({
  commands,
  selectedIndex,
  onCommand,
  onSelectIndex,
}: {
  commands: WorkspaceCommand[];
  selectedIndex: number;
  onCommand: (command: WorkspaceCommand) => void;
  onSelectIndex: (index: number) => void;
}) {
  return (
    <div
      aria-label="Commands"
      className="mb-2 overflow-hidden rounded-xl border border-white/10 bg-[#171717] p-1 shadow-[0_16px_44px_rgba(0,0,0,0.42)]"
      role="listbox"
    >
      {commands.map((command, index) => (
        <Button
          aria-selected={index === selectedIndex}
          className={cn(
            "flex h-auto w-full items-center justify-start gap-3 rounded-lg border-0 bg-transparent px-3 py-2 text-left text-base text-white shadow-none transition-colors hover:bg-input/50 hover:text-white",
            index === selectedIndex && "bg-input/40",
          )}
          key={command.id}
          onClick={() => onCommand(command)}
          onMouseEnter={() => onSelectIndex(index)}
          size="sm"
          role="option"
          type="button"
          variant="ghost"
        >
          <Terminal aria-hidden="true" className="size-4 text-white/75" />
          <span className="min-w-0 flex-1">
            <span className="block font-medium leading-5">{command.label}</span>
            <span className="block truncate text-xs leading-4 text-white/55">
              {command.description}
            </span>
          </span>
        </Button>
      ))}
    </div>
  );
}

export function SkillMenu({
  selectedIndex,
  skills,
  onSelectIndex,
  onSkill,
}: {
  selectedIndex: number;
  skills: Skill[];
  onSelectIndex: (index: number) => void;
  onSkill: (skill: Skill) => void;
}) {
  return (
    <div
      aria-label="Skills"
      className="mb-2 overflow-hidden rounded-xl border border-white/10 bg-[#171717] p-1 shadow-[0_16px_44px_rgba(0,0,0,0.42)]"
      role="listbox"
    >
      {skills.map((skill, index) => (
        <Button
          aria-selected={index === selectedIndex}
          className={cn(
            "flex h-auto w-full items-center justify-start gap-3 rounded-lg border-0 bg-transparent px-3 py-2 text-left text-base text-white shadow-none transition-colors hover:bg-input/50 hover:text-white",
            index === selectedIndex && "bg-input/40",
          )}
          key={skill.id}
          onClick={() => onSkill(skill)}
          onMouseEnter={() => onSelectIndex(index)}
          size="sm"
          role="option"
          type="button"
          variant="ghost"
        >
          <Sparkles aria-hidden="true" className="size-4 text-white/75" />
          <span className="min-w-0 flex-1">
            <span className="block font-medium leading-5">${skill.slug}</span>
            <span className="block truncate text-xs leading-4 text-white/55">
              {skill.description || skill.name}
            </span>
          </span>
        </Button>
      ))}
    </div>
  );
}
