import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Sidebar } from "@/components/Sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";

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
  PanelResizer: ({
    onMouseDown,
  }: {
    onMouseDown: React.MouseEventHandler<HTMLDivElement>;
  }) => <div data-testid="panel-resizer" onMouseDown={onMouseDown} />,
}));

vi.mock("@/components/SidebarActivityTicker", () => ({
  SidebarActivityTicker: () => null,
}));

describe("Sidebar", () => {
  const navigateToPage = vi.fn();
  const logout = vi.fn();
  const renderSidebar = (
    props?: Partial<React.ComponentProps<typeof Sidebar>>,
  ) =>
    render(
      <TooltipProvider>
        <Sidebar width={232} onWidthChange={() => {}} {...props} />
      </TooltipProvider>,
    );

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
    renderSidebar();

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

    renderSidebar({ onNavigate });

    fireEvent.click(screen.getByRole("button", { name: "Providers" }));

    expect(navigateToPage).toHaveBeenCalledWith("providers");
    expect(onNavigate).toHaveBeenCalledTimes(1);
  });

  it("left aligns navigation and logout actions", () => {
    renderSidebar();

    expect(screen.getByRole("button", { name: "Workspace" })).toHaveClass(
      "text-left",
    );
    expect(screen.getByRole("button", { name: "Logout" })).toHaveClass(
      "text-left",
    );
  });

  it("keeps the active navigation item at the same font weight", () => {
    renderSidebar();

    const workspace = screen.getByRole("button", { name: "Workspace" });
    expect(workspace).toHaveAttribute("data-active", "true");
    expect(workspace.className).not.toContain("font-bold");
  });

  it("uses a compact hover treatment for navigation items", () => {
    renderSidebar();

    expect(screen.getByRole("button", { name: "Providers" })).toHaveClass(
      "cursor-pointer",
      "rounded-sm",
      "hover:bg-sidebar-accent",
    );
  });

  it("renders icon-only navigation while compressed", () => {
    renderSidebar({ iconRail: true, width: 68 });

    expect(screen.queryByText("Agent Studio")).not.toBeInTheDocument();
    expect(screen.queryByText("Configuration")).not.toBeInTheDocument();
    expect(screen.queryByText("Live")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Assistant" })).toHaveClass(
      "size-10",
      "cursor-pointer",
      "rounded-sm",
      "hover:bg-sidebar-accent",
    );
    expect(screen.getByRole("button", { name: "Workspace" })).toHaveAttribute(
      "data-active",
      "true",
    );
    expect(screen.getByRole("button", { name: "Logout" })).toHaveClass(
      "size-10",
    );
  });

  it("keeps all primary pages available from the icon rail", () => {
    renderSidebar({ iconRail: true, width: 68 });

    expect(
      screen
        .getAllByRole("button")
        .map((button) => button.getAttribute("aria-label")),
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

  it("keeps drag width updates on the full navigation while compressed", () => {
    const onWidthChange = vi.fn();

    renderSidebar({
      expandedWidth: 232,
      iconRail: true,
      width: 68,
      onWidthChange,
    });

    fireEvent.mouseDown(screen.getByTestId("panel-resizer"), {
      clientX: 68,
      clientY: 20,
    });
    fireEvent.mouseMove(document, { clientX: 100, clientY: 20 });
    fireEvent.mouseUp(document);

    expect(onWidthChange).toHaveBeenCalledWith(264);
  });
});
