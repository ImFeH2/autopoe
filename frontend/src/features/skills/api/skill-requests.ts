import type { Skill } from "@/features/skills/model/skill-types";

export const reloadSkillsRequest = async () => {
  const response = await fetch("/api/skills/reload", {
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });

  if (!response.ok) {
    return null;
  }
  return (await response.json()) as Skill[];
};

export const updateSkillEnabledRequest = async (
  skillId: string,
  enabled: boolean,
) => {
  const response = await fetch(`/api/skills/${encodeURIComponent(skillId)}`, {
    body: JSON.stringify({ enabled }),
    headers: { "Content-Type": "application/json" },
    method: "PUT",
  });

  if (!response.ok) {
    return null;
  }
  return (await response.json()) as Skill;
};
