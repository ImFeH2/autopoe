import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ShellHeader } from "@/components/layout/ShellHeader";

const { useAgentTabsRuntime, useAgentUI } = vi.hoisted(() => ({
  useAgentTabsRuntime: vi.fn(),
  useAgentUI: vi.fn(),
}));

vi.mock("@/context/AgentContext", async () => {
  const actual = await vi.importActual<typeof import("@/context/AgentContext")>(
    "@/context/AgentContext",
  );
  return {
    ...actual,
    useAgentTabsRuntime,
    useAgentUI,
  };
});

describe("ShellHeader", () => {
  const navigateToPage = vi.fn();
  const navigateToWorkspaceTab = vi.fn();
  const onOpenNavigation = vi.fn();
  class ResizeObserverMock {
    observe() {}
    unobserve() {}
    disconnect() {}
  }

  beforeEach(() => {
    vi.clearAllMocks();
    globalThis.ResizeObserver = ResizeObserverMock;
    useAgentUI.mockReturnValue({
      currentPage: "settings",
      navigateToPage,
      navigateToWorkspaceTab,
    });
    useAgentTabsRuntime.mockReturnValue({
      tabs: new Map([
        [
          "workflow-1",
          {
            id: "workflow-1",
            title: "Release Plan",
          },
        ],
      ]),
    });
  });

  afterEach(() => {
    cleanup();
    Reflect.deleteProperty(globalThis, "ResizeObserver");
  });

  it("shows the shared command entry on desktop pages", () => {
    render(<ShellHeader compact={false} onOpenNavigation={onOpenNavigation} />);

    expect(
      screen.getByRole("button", { name: "Open search" }),
    ).toHaveTextContent("Do anything");
    expect(
      screen.queryByRole("button", { name: "Open navigation" }),
    ).not.toBeInTheDocument();
  });

  it("keeps navigation and command entry available in compact layout", () => {
    render(<ShellHeader compact onOpenNavigation={onOpenNavigation} />);

    fireEvent.click(screen.getByRole("button", { name: "Open navigation" }));
    expect(onOpenNavigation).toHaveBeenCalledTimes(1);
    expect(
      screen.getByRole("button", { name: "Open search" }),
    ).toHaveTextContent("Do anything");
  });

  it("opens the command palette and navigates to pages and workflows", async () => {
    render(<ShellHeader compact={false} onOpenNavigation={onOpenNavigation} />);

    fireEvent.click(screen.getByRole("button", { name: "Open search" }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Settings"));
    expect(navigateToPage).toHaveBeenCalledWith("settings");

    fireEvent.click(screen.getByRole("button", { name: "Open search" }));
    fireEvent.click(await screen.findByText("Release Plan"));
    expect(navigateToWorkspaceTab).toHaveBeenCalledWith("workflow-1");
    expect(navigateToPage).not.toHaveBeenCalledWith("workspace");
  });
});
