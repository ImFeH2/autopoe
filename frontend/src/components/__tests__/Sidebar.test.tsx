import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Sidebar } from "@/components/Sidebar";

const { useAgentConnectionRuntime, useAgentUI } = vi.hoisted(() => ({
  useAgentConnectionRuntime: vi.fn(),
  useAgentUI: vi.fn(),
}));
const { useAccess } = vi.hoisted(() => ({
  useAccess: vi.fn(),
}));

vi.mock("@/context/AgentContext", async () => {
  const actual = await vi.importActual<typeof import("@/context/AgentContext")>(
    "@/context/AgentContext",
  );
  return {
    ...actual,
    useAgentConnectionRuntime,
    useAgentUI,
  };
});

vi.mock("@/context/useAccess", () => ({
  useAccess,
}));

vi.mock("@/components/PanelResizer", () => ({
  PanelResizer: () => null,
}));

vi.mock("@/components/SidebarActivityTicker", () => ({
  SidebarActivityTicker: () => null,
}));

describe("Sidebar", () => {
  const navigateToPage = vi.fn();
  const logout = vi.fn();

  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    navigateToPage.mockReset();
    logout.mockReset();
    useAgentConnectionRuntime.mockReturnValue({ connected: true });
    useAgentUI.mockReturnValue({
      currentPage: "workspace",
      navigateToPage,
    });
    useAccess.mockReturnValue({ logout });
  });

  it("renders navigation items in the expected order", () => {
    render(<Sidebar width={232} onWidthChange={() => {}} />);

    expect(screen.queryByText("Core")).toBeNull();
    expect(
      screen.getAllByRole("button").map((button) => button.textContent),
    ).toEqual([
      "Assistant",
      "Workspace",
      "Providers",
      "Roles",
      "Prompts",
      "Tools",
      "Channels",
      "Settings",
      "Logout",
    ]);
  });

  it("navigates to the selected page", () => {
    const onNavigate = vi.fn();

    render(
      <Sidebar width={232} onWidthChange={() => {}} onNavigate={onNavigate} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Providers" }));

    expect(navigateToPage).toHaveBeenCalledWith("providers");
    expect(onNavigate).toHaveBeenCalledTimes(1);
  });

  it("left aligns navigation and logout actions", () => {
    render(<Sidebar width={232} onWidthChange={() => {}} />);

    expect(screen.getByRole("button", { name: "Workspace" })).toHaveClass(
      "text-left",
    );
    expect(screen.getByRole("button", { name: "Logout" })).toHaveClass(
      "text-left",
    );
  });
});
