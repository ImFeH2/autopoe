export type SkillScope = "project" | "user";

export type Skill = {
  description: string;
  enabled: boolean;
  error: string;
  id: string;
  name: string;
  path: string;
  scope: SkillScope;
  slug: string;
};
