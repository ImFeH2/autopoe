import { AlertCircle, RefreshCw, Sparkles } from "lucide-react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import {
  dashedPanelClassName,
  dataRowClassName,
  dataRowLabelClassName,
  emptyStateClassName,
  fieldLabelClassName,
  mutedTextClassName,
  navigationLabelClassName,
  stableScrollbarClassName,
  subtleButtonClassName,
} from "@/components/flowent/styles";
import type { Skill } from "@/features/skills/model/skill-types";
import { cn } from "@/lib/utils";

export function SkillsView({
  activeSkill,
  onReloadSkills,
  onSkillSelect,
  onSkillToggle,
  skills,
}: {
  activeSkill?: Skill;
  onReloadSkills: () => void;
  onSkillSelect: (skill: Skill) => void;
  onSkillToggle: (skill: Skill, enabled: boolean) => void;
  skills: Skill[];
}) {
  const { t } = useTranslation();

  return (
    <section
      className="grid h-full min-h-0 bg-black"
      aria-label={t("setup.skills.page")}
    >
      <div className="grid h-full min-h-0 grid-cols-[232px_minmax(0,1fr)] max-[900px]:grid-cols-1 max-[900px]:grid-rows-[auto_minmax(0,1fr)]">
        <SkillsSidebar
          activeSkill={activeSkill}
          onReloadSkills={onReloadSkills}
          onSkillSelect={onSkillSelect}
          skills={skills}
        />
        <SkillDetails activeSkill={activeSkill} onSkillToggle={onSkillToggle} />
      </div>
    </section>
  );
}

function SkillsSidebar({
  activeSkill,
  onReloadSkills,
  onSkillSelect,
  skills,
}: {
  activeSkill?: Skill;
  onReloadSkills: () => void;
  onSkillSelect: (skill: Skill) => void;
  skills: Skill[];
}) {
  const { t } = useTranslation();

  return (
    <aside
      className={cn(
        "flex min-h-0 min-w-0 flex-col overflow-auto border-r border-white/10 bg-black p-3 max-[900px]:max-h-64 max-[900px]:border-r-0 max-[900px]:border-b",
        stableScrollbarClassName,
      )}
      aria-label={t("setup.skills.list")}
    >
      <Button
        className="h-8 w-full border-dashed border-white/20 bg-input/30 text-base text-white shadow-none hover:bg-input/50"
        onClick={onReloadSkills}
        size="sm"
        type="button"
        variant="outline"
      >
        <RefreshCw aria-hidden="true" />
        {t("setup.skills.reload")}
      </Button>
      <div className="mt-4 -mx-1 grid gap-0">
        {skills.length === 0 ? (
          <p className={emptyStateClassName}>{t("setup.skills.noSkills")}</p>
        ) : null}
        {skills.map((skill) => {
          const isActive = activeSkill?.id === skill.id;

          return (
            <Button
              aria-label={skill.name}
              aria-pressed={isActive}
              className={cn(
                "grid h-auto min-h-[34px] w-full cursor-pointer justify-start rounded-lg border border-transparent bg-transparent px-2 py-1 text-left text-white/90 shadow-none transition-colors duration-100 hover:bg-[#151515] hover:text-white",
                navigationLabelClassName,
                isActive && "bg-[#202020] text-white",
              )}
              key={skill.id}
              onClick={() => onSkillSelect(skill)}
              size="sm"
              type="button"
              variant="ghost"
            >
              <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">
                {skill.name}
              </span>
            </Button>
          );
        })}
      </div>
    </aside>
  );
}

function SkillDetails({
  activeSkill,
  onSkillToggle,
}: {
  activeSkill?: Skill;
  onSkillToggle: (skill: Skill, enabled: boolean) => void;
}) {
  const { t } = useTranslation();

  if (!activeSkill) {
    return (
      <div className="grid min-h-0 content-start overflow-auto px-12 py-8 max-[900px]:px-5 max-[900px]:py-5">
        <p className={emptyStateClassName}>{t("setup.skills.noSkills")}</p>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "grid min-h-0 w-full content-start gap-7 overflow-auto px-12 py-8 max-[900px]:px-5 max-[900px]:py-5",
        stableScrollbarClassName,
      )}
      aria-label={t("setup.skills.skill")}
    >
      <section className="grid gap-3">
        <div className={dashedPanelClassName}>
          <div className={dataRowClassName}>
            <div className={cn(fieldLabelClassName, dataRowLabelClassName)}>
              {t("setup.skills.name")}
            </div>
            <div className="min-w-0 text-base leading-5 text-white">
              {activeSkill.name}
            </div>
          </div>
          <div className={dataRowClassName}>
            <div className={cn(fieldLabelClassName, dataRowLabelClassName)}>
              {t("setup.skills.call")}
            </div>
            <div className="min-w-0 font-mono text-base leading-5 text-white">
              ${activeSkill.slug}
            </div>
          </div>
          <div className={dataRowClassName}>
            <div className={cn(fieldLabelClassName, dataRowLabelClassName)}>
              {t("setup.skills.scope")}
            </div>
            <div className="min-w-0 text-base leading-5 text-white">
              {scopeLabel(activeSkill.scope, t)}
            </div>
          </div>
          <div className={dataRowClassName}>
            <div className={cn(fieldLabelClassName, dataRowLabelClassName)}>
              {t("setup.skills.status")}
            </div>
            <div className="min-w-0 text-base leading-5 text-white">
              {activeSkill.enabled
                ? t("setup.skills.on")
                : t("setup.skills.off")}
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-2">
        <div className="flex items-center gap-2 text-sm font-medium text-white">
          <Sparkles aria-hidden="true" className="size-4 text-white/70" />
          {t("setup.skills.description")}
        </div>
        {activeSkill.description ? (
          <p className={cn("m-0 text-sm leading-6", mutedTextClassName)}>
            {activeSkill.description}
          </p>
        ) : (
          <p className={emptyStateClassName}>
            {t("setup.skills.noDescription")}
          </p>
        )}
      </section>

      {activeSkill.error ? (
        <section className="flex items-start gap-2 rounded-lg border border-red-300/20 bg-black p-3 text-sm leading-5 text-red-200">
          <AlertCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          <span>{activeSkill.error}</span>
        </section>
      ) : null}

      <div className="flex justify-end">
        <Button
          className={subtleButtonClassName}
          onClick={() => onSkillToggle(activeSkill, !activeSkill.enabled)}
          type="button"
          variant="outline"
        >
          {activeSkill.enabled ? t("setup.skills.off") : t("setup.skills.on")}
        </Button>
      </div>
    </div>
  );
}

function scopeLabel(scope: Skill["scope"], t: TFunction) {
  return scope === "project"
    ? t("setup.skills.project")
    : t("setup.skills.user");
}
