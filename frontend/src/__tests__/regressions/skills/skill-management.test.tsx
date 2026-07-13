import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import App from "@/App";
import { projectSkill } from "@/test/app-fixtures";
import { mockSkillsAppRequests } from "@/test/skills-app-harness";

describe("Skill management", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    window.history.replaceState({}, "", "/");
    window.localStorage.clear();
  });

  it("shows an empty Skills page when no skills are available", async () => {
    const user = userEvent.setup();
    mockSkillsAppRequests();
    render(<App />);

    await user.click(await screen.findByRole("tab", { name: "Skills" }));

    expect(screen.getAllByText("No skills").length).toBeGreaterThan(0);
  });

  it("lists available skills with their scope and description", async () => {
    const user = userEvent.setup();
    mockSkillsAppRequests({ initialSkills: [projectSkill()] });
    render(<App />);

    await user.click(await screen.findByRole("tab", { name: "Skills" }));

    expect(screen.getAllByText("Project Review").length).toBeGreaterThan(0);
    expect(screen.getByText("Review project changes.")).toBeInTheDocument();
    expect(screen.getByText("Project")).toBeInTheDocument();
    expect(screen.getByText("$project-review")).toBeInTheDocument();
  });

  it("shows invalid skill errors without hiding the skill", async () => {
    const user = userEvent.setup();
    mockSkillsAppRequests({
      initialSkills: [
        projectSkill({
          description: "",
          error: "Skill needs a name and description.",
          name: "Broken Skill",
          slug: "broken-skill",
        }),
      ],
    });
    render(<App />);

    await user.click(await screen.findByRole("tab", { name: "Skills" }));

    expect(screen.getAllByText("Broken Skill").length).toBeGreaterThan(0);
    expect(
      screen.getByText("Skill needs a name and description."),
    ).toBeInTheDocument();
  });

  it("updates a skill when its enabled state changes", async () => {
    const user = userEvent.setup();
    mockSkillsAppRequests({ initialSkills: [projectSkill()] });
    render(<App />);

    await user.click(await screen.findByRole("tab", { name: "Skills" }));
    await user.click(await screen.findByRole("button", { name: "Off" }));

    expect(window.fetch).toHaveBeenCalledWith(
      "/api/skills/skill-project-review",
      expect.objectContaining({
        body: JSON.stringify({ enabled: false }),
        method: "PUT",
      }),
    );
  });

  it("reloads the Skills page from the current skill set", async () => {
    const user = userEvent.setup();
    mockSkillsAppRequests({ reloadResults: [projectSkill()] });
    render(<App />);

    await user.click(await screen.findByRole("tab", { name: "Skills" }));
    await waitFor(() => {
      expect(screen.getAllByText("No skills").length).toBeGreaterThan(0);
    });
    await user.click(screen.getByRole("button", { name: "Reload" }));

    await waitFor(() => {
      expect(screen.getAllByText("Project Review").length).toBeGreaterThan(0);
    });
  });

  it("shows skill suggestions when the composer starts a skill reference", async () => {
    const user = userEvent.setup();
    mockSkillsAppRequests({ initialSkills: [projectSkill()] });
    render(<App />);

    const composer = await screen.findByRole("textbox", {
      name: "Message Flowent",
    });
    await user.type(composer, "$");

    expect(screen.getByRole("listbox", { name: "Skills" })).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: /\$project-review/ }),
    ).toBeInTheDocument();
  });

  it("inserts the selected skill reference into the composer", async () => {
    const user = userEvent.setup();
    mockSkillsAppRequests({ initialSkills: [projectSkill()] });
    render(<App />);

    const composer = await screen.findByRole("textbox", {
      name: "Message Flowent",
    });
    await user.type(composer, "$");
    await user.click(screen.getByRole("option", { name: /\$project-review/ }));

    expect(composer).toHaveValue("$project-review ");
  });

  it("keeps focus in the composer when skill completion uses Tab", async () => {
    const user = userEvent.setup();
    mockSkillsAppRequests({ initialSkills: [projectSkill()] });
    render(<App />);

    const composer = await screen.findByRole("textbox", {
      name: "Message Flowent",
    });
    await user.type(composer, "$");
    await user.keyboard("{Tab}");

    expect(composer).toHaveFocus();
    expect(composer).toHaveValue("$project-review ");
  });

  it("does not suggest disabled skills in the composer", async () => {
    const user = userEvent.setup();
    mockSkillsAppRequests({
      initialSkills: [projectSkill({ enabled: false })],
    });
    render(<App />);

    const composer = await screen.findByRole("textbox", {
      name: "Message Flowent",
    });
    await user.type(composer, "$");

    expect(
      screen.queryByRole("listbox", { name: "Skills" }),
    ).not.toBeInTheDocument();
    expect(document.body).not.toHaveTextContent("$project-review");
  });
});
