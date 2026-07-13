import { vi } from "vitest";

import {
  projectSkill,
  selectedProviderState,
  type TestSkill,
} from "@/test/app-fixtures";

type SkillsAppHarnessOptions = {
  initialSkills?: TestSkill[];
  reloadResults?: TestSkill[];
};

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status,
  });

const requestUrl = (input: RequestInfo | URL) => {
  if (typeof input === "string") {
    return input;
  }
  if (input instanceof URL) {
    return input.toString();
  }
  return input.url;
};

export const mockSkillsAppRequests = ({
  initialSkills = [],
  reloadResults = initialSkills,
}: SkillsAppHarnessOptions = {}) => {
  let skills = [...initialSkills];

  return vi.spyOn(window, "fetch").mockImplementation(async (input, init) => {
    const url = requestUrl(input);

    if (url === "/api/state") {
      return jsonResponse({ ...selectedProviderState(), skills });
    }

    if (url === "/api/about") {
      return jsonResponse({ version: "test" });
    }

    if (url.startsWith("/api/skills/") && init?.method === "PUT") {
      const request = JSON.parse(String(init.body)) as { enabled: boolean };
      const skillId = url.replace("/api/skills/", "");
      const currentSkill =
        skills.find((skill) => skill.id === skillId) ?? projectSkill();
      const updatedSkill = { ...currentSkill, enabled: request.enabled };
      skills = skills.map((skill) =>
        skill.id === updatedSkill.id ? updatedSkill : skill,
      );
      return jsonResponse(updatedSkill);
    }

    if (url === "/api/skills/reload" && init?.method === "POST") {
      skills = [...reloadResults];
      return jsonResponse(skills);
    }

    return jsonResponse({ detail: "Not found" }, 404);
  });
};
