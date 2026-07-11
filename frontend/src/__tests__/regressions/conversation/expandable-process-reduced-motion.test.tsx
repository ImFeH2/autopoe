import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ToolProcessItem } from "@/components/flowent/workspace/tool-process";

vi.mock("framer-motion", async (importOriginal) => {
  const original = await importOriginal<typeof import("framer-motion")>();
  return {
    ...original,
    useReducedMotion: () => true,
  };
});

describe("Workspace expandable process reduced motion", () => {
  it("removes collapsed details without waiting for an animation", async () => {
    const user = userEvent.setup();
    render(
      <ToolProcessItem
        tool={{
          arguments: { path: "notes.txt" },
          id: "tool-1",
          name: "read_file",
          result: { text: "Project notes", type: "text" },
          status: "success",
          title: "Read notes.txt",
        }}
      />,
    );

    const toggle = screen.getByRole("button", { name: /Read notes\.txt/ });
    await user.click(toggle);
    expect(screen.getByText("Project notes")).toBeInTheDocument();

    await user.click(toggle);

    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Project notes")).not.toBeInTheDocument();
  });
});
