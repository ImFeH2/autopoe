import { useCallback, useMemo, useState } from "react";

import {
  reloadSkillsRequest,
  updateSkillEnabledRequest,
} from "@/features/skills/api/skill-requests";
import type { Skill } from "@/features/skills/model/skill-types";

export const useSkills = () => {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [activeSkillId, setActiveSkillId] = useState("");

  const activeSkill = useMemo(
    () => skills.find((skill) => skill.id === activeSkillId) ?? skills[0],
    [activeSkillId, skills],
  );

  const replaceSkills = useCallback((nextSkills: Skill[]) => {
    setSkills(nextSkills);
    setActiveSkillId(nextSkills[0]?.id ?? "");
  }, []);

  const selectSkill = useCallback((skill: Skill) => {
    setActiveSkillId(skill.id);
  }, []);

  const reloadSkills = useCallback(async () => {
    const reloadedSkills = await reloadSkillsRequest();

    if (reloadedSkills) {
      setSkills(reloadedSkills);
      setActiveSkillId((currentSkillId) => {
        if (reloadedSkills.some((skill) => skill.id === currentSkillId)) {
          return currentSkillId;
        }
        return reloadedSkills[0]?.id ?? "";
      });
    }
  }, []);

  const toggleSkill = useCallback(async (skill: Skill, enabled: boolean) => {
    const updatedSkill = await updateSkillEnabledRequest(skill.id, enabled);

    if (updatedSkill) {
      setSkills((currentSkills) =>
        currentSkills.map((currentSkill) =>
          currentSkill.id === updatedSkill.id ? updatedSkill : currentSkill,
        ),
      );
    }
  }, []);

  return {
    activeSkill,
    reloadSkills,
    replaceSkills,
    selectSkill,
    skills,
    toggleSkill,
  };
};
