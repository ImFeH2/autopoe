import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import App from "@/App";
import { savedWorkflow, selectedProviderState } from "@/test/app-fixtures";
import {
  mockAppShellRequests,
  mockNarrowSidebarViewport,
} from "@/test/app-shell-harness";

describe("App shell navigation", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  it("opens the Workspace as the default chat view", async () => {
    mockAppShellRequests();
    render(<App />);

    expect(
      screen.getByRole("navigation", { name: "Primary navigation" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Workspace" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getAllByText("No provider").length).toBeGreaterThan(0);
    expect(
      await screen.findByRole("textbox", { name: "Message Flowent" }),
    ).toBeInTheDocument();
    const sendButton = screen.getByRole("button", { name: "Send message" });
    expect(sendButton).toBeDisabled();
    expect(sendButton).not.toHaveTextContent("Send");
    expect(
      screen.queryByText(
        "I can help coordinate the launch checklist, draft each step, and keep the conversation focused on the decisions that still need a person.",
      ),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(
        "Start with the provider setup and a first workspace flow.",
      ),
    ).not.toBeInTheDocument();
  });

  it("opens a new workflow from the top Workflows item", async () => {
    const user = userEvent.setup();
    mockAppShellRequests({
      ...selectedProviderState(),
      workflows: [],
    });
    render(<App />);

    expect(
      screen.getByRole("button", { name: "Workflows" }),
    ).toBeInTheDocument();
    expect(screen.getByText("No workflow yet.")).toBeInTheDocument();

    await user.click(await screen.findByRole("tab", { name: "Workflows" }));

    expect(
      screen.queryByRole("textbox", { name: "Workflow name" }),
    ).not.toBeInTheDocument();
    expect(
      await screen.findByRole("button", { name: "Run" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("My Workflows")).not.toBeInTheDocument();
    expect(
      screen.getByText(
        "Right-click the canvas or use Add to create your first node.",
      ),
    ).toBeInTheDocument();
  });

  it("shows saved workflow rows as text-only history items", async () => {
    mockAppShellRequests({
      ...selectedProviderState(),
      workflows: [savedWorkflow()],
    });
    render(<App />);

    const workflowItem = await screen.findByRole("button", {
      name: "Launch Workflow",
    });
    const workflowSection = screen.getByRole("button", { name: "Workflows" });

    expect(workflowSection).toHaveClass("flowent-workflow-history-trigger");
    expect(workflowSection).not.toHaveClass("flowent-navigation-item");
    expect(workflowItem.querySelector("svg")).toBeNull();
    expect(workflowItem).toHaveClass("flowent-workflow-history-item");
    expect(workflowItem).not.toHaveClass("flowent-navigation-item");
  });

  it("shows workflow history actions for opening, renaming, pinning, and deleting", async () => {
    const user = userEvent.setup();
    const openSpy = vi.spyOn(window, "open").mockReturnValue(null);
    mockAppShellRequests({
      ...selectedProviderState(),
      workflows: [
        savedWorkflow(),
        savedWorkflow({
          id: "workflow-2",
          name: "Second Workflow",
          updated_at: 1710000040,
        }),
      ],
    });
    render(<App />);

    const launchWorkflow = await screen.findByRole("button", {
      name: "Launch Workflow",
    });
    const launchWorkflowRow = launchWorkflow.closest("div");
    await user.hover(launchWorkflow);
    await user.click(
      within(launchWorkflowRow as HTMLElement).getByRole("button", {
        name: "Options for Launch Workflow",
      }),
    );

    const openNewTabItem = screen.getByRole("menuitem", {
      name: "Open new tab",
    });
    expect(openNewTabItem).toBeVisible();
    expect(
      openNewTabItem.closest('[data-slot="dropdown-menu-content"]'),
    ).not.toBeNull();
    expect(
      openNewTabItem.closest('[data-slot="context-menu-content"]'),
    ).toBeNull();
    expect(screen.getByRole("menuitem", { name: "Rename" })).toBeVisible();
    expect(screen.getByRole("menuitem", { name: "Pin" })).toBeVisible();
    expect(screen.getByRole("menuitem", { name: "Delete" })).toBeVisible();

    await user.click(openNewTabItem);

    expect(openSpy).toHaveBeenCalledWith(
      "/workflows/workflow-1",
      "_blank",
      "noopener,noreferrer",
    );

    await user.click(
      within(launchWorkflowRow as HTMLElement).getByRole("button", {
        name: "Options for Launch Workflow",
      }),
    );
    await user.click(screen.getByRole("menuitem", { name: "Rename" }));

    const renameInput = screen.getByRole("textbox", {
      name: "Rename Launch Workflow",
    });
    await user.clear(renameInput);
    await user.type(renameInput, "Renamed Workflow");
    await user.keyboard("{Enter}");

    await waitFor(() => {
      expect(window.fetch).toHaveBeenCalledWith(
        "/api/workflows",
        expect.objectContaining({
          body: expect.stringContaining('"name":"Renamed Workflow"'),
          method: "PUT",
        }),
      );
    });
    expect(
      await screen.findByRole("button", { name: "Renamed Workflow" }),
    ).toBeInTheDocument();

    const secondWorkflow = screen.getByRole("button", {
      name: "Second Workflow",
    });
    const secondWorkflowRow = secondWorkflow.closest("div");
    await user.hover(secondWorkflow);
    await user.click(
      within(secondWorkflowRow as HTMLElement).getByRole("button", {
        name: "Options for Second Workflow",
      }),
    );
    await user.click(screen.getByRole("menuitem", { name: "Pin" }));

    const workflowRows = screen.getAllByRole("button", {
      name: /^(Second|Renamed) Workflow$/,
    });
    expect(workflowRows.map((row) => row.textContent)).toEqual([
      "Second Workflow",
      "Renamed Workflow",
    ]);
    expect(
      screen
        .getByRole("button", {
          name: "Second Workflow",
        })
        .querySelector("svg"),
    ).not.toBeNull();
    expect(
      screen
        .getByRole("button", {
          name: "Renamed Workflow",
        })
        .querySelector("svg"),
    ).toBeNull();
    expect(window.localStorage.getItem("flowent:pinned-workflows")).toContain(
      "workflow-2",
    );

    await user.click(
      within(secondWorkflowRow as HTMLElement).getByRole("button", {
        name: "Options for Second Workflow",
      }),
    );
    expect(screen.getByRole("menuitem", { name: "Unpin" })).toBeVisible();
    await user.keyboard("{Escape}");

    const renamedWorkflow = screen.getByRole("button", {
      name: "Renamed Workflow",
    });
    const renamedWorkflowRow = renamedWorkflow.closest("div");
    await user.hover(renamedWorkflow);
    await user.click(
      within(renamedWorkflowRow as HTMLElement).getByRole("button", {
        name: "Options for Renamed Workflow",
      }),
    );
    await user.click(screen.getByRole("menuitem", { name: "Delete" }));

    await waitFor(() => {
      expect(window.fetch).toHaveBeenCalledWith(
        "/api/workflows/workflow-1",
        expect.objectContaining({ method: "DELETE" }),
      );
    });
    expect(
      screen.queryByRole("button", { name: "Renamed Workflow" }),
    ).not.toBeInTheDocument();
  });

  it("opens workflow history actions from the row context menu", async () => {
    mockAppShellRequests({
      ...selectedProviderState(),
      workflows: [savedWorkflow()],
    });
    render(<App />);

    const launchWorkflow = await screen.findByRole("button", {
      name: "Launch Workflow",
    });

    fireEvent.contextMenu(launchWorkflow, { clientX: 120, clientY: 240 });

    const openNewTabItem = await screen.findByRole("menuitem", {
      name: "Open new tab",
    });
    expect(openNewTabItem).toBeVisible();
    expect(
      openNewTabItem.closest('[data-slot="context-menu-content"]'),
    ).not.toBeNull();
    expect(
      openNewTabItem.closest('[data-slot="dropdown-menu-content"]'),
    ).toBeNull();
    expect(screen.getByRole("menuitem", { name: "Rename" })).toBeVisible();
    expect(screen.getByRole("menuitem", { name: "Pin" })).toBeVisible();
    expect(screen.getByRole("menuitem", { name: "Delete" })).toBeVisible();
  });

  it("shows the mobile sidebar as an overlay drawer", async () => {
    const restoreViewport = mockNarrowSidebarViewport();
    const user = userEvent.setup();
    mockAppShellRequests({
      ...selectedProviderState(),
      workflows: [savedWorkflow()],
    });

    try {
      render(<App />);

      await user.click(await screen.findByRole("button", { name: "Menu" }));

      const dialog = await screen.findByRole("dialog", {
        name: "Navigation",
      });
      expect(dialog.className).toContain(
        "data-[state=open]:slide-in-from-left-full",
      );
      expect(dialog.className).toContain(
        "data-[state=closed]:slide-out-to-left-full",
      );
      expect(dialog).toHaveClass("flowent-mobile-sidebar-drawer");
      expect(dialog).toHaveClass("duration-300");
      expect(
        document.querySelector('[data-slot="dialog-overlay"]'),
      ).toHaveClass("flowent-mobile-sidebar-overlay", "duration-300");

      const mobileNavigation = within(dialog).getByRole("navigation", {
        name: "Mobile navigation",
      });

      expect(
        within(mobileNavigation).getByRole("tab", { name: "Workspace" }),
      ).toBeInTheDocument();
      expect(
        within(mobileNavigation).getByRole("tab", { name: "Skills" }),
      ).toBeInTheDocument();
      expect(within(mobileNavigation).getByText("Tools")).toBeInTheDocument();
      expect(within(mobileNavigation).getByText("Setup")).toBeInTheDocument();
      expect(
        within(mobileNavigation).getByRole("button", {
          name: "Launch Workflow",
        }),
      ).toBeInTheDocument();
      expect(within(dialog).getByText("OpenAI")).toBeInTheDocument();

      await user.click(
        within(mobileNavigation).getByRole("tab", { name: "Skills" }),
      );

      await waitFor(() => {
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      });

      await user.click(screen.getByRole("button", { name: "Menu" }));
      await user.keyboard("{Escape}");

      await waitFor(() => {
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      });
    } finally {
      restoreViewport();
    }
  });

  it("closes the mobile sidebar after selecting a workflow", async () => {
    const restoreViewport = mockNarrowSidebarViewport();
    const user = userEvent.setup();
    mockAppShellRequests({
      ...selectedProviderState(),
      workflows: [savedWorkflow()],
    });

    try {
      render(<App />);

      await user.click(await screen.findByRole("button", { name: "Menu" }));
      const dialog = await screen.findByRole("dialog", {
        name: "Navigation",
      });
      await user.click(
        within(dialog).getByRole("button", { name: "Launch Workflow" }),
      );

      await waitFor(() => {
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      });
      expect(window.location.pathname).toBe("/workflows/workflow-1");
    } finally {
      restoreViewport();
    }
  });

  it("collapses and expands the Workflows history section", async () => {
    const user = userEvent.setup();
    mockAppShellRequests({
      ...selectedProviderState(),
      workflows: [savedWorkflow()],
    });
    render(<App />);

    expect(
      await screen.findByRole("button", { name: "Launch Workflow" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Workflows" }));

    await waitFor(() => {
      expect(
        screen.queryByRole("button", { name: "Launch Workflow" }),
      ).not.toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Workflows" }));

    expect(
      await screen.findByRole("button", { name: "Launch Workflow" }),
    ).toBeInTheDocument();
  });

  it("collapses and expands the sidebar from the brand controls", async () => {
    const user = userEvent.setup();
    mockAppShellRequests({
      ...selectedProviderState(),
      workflows: [savedWorkflow()],
    });
    render(<App />);

    expect(screen.getByText("Flowent")).toBeInTheDocument();
    expect(screen.getByText("Tools")).toHaveClass("pt-4", "pb-1");
    expect(screen.getByText("Tools")).not.toHaveClass("mt-4", "mb-1");
    expect(screen.getByRole("button", { name: "Workflows" })).not.toHaveClass(
      "mt-4",
    );

    await user.click(screen.getByRole("button", { name: "Collapse sidebar" }));

    await waitFor(() => {
      expect(screen.queryByText("Flowent")).not.toBeInTheDocument();
    });
    expect(screen.getByRole("tab", { name: "Workspace" })).toHaveClass(
      "flowent-sidebar-rail-item",
    );
    expect(document.querySelector(".flowent-sidebar-rail-logo")).toBeTruthy();
    expect(document.querySelector(".flowent-sidebar-rail-status")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Expand sidebar" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Expand sidebar from Flowent" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Workflows" }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Expand sidebar" }));

    expect(screen.getByText("Flowent")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Workspace" })).not.toHaveClass(
      "flowent-sidebar-rail-item",
    );
    expect(document.querySelector(".flowent-sidebar-rail-logo")).toBeNull();
    expect(document.querySelector(".flowent-sidebar-rail-status")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Collapse sidebar" }),
    ).toBeInTheDocument();
  });

  it("toggles the sidebar from the sidebar boundary", async () => {
    const user = userEvent.setup();
    mockAppShellRequests({
      ...selectedProviderState(),
      workflows: [savedWorkflow()],
    });
    render(<App />);

    const boundary = screen.getByRole("button", {
      name: "Toggle sidebar from boundary",
    });
    expect(boundary).toHaveClass(
      "hover:bg-transparent",
      "focus-visible:bg-transparent",
      "active:bg-transparent",
      "dark:hover:bg-transparent",
    );
    expect(boundary).not.toHaveClass(
      "hover:bg-white/10",
      "focus-visible:bg-white/10",
    );

    await user.click(boundary);

    expect(
      await screen.findByRole("button", { name: "Expand sidebar" }),
    ).toBeInTheDocument();

    await user.click(boundary);

    expect(
      await screen.findByRole("button", { name: "Collapse sidebar" }),
    ).toBeInTheDocument();
  });

  it("resizes, remembers, and resets the desktop sidebar width", async () => {
    mockAppShellRequests({
      ...selectedProviderState(),
      workflows: [savedWorkflow()],
    });
    render(<App />);

    const boundary = screen.getByRole("button", {
      name: "Toggle sidebar from boundary",
    });
    const appShell = boundary.closest('[data-slot="tabs"]');
    expect(appShell).toHaveStyle({
      gridTemplateColumns: "232px minmax(0, 1fr)",
    });

    fireEvent.pointerDown(boundary, { button: 0, clientX: 232 });
    fireEvent.pointerMove(window, { clientX: 300 });
    fireEvent.pointerUp(window);

    await waitFor(() => {
      expect(appShell).toHaveStyle({
        gridTemplateColumns: "300px minmax(0, 1fr)",
      });
    });
    expect(window.localStorage.getItem("flowent:sidebar-width")).toBe("300");

    fireEvent.doubleClick(boundary);

    await waitFor(() => {
      expect(appShell).toHaveStyle({
        gridTemplateColumns: "232px minmax(0, 1fr)",
      });
    });
    expect(window.localStorage.getItem("flowent:sidebar-width")).toBe("232");
  });

  it("restores the saved desktop sidebar width on reload", () => {
    window.localStorage.setItem("flowent:sidebar-width", "312");
    mockAppShellRequests({
      ...selectedProviderState(),
      workflows: [savedWorkflow()],
    });
    render(<App />);

    const boundary = screen.getByRole("button", {
      name: "Toggle sidebar from boundary",
    });

    expect(boundary.closest('[data-slot="tabs"]')).toHaveStyle({
      gridTemplateColumns: "312px minmax(0, 1fr)",
    });
  });

  it("toggles the sidebar with Control+B", async () => {
    mockAppShellRequests({
      ...selectedProviderState(),
      workflows: [savedWorkflow()],
    });
    render(<App />);

    fireEvent.keyDown(window, { code: "KeyB", ctrlKey: true });

    expect(
      await screen.findByRole("button", { name: "Expand sidebar" }),
    ).toBeInTheDocument();

    fireEvent.keyDown(window, { code: "KeyB", ctrlKey: true });

    expect(
      await screen.findByRole("button", { name: "Collapse sidebar" }),
    ).toBeInTheDocument();
  });
});
