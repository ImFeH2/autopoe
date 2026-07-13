import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import App from "@/App";
import { mockPermissionsAppRequests } from "@/test/permissions-app-harness";

const savedPath = {
  created_at: 1710000000,
  path: "/workspace/.cache/pnpm",
};

describe("Writable path permissions", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    window.history.replaceState({}, "", "/");
    window.localStorage.clear();
  });

  it("opens Permissions from the sidebar", async () => {
    const user = userEvent.setup();
    mockPermissionsAppRequests();
    render(<App />);

    await user.click(screen.getByRole("tab", { name: "Permissions" }));

    expect(
      await screen.findByRole("region", { name: "Permissions" }),
    ).toBeInTheDocument();
    expect(screen.getByText("No paths")).toBeInTheDocument();
  });

  it("lists saved writable paths in Permissions", async () => {
    const user = userEvent.setup();
    mockPermissionsAppRequests({ initialPaths: [savedPath] });
    render(<App />);

    await user.click(screen.getByRole("tab", { name: "Permissions" }));

    expect(screen.getByText(savedPath.path)).toBeInTheDocument();
  });

  it("deletes a saved writable path from Permissions", async () => {
    const user = userEvent.setup();
    mockPermissionsAppRequests({ initialPaths: [savedPath] });
    render(<App />);

    await user.click(screen.getByRole("tab", { name: "Permissions" }));
    await user.click(screen.getByRole("button", { name: "Remove" }));

    await waitFor(() => {
      expect(screen.queryByText(savedPath.path)).not.toBeInTheDocument();
    });
    expect(window.fetch).toHaveBeenCalledWith(
      "/api/permissions/writable-paths",
      expect.objectContaining({
        body: JSON.stringify({ path: savedPath.path }),
        method: "DELETE",
      }),
    );
    expect(screen.getByText("No paths")).toBeInTheDocument();
  });

  it("adds a writable path from Permissions", async () => {
    const user = userEvent.setup();
    mockPermissionsAppRequests();
    render(<App />);

    await user.click(screen.getByRole("tab", { name: "Permissions" }));
    await user.type(screen.getByLabelText("Directory path"), savedPath.path);
    await user.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() => {
      expect(screen.getByText(savedPath.path)).toBeInTheDocument();
    });
    expect(window.fetch).toHaveBeenCalledWith(
      "/api/permissions/writable-paths",
      expect.objectContaining({
        body: JSON.stringify({ path: savedPath.path }),
        method: "POST",
      }),
    );
    expect(screen.getByLabelText("Directory path")).toHaveValue("");
    expect(screen.queryByText("No paths")).not.toBeInTheDocument();
  });

  it("blocks duplicate writable paths from Permissions", async () => {
    const user = userEvent.setup();
    mockPermissionsAppRequests({ initialPaths: [savedPath] });
    render(<App />);

    await user.click(screen.getByRole("tab", { name: "Permissions" }));
    await user.type(
      screen.getByLabelText("Directory path"),
      ` ${savedPath.path} `,
    );
    await user.click(screen.getByRole("button", { name: "Add" }));

    expect(screen.getByText("Path already exists")).toBeInTheDocument();
    expect(window.fetch).not.toHaveBeenCalledWith(
      "/api/permissions/writable-paths",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("keeps Add disabled when the writable path input is empty", async () => {
    const user = userEvent.setup();
    mockPermissionsAppRequests();
    render(<App />);

    await user.click(screen.getByRole("tab", { name: "Permissions" }));

    expect(screen.getByRole("button", { name: "Add" })).toBeDisabled();

    await user.type(screen.getByLabelText("Directory path"), "   ");

    expect(screen.getByRole("button", { name: "Add" })).toBeDisabled();
    expect(window.fetch).not.toHaveBeenCalledWith(
      "/api/permissions/writable-paths",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("shows an error when a writable path cannot be added", async () => {
    const user = userEvent.setup();
    mockPermissionsAppRequests({ addFailure: true });
    render(<App />);

    await user.click(screen.getByRole("tab", { name: "Permissions" }));
    await user.type(screen.getByLabelText("Directory path"), "/tmp/cache");
    await user.click(screen.getByRole("button", { name: "Add" }));

    expect(
      await screen.findByText("Directory could not be added."),
    ).toBeInTheDocument();
    expect(screen.queryByText("/tmp/cache")).not.toBeInTheDocument();
  });
});
